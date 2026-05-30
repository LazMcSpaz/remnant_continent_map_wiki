// Multi-step route creation wizard.
//
// +Route opens this instead of free-drawing. Steps:
//   1. place START (click map; snaps to nearby cities / route endpoints)
//   2. place END   (same snapping)
//   3. choose routing: Follow roads (OSRM) or Landship (routes around forest +
//      mountain barriers)
//   4. choose the owning faction (or unaligned)
// then the route is created with the computed geometry.

import maplibregl from "maplibre-gl";
import type { Map as MlMap } from "maplibre-gl";
import type { LineString, Position } from "geojson";
import type { Faction } from "../state/db-types";
import { snapToRoads, landshipRoute } from "./routing";

export interface RouteWizardHost {
  factions(): Faction[];
  /** Forest/mountain barrier rings ([lng,lat] vertices) for landship routing. */
  barrierRings(): Position[][];
  /** Snap candidates: city points + route endpoints. */
  snapPoints(): Position[];
  createRoute(
    geometry: LineString,
    opts: { kind: string; ownerFactionId?: string },
  ): Promise<unknown>;
  reloadData(): Promise<void>;
  setStatus(text: string, kind?: "info" | "error"): void;
}

const SNAP_TOL_PX = 14;
const PREVIEW_SRC = "rc-wizard-preview";
const PREVIEW_LAYER = "rc-wizard-preview-line";

type Step = "start" | "end" | "mode" | "computing" | "owner";

export class RouteWizard {
  private map: MlMap;
  private host: RouteWizardHost;
  private card: HTMLElement;
  private active = false;
  private step: Step = "start";
  private startPt: Position | null = null;
  private endPt: Position | null = null;
  private geometry: LineString | null = null;
  private kind = "road";
  private markers: maplibregl.Marker[] = [];

  constructor(map: MlMap, mount: HTMLElement, host: RouteWizardHost) {
    this.map = map;
    this.host = host;
    this.card = document.createElement("div");
    this.card.className = "wizard-card";
    this.card.hidden = true;
    mount.append(this.card);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.active) this.cancel();
    });
  }

  isActive(): boolean {
    return this.active;
  }

  start(): void {
    this.active = true;
    this.startPt = null;
    this.endPt = null;
    this.geometry = null;
    this.step = "start";
    this.render();
    this.armPlacement();
  }

  cancel(): void {
    this.active = false;
    this.card.hidden = true;
    this.clearTemp();
    this.host.setStatus("Route creation cancelled.");
  }

  // --- placement --------------------------------------------------------------

  private armPlacement(): void {
    this.map.getCanvas().style.cursor = "crosshair";
    this.map.once("click", (e) => {
      if (!this.active) return;
      const pt = this.snap([e.lngLat.lng, e.lngLat.lat]);
      if (this.step === "start") {
        this.startPt = pt;
        this.addMarker(pt, "#7ee787", "Start");
        this.step = "end";
        this.render();
        this.armPlacement();
      } else if (this.step === "end") {
        this.endPt = pt;
        this.addMarker(pt, "#ff7b72", "End");
        this.map.getCanvas().style.cursor = "";
        this.step = "mode";
        this.render();
      }
    });
  }

  private snap(lngLat: Position): Position {
    const cp = this.map.project(lngLat as [number, number]);
    let best: Position | null = null;
    let bestD = SNAP_TOL_PX;
    for (const p of this.host.snapPoints()) {
      const sp = this.map.project(p as [number, number]);
      const d = Math.hypot(sp.x - cp.x, sp.y - cp.y);
      if (d <= bestD) {
        bestD = d;
        best = p;
      }
    }
    return best ?? lngLat;
  }

  // --- routing ----------------------------------------------------------------

  private async computeRoute(mode: "roads" | "landship"): Promise<void> {
    if (!this.startPt || !this.endPt) return;
    this.step = "computing";
    this.render();
    if (mode === "roads") {
      this.kind = "road";
      const snapped = await snapToRoads([this.startPt, this.endPt]);
      this.geometry = snapped ?? { type: "LineString", coordinates: [this.startPt, this.endPt] };
      if (!snapped) this.host.setStatus("Routing unavailable — used a straight line.", "error");
    } else {
      this.kind = "trail"; // landship hover path (off-road)
      this.geometry = landshipRoute(this.startPt, this.endPt, this.host.barrierRings());
    }
    this.showPreview(this.geometry);
    this.step = "owner";
    this.render();
  }

  private async finish(ownerFactionId: string | null): Promise<void> {
    if (!this.geometry) return;
    try {
      await this.host.createRoute(this.geometry, {
        kind: this.kind,
        ...(ownerFactionId ? { ownerFactionId } : {}),
      });
      await this.host.reloadData();
      this.host.setStatus("Route created.");
    } catch (err) {
      this.host.setStatus(err instanceof Error ? err.message : String(err), "error");
    }
    this.active = false;
    this.card.hidden = true;
    this.clearTemp();
  }

  // --- temp visuals -----------------------------------------------------------

  private addMarker(pt: Position, color: string, title: string): void {
    const elx = document.createElement("div");
    elx.className = "wizard-pin";
    elx.style.background = color;
    elx.title = title;
    this.markers.push(
      new maplibregl.Marker({ element: elx }).setLngLat(pt as [number, number]).addTo(this.map),
    );
  }

  private showPreview(geom: LineString): void {
    const data = { type: "Feature" as const, geometry: geom, properties: {} };
    const src = this.map.getSource(PREVIEW_SRC) as maplibregl.GeoJSONSource | undefined;
    if (src) {
      src.setData(data);
    } else {
      this.map.addSource(PREVIEW_SRC, { type: "geojson", data });
      this.map.addLayer({
        id: PREVIEW_LAYER,
        type: "line",
        source: PREVIEW_SRC,
        paint: { "line-color": "#ffd166", "line-width": 3, "line-dasharray": [1.5, 1] },
      });
    }
  }

  private clearTemp(): void {
    for (const m of this.markers) m.remove();
    this.markers = [];
    if (this.map.getLayer(PREVIEW_LAYER)) this.map.removeLayer(PREVIEW_LAYER);
    if (this.map.getSource(PREVIEW_SRC)) this.map.removeSource(PREVIEW_SRC);
    this.map.getCanvas().style.cursor = "";
  }

  // --- modal rendering --------------------------------------------------------

  private render(): void {
    const c = this.card;
    c.hidden = false;
    c.replaceChildren();
    const title = document.createElement("h3");
    title.className = "wizard-title";
    const body = document.createElement("div");
    body.className = "wizard-body";

    const mkBtn = (label: string, cls: string, onClick: () => void): HTMLButtonElement => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = cls;
      b.textContent = label;
      b.addEventListener("click", onClick);
      return b;
    };
    const cancel = mkBtn("Cancel", "wiki-btn-ghost", () => this.cancel());

    if (this.step === "start") {
      title.textContent = "New route — place the start";
      body.append(hint("Click the map to set the START. It snaps to nearby cities and route ends."));
      c.append(title, body, actions(cancel));
    } else if (this.step === "end") {
      title.textContent = "New route — place the end";
      body.append(hint("Click the map to set the END."));
      c.append(title, body, actions(cancel));
    } else if (this.step === "mode") {
      title.textContent = "How does this route travel?";
      const roads = mkBtn("Follow roads", "wiki-btn", () => void this.computeRoute("roads"));
      const land = mkBtn("Landship route", "wiki-btn", () => void this.computeRoute("landship"));
      body.append(
        hint("Roads snap to the real road network. Landships hover — they route around forests and mountains."),
        rowOf(roads, land),
      );
      c.append(title, body, actions(cancel));
    } else if (this.step === "computing") {
      title.textContent = "Computing route…";
      c.append(title, body);
    } else if (this.step === "owner") {
      title.textContent = "Who owns this route?";
      const km = this.geometry ? lengthKm(this.geometry).toFixed(0) : "?";
      body.append(hint(`Computed path: ~${km} km. Choose an owner (or leave unaligned).`));
      const list = document.createElement("div");
      list.className = "wizard-faction-list";
      list.append(
        mkBtn("Unaligned", "wiki-btn-ghost", () => void this.finish(null)),
        ...this.host.factions().map((f) => {
          const b = mkBtn(f.name, "wizard-faction", () => void this.finish(f.id));
          const dot = document.createElement("span");
          dot.className = "layers-swatch";
          dot.style.background = f.color;
          b.prepend(dot);
          return b;
        }),
      );
      body.append(list);
      c.append(title, body, actions(cancel));
    }
  }
}

function hint(text: string): HTMLElement {
  const p = document.createElement("p");
  p.className = "wizard-hint";
  p.textContent = text;
  return p;
}
function rowOf(...els: HTMLElement[]): HTMLElement {
  const d = document.createElement("div");
  d.className = "wizard-row";
  d.append(...els);
  return d;
}
function actions(...els: HTMLElement[]): HTMLElement {
  const d = document.createElement("div");
  d.className = "wizard-actions";
  d.append(...els);
  return d;
}

function lengthKm(line: LineString): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  let total = 0;
  const c = line.coordinates;
  for (let i = 1; i < c.length; i++) {
    const dLat = toRad(c[i][1] - c[i - 1][1]);
    const dLng = toRad(c[i][0] - c[i - 1][0]);
    const lat1 = toRad(c[i - 1][1]);
    const lat2 = toRad(c[i][1]);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    total += 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  return total;
}
