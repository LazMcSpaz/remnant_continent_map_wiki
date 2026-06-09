// Topology overlay (DERIVED). Bakes a static raster over AOI.climateExtent that
// combines two relief cues:
//
//   • **Hillshade** — classic Lambert hillshade from the DEM gradient, NW light
//     (azimuth 315°, altitude 45°). Subtle, so underlying features glow through.
//   • **Contour lines** — thin elevation isolines drawn onto the same canvas at a
//     fixed interval (250 m). A pixel is "on" a contour when floor(elev/interval)
//     differs from a horizontal or vertical neighbour. Faint cool grey.
//
// Computed once (lazily, on first toggle-on) and cached. Self-contained: own
// `rc-topology-*` sources/layers, inserted below `rc-location-circle`. Matches
// the image+raster overlay pattern from climate-overlay.

import type { Map as MlMap, ImageSource } from "maplibre-gl";
import { AOI } from "../config";
import { loadDemBlock, elevationFromBlock, type DemBlock } from "./elevation";

const SRC = "rc-topology";
const FILL = "rc-topology-fill";

// Moderate raster width — the GPU upsamples linearly, so this renders smoothly
// at any zoom while keeping the bake quick.
const RASTER_W = 768;

// Contour interval in metres. 250 m gives legible detail without clutter.
const CONTOUR_INTERVAL = 250;

// Hillshade sun direction (NW, elevation 45°).
const SUN_AZ = (315 * Math.PI) / 180; // azimuth in radians
const SUN_ALT = (45 * Math.PI) / 180; // altitude in radians
const SUN_X = Math.cos(SUN_ALT) * Math.cos(SUN_AZ);
const SUN_Y = Math.cos(SUN_ALT) * Math.sin(SUN_AZ);
const SUN_Z = Math.sin(SUN_ALT);

type StatusFn = (msg: string, kind?: "info" | "error") => void;

export class TopologyOverlay {
  private map: MlMap;
  private onStatus: StatusFn;
  private visible = false;
  private added = false;
  private block: DemBlock | null = null;
  private dataUrl: string | null = null;
  private baking: Promise<void> | null = null;
  private coords: [[number, number], [number, number], [number, number], [number, number]];

  constructor(map: MlMap, onStatus: StatusFn = () => {}) {
    this.map = map;
    this.onStatus = onStatus;
    const [w, s, e, n] = AOI.climateExtent;
    this.coords = [[w, n], [e, n], [e, s], [w, s]];
  }

  /** Bake the hillshade + contour canvas into a data URL (called once). */
  private bakeDataUrl(block: DemBlock): string {
    const [w, s, e, n] = AOI.climateExtent;
    const aspect = (n - s) / (e - w);
    const W = RASTER_W;
    const H = Math.max(1, Math.round(W * aspect));

    // Sample the full elevation grid first so we can compute finite differences
    // between adjacent pixels.
    const elev = new Float32Array(W * H);
    for (let j = 0; j < H; j++) {
      const lat = n - ((j + 0.5) / H) * (n - s);
      for (let i = 0; i < W; i++) {
        const lng = w + ((i + 0.5) / W) * (e - w);
        elev[j * W + i] = elevationFromBlock(block, lng, lat) ?? 0;
      }
    }

    // Approximate pixel spacing in metres (used to scale the gradient so
    // hillshade brightness doesn't blow out flat terrain).
    const latMid = (n + s) / 2;
    const cosLat = Math.cos((latMid * Math.PI) / 180);
    const degToM = 111_320;
    const pixW = ((e - w) / W) * degToM * cosLat; // x spacing (m/px)
    const pixH = ((n - s) / H) * degToM;           // y spacing (m/px)

    const cv = document.createElement("canvas");
    cv.width = W;
    cv.height = H;
    const ctx = cv.getContext("2d")!;
    const img = ctx.createImageData(W, H);
    const d = img.data;

    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        const k = j * W + i;
        const e0 = elev[k];

        // --- Hillshade ---
        // Central differences; clamp to edge pixels.
        const iL = i > 0 ? i - 1 : 0;
        const iR = i < W - 1 ? i + 1 : W - 1;
        const jU = j > 0 ? j - 1 : 0;
        const jD = j < H - 1 ? j + 1 : H - 1;
        const dzdx = (elev[j * W + iR] - elev[j * W + iL]) / ((iR - iL) * pixW);
        const dzdy = (elev[jD * W + i] - elev[jU * W + i]) / ((jD - jU) * pixH);
        // Surface normal (unnormalized).
        const nx = -dzdx;
        const ny = dzdy;    // y-axis points north (+elevation uphill)
        const nz = 1.0;
        const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
        // Lambert: dot(normal, sun).
        const dot = (nx / len) * SUN_X + (ny / len) * SUN_Y + (nz / len) * SUN_Z;
        // Compress dynamic range: 0.2 (deep shadow) → 0.75 (bright face).
        const shade = Math.max(0, Math.min(1, dot));
        const brightness = Math.round(0.20 * 255 + shade * 0.55 * 255);

        // --- Contour lines ---
        // A pixel is on a contour when floor(elev/interval) differs from a
        // horizontal or vertical direct neighbour.
        const band = Math.floor(e0 / CONTOUR_INTERVAL);
        const isContour =
          (i < W - 1 && Math.floor(elev[j * W + (i + 1)] / CONTOUR_INTERVAL) !== band) ||
          (j < H - 1 && Math.floor(elev[(j + 1) * W + i] / CONTOUR_INTERVAL) !== band);

        const o = k * 4;
        if (isContour) {
          // Faint cool contour line over hillshade: grey-blue tint, semi-transparent.
          d[o] = 160;
          d[o + 1] = 185;
          d[o + 2] = 200;
          d[o + 3] = 130; // semi-transparent so the basemap shows through
        } else {
          // Hillshade: grey tone, moderate opacity so dark map shows through.
          d[o] = brightness;
          d[o + 1] = brightness;
          d[o + 2] = brightness;
          d[o + 3] = 100; // subtle overlay
        }
      }
    }

    ctx.putImageData(img, 0, 0);
    return cv.toDataURL("image/png");
  }

  /** Build the raster image + layer (lazily; subsequent calls are no-ops). */
  private async ensureBuilt(): Promise<void> {
    if (this.added) return;
    if (this.baking) return this.baking;
    this.baking = (async () => {
      const [w, s, e, n] = AOI.climateExtent;
      this.onStatus("Building topology (hillshade + contours)…");
      try {
        if (!this.block) this.block = await loadDemBlock(w, s, e, n);
        this.dataUrl = this.bakeDataUrl(this.block);
        this.addLayers();
        this.onStatus("Topology layer ready.");
      } catch (err) {
        this.onStatus(err instanceof Error ? err.message : String(err), "error");
      } finally {
        this.baking = null;
      }
    })();
    return this.baking;
  }

  private addLayers(): void {
    const before = this.map.getLayer("rc-location-circle") ? "rc-location-circle" : undefined;
    if (!this.map.getSource(SRC)) {
      this.map.addSource(SRC, {
        type: "image",
        url: this.dataUrl!,
        coordinates: this.coords,
      });
      this.map.addLayer(
        {
          id: FILL,
          type: "raster",
          source: SRC,
          layout: { visibility: this.visible ? "visible" : "none" },
          paint: {
            "raster-opacity": 1,
            "raster-resampling": "linear",
            "raster-fade-duration": 0,
          },
        },
        before,
      );
    }
    this.added = true;
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    if (visible && !this.added) {
      void this.ensureBuilt();
    } else if (this.added) {
      this.map.setLayoutProperty(FILL, "visibility", visible ? "visible" : "none");
      // Keep the source URL current if we have a cached render.
      if (visible && this.dataUrl) {
        (this.map.getSource(SRC) as ImageSource | undefined)?.updateImage({
          url: this.dataUrl,
        });
      }
    }
  }

  isVisible(): boolean {
    return this.visible;
  }
}
