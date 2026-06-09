// Surface/Decay brush — paint authored surface alterations (rubble, ruined,
// regrowth, barren, forest, water) onto the map as circular polygon footprints.
// Pattern mirrors terrain-brush.ts exactly: drag-to-paint with distance
// throttling, cursor ring + faint stamp previews, host interface for persistence.

import type { Map as MlMap, GeoJSONSource, MapMouseEvent } from "maplibre-gl";
import type { FeatureCollection } from "geojson";

const RING_SRC  = "rc-surface-ring";
const RING_FILL = "rc-surface-ring-fill";
const RING_LINE = "rc-surface-ring-line";
const STAMP_SRC  = "rc-surface-stamps";
const STAMP_FILL = "rc-surface-stamps-fill";

export type SurfaceType = "rubble" | "ruined" | "regrowth" | "barren" | "forest" | "water";

export interface SurfaceEdit {
  id: string;
  surface: SurfaceType;
  lng: number;
  lat: number;
  radiusKm: number;
}

// Colors per surface type (used in stamp previews and persisted render layer).
export const SURFACE_COLORS: Record<SurfaceType, string> = {
  rubble:   "#5a4a3a",
  ruined:   "#6b5640",
  regrowth: "#3a6b3f",
  barren:   "#8a7a5a",
  forest:   "#2f6b3f",
  water:    "#15324a",
};

export const SURFACE_TYPES: SurfaceType[] = ["rubble", "ruined", "regrowth", "barren", "forest", "water"];

let editSeq = 0;

export interface SurfaceBrushHost {
  /** Persist any new edits and return the canonical list (with server ids). */
  recalculate(edits: SurfaceEdit[]): Promise<SurfaceEdit[]>;
  onStatus(text: string, kind?: "info" | "error"): void;
  /** Seed edits from persistence. */
  initialEdits?: SurfaceEdit[] | undefined;
}

/** Rough circle polygon (degrees) for the brush cursor / stamp preview. */
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

export class SurfaceBrush {
  private map: MlMap;
  private host: SurfaceBrushHost;
  private edits: SurfaceEdit[];
  private active  = false;
  private painting = false;
  private surface: SurfaceType = "rubble";
  private radiusKm = 40;
  private added   = false;
  private lastStampAt: { lng: number; lat: number } | null = null;
  private dirty = false;

  constructor(map: MlMap, host: SurfaceBrushHost) {
    this.map  = map;
    this.host = host;
    this.edits = host.initialEdits ? [...host.initialEdits] : [];
  }

  getEdits(): SurfaceEdit[] { return this.edits; }
  setSurface(s: SurfaceType): void { this.surface = s; }
  setRadiusKm(km: number): void { this.radiusKm = km; }
  isActive(): boolean { return this.active; }
  hasUnsaved(): boolean { return this.dirty; }

  /** Enter/leave brush mode. While active, dragging paints surface stamps. */
  setActive(active: boolean): void {
    if (active === this.active) return;
    this.active = active;
    this.ensureLayers();
    const canvas = this.map.getCanvas();
    if (active) {
      canvas.style.cursor = "crosshair";
      this.map.dragPan.disable();
      this.map.on("mousedown", this.onDown);
      this.map.on("mousemove", this.onMove);
      this.map.on("mouseup",   this.onUp);
      this.host.onStatus("Surface brush: drag to paint, then Apply.");
    } else {
      canvas.style.cursor = "";
      this.map.dragPan.enable();
      this.map.off("mousedown", this.onDown);
      this.map.off("mousemove", this.onMove);
      this.map.off("mouseup",   this.onUp);
      this.hideRing();
    }
  }

  /** Persist + update the map from the current edits. */
  apply(): void {
    void this.host.recalculate(this.edits).then((canonical) => {
      this.edits = canonical;
      this.dirty = false;
      this.renderStamps();
    });
  }

  /** Clear all edits and persist the empty state. */
  clearEdits(): void {
    this.edits = [];
    this.dirty = true;
    this.renderStamps();
    void this.host.recalculate(this.edits).then((canonical) => {
      this.edits = canonical;
      this.dirty = false;
      this.renderStamps();
    });
  }

  private onDown = (e: MapMouseEvent): void => {
    e.preventDefault();
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
      if (moved < this.radiusKm * 0.33) return;
    }
    this.lastStampAt = { lng, lat };
    this.edits.push({
      id: `surf-${++editSeq}`,
      surface: this.surface,
      lng,
      lat,
      radiusKm: this.radiusKm,
    });
    this.dirty = true;
    this.renderStamps();
  }

  // --- cursor ring + stamp preview layers ---

  private ensureLayers(): void {
    if (this.added) return;
    const empty: FeatureCollection = { type: "FeatureCollection", features: [] };
    this.map.addSource(STAMP_SRC, { type: "geojson", data: empty });
    this.map.addSource(RING_SRC,  { type: "geojson", data: empty });
    const before = this.map.getLayer("rc-location-circle") ? "rc-location-circle" : undefined;

    // Stamp fill: colored by surface type using a MapLibre match expression.
    this.map.addLayer(
      {
        id: STAMP_FILL,
        type: "fill",
        source: STAMP_SRC,
        paint: {
          "fill-color": [
            "match", ["get", "surface"],
            "rubble",   SURFACE_COLORS.rubble,
            "ruined",   SURFACE_COLORS.ruined,
            "regrowth", SURFACE_COLORS.regrowth,
            "barren",   SURFACE_COLORS.barren,
            "forest",   SURFACE_COLORS.forest,
            "water",    SURFACE_COLORS.water,
            "#888888",
          ],
          "fill-opacity": 0.45,
        },
      },
      before,
    );

    // Cursor ring.
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
    // Render any pre-loaded edits immediately.
    this.renderStamps();
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
    if (!this.added) return;
    const fc: FeatureCollection = {
      type: "FeatureCollection",
      features: this.edits.map((ed) => ({
        type: "Feature",
        geometry: { type: "Polygon", coordinates: [circle(ed.lng, ed.lat, ed.radiusKm)] },
        properties: { surface: ed.surface },
      })),
    };
    (this.map.getSource(STAMP_SRC) as GeoJSONSource | undefined)?.setData(fc);
  }

  /** Call after boot to render pre-loaded edits (layers not yet added). */
  ensureRendered(): void {
    this.ensureLayers();
  }
}
