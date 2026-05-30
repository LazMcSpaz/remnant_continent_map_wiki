// DERIVED: the network graph.
//
// Nodes are locations; edges are routes carrying { owner, capacity, speed,
// status }. Built here in Phase 1 because route measurement, travel times, and
// isochrones all need it — and it is the single object the Phase 4 simulation
// consumes (see web/src/sim/INTERFACE.md). Pure function of the authored layer;
// never persisted as fact.
//
// Route endpoints are snapped to the nearest location within SNAP_METERS so a
// route drawn to a city connects to that city's node. Endpoints with no nearby
// location become standalone "junction" nodes keyed by rounded coordinate.

import type { FeatureCollection, Point, Polygon, LineString, Position } from "geojson";
import type { LocationProps, RouteProps } from "../layers/features";
import type { RouteStatus } from "../state/db-types";
import { travelHours } from "./travel";

export interface GraphNode {
  id: string;
  /** Location id when the node is a place; null for bare junctions. */
  locationId: string | null;
  name: string;
  lngLat: [number, number];
}

export interface GraphEdge {
  id: string;
  routeId: string;
  from: string;
  to: string;
  owner: string | null;
  speed: number; // km/h, by route kind (placeholder until travel_modes wired)
  capacity: number; // placeholder; Phase 2 derives from kind/status
  status: RouteStatus;
  /** Geodesic length in kilometers. */
  lengthKm: number;
}

export interface NetworkGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

const SNAP_METERS = 2000; // endpoints within 2 km of a location snap to it
const EARTH_R = 6371; // km

/** Default speeds (km/h) by route kind — superseded by travel_modes later. */
const KIND_SPEED: Record<string, number> = { rail: 90, road: 60, trail: 25 };
/** Class multiplier: major routes are faster/better maintained; secret slower. */
const CLASS_SPEED: Record<string, number> = { major: 1, minor: 0.75, secret: 0.5 };

function toRad(d: number): number {
  return (d * Math.PI) / 180;
}

/** Great-circle distance in km between two [lng, lat] points. */
export function haversineKm(a: [number, number], b: [number, number]): number {
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Total geodesic length of a LineString in km. */
function lineLengthKm(coords: Position[]): number {
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    total += haversineKm(
      [coords[i - 1][0], coords[i - 1][1]],
      [coords[i][0], coords[i][1]],
    );
  }
  return total;
}

function representativePoint(geom: Point | Polygon): [number, number] {
  if (geom.type === "Point") return [geom.coordinates[0], geom.coordinates[1]];
  // Polygon: average the outer ring (good enough for snapping).
  const ring = geom.coordinates[0] ?? [];
  let x = 0;
  let y = 0;
  for (const p of ring) {
    x += p[0];
    y += p[1];
  }
  const n = ring.length || 1;
  return [x / n, y / n];
}

/**
 * Build the derived network graph from authored locations and routes.
 * Pure: same inputs always yield the same graph.
 */
export function buildNetworkGraph(
  locations: FeatureCollection<Point | Polygon, LocationProps>,
  routes: FeatureCollection<LineString, RouteProps>,
): NetworkGraph {
  const nodes = new Map<string, GraphNode>();

  const places = locations.features.map((f) => ({
    id: f.properties.id,
    name: f.properties.name,
    pt: representativePoint(f.geometry),
  }));

  for (const p of places) {
    nodes.set(`loc:${p.id}`, {
      id: `loc:${p.id}`,
      locationId: p.id,
      name: p.name,
      lngLat: p.pt,
    });
  }

  const snapKm = SNAP_METERS / 1000;

  /** Resolve an endpoint to a node id, creating a junction node if needed. */
  function nodeForEndpoint(pt: [number, number]): string {
    let best: { id: string; d: number } | null = null;
    for (const p of places) {
      const d = haversineKm(pt, p.pt);
      if (d <= snapKm && (!best || d < best.d)) best = { id: `loc:${p.id}`, d };
    }
    if (best) return best.id;
    // Bare junction, keyed by rounded coordinate so coincident endpoints merge.
    const key = `jct:${pt[0].toFixed(4)},${pt[1].toFixed(4)}`;
    if (!nodes.has(key)) {
      nodes.set(key, { id: key, locationId: null, name: "junction", lngLat: pt });
    }
    return key;
  }

  const edges: GraphEdge[] = [];
  for (const r of routes.features) {
    const coords = r.geometry.coordinates;
    if (coords.length < 2) continue;
    const start: [number, number] = [coords[0][0], coords[0][1]];
    const end: [number, number] = [coords[coords.length - 1][0], coords[coords.length - 1][1]];
    const from = nodeForEndpoint(start);
    const to = nodeForEndpoint(end);
    const props = r.properties;
    edges.push({
      id: `edge:${props.id}`,
      routeId: props.id,
      from,
      to,
      owner: props.ownerFactionId,
      speed: (KIND_SPEED[props.kind] ?? 50) * (CLASS_SPEED[props.routeClass] ?? 1),
      capacity: props.routeClass === "major" ? 3 : props.routeClass === "minor" ? 2 : 1,
      status: props.status,
      lengthKm: lineLengthKm(coords),
    });
  }

  return { nodes: [...nodes.values()], edges };
}

/** Travel time (hours) along an edge for the current travel mode + route
 *  status. Always computes — breaks never sever travel (they're annotations). */
export function edgeTravelHours(edge: GraphEdge): number {
  return travelHours(edge.lengthKm, edge.status);
}

export interface GroupAggregate {
  lengthKm: number;
  /** Sum of member travel times at the current mode — always computed. */
  travelHours: number;
  /** True if any member is physically destroyed (not from breaks). */
  closed: boolean;
  memberCount: number;
  severedCount: number;
}

/**
 * Aggregate a corridor's derived state. Travel time always computes (sum of
 * member times). "Closed" reflects physically destroyed segments only — breaks
 * are annotations and do not close a corridor.
 */
export function aggregateGroup(memberRouteIds: string[], graph: NetworkGraph): GroupAggregate {
  let lengthKm = 0;
  let travel = 0;
  let destroyed = 0;
  for (const rid of memberRouteIds) {
    const edge = graph.edges.find((e) => e.routeId === rid);
    if (!edge) continue;
    lengthKm += edge.lengthKm;
    travel += travelHours(edge.lengthKm, edge.status);
    if (edge.status === "destroyed") destroyed += 1;
  }
  return {
    lengthKm,
    travelHours: travel,
    closed: destroyed > 0,
    memberCount: memberRouteIds.length,
    severedCount: destroyed,
  };
}
