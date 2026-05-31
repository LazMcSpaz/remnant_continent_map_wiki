// Full-map climate overlay (DERIVED, Phase 2).
//
// A **static raster**. Over a fixed extent (config AOI.climateExtent) we sample
// the real DEM once into an in-memory block, run the climate rules at every
// raster pixel, and bake the result into canvases:
//
//   • a **climate** raster — temperature / rain / biome (switchable)
//   • a **sea-level** raster — the flooded cells (below the post-shift sea level)
//
// Each is shown through a MapLibre `image` source + `raster` layer with linear
// resampling, so the GPU interpolates between pixels: soft coastlines and zone
// boundaries instead of blocky rectangles. Computed **once** (lazily, on first
// toggle-on) and cached — toggling is just a visibility flip, switching the
// metric just re-paints from the stored field (no resampling), and a season
// scrub re-bakes from the cached DEM block (no re-fetch). It never recomputes
// on pan/zoom. Holds no authored data; the per-region derived map (for the
// terrain panel) is kept alongside.

import type { Map as MlMap, ImageSource } from "maplibre-gl";
import { AOI } from "../config";
import type { FeatureData } from "../layers/features";
import {
  deriveClimate,
  climateInputs,
  climateAt,
  temperatureAt,
  seaLevelAt,
  biomeAt,
  BIOME_LEGEND,
  type ClimateInputs,
  type GridMetric,
  type RegionDerived,
} from "./climate";
import { loadDemBlock, elevationFromBlock, type DemBlock } from "./elevation";

const SRC = "rc-climate";
const FILL = "rc-climate-fill";
const WATER_SRC = "rc-water";
const WATER = "rc-water-fill";

// Raster resolution. The GPU upsamples this with linear filtering, so a moderate
// grid renders smoothly at any zoom; this many pixels keeps the bake quick.
const RASTER_W = 768;

type RGB = [number, number, number];

interface RampStop {
  v: number;
  c: RGB;
}

/** Legend/ramp metadata, shared by the canvas painter and the legend UI. */
export interface RampLegend {
  title: string;
  unit: string;
  stops: Array<{ v: number; color: string }>;
}

const TEMP_STOPS: RampStop[] = [
  { v: -30, c: [59, 76, 192] },
  { v: -10, c: [122, 160, 255] },
  { v: 0, c: [185, 208, 255] },
  { v: 10, c: [255, 233, 176] },
  { v: 20, c: [255, 178, 74] },
  { v: 30, c: [232, 93, 58] },
  { v: 40, c: [160, 16, 16] },
];

const PRECIP_STOPS: RampStop[] = [
  { v: 0, c: [201, 169, 106] },
  { v: 20, c: [216, 201, 138] },
  { v: 40, c: [169, 201, 122] },
  { v: 60, c: [95, 174, 107] },
  { v: 80, c: [47, 139, 107] },
  { v: 100, c: [31, 111, 139] },
];

function hex(c: RGB): string {
  return "#" + c.map((n) => Math.round(n).toString(16).padStart(2, "0")).join("");
}

export const TEMP_LEGEND: RampLegend = {
  title: "Temperature",
  unit: "°C",
  stops: TEMP_STOPS.map((s) => ({ v: s.v, color: hex(s.c) })),
};
export const PRECIP_LEGEND: RampLegend = {
  title: "Precipitation",
  unit: "",
  stops: PRECIP_STOPS.map((s) => ({ v: s.v, color: hex(s.c) })),
};

/** Interpolate an RGB colour from value-keyed ramp stops. */
function ramp(value: number, stops: RampStop[]): RGB {
  if (value <= stops[0].v) return stops[0].c;
  const last = stops[stops.length - 1];
  if (value >= last.v) return last.c;
  for (let i = 1; i < stops.length; i++) {
    if (value <= stops[i].v) {
      const a = stops[i - 1];
      const b = stops[i];
      const t = (value - a.v) / (b.v - a.v);
      return [
        a.c[0] + (b.c[0] - a.c[0]) * t,
        a.c[1] + (b.c[1] - a.c[1]) * t,
        a.c[2] + (b.c[2] - a.c[2]) * t,
      ];
    }
  }
  return last.c;
}

/** id → index/RGB for biomes, so a Uint8 field can carry biome per pixel. */
const BIOME_IDX = new Map(BIOME_LEGEND.map((b, i) => [b.id, i]));
const BIOME_RGB: RGB[] = BIOME_LEGEND.map((b) => {
  const n = parseInt(b.color.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
});

interface Field {
  w: number;
  h: number;
  temp: Float32Array;
  precip: Uint8Array;
  biome: Uint8Array;
  water: Uint8Array;
}

type StatusFn = (msg: string, kind?: "info" | "error") => void;

export class ClimateOverlay {
  private map: MlMap;
  private onStatus: StatusFn;
  private metric: GridMetric = "temperature";
  private visible = false;
  private waterVisible = false;
  private added = false;
  private inp: ClimateInputs;
  private derived: Map<string, RegionDerived> = new Map();
  private block: DemBlock | null = null;
  private field: Field | null = null;
  private baking: Promise<void> | null = null;
  private rebakeTimer: number | undefined;
  private coords: [[number, number], [number, number], [number, number], [number, number]];

  constructor(map: MlMap, onStatus: StatusFn = () => {}) {
    this.map = map;
    this.onStatus = onStatus;
    this.inp = climateInputs(null);
    const [w, s, e, n] = AOI.climateExtent;
    this.coords = [[w, n], [e, n], [e, s], [w, s]];
  }

  /** New authored inputs: refresh per-region derived; re-bake the field if the
   *  overlay is already built (cheap — reuses the cached DEM block). */
  recompute(data: FeatureData): void {
    this.inp = climateInputs(data.worldSettings);
    this.derived = deriveClimate(data.terrainRegions, data.worldSettings);
    if (this.field && this.block) {
      // Debounce: a season scrub fires this on every tick, but re-baking the
      // whole raster is heavy. Coalesce rapid calls into one repaint.
      window.clearTimeout(this.rebakeTimer);
      this.rebakeTimer = window.setTimeout(() => {
        if (this.block) {
          this.sampleField(this.block);
          this.repaint();
        }
      }, 120);
    }
  }

  /** Sample the climate field across the raster from a loaded DEM block. */
  private sampleField(block: DemBlock): void {
    const [w, s, e, n] = AOI.climateExtent;
    const aspect = (n - s) / (e - w);
    const W = RASTER_W;
    const H = Math.max(1, Math.round(W * aspect));
    const temp = new Float32Array(W * H);
    const precip = new Uint8Array(W * H);
    const biome = new Uint8Array(W * H);
    const water = new Uint8Array(W * H);
    const inp = this.inp;
    for (let j = 0; j < H; j++) {
      // Top row = north. Sample at pixel centres.
      const lat = n - ((j + 0.5) / H) * (n - s);
      for (let i = 0; i < W; i++) {
        const lng = w + ((i + 0.5) / W) * (e - w);
        const elev = elevationFromBlock(block, lng, lat) ?? 0;
        const sea = seaLevelAt([lng, lat], inp);
        const isWater = elev <= sea;
        const maritime = isWater ? 1 : 0;
        const c = climateAt([lng, lat], elev, inp, { maritime, isWater });
        const meanT = temperatureAt([lng, lat], elev, { ...inp, season: 0.25 }, maritime);
        const b = biomeAt(meanT, c.precip, isWater);
        const k = j * W + i;
        temp[k] = c.tempC;
        precip[k] = c.precip;
        biome[k] = BIOME_IDX.get(b.id) ?? 0;
        water[k] = isWater ? 1 : 0;
      }
    }
    this.field = { w: W, h: H, temp, precip, biome, water };
  }

  /** Paint the climate canvas for the active metric → a data URL. */
  private climateDataUrl(): string {
    const f = this.field!;
    const cv = document.createElement("canvas");
    cv.width = f.w;
    cv.height = f.h;
    const ctx = cv.getContext("2d")!;
    const img = ctx.createImageData(f.w, f.h);
    const d = img.data;
    for (let k = 0; k < f.w * f.h; k++) {
      let rgb: RGB;
      if (this.metric === "temperature") rgb = ramp(f.temp[k], TEMP_STOPS);
      else if (this.metric === "precip") rgb = ramp(f.precip[k], PRECIP_STOPS);
      else rgb = BIOME_RGB[f.biome[k]];
      const o = k * 4;
      d[o] = rgb[0];
      d[o + 1] = rgb[1];
      d[o + 2] = rgb[2];
      d[o + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return cv.toDataURL("image/png");
  }

  /** Paint the sea-level canvas (only flooded pixels are opaque) → data URL. */
  private waterDataUrl(): string {
    const f = this.field!;
    const cv = document.createElement("canvas");
    cv.width = f.w;
    cv.height = f.h;
    const ctx = cv.getContext("2d")!;
    const img = ctx.createImageData(f.w, f.h);
    const d = img.data;
    const [wr, wg, wb] = BIOME_RGB[BIOME_IDX.get("water")!];
    for (let k = 0; k < f.w * f.h; k++) {
      const o = k * 4;
      if (f.water[k]) {
        d[o] = wr;
        d[o + 1] = wg;
        d[o + 2] = wb;
        d[o + 3] = 255;
      } else {
        d[o + 3] = 0;
      }
    }
    ctx.putImageData(img, 0, 0);
    return cv.toDataURL("image/png");
  }

  /** Re-push both rasters into their image sources (after a re-bake/metric). */
  private repaint(): void {
    if (!this.added || !this.field) return;
    (this.map.getSource(SRC) as ImageSource | undefined)?.updateImage({ url: this.climateDataUrl() });
    (this.map.getSource(WATER_SRC) as ImageSource | undefined)?.updateImage({ url: this.waterDataUrl() });
  }

  /** Build the field + layers once (lazily). Subsequent calls are no-ops. */
  private async ensureBuilt(): Promise<void> {
    if (this.field && this.added) return;
    if (this.baking) return this.baking;
    this.baking = (async () => {
      const [w, s, e, n] = AOI.climateExtent;
      this.onStatus("Computing climate field (sampling elevation)…");
      try {
        if (!this.block) this.block = await loadDemBlock(w, s, e, n);
        this.sampleField(this.block);
        this.add();
        this.onStatus("Climate field ready.");
      } catch (err) {
        this.onStatus(err instanceof Error ? err.message : String(err), "error");
      } finally {
        this.baking = null;
      }
    })();
    return this.baking;
  }

  private add(): void {
    const before = this.map.getLayer("rc-location-circle") ? "rc-location-circle" : undefined;
    if (!this.map.getSource(SRC)) {
      this.map.addSource(SRC, { type: "image", url: this.climateDataUrl(), coordinates: this.coords });
      this.map.addLayer(
        {
          id: FILL,
          type: "raster",
          source: SRC,
          layout: { visibility: this.visible ? "visible" : "none" },
          paint: { "raster-opacity": 0.6, "raster-resampling": "linear", "raster-fade-duration": 0 },
        },
        before,
      );
    }
    if (!this.map.getSource(WATER_SRC)) {
      this.map.addSource(WATER_SRC, { type: "image", url: this.waterDataUrl(), coordinates: this.coords });
      // Sea level above the climate fill (so flooding reads), below markers.
      this.map.addLayer(
        {
          id: WATER,
          type: "raster",
          source: WATER_SRC,
          layout: { visibility: this.waterVisible ? "visible" : "none" },
          paint: { "raster-opacity": 0.66, "raster-resampling": "linear", "raster-fade-duration": 0 },
        },
        before,
      );
    }
    this.added = true;
  }

  setMetric(metric: GridMetric): void {
    this.metric = metric;
    if (this.added && this.field) {
      (this.map.getSource(SRC) as ImageSource | undefined)?.updateImage({ url: this.climateDataUrl() });
    }
  }

  getMetric(): GridMetric {
    return this.metric;
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    if (visible && !this.added) void this.ensureBuilt();
    else if (this.added) this.map.setLayoutProperty(FILL, "visibility", visible ? "visible" : "none");
  }

  isVisible(): boolean {
    return this.visible;
  }

  /** Toggle the sea-level (inundation) raster independently of the climate one. */
  setWaterVisible(visible: boolean): void {
    this.waterVisible = visible;
    if (visible && !this.added) void this.ensureBuilt();
    else if (this.added) this.map.setLayoutProperty(WATER, "visibility", visible ? "visible" : "none");
  }

  isWaterVisible(): boolean {
    return this.waterVisible;
  }

  /** Per-region derived values (used by the terrain panel). */
  get(id: string): RegionDerived | undefined {
    return this.derived.get(id);
  }
}
