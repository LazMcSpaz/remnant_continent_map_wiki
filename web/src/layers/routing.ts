// Road snapping via OSRM. Turns the waypoints a user clicked into a geometry
// that follows real roads between them. Used by the route editor for ROAD
// routes; rail/trail are hand-traced (OSRM's public server only does roads).
//
// The public demo server (router.project-osrm.org) is fine for low-volume
// authoring use. Override with VITE_OSRM_URL to point at your own instance.
// Note: the host must also be allowed in connect-src (web/public/_headers).

import type { LineString, Position } from "geojson";

// --- Landship routing (obstacle avoidance) ---------------------------------
// Landships hover, so they ignore roads but are hindered by dense forest and
// steep mountains. Those areas are passed in as barrier rings; we route around
// them with a visibility graph over the (slightly buffered) barrier corners +
// the start/end, then shortest-path with Dijkstra. Coarse but inspectable —
// good enough for stylized world geography.

type Ring = Position[]; // [lng, lat] vertices

function ccw(a: Position, b: Position, c: Position): number {
  return (c[1] - a[1]) * (b[0] - a[0]) - (b[1] - a[1]) * (c[0] - a[0]);
}

/** Strict (proper) segment crossing — endpoints touching don't count. */
function properIntersect(p1: Position, p2: Position, p3: Position, p4: Position): boolean {
  const d1 = ccw(p3, p4, p1);
  const d2 = ccw(p3, p4, p2);
  const d3 = ccw(p1, p2, p3);
  const d4 = ccw(p1, p2, p4);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

function pointInRing(pt: Position, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function dist(a: Position, b: Position): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return Math.hypot(dx, dy); // planar in degrees — fine for relative pathfinding
}

/** True if the segment a→b passes through any barrier's interior or crosses it. */
function blocked(a: Position, b: Position, barriers: Ring[]): boolean {
  const mid: Position = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  for (const ring of barriers) {
    if (pointInRing(mid, ring)) return true;
    for (let i = 0; i + 1 < ring.length; i++) {
      if (properIntersect(a, b, ring[i], ring[i + 1])) return true;
    }
  }
  return false;
}

function centroid(ring: Ring): Position {
  let x = 0, y = 0;
  for (const p of ring) {
    x += p[0];
    y += p[1];
  }
  return [x / ring.length, y / ring.length];
}

/** Push a vertex slightly outward from its ring centroid so paths clear edges. */
function bufferOut(v: Position, c: Position, by = 0.02): Position {
  const dx = v[0] - c[0];
  const dy = v[1] - c[1];
  const len = Math.hypot(dx, dy) || 1;
  return [v[0] + (dx / len) * by, v[1] + (dy / len) * by];
}

/**
 * A landship path from start to end that routes around barrier rings. Returns a
 * LineString; if start↔end is already clear (or no path is found) it's a
 * straight segment.
 */
export function landshipRoute(start: Position, end: Position, barriers: Ring[]): LineString {
  const line = (coords: Position[]): LineString => ({ type: "LineString", coordinates: coords });
  if (barriers.length === 0 || !blocked(start, end, barriers)) return line([start, end]);

  // Nodes: start, end, and buffered barrier corners.
  const nodes: Position[] = [start, end];
  for (const ring of barriers) {
    const c = centroid(ring);
    const last = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
      ? ring.length - 1
      : ring.length;
    for (let i = 0; i < last; i++) nodes.push(bufferOut(ring[i], c));
  }

  const n = nodes.length;
  const adj: Array<Array<{ to: number; w: number }>> = Array.from({ length: n }, () => []);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (!blocked(nodes[i], nodes[j], barriers)) {
        const w = dist(nodes[i], nodes[j]);
        adj[i].push({ to: j, w });
        adj[j].push({ to: i, w });
      }
    }
  }

  // Dijkstra from 0 (start) to 1 (end).
  const dists = new Array<number>(n).fill(Infinity);
  const prev = new Array<number>(n).fill(-1);
  const done = new Array<boolean>(n).fill(false);
  dists[0] = 0;
  for (let it = 0; it < n; it++) {
    let u = -1;
    let best = Infinity;
    for (let i = 0; i < n; i++) if (!done[i] && dists[i] < best) { best = dists[i]; u = i; }
    if (u === -1) break;
    done[u] = true;
    if (u === 1) break;
    for (const { to, w } of adj[u]) {
      if (dists[u] + w < dists[to]) {
        dists[to] = dists[u] + w;
        prev[to] = u;
      }
    }
  }

  if (!Number.isFinite(dists[1])) return line([start, end]); // no path — fall back
  const path: Position[] = [];
  for (let at = 1; at !== -1; at = prev[at]) path.unshift(nodes[at]);
  return line(path);
}


function osrmBase(): string {
  const env = import.meta.env;
  const v = typeof env.VITE_OSRM_URL === "string" ? env.VITE_OSRM_URL.trim() : "";
  return v || "https://router.project-osrm.org";
}

interface OsrmResponse {
  code: string;
  routes?: Array<{ geometry: LineString }>;
}

/**
 * Snap an ordered list of [lng, lat] waypoints to the road network, returning a
 * LineString that follows real roads. Returns null if routing is unavailable or
 * fails, so callers can fall back to the straight drawn line.
 */
export async function snapToRoads(waypoints: Position[]): Promise<LineString | null> {
  if (waypoints.length < 2) return null;
  const coords = waypoints.map((p) => `${p[0]},${p[1]}`).join(";");
  const url = `${osrmBase()}/route/v1/driving/${coords}?overview=full&geometries=geojson`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as OsrmResponse;
    if (data.code !== "Ok" || !data.routes?.length) return null;
    return data.routes[0].geometry;
  } catch {
    return null;
  }
}
