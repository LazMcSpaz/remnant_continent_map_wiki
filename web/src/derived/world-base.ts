// The fictional world as the BASE map (substrate). Instead of a real OSM
// basemap (whose baked-in labels flip upside-down under the new-north rotation
// and whose real roads/names fight the fiction), the default backdrop is our
// own derived world, baked once into a raster over AOI.climateExtent:
//
//   • land  — Whittaker biome colour (from the climate rules), shaded by a
//             DEM hillshade so relief reads like a drawn map
//   • sea   — everything below the post-shift sea level (the inundation),
//             deepening with depth; the map background uses the same SEA colour
//             so the world fades seamlessly into open ocean past the extent
//   • rivers — the hydrology drainage network composited on top of land
//
// Real OSM is demoted to an optional "Reference" layer (see basemap + layers
// control). This module owns only its own source/layer. Baked once, cached;
// rebakes when the pole/sea inputs change.

import type { Map as MlMap, ImageSource } from "maplibre-gl";
import { AOI } from "../config";
import type { FeatureData } from "../layers/features";
import {
  climateInputs,
  climateAt,
  temperatureAt,
  seaLevelAt,
  biomeAt,
  type ClimateInputs,
} from "./climate";
import { loadDemBlock, elevationFromBlock, type DemBlock } from "./elevation";
import { getHydrology, type HydroGrid } from "./hydrology";

/** Cartographic sea colour. The map background uses this too, so the baked
 *  extent blends into open ocean with no hard rectangle edge. */
export const SEA_COLOR = "#a6c9dc";
const SEA_RGB: RGB = [0xa6, 0xc9, 0xdc];
const SEA_DEEP: RGB = [0x5f, 0x8f, 0xb0];
const RIVER_RGB: RGB = [0x6f, 0xa8, 0xc6];

const SRC = "rc-worldbase";
const LAYER = "rc-worldbase-layer";
const BAKE_W = 1024; // base detail; baked once
const RIVER_MIN = 46; // hydrology strength to start drawing a channel

type RGB = [number, number, number];
type StatusFn = (msg: string, kind?: "info" | "error") => void;

export class WorldBase {
  private map: MlMap;
  private onStatus: StatusFn;
  private added = false;
  private block: DemBlock | null = null;
  private baking: Promise<void> | null = null;
  private coords: [[number, number], [number, number], [number, number], [number, number]];

  constructor(map: MlMap, onStatus: StatusFn = () => {}) {
    this.map = map;
    this.onStatus = onStatus;
    const [w, s, e, n] = AOI.climateExtent;
    this.coords = [[w, n], [e, n], [e, s], [w, s]];
  }

  /** Bake (or re-bake) the world from current inputs and show it as the base. */
  async build(data: FeatureData): Promise<void> {
    if (this.baking) return this.baking;
    this.baking = this.bake(climateInputs(data.worldSettings)).finally(() => {
      this.baking = null;
    });
    return this.baking;
  }

  private async bake(inp: ClimateInputs): Promise<void> {
    const [w, s, e, n] = AOI.climateExtent;
    this.onStatus("Rendering the world (sampling terrain)…");
    try {
      if (!this.block) this.block = await loadDemBlock(w, s, e, n);
      const block = this.block;
      const hydro = await getHydrology(inp);

      const W = BAKE_W;
      const H = Math.max(1, Math.round(W * ((n - s) / (e - w))));
      const cv = document.createElement("canvas");
      cv.width = W;
      cv.height = H;
      const ctx = cv.getContext("2d")!;
      const img = ctx.createImageData(W, H);
      const d = img.data;

      const dLng = (e - w) / W;
      const dLat = (n - s) / H;

      for (let j = 0; j < H; j++) {
        const lat = n - (j + 0.5) * dLat;
        for (let i = 0; i < W; i++) {
          const lng = w + (i + 0.5) * dLng;
          const rgb = this.pixel(lng, lat, dLng, dLat, block, hydro, inp);
          const o = (j * W + i) * 4;
          d[o] = rgb[0];
          d[o + 1] = rgb[1];
          d[o + 2] = rgb[2];
          d[o + 3] = 255;
        }
        // Yield occasionally so the bake doesn't freeze the UI.
        if ((j & 31) === 31) await new Promise((r) => setTimeout(r, 0));
      }
      ctx.putImageData(img, 0, 0);
      this.show(cv.toDataURL("image/png"));
      this.onStatus("World rendered.");
    } catch (err) {
      this.onStatus(err instanceof Error ? err.message : String(err), "error");
    }
  }

  /** Colour for one pixel: sea (by depth), or hillshaded biome land + rivers. */
  private pixel(
    lng: number,
    lat: number,
    dLng: number,
    dLat: number,
    block: DemBlock,
    hydro: HydroGrid,
    inp: ClimateInputs,
  ): RGB {
    const raw = elevationFromBlock(block, lng, lat);
    const elev = raw ?? 0;
    const sea = seaLevelAt([lng, lat], inp);
    const isWater = raw !== null && elev <= sea;

    if (isWater) {
      const depth = Math.min(1, (sea - elev) / 300);
      return mix(SEA_RGB, SEA_DEEP, depth);
    }

    // Land: biome colour, hillshaded.
    const c = climateAt([lng, lat], elev, inp);
    const meanT = temperatureAt([lng, lat], elev, { ...inp, season: 0.25 }, 0);
    const biome = biomeAt(meanT, c.precip, false);
    let rgb = hexToRgb(biome.color);
    rgb = shade(rgb, this.hillshade(lng, lat, dLng, dLat, block));

    // River channel over land.
    const flow = hydro.waterAt(lng, lat);
    if (flow >= RIVER_MIN) {
      const t = Math.min(1, (flow - RIVER_MIN) / (100 - RIVER_MIN)) * 0.8;
      rgb = mix(rgb, RIVER_RGB, t);
    }
    return rgb;
  }

  /** Lambert-ish hillshade in 0..1 from the DEM gradient (NW light). */
  private hillshade(lng: number, lat: number, dLng: number, dLat: number, block: DemBlock): number {
    const eL = elevationFromBlock(block, lng - dLng, lat) ?? 0;
    const eR = elevationFromBlock(block, lng + dLng, lat) ?? 0;
    const eU = elevationFromBlock(block, lng, lat + dLat) ?? 0;
    const eD = elevationFromBlock(block, lng, lat - dLat) ?? 0;
    // Pixel ground size (m); cos(lat) shrinks longitude spacing.
    const latRad = (lat * Math.PI) / 180;
    const mx = dLng * 111320 * Math.max(0.2, Math.cos(latRad));
    const my = dLat * 110540;
    const Z = 4; // vertical exaggeration for a readable, drawn-map relief
    const dzdx = ((eR - eL) / (2 * mx)) * Z;
    const dzdy = ((eU - eD) / (2 * my)) * Z;
    // Light: azimuth 315° (NW), altitude 45°.
    const az = (315 * Math.PI) / 180;
    const alt = (45 * Math.PI) / 180;
    const lx = Math.cos(alt) * Math.sin(az);
    const ly = Math.cos(alt) * Math.cos(az);
    const lz = Math.sin(alt);
    const len = Math.sqrt(dzdx * dzdx + dzdy * dzdy + 1);
    const dot = (-dzdx * lx - dzdy * ly + lz) / len;
    return Math.max(0, Math.min(1, dot));
  }

  private show(url: string): void {
    const src = this.map.getSource(SRC) as ImageSource | undefined;
    if (src) {
      src.updateImage({ url });
      return;
    }
    this.map.addSource(SRC, { type: "image", url, coordinates: this.coords });
    // Bottom of the stack: above the background, below the OSM reference + all
    // authored features. Insert before "osm" (the reference) when present.
    const before = this.map.getLayer("osm") ? "osm" : undefined;
    this.map.addLayer(
      {
        id: LAYER,
        type: "raster",
        source: SRC,
        paint: { "raster-opacity": 1, "raster-resampling": "linear", "raster-fade-duration": 0 },
      },
      before,
    );
    this.added = true;
  }

  isAdded(): boolean {
    return this.added;
  }
}

// --- colour helpers ---------------------------------------------------------
function hexToRgb(hex: string): RGB {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
/** Apply a hillshade factor (0..1) to a colour, kept subtle (never black). */
function shade(rgb: RGB, h: number): RGB {
  const f = 0.62 + 0.5 * h; // ~0.62 (shadow) .. 1.12 (lit), clamped per channel
  return [Math.min(255, rgb[0] * f), Math.min(255, rgb[1] * f), Math.min(255, rgb[2] * f)];
}
