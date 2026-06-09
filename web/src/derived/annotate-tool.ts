// Annotation + measurement tool. Two modes share the same click-to-place
// interaction on the map:
//
//   • Annotate — drop a labeled MARKER (single click), or draw a LINE / REGION
//     (click vertices, double-click or Enter to finish), persisted as a map
//     annotation. You're prompted for a label.
//   • Measure — same click-to-place, but EPHEMERAL: a live readout shows the
//     running distance (line) or enclosed area (region). Nothing is saved.
//
// Self-contained: a draft `rc-annotate-*` GeoJSON layer for the in-progress
// shape + a small status/readout via the host. It does not touch the Terra Draw
// editor or layers/.

import type { Map as MlMap, GeoJSONSource, MapMouseEvent } from "maplibre-gl";
import type { FeatureCollection } from "geojson";
import { pathLengthKm, polygonAreaKm2, formatMiles, formatSqMiles } from "./measure";

const DRAFT_SRC = "rc-annotate-draft";
const DRAFT_LINE = "rc-annotate-draft-line";
const DRAFT_FILL = "rc-annotate-draft-fill";
const DRAFT_PT = "rc-annotate-draft-pt";

export type AnnotateMode = "marker" | "line" | "region";
export type ToolPurpose = "annotate" | "measure";

export interface AnnotateHost {
  /** Persist a finished annotation (annotate purpose only). */
  saveAnnotation(kind: AnnotateMode, coords: number[][], label: string | null, color: string): Promise<void>;
  onStatus(text: string, kind?: "info" | "error"): void;
}

export class AnnotateTool {
  private map: MlMap;
  private host: AnnotateHost;
  private active = false;
  private added = false;
  private purpose: ToolPurpose = "measure";
  private mode: AnnotateMode = "line";
  private color = "#e0af68";
  private pts: Array<[number, number]> = [];

  constructor(map: MlMap, host: AnnotateHost) {
    this.map = map;
    this.host = host;
  }

  isActive(): boolean {
    return this.active;
  }
  setPurpose(p: ToolPurpose): void {
    this.purpose = p;
  }
  setMode(m: AnnotateMode): void {
    this.mode = m;
  }
  setColor(c: string): void {
    this.color = c;
  }

  setActive(active: boolean): void {
    if (active === this.active) return;
    this.active = active;
    this.ensureLayers();
    const canvas = this.map.getCanvas();
    if (active) {
      canvas.style.cursor = "crosshair";
      this.pts = [];
      this.map.on("click", this.onClick);
      this.map.on("dblclick", this.onDblClick);
      this.map.on("mousemove", this.onMove);
      window.addEventListener("keydown", this.onKey);
      this.host.onStatus(this.hint());
    } else {
      canvas.style.cursor = "";
      this.map.off("click", this.onClick);
      this.map.off("dblclick", this.onDblClick);
      this.map.off("mousemove", this.onMove);
      window.removeEventListener("keydown", this.onKey);
      this.clearDraft();
    }
  }

  private hint(): string {
    if (this.mode === "marker") return "Click to drop a marker.";
    const verb = this.purpose === "measure" ? "measure" : "draw";
    return `Click to ${verb} a ${this.mode}; double-click or Enter to finish, Esc to cancel.`;
  }

  private onClick = (e: MapMouseEvent): void => {
    const pt: [number, number] = [e.lngLat.lng, e.lngLat.lat];
    if (this.mode === "marker") {
      void this.finishMarker(pt);
      return;
    }
    this.pts.push(pt);
    this.renderDraft();
    this.host.onStatus(this.readout());
  };

  private onMove = (e: MapMouseEvent): void => {
    if (this.mode === "marker" || this.pts.length === 0) return;
    // Live: render the draft with the hovered point appended.
    this.renderDraft([e.lngLat.lng, e.lngLat.lat]);
    this.host.onStatus(this.readout([e.lngLat.lng, e.lngLat.lat]));
  };

  private onDblClick = (e: MapMouseEvent): void => {
    if (this.mode === "marker") return;
    e.preventDefault();
    void this.finishShape();
  };

  private onKey = (e: KeyboardEvent): void => {
    if (!this.active) return;
    if (e.key === "Enter") void this.finishShape();
    else if (e.key === "Escape") {
      this.pts = [];
      this.clearDraft();
      this.host.onStatus(this.hint());
    }
  };

  /** Running measurement readout (distance or area). */
  private readout(hover?: [number, number]): string {
    const path = hover ? [...this.pts, hover] : this.pts;
    if (this.mode === "region" && path.length >= 3) {
      return `Area: ${formatSqMiles(polygonAreaKm2(path))} · perimeter ${formatMiles(pathLengthKm([...path, path[0]]))}`;
    }
    return `Distance: ${formatMiles(pathLengthKm(path))} (${Math.max(0, path.length - 1)} segments)`;
  }

  private async finishMarker(pt: [number, number]): Promise<void> {
    if (this.purpose === "measure") {
      this.host.onStatus(`Point: ${pt[1].toFixed(3)}, ${pt[0].toFixed(3)}`);
      return;
    }
    const label = window.prompt("Marker label (optional):") ?? null;
    try {
      await this.host.saveAnnotation("marker", [pt], label || null, this.color);
      this.host.onStatus("Marker placed.");
    } catch (err) {
      this.host.onStatus(err instanceof Error ? err.message : String(err), "error");
    }
  }

  private async finishShape(): Promise<void> {
    const need = this.mode === "region" ? 3 : 2;
    if (this.pts.length < need) return;
    const coords = this.pts.map((p) => [p[0], p[1]]);
    if (this.purpose === "measure") {
      // Freeze the final readout; keep the draft visible until the tool changes.
      this.host.onStatus(this.readout());
      this.pts = [];
      return;
    }
    const label = window.prompt(`${this.mode === "region" ? "Region" : "Line"} label (optional):`) ?? null;
    try {
      await this.host.saveAnnotation(this.mode, coords, label || null, this.color);
      this.host.onStatus(`${this.mode} saved.`);
    } catch (err) {
      this.host.onStatus(err instanceof Error ? err.message : String(err), "error");
    }
    this.pts = [];
    this.clearDraft();
  }

  // --- draft rendering ---
  private ensureLayers(): void {
    if (this.added) return;
    const empty = { type: "FeatureCollection", features: [] } as FeatureCollection;
    this.map.addSource(DRAFT_SRC, { type: "geojson", data: empty });
    const before = this.map.getLayer("rc-location-circle") ? "rc-location-circle" : undefined;
    this.map.addLayer(
      { id: DRAFT_FILL, type: "fill", source: DRAFT_SRC, filter: ["==", ["geometry-type"], "Polygon"],
        paint: { "fill-color": "#e0af68", "fill-opacity": 0.12 } },
      before,
    );
    this.map.addLayer(
      { id: DRAFT_LINE, type: "line", source: DRAFT_SRC, filter: ["!=", ["geometry-type"], "Point"],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#e7ecf3", "line-width": 1.6, "line-dasharray": [2, 2] } },
      before,
    );
    this.map.addLayer(
      { id: DRAFT_PT, type: "circle", source: DRAFT_SRC, filter: ["==", ["geometry-type"], "Point"],
        paint: { "circle-radius": 3, "circle-color": "#e7ecf3" } },
      before,
    );
    this.added = true;
  }

  private renderDraft(hover?: [number, number]): void {
    const path = hover ? [...this.pts, hover] : this.pts;
    const features: FeatureCollection["features"] = path.map((p) => ({
      type: "Feature", geometry: { type: "Point", coordinates: p }, properties: {},
    }));
    if (path.length >= 2) {
      if (this.mode === "region" && path.length >= 3) {
        features.push({ type: "Feature", geometry: { type: "Polygon", coordinates: [[...path, path[0]]] }, properties: {} });
      } else {
        features.push({ type: "Feature", geometry: { type: "LineString", coordinates: path }, properties: {} });
      }
    }
    (this.map.getSource(DRAFT_SRC) as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features });
  }

  private clearDraft(): void {
    (this.map.getSource(DRAFT_SRC) as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features: [] });
  }
}
