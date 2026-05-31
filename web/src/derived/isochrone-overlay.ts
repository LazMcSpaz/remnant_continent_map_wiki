// Travel-time isochrone overlay (DERIVED, Phase 4 analysis). From a chosen
// origin city + travel mode, shade the reachable network by time-to-reach:
// route lines and reachable-city dots colored in bands (near = cool/green,
// far = warm/red). Self-contained — its own sources/layers — so layers/ stays
// untouched (same pattern as the chokepoint + sim overlays).

import type { Map as MlMap, GeoJSONSource } from "maplibre-gl";
import type { FeatureCollection, LineString, Point } from "geojson";
import type { RouteProps } from "../layers/features";
import type { NetworkGraph } from "./network-graph";
import { computeIsochrones, type Isochrones } from "./network-analysis";
import type { TravelMode } from "./travel";

const LINE_SRC = "rc-iso-line";
const LINE_LAYER = "rc-iso-line-layer";
const PT_SRC = "rc-iso-pt";
const PT_LAYER = "rc-iso-pt-layer";

/** Hour band breakpoints → color, applied to both lines and dots. */
const BANDS: Array<[number, string]> = [
  [0, "#2f8b6b"],
  [6, "#5fae6b"],
  [12, "#bcae54"],
  [24, "#e0a24a"],
  [48, "#e0743a"],
  [96, "#d23b3b"],
];

function colorExpr(): maplibregl.ExpressionSpecification {
  const stops: (number | string)[] = [];
  for (const [h, c] of BANDS) stops.push(h, c);
  return ["interpolate", ["linear"], ["get", "hours"], ...stops] as maplibregl.ExpressionSpecification;
}

export class IsochroneOverlay {
  private map: MlMap;
  private added = false;
  private active = false;
  private iso: Isochrones | null = null;

  constructor(map: MlMap) {
    this.map = map;
  }

  isActive(): boolean {
    return this.active;
  }

  getIsochrones(): Isochrones | null {
    return this.iso;
  }

  /** Compute from an origin + mode and paint. Pass the current routes for geom. */
  show(
    graph: NetworkGraph,
    routes: FeatureCollection<LineString, RouteProps>,
    originNodeId: string,
    mode: TravelMode,
  ): Isochrones {
    this.iso = computeIsochrones(graph, originNodeId, mode);
    this.active = true;
    this.paint(routes);
    return this.iso;
  }

  /** Clear the overlay (origin deselected). */
  clear(): void {
    this.active = false;
    this.iso = null;
    if (!this.added) return;
    const empty: FeatureCollection = { type: "FeatureCollection", features: [] };
    (this.map.getSource(LINE_SRC) as GeoJSONSource).setData(empty);
    (this.map.getSource(PT_SRC) as GeoJSONSource).setData(empty);
  }

  private paint(routes: FeatureCollection<LineString, RouteProps>): void {
    if (!this.iso) return;
    const hoursByRoute = new Map(this.iso.edges.map((e) => [e.routeId, e.hours]));
    const lineFeatures = routes.features
      .filter((f) => hoursByRoute.has(f.properties.id))
      .map((f) => ({
        type: "Feature" as const,
        geometry: f.geometry,
        properties: { hours: hoursByRoute.get(f.properties.id)! },
      }));
    const lineFC: FeatureCollection<LineString> = { type: "FeatureCollection", features: lineFeatures };

    const ptFeatures = this.iso.nodes
      .filter((n) => n.locationId != null)
      .map((n) => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: n.lngLat },
        properties: { hours: n.hours, origin: n.nodeId === this.iso!.originNodeId ? 1 : 0 },
      }));
    const ptFC: FeatureCollection<Point> = { type: "FeatureCollection", features: ptFeatures };

    const lineSrc = this.map.getSource(LINE_SRC) as GeoJSONSource | undefined;
    if (lineSrc) {
      lineSrc.setData(lineFC);
      (this.map.getSource(PT_SRC) as GeoJSONSource).setData(ptFC);
    } else {
      this.add(lineFC, ptFC);
    }
  }

  private add(lineFC: FeatureCollection<LineString>, ptFC: FeatureCollection<Point>): void {
    const before = this.map.getLayer("rc-location-circle") ? "rc-location-circle" : undefined;
    this.map.addSource(LINE_SRC, { type: "geojson", data: lineFC });
    this.map.addLayer(
      {
        id: LINE_LAYER,
        type: "line",
        source: LINE_SRC,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": colorExpr(), "line-width": 4, "line-opacity": 0.85 },
      },
      before,
    );
    this.map.addSource(PT_SRC, { type: "geojson", data: ptFC });
    this.map.addLayer(
      {
        id: PT_LAYER,
        type: "circle",
        source: PT_SRC,
        paint: {
          // Origin gets a bigger ring; reachable cities sized uniformly.
          "circle-radius": ["case", ["==", ["get", "origin"], 1], 9, 6],
          "circle-color": colorExpr(),
          "circle-stroke-color": "#0e1116",
          "circle-stroke-width": 1.2,
        },
      },
      before,
    );
    this.added = true;
  }
}
