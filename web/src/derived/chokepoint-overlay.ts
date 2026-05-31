// Chokepoint overlay (DERIVED). Paints the route network by chokepoint score
// from network-analysis.ts: low = thin/cool, high = thick/hot red, so the
// bottlenecks the whole network funnels through stand out. Self-contained — its
// own source/layers — so layers/ stays untouched (same pattern as the sim
// overlay). Toggled by the Chokepoints layer; rebuilt when routes change.

import type { Map as MlMap, GeoJSONSource } from "maplibre-gl";
import type { FeatureCollection, LineString } from "geojson";
import type { RouteProps } from "../layers/features";
import type { NetworkGraph } from "./network-graph";
import { analyzeNetwork, type NetworkAnalysis, type EdgeScore } from "./network-analysis";

const SRC = "rc-chokepoint";
const LAYER = "rc-chokepoint-line";

type StatusFn = (msg: string, kind?: "info" | "error") => void;

export class ChokepointOverlay {
  private map: MlMap;
  private onStatus: StatusFn;
  private visible = false;
  private added = false;
  private analysis: NetworkAnalysis | null = null;

  constructor(map: MlMap, onStatus: StatusFn = () => {}) {
    this.map = map;
    this.onStatus = onStatus;
  }

  /** Latest analysis (for the control panel's ranked list). */
  getAnalysis(): NetworkAnalysis | null {
    return this.analysis;
  }

  /** Recompute from the current graph + route geometries and repaint. */
  recompute(graph: NetworkGraph, routes: FeatureCollection<LineString, RouteProps>): void {
    this.analysis = analyzeNetwork(graph);
    if (!this.visible && !this.added) return;
    this.paint(routes);
  }

  /** Build the scored GeoJSON (route geometry + score per route) and show it. */
  private paint(routes: FeatureCollection<LineString, RouteProps>): void {
    if (!this.analysis) return;
    const scoreByRoute = new Map<string, EdgeScore>();
    for (const e of this.analysis.edges) scoreByRoute.set(e.routeId, e);

    const features = routes.features
      .filter((f) => scoreByRoute.has(f.properties.id))
      .map((f) => {
        const s = scoreByRoute.get(f.properties.id)!;
        return {
          type: "Feature" as const,
          geometry: f.geometry,
          properties: {
            routeId: f.properties.id,
            score: s.score,
            betweenness: s.betweenness,
            cutImpact: s.cutImpact,
          },
        };
      });

    const fc: FeatureCollection<LineString> = { type: "FeatureCollection", features };
    const src = this.map.getSource(SRC) as GeoJSONSource | undefined;
    if (src) src.setData(fc);
    else this.add(fc);
  }

  private add(fc: FeatureCollection<LineString>): void {
    this.map.addSource(SRC, { type: "geojson", data: fc });
    // Above the route lines but below the city markers.
    const before = this.map.getLayer("rc-location-circle") ? "rc-location-circle" : undefined;
    this.map.addLayer(
      {
        id: LAYER,
        type: "line",
        source: SRC,
        layout: {
          visibility: this.visible ? "visible" : "none",
          "line-cap": "round",
          "line-join": "round",
        },
        paint: {
          // Thicker + hotter as the chokepoint score rises.
          "line-width": ["interpolate", ["linear"], ["get", "score"], 0, 2, 1, 9],
          "line-color": [
            "interpolate", ["linear"], ["get", "score"],
            0, "#5a8fb0",
            0.4, "#e0c14a",
            0.7, "#e07a3a",
            1, "#d23b3b",
          ],
          "line-opacity": 0.85,
        },
      },
      before,
    );
    this.added = true;
  }

  setVisible(
    visible: boolean,
    graph?: NetworkGraph,
    routes?: FeatureCollection<LineString, RouteProps>,
  ): void {
    this.visible = visible;
    if (visible && !this.added && routes) {
      if (graph && !this.analysis) this.analysis = analyzeNetwork(graph);
      this.onStatus("Analyzing the network for chokepoints…");
      this.paint(routes);
      this.onStatus("Chokepoints highlighted — thickest/red = the network funnels through here.");
    } else if (this.map.getLayer(LAYER)) {
      this.map.setLayoutProperty(LAYER, "visibility", visible ? "visible" : "none");
    }
  }

  isVisible(): boolean {
    return this.visible;
  }
}
