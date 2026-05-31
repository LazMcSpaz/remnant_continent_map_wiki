// Full-map climate overlay (DERIVED, Phase 2).
//
// Replaces the old terrain-polygon choropleth with a rules-based **sampled
// grid**: over the current viewport we lay down a grid of cells, sample the
// real DEM elevation at each cell centre, and run the climate rules
// (climate.ts) to get temperature / precipitation / biome — plus whether the
// cell sits below the post-shift sea level (inundation). One sampling pass
// feeds two independently-toggleable layers:
//
//   • the **climate** fill — coloured by the chosen metric (temp / rain / biome)
//   • the **sea level** fill — the flooded cells, so the new coastline reads at
//     a glance instead of having to be inferred city by city
//
// The grid resamples on pan/zoom (debounced) and samples at a coarser DEM zoom
// when zoomed out, so a continental view touches a handful of tiles, not
// hundreds. Holds no authored data; it paints recomputed values only. The
// per-region derived map (for the terrain panel) is kept alongside.

import type { Map as MlMap, GeoJSONSource, ExpressionSpecification } from "maplibre-gl";
import type { FeatureCollection, Polygon } from "geojson";
import type { FeatureData } from "../layers/features";
import {
  deriveClimate,
  climateInputs,
  climateAt,
  temperatureAt,
  seaLevelAt,
  biomeAt,
  type ClimateInputs,
  type GridMetric,
  type RegionDerived,
} from "./climate";
import { sampleElevation } from "./elevation";

const SRC = "rc-climate";
const FILL = "rc-climate-fill";
const WATER = "rc-water-fill";

interface CellProps {
  temp: number; // °C (current season), drives the temperature ramp
  precip: number; // 0..100, drives the rain ramp
  biomeColor: string; // precomputed biome colour (categorical)
  water: number; // 1 if below post-shift sea level, else 0
}

/** Blue→red ramp for temperature (°C, ~ -30..40). */
function tempColor(): ExpressionSpecification {
  return [
    "interpolate", ["linear"], ["get", "temp"],
    -30, "#3b4cc0",
    -10, "#7aa0ff",
    0, "#b9d0ff",
    10, "#ffe9b0",
    20, "#ffb24a",
    30, "#e85d3a",
    40, "#a01010",
  ];
}

/** Tan→green→teal ramp for precipitation (0..100). */
function precipColor(): ExpressionSpecification {
  return [
    "interpolate", ["linear"], ["get", "precip"],
    0, "#c9a96a",
    20, "#d8c98a",
    40, "#a9c97a",
    60, "#5fae6b",
    80, "#2f8b6b",
    100, "#1f6f8b",
  ];
}

/** Number of grid columns/rows for the current container size (bounded). */
function gridDims(map: MlMap): { cols: number; rows: number } {
  const c = map.getContainer();
  const w = c.clientWidth || 1000;
  const h = c.clientHeight || 700;
  const cols = Math.max(20, Math.min(56, Math.round(w / 26)));
  const rows = Math.max(16, Math.min(44, Math.round(h / 26)));
  return { cols, rows };
}

/** DEM tile zoom for the grid: coarse when zoomed out, fine when zoomed in. */
function demZoomFor(map: MlMap): number {
  return Math.max(3, Math.min(8, Math.round(map.getZoom())));
}

export class ClimateOverlay {
  private map: MlMap;
  private metric: GridMetric = "temperature";
  private visible = false; // climate fill
  private waterVisible = false; // sea-level fill
  private added = false;
  private inp: ClimateInputs;
  private derived: Map<string, RegionDerived> = new Map();
  private token = 0; // cancels stale async grid builds
  private moveTimer: number | undefined;

  constructor(map: MlMap) {
    this.map = map;
    this.inp = climateInputs(null);
    this.map.on("moveend", () => this.onMove());
  }

  /** Recompute from current authored inputs: per-region derived + resample grid. */
  recompute(data: FeatureData): void {
    this.inp = climateInputs(data.worldSettings);
    this.derived = deriveClimate(data.terrainRegions, data.worldSettings);
    void this.buildGrid();
  }

  private onMove(): void {
    if (!this.visible && !this.waterVisible) return;
    window.clearTimeout(this.moveTimer);
    this.moveTimer = window.setTimeout(() => void this.buildGrid(), 250);
  }

  /** Sample the grid over the current viewport and repaint both fills. */
  private async buildGrid(): Promise<void> {
    if (!this.visible && !this.waterVisible) return;
    const token = ++this.token;
    const b = this.map.getBounds();
    const w = b.getWest();
    const s = b.getSouth();
    const e = b.getEast();
    const n = b.getNorth();
    const { cols, rows } = gridDims(this.map);
    const dx = (e - w) / cols;
    const dy = (n - s) / rows;
    const z = demZoomFor(this.map);
    const inp = this.inp;

    const features = await Promise.all(
      Array.from({ length: cols * rows }, async (_unused, k) => {
        const i = k % cols;
        const j = Math.floor(k / cols);
        const x0 = w + i * dx;
        const y0 = s + j * dy;
        const cx = x0 + dx / 2;
        const cy = y0 + dy / 2;
        const elev = (await sampleElevation(cx, cy, z)) ?? 0;
        const sea = seaLevelAt([cx, cy], inp);
        const isWater = elev <= sea;
        const maritime = isWater ? 1 : 0;
        const c = climateAt([cx, cy], elev, inp, { maritime, isWater });
        const meanT = temperatureAt([cx, cy], elev, { ...inp, season: 0.25 }, maritime);
        const biome = biomeAt(meanT, c.precip, isWater);
        const props: CellProps = {
          temp: Math.round(c.tempC),
          precip: c.precip,
          biomeColor: biome.color,
          water: isWater ? 1 : 0,
        };
        const geometry: Polygon = {
          type: "Polygon",
          coordinates: [[
            [x0, y0], [x0 + dx, y0], [x0 + dx, y0 + dy], [x0, y0 + dy], [x0, y0],
          ]],
        };
        return { type: "Feature" as const, geometry, properties: props };
      }),
    );

    if (token !== this.token) return; // a newer build superseded this one
    const fc: FeatureCollection<Polygon, CellProps> = { type: "FeatureCollection", features };
    const src = this.map.getSource(SRC) as GeoJSONSource | undefined;
    if (src) src.setData(fc);
    else this.add(fc);
    this.applyColor();
  }

  private add(fc: FeatureCollection<Polygon, CellProps>): void {
    this.map.addSource(SRC, { type: "geojson", data: fc });
    // Beneath the location markers so cities stay clickable on top.
    const before = this.map.getLayer("rc-location-circle") ? "rc-location-circle" : undefined;
    this.map.addLayer(
      {
        id: FILL,
        type: "fill",
        source: SRC,
        layout: { visibility: this.visible ? "visible" : "none" },
        paint: { "fill-opacity": 0.5, "fill-antialias": false },
      },
      before,
    );
    // Sea level sits above the climate fill (so flooding reads clearly) but
    // still below the markers. Only the inundated cells draw.
    this.map.addLayer(
      {
        id: WATER,
        type: "fill",
        source: SRC,
        filter: ["==", ["get", "water"], 1],
        layout: { visibility: this.waterVisible ? "visible" : "none" },
        paint: { "fill-color": "#1f5d8c", "fill-opacity": 0.62, "fill-antialias": false },
      },
      before,
    );
    this.added = true;
  }

  private applyColor(): void {
    if (!this.added) return;
    const ramp =
      this.metric === "temperature" ? tempColor()
      : this.metric === "precip" ? precipColor()
      : (["get", "biomeColor"] as ExpressionSpecification);
    this.map.setPaintProperty(FILL, "fill-color", ramp);
  }

  setMetric(metric: GridMetric, _data?: FeatureData): void {
    this.metric = metric;
    this.applyColor();
  }

  getMetric(): GridMetric {
    return this.metric;
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    if (visible && !this.added) {
      void this.buildGrid();
    } else if (this.added) {
      this.map.setLayoutProperty(FILL, "visibility", visible ? "visible" : "none");
    }
  }

  isVisible(): boolean {
    return this.visible;
  }

  /** Toggle the sea-level (inundation) fill independently of the climate fill. */
  setWaterVisible(visible: boolean): void {
    this.waterVisible = visible;
    if (visible && !this.added) {
      void this.buildGrid();
    } else if (this.added) {
      this.map.setLayoutProperty(WATER, "visibility", visible ? "visible" : "none");
    }
  }

  isWaterVisible(): boolean {
    return this.waterVisible;
  }

  /** Per-region derived values (used by the terrain panel). */
  get(id: string): RegionDerived | undefined {
    return this.derived.get(id);
  }
}
