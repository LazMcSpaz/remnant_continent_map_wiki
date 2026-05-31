// SIM visualization (self-contained). Per the INTERFACE.md seam, the simulation
// must not require changes to layers/ — so it paints through its OWN sources and
// layers added here, not by modifying the feature renderer.
//
//   • pressure halos — a circle under each city, sized/colored by 0..100 pressure
//     (calm green → strained amber → starving red), so deficits read at a glance
//   • flow lines — the trade that happened this turn, width by amount, so you can
//     see surplus moving toward deficit and where a cut strands it
//
// Toggle with the Sim layer; updated each turn from a SimState.

import type { Map as MlMap, GeoJSONSource } from "maplibre-gl";
import type { FeatureCollection, Point, LineString } from "geojson";
import type { NetworkGraph } from "../derived/network-graph";
import type { SimState } from "./types";

const P_SRC = "rc-sim-pressure";
const P_LAYER = "rc-sim-pressure-circle";
const F_SRC = "rc-sim-flow";
const F_LAYER = "rc-sim-flow-line";

export class SimOverlay {
  private map: MlMap;
  private added = false;
  private visible = false;

  constructor(map: MlMap) {
    this.map = map;
  }

  private ensureLayers(): void {
    if (this.added) return;
    const empty = <T extends Point | LineString>(): FeatureCollection<T> => ({
      type: "FeatureCollection",
      features: [],
    });
    this.map.addSource(P_SRC, { type: "geojson", data: empty<Point>() });
    this.map.addSource(F_SRC, { type: "geojson", data: empty<LineString>() });

    // Flow lines beneath the city halos; both beneath the clickable markers.
    const before = this.map.getLayer("rc-location-highlight") ? "rc-location-highlight" : undefined;
    this.map.addLayer(
      {
        id: F_LAYER,
        type: "line",
        source: F_SRC,
        layout: { visibility: this.visible ? "visible" : "none", "line-cap": "round" },
        paint: {
          "line-color": "#7fd1c0",
          "line-opacity": 0.7,
          "line-width": ["interpolate", ["linear"], ["get", "amount"], 0, 1, 100, 6],
        },
      },
      before,
    );
    this.map.addLayer(
      {
        id: P_LAYER,
        type: "circle",
        source: P_SRC,
        layout: { visibility: this.visible ? "visible" : "none" },
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["get", "pressure"], 0, 6, 100, 22],
          "circle-color": [
            "interpolate", ["linear"], ["get", "pressure"],
            0, "#3fae6b",
            35, "#e0c14a",
            70, "#e07a3a",
            100, "#d23b3b",
          ],
          "circle-opacity": 0.5,
          "circle-stroke-color": "#0e1116",
          "circle-stroke-width": 0.5,
        },
      },
      before,
    );
    this.added = true;
  }

  /** Repaint from a SimState + the graph (for node/edge coordinates). */
  update(state: SimState, graph: NetworkGraph): void {
    this.ensureLayers();
    const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));

    const pts: FeatureCollection<Point>["features"] = [];
    for (const n of graph.nodes) {
      if (!n.locationId) continue;
      const p = state.pressure[n.locationId];
      if (p == null) continue;
      pts.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: n.lngLat },
        properties: { pressure: p },
      });
    }
    (this.map.getSource(P_SRC) as GeoJSONSource).setData({ type: "FeatureCollection", features: pts });

    // Aggregate flows per edge (sum across resources) into a single line each.
    const perEdge = new Map<string, { amount: number; from: string; to: string }>();
    for (const f of state.flows) {
      const cur = perEdge.get(f.edgeId);
      if (cur) cur.amount += f.amount;
      else perEdge.set(f.edgeId, { amount: f.amount, from: f.from, to: f.to });
    }
    const lines: FeatureCollection<LineString>["features"] = [];
    for (const [, fl] of perEdge) {
      const a = nodeById.get(fl.from);
      const b = nodeById.get(fl.to);
      if (!a || !b) continue;
      lines.push({
        type: "Feature",
        geometry: { type: "LineString", coordinates: [a.lngLat, b.lngLat] },
        properties: { amount: fl.amount },
      });
    }
    (this.map.getSource(F_SRC) as GeoJSONSource).setData({ type: "FeatureCollection", features: lines });
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    if (!this.added) {
      if (visible) this.ensureLayers();
      else return;
    }
    const v = visible ? "visible" : "none";
    this.map.setLayoutProperty(P_LAYER, "visibility", v);
    this.map.setLayoutProperty(F_LAYER, "visibility", v);
  }

  isVisible(): boolean {
    return this.visible;
  }

  /** Clear all sim graphics (e.g. when the simulation is reset). */
  clear(): void {
    if (!this.added) return;
    const empty: FeatureCollection = { type: "FeatureCollection", features: [] };
    (this.map.getSource(P_SRC) as GeoJSONSource).setData(empty);
    (this.map.getSource(F_SRC) as GeoJSONSource).setData(empty);
  }
}
