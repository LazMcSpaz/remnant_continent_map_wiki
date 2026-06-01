// Terrain brush — sculpt the elevation field, then Recalculate to re-derive
// rivers, coast, and climate from the reshaped terrain. The brush authors soft
// Gaussian elevation deltas (ElevationEdit): click/drag raises or lowers the
// land with a video-game falloff. Edits accumulate in memory (persistence is a
// later chunk); pressing Recalculate feeds them to the coast/river overlay and
// re-derives everything from the one composite field.
//
// Self-contained: a paint interaction on the map canvas + a small control
// panel. It does not touch layers/ or the Terra Draw editor.

import type { Map as MlMap, GeoJSONSource, MapMouseEvent } from "maplibre-gl";
import type { FeatureCollection } from "geojson";
import type { ElevationEdit } from "../derived/terrain";

const RING_SRC = "rc-brush-ring";
const RING_FILL = "rc-brush-ring-fill";
const RING_LINE = "rc-brush-ring-line";
const STAMP_SRC = "rc-brush-stamps";
const STAMP_FILL = "rc-brush-stamps-fill";

let editSeq = 0;

export interface TerrainBrushHost {
  /** Re-derive coast/rivers/climate from the current edits. */
  recalculate(edits: ElevationEdit[]): void | Promise<void>;
  onStatus(text: string, kind?: "info" | "error"): void;
  /** Seed edits (e.g. loaded from persistence). */
  initialEdits?: ElevationEdit[];
}

/** A rough circle polygon (degrees) for the brush cursor / stamp preview. */
function circle(lng: number, lat: number, radiusKm: number, steps = 48): number[][] {
  const kmPerDegLat = 111.32;
  const kmPerDegLng = kmPerDegLat * Math.cos((lat * Math.PI) / 180);
  const ring: number[][] = [];
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    ring.push([lng + (Math.cos(a) * radiusKm) / kmPerDegLng, lat + (Math.sin(a) * radiusKm) / kmPerDegLat]);
  }
  return ring;
}

export class TerrainBrush {
  private map: MlMap;
  private host: TerrainBrushHost;
  private edits: ElevationEdit[];
  private active = false;
  private painting = false;
  private mode: "raise" | "lower" = "raise";
  private radiusKm = 60;
  private strengthM = 300;
  private added = false;
  private lastStampAt: { lng: number; lat: number } | null = null;
  private dirty = false;

  constructor(map: MlMap, host: TerrainBrushHost) {
    this.map = map;
    this.host = host;
    this.edits = host.initialEdits ? [...host.initialEdits] : [];
  }

  getEdits(): ElevationEdit[] {
    return this.edits;
  }

  setMode(mode: "raise" | "lower"): void {
    this.mode = mode;
  }
  setRadiusKm(km: number): void {
    this.radiusKm = km;
  }
  setStrengthM(m: number): void {
    this.strengthM = m;
  }

  /** Enter/leave brush mode. While active, dragging paints elevation stamps. */
  setActive(active: boolean): void {
    if (active === this.active) return;
    this.active = active;
    this.ensureLayers();
    const canvas = this.map.getCanvas();
    if (active) {
      canvas.style.cursor = "crosshair";
      this.map.dragPan.disable(); // so a drag paints instead of panning
      this.map.on("mousedown", this.onDown);
      this.map.on("mousemove", this.onMove);
      this.map.on("mouseup", this.onUp);
      this.host.onStatus("Terrain brush: drag to sculpt, then Recalculate.");
    } else {
      canvas.style.cursor = "";
      this.map.dragPan.enable();
      this.map.off("mousedown", this.onDown);
      this.map.off("mousemove", this.onMove);
      this.map.off("mouseup", this.onUp);
      this.hideRing();
    }
  }

  isActive(): boolean {
    return this.active;
  }

  hasUnsaved(): boolean {
    return this.dirty;
  }

  /** Clear all edits and recalculate back to the base world. */
  clearEdits(): void {
    this.edits = [];
    this.dirty = true;
    this.renderStamps();
    void this.host.recalculate(this.edits);
  }

  /** Recompute the world from the current edits. */
  recalculate(): void {
    void this.host.recalculate(this.edits);
    this.dirty = false;
  }

  private onDown = (e: MapMouseEvent): void => {
    this.painting = true;
    this.lastStampAt = null;
    this.stamp(e.lngLat.lng, e.lngLat.lat);
  };

  private onMove = (e: MapMouseEvent): void => {
    this.updateRing(e.lngLat.lng, e.lngLat.lat);
    if (this.painting) this.stamp(e.lngLat.lng, e.lngLat.lat);
  };

  private onUp = (): void => {
    this.painting = false;
  };

  /** Drop a stamp, throttled by distance so a drag lays overlapping dabs. */
  private stamp(lng: number, lat: number): void {
    if (this.lastStampAt) {
      const kmPerDegLat = 111.32;
      const dLat = (lat - this.lastStampAt.lat) * kmPerDegLat;
      const dLng = (lng - this.lastStampAt.lng) * kmPerDegLat * Math.cos((lat * Math.PI) / 180);
      const moved = Math.hypot(dLat, dLng);
      if (moved < this.radiusKm * 0.33) return; // space dabs ~1/3 radius apart
    }
    this.lastStampAt = { lng, lat };
    this.edits.push({
      id: `edit-${++editSeq}`,
      lng,
      lat,
      radiusKm: this.radiusKm,
      deltaM: this.mode === "raise" ? this.strengthM : -this.strengthM,
    });
    this.dirty = true;
    this.renderStamps();
  }

  // --- cursor ring + stamp preview layers ---
  private ensureLayers(): void {
    if (this.added) return;
    const empty: FeatureCollection = { type: "FeatureCollection", features: [] };
    this.map.addSource(STAMP_SRC, { type: "geojson", data: empty });
    this.map.addSource(RING_SRC, { type: "geojson", data: empty });
    const before = this.map.getLayer("rc-location-circle") ? "rc-location-circle" : undefined;
    // Stamps: faint footprint of where you've sculpted (raise warm, lower cool).
    this.map.addLayer(
      {
        id: STAMP_FILL,
        type: "fill",
        source: STAMP_SRC,
        paint: {
          "fill-color": ["case", [">", ["get", "delta"], 0], "#caa15a", "#5a8fca"],
          "fill-opacity": 0.12,
        },
      },
      before,
    );
    this.map.addLayer(
      {
        id: RING_FILL,
        type: "fill",
        source: RING_SRC,
        paint: { "fill-color": "#e7ecf3", "fill-opacity": 0.06 },
      },
      before,
    );
    this.map.addLayer(
      {
        id: RING_LINE,
        type: "line",
        source: RING_SRC,
        paint: { "line-color": "#e7ecf3", "line-width": 1, "line-opacity": 0.7 },
      },
      before,
    );
    this.added = true;
  }

  private updateRing(lng: number, lat: number): void {
    const fc: FeatureCollection = {
      type: "FeatureCollection",
      features: [{ type: "Feature", geometry: { type: "Polygon", coordinates: [circle(lng, lat, this.radiusKm)] }, properties: {} }],
    };
    (this.map.getSource(RING_SRC) as GeoJSONSource | undefined)?.setData(fc);
  }

  private hideRing(): void {
    (this.map.getSource(RING_SRC) as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features: [] });
  }

  private renderStamps(): void {
    const fc: FeatureCollection = {
      type: "FeatureCollection",
      features: this.edits.map((ed) => ({
        type: "Feature",
        geometry: { type: "Polygon", coordinates: [circle(ed.lng, ed.lat, ed.radiusKm)] },
        properties: { delta: ed.deltaM },
      })),
    };
    (this.map.getSource(STAMP_SRC) as GeoJSONSource | undefined)?.setData(fc);
  }
}
