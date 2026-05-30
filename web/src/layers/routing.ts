// Road snapping via OSRM. Turns the waypoints a user clicked into a geometry
// that follows real roads between them. Used by the route editor for ROAD
// routes; rail/trail are hand-traced (OSRM's public server only does roads).
//
// The public demo server (router.project-osrm.org) is fine for low-volume
// authoring use. Override with VITE_OSRM_URL to point at your own instance.
// Note: the host must also be allowed in connect-src (web/public/_headers).

import type { LineString, Position } from "geojson";

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
