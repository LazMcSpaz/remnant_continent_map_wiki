// Rivers overlay (DERIVED). Renders the hydrology drainage network as a static
// raster image layer (same approach as the climate overlay): bake the river
// strength into a canvas once, show it through an `image` source + `raster`
// layer with linear resampling so channels read as soft blue veins rather than
// blocky cells. Lazily computed on first toggle-on and cached; toggling is a
// visibility flip. Recomputes when the hydrology inputs change (the pole).

import type { Map as MlMap, ImageSource } from "maplibre-gl";
import { AOI } from "../config";
import { climateInputs, type ClimateInputs } from "./climate";
import type { FeatureData } from "../layers/features";
import { getHydrology } from "./hydrology";

const SRC = "rc-rivers";
const LAYER = "rc-rivers-fill";

// Below this strength a cell isn't drawn (drizzle/sheet-flow, not a channel).
const RIVER_MIN = 38;

type StatusFn = (msg: string, kind?: "info" | "error") => void;

export class RiversOverlay {
  private map: MlMap;
  private onStatus: StatusFn;
  private inp: ClimateInputs;
  private visible = false;
  private added = false;
  private baking: Promise<void> | null = null;
  private coords: [[number, number], [number, number], [number, number], [number, number]];

  constructor(map: MlMap, onStatus: StatusFn = () => {}) {
    this.map = map;
    this.onStatus = onStatus;
    this.inp = climateInputs(null);
    const [w, s, e, n] = AOI.climateExtent;
    this.coords = [[w, n], [e, n], [e, s], [w, s]];
  }

  recompute(data: FeatureData): void {
    this.inp = climateInputs(data.worldSettings);
    if (this.added) {
      this.added = false; // force a re-bake with the new drainage on next show
      if (this.visible) void this.ensureBuilt();
    }
  }

  private dataUrl(strength: Float32Array, w: number, h: number): string {
    const cv = document.createElement("canvas");
    cv.width = w;
    cv.height = h;
    const ctx = cv.getContext("2d")!;
    const img = ctx.createImageData(w, h);
    const d = img.data;
    for (let k = 0; k < w * h; k++) {
      const o = k * 4;
      const s = strength[k];
      if (s < RIVER_MIN) {
        d[o + 3] = 0;
        continue;
      }
      // Strength → opacity (stronger channels more solid); colour matches lakes.
      const t = Math.min(1, (s - RIVER_MIN) / (100 - RIVER_MIN));
      d[o] = 0x6f;
      d[o + 1] = 0xa8;
      d[o + 2] = 0xc6;
      d[o + 3] = Math.round((0.35 + 0.65 * t) * 255);
    }
    ctx.putImageData(img, 0, 0);
    return cv.toDataURL("image/png");
  }

  private async ensureBuilt(): Promise<void> {
    if (this.added) return;
    if (this.baking) return this.baking;
    this.baking = (async () => {
      this.onStatus("Tracing rivers (DEM flow accumulation)…");
      try {
        const h = await getHydrology(this.inp);
        const url = this.dataUrl(h.strength, h.w, h.h);
        const before = this.map.getLayer("rc-location-circle") ? "rc-location-circle" : undefined;
        const src = this.map.getSource(SRC);
        if (src) {
          (src as ImageSource).updateImage({ url });
        } else {
          this.map.addSource(SRC, { type: "image", url, coordinates: this.coords });
          this.map.addLayer(
            {
              id: LAYER,
              type: "raster",
              source: SRC,
              layout: { visibility: this.visible ? "visible" : "none" },
              paint: { "raster-opacity": 0.9, "raster-resampling": "linear", "raster-fade-duration": 0 },
            },
            before,
          );
        }
        this.added = true;
        this.onStatus("Rivers ready.");
      } catch (err) {
        this.onStatus(err instanceof Error ? err.message : String(err), "error");
      } finally {
        this.baking = null;
      }
    })();
    return this.baking;
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    if (visible && !this.added) void this.ensureBuilt();
    else if (this.map.getLayer(LAYER)) this.map.setLayoutProperty(LAYER, "visibility", visible ? "visible" : "none");
  }

  isVisible(): boolean {
    return this.visible;
  }
}
