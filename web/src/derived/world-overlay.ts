// The fictional world rendered as CRISP VECTOR map art (replaces the blurry
// raster overlays for the "world" look). Built from world-vector.ts:
//
//   • biome fills      — clean polygons, one fill layer per biome color
//   • coastline stroke — the post-shift shoreline as a defined line + soft halo
//   • rivers           — hydrology drainage polylines on top
//
// Self-contained: its own sources/layers, inserted just above the basemap so
// the real roads still read faintly beneath if the Reference layer is on, but
// the world reads as a drawn map. Baked once from a DEM block; cached.

import type { Map as MlMap, GeoJSONSource, ExpressionSpecification } from "maplibre-gl";
import type { FeatureCollection, LineString } from "geojson";
import { AOI } from "../config";
import type { FeatureData } from "../layers/features";
import { climateInputs, type ClimateInputs } from "./climate";
import { loadDemBlock, type DemBlock } from "./elevation";
import { getHydrology } from "./hydrology";
import { traceWorld, type WorldVectors } from "./world-vector";

const LAND_SRC = "rc-world-land";
const BIOME_SRC = "rc-world-biome";
const RIVER_SRC = "rc-world-river";
const COAST_LINE = "rc-world-coast";
const COAST_HALO = "rc-world-coast-halo";
const BIOME_FILL = "rc-world-biome-fill";
const RIVER_LINE = "rc-world-river-line";

const RIVER_MIN = 46;
const COAST_COLOR = "#3a566b";
const RIVER_COLOR = "#5f9bc4";

type StatusFn = (msg: string, kind?: "info" | "error") => void;

export class WorldOverlay {
  private map: MlMap;
  private onStatus: StatusFn;
  private visible = false;
  private added = false;
  private block: DemBlock | null = null;
  private baking: Promise<void> | null = null;

  constructor(map: MlMap, onStatus: StatusFn = () => {}) {
    this.map = map;
    this.onStatus = onStatus;
  }

  isVisible(): boolean {
    return this.visible;
  }

  setVisible(visible: boolean, data?: FeatureData): void {
    this.visible = visible;
    if (visible && !this.added) {
      if (data) void this.build(data);
      return;
    }
    if (!this.added) return;
    const v = visible ? "visible" : "none";
    for (const id of [BIOME_FILL, COAST_HALO, COAST_LINE, RIVER_LINE]) {
      if (this.map.getLayer(id)) this.map.setLayoutProperty(id, "visibility", v);
    }
  }

  /** (Re)bake the vector world and show it. Cheap after the first DEM load. */
  async build(data: FeatureData): Promise<void> {
    if (this.baking) return this.baking;
    this.baking = this.bake(climateInputs(data.worldSettings)).finally(() => {
      this.baking = null;
    });
    return this.baking;
  }

  private async bake(inp: ClimateInputs): Promise<void> {
    const [w, s, e, n] = AOI.climateExtent;
    this.onStatus("Drawing the world (tracing coastline & regions)…");
    try {
      if (!this.block) this.block = await loadDemBlock(w, s, e, n);
      const vectors = traceWorld(this.block, inp);
      const rivers = await this.riverLines(inp);
      this.render(vectors, rivers);
      this.onStatus("World drawn.");
    } catch (err) {
      this.onStatus(err instanceof Error ? err.message : String(err), "error");
    }
  }

  /** Build river polylines by following the hydrology drainage downstream. */
  private async riverLines(inp: ClimateInputs): Promise<FeatureCollection<LineString>> {
    const hydro = await getHydrology(inp);
    return hydro.toRiverLines(RIVER_MIN);
  }

  private biomeFillColor(): ExpressionSpecification {
    return ["get", "color"] as ExpressionSpecification;
  }

  private render(vectors: WorldVectors, rivers: FeatureCollection<LineString>): void {
    // Biome fills: one FeatureCollection, color carried per feature.
    const biomeFC: FeatureCollection = {
      type: "FeatureCollection",
      features: vectors.biomes.map((b) => ({
        type: "Feature",
        geometry: b.geometry,
        properties: { color: b.color, biome: b.biomeId, label: b.label },
      })),
    };

    const setOrAdd = (id: string, fc: FeatureCollection) => {
      const src = this.map.getSource(id) as GeoJSONSource | undefined;
      if (src) src.setData(fc);
    };

    if (this.added) {
      setOrAdd(BIOME_SRC, biomeFC);
      setOrAdd(LAND_SRC, vectors.land as FeatureCollection);
      setOrAdd(RIVER_SRC, rivers as FeatureCollection);
      return;
    }

    // First build: add sources + layers, just above the basemap (osm).
    const before = this.map.getLayer("rc-location-circle") ? "rc-location-circle" : undefined;
    this.map.addSource(BIOME_SRC, { type: "geojson", data: biomeFC });
    this.map.addSource(LAND_SRC, { type: "geojson", data: vectors.land as FeatureCollection });
    this.map.addSource(RIVER_SRC, { type: "geojson", data: rivers as FeatureCollection });

    const vis = this.visible ? "visible" : "none";

    this.map.addLayer(
      {
        id: BIOME_FILL,
        type: "fill",
        source: BIOME_SRC,
        layout: { visibility: vis },
        paint: { "fill-color": this.biomeFillColor(), "fill-opacity": 0.92, "fill-antialias": true },
      },
      before,
    );
    // Coastline halo (soft, light) then the crisp line on top of the land edge.
    this.map.addLayer(
      {
        id: COAST_HALO,
        type: "line",
        source: LAND_SRC,
        layout: { visibility: vis, "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#dfeaf2", "line-width": 4, "line-opacity": 0.5, "line-blur": 2 },
      },
      before,
    );
    this.map.addLayer(
      {
        id: COAST_LINE,
        type: "line",
        source: LAND_SRC,
        layout: { visibility: vis, "line-cap": "round", "line-join": "round" },
        paint: { "line-color": COAST_COLOR, "line-width": 1.2 },
      },
      before,
    );
    this.map.addLayer(
      {
        id: RIVER_LINE,
        type: "line",
        source: RIVER_SRC,
        layout: { visibility: vis, "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": RIVER_COLOR,
          "line-opacity": 0.85,
          "line-width": ["interpolate", ["linear"], ["get", "strength"], 46, 0.6, 100, 3.2],
        },
      },
      before,
    );
    this.added = true;
  }
}
