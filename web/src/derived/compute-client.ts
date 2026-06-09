// Client for the local Python compute backend (server/). When VITE_COMPUTE_URL
// is set, the app asks it for derived water/coast features computed on real
// high-resolution DEMs — instead of sampling DEM tiles + running hydrology in
// the browser. The backend returns ready-to-render GeoJSON.

import type { FeatureCollection, LineString, Polygon } from "geojson";
import { computeUrl } from "../config";
import type { ClimateInputs } from "./climate";
import type { ElevationEdit } from "./terrain";

export interface DerivedWater {
  rivers: FeatureCollection<LineString>;
  lakes: FeatureCollection<Polygon>;
  sea: FeatureCollection<Polygon>;
  coastline: FeatureCollection<LineString>;
  meta: Record<string, unknown>;
}

export function hasComputeBackend(): boolean {
  return computeUrl() !== null;
}

/** Liveness + whether a DEM is loaded on the backend. */
export async function computeHealth(): Promise<{ ok: boolean; demLoaded: boolean; detail?: string }> {
  const base = computeUrl();
  if (!base) return { ok: false, demLoaded: false, detail: "VITE_COMPUTE_URL not set" };
  try {
    const res = await fetch(`${base}/health`);
    if (!res.ok) return { ok: false, demLoaded: false, detail: `HTTP ${res.status}` };
    const body = await res.json();
    return { ok: true, demLoaded: Boolean(body?.dem?.loaded), detail: body?.dem?.path ?? undefined };
  } catch (err) {
    return { ok: false, demLoaded: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

/** Ask the backend to derive water/coast for the current world + edits. */
export async function deriveWater(
  inp: ClimateInputs,
  edits: ElevationEdit[],
  opts: { bbox?: [number, number, number, number] } = {},
): Promise<DerivedWater> {
  const base = computeUrl();
  if (!base) throw new Error("No compute backend configured (VITE_COMPUTE_URL).");
  const body = {
    world: {
      pole_lng: inp.pole[0],
      pole_lat: inp.pole[1],
      sea_level_m: inp.seaLevelM,
      // SEA_BULGE_M lives in climate.ts; the backend defaults to 220 to match.
    },
    edits: edits.map((e) => ({ lng: e.lng, lat: e.lat, radiusKm: e.radiusKm, deltaM: e.deltaM })),
    bbox: opts.bbox ?? null,
    smooth: true,
  };
  const res = await fetch(`${base}/derive/water`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`compute /derive/water failed: HTTP ${res.status} ${text.slice(0, 200)}`);
  }
  return (await res.json()) as DerivedWater;
}
