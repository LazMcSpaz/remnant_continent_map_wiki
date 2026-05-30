// DERIVED: the climate cascade.
//
// Pure functions of the AUTHORED layer (world_settings + terrain_regions). They
// are never stored — they recompute whenever an input changes (move the pole,
// shift the season, edit elevation). This is the Phase 2 cascade from the
// README, and the first consumer of the climate/terrain inputs hardened into
// the schema.
//
//   world_settings + terrain  ──►  effective latitude  ──►  temperature field
//                                                       ──►  growing season
//                                                       ──►  crop suitability
//
// The model is deliberately simple and fully inspectable: every output traces
// back to an authored input you can point at. It is a stylized world-model, not
// a climatology engine.

import type { WorldSettingsGeo, TerrainRegionGeo, LandCover } from "../state/db-types";

const DEG2RAD = Math.PI / 180;
const EARTH_R = 6371; // km

/** Great-circle distance in km between two [lng, lat] points. */
function haversineKm(a: [number, number], b: [number, number]): number {
  const dLat = (b[1] - a[1]) * DEG2RAD;
  const dLng = (b[0] - a[0]) * DEG2RAD;
  const lat1 = a[1] * DEG2RAD;
  const lat2 = b[1] * DEG2RAD;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Representative [lng, lat] of a MultiPolygon (outer-ring centroid average). */
export function regionCentroid(geom: TerrainRegionGeo["geometry"]): [number, number] {
  let x = 0;
  let y = 0;
  let n = 0;
  for (const poly of geom.coordinates) {
    const ring = poly[0] ?? [];
    for (const p of ring) {
      x += p[0];
      y += p[1];
      n++;
    }
  }
  return n ? [x / n, y / n] : [0, 0];
}

/**
 * Effective latitude (0 at the pole-defined equator, 90 at the pole): the
 * angular distance from the authored pole, in degrees. Moving `pole_geom`
 * remaps every region's latitude, which is what makes the whole field shift.
 */
export function effectiveLatitude(
  point: [number, number],
  pole: [number, number],
): number {
  const km = haversineKm(point, pole);
  // Convert arc length to degrees of arc on the sphere.
  const deg = (km / (Math.PI * EARTH_R)) * 180;
  return Math.max(0, Math.min(90, deg));
}

/** Ray-casting point-in-ring test on a single linear ring ([lng,lat] pairs). */
function pointInRing(pt: [number, number], ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect =
      yi > pt[1] !== yj > pt[1] &&
      pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** True when a point falls inside a MultiPolygon (outer ring; ignores holes). */
function pointInMultiPolygon(pt: [number, number], geom: TerrainRegionGeo["geometry"]): boolean {
  for (const poly of geom.coordinates) {
    const outer = poly[0];
    if (outer && pointInRing(pt, outer)) return true;
  }
  return false;
}

/** The terrain region containing a point, or null when none covers it. */
export function regionAt(
  point: [number, number],
  regions: TerrainRegionGeo[],
): TerrainRegionGeo | null {
  for (const r of regions) {
    if (pointInMultiPolygon(point, r.geometry)) return r;
  }
  return null;
}

/**
 * Elevation (m) sampled at a point from the terrain region that contains it,
 * or 0 (sea level) when no region covers it. This is what makes a city's
 * derived climate respond to terrain elevation edits beneath it — the cascade
 * that would otherwise be broken because locations carry no elevation of their
 * own.
 */
export function sampleElevation(
  point: [number, number],
  regions: TerrainRegionGeo[],
): number {
  const r = regionAt(point, regions);
  return r?.elevation_m ?? 0;
}

export interface ClimateInputs {
  equatorTempC: number;
  poleTempC: number;
  lapseRateCPerKm: number;
  axialTiltDeg: number;
  /** Season phase 0..1 (0 = perihelion-ish/“winter” in the north here). */
  season: number;
  globalTempOffsetC: number;
  pole: [number, number];
}

/** Pull the climate inputs out of world_settings, with safe fallbacks. */
export function climateInputs(ws: WorldSettingsGeo | null): ClimateInputs {
  const pole = ws?.pole_geometry
    ? ([ws.pole_geometry.coordinates[0], ws.pole_geometry.coordinates[1]] as [number, number])
    : ([0, 90] as [number, number]);
  return {
    equatorTempC: ws?.equator_temp_c ?? 30,
    poleTempC: ws?.pole_temp_c ?? -25,
    lapseRateCPerKm: ws?.lapse_rate_c_per_km ?? 6.5,
    axialTiltDeg: ws?.axial_tilt_deg ?? 23.5,
    season: ws?.season ?? 0,
    globalTempOffsetC: ws?.global_temp_offset ?? 0,
    pole,
  };
}

/**
 * Mean annual-ish temperature (°C) at a point+elevation for a season phase.
 *  base = lerp(equator, pole) by cos(effective latitude)
 *  seasonal swing scales with axial tilt and latitude, peaks at season 0/1
 *  elevation cools by the lapse rate
 *  global offset shifts everything
 */
export function temperatureAt(
  point: [number, number],
  elevationM: number,
  inp: ClimateInputs,
): number {
  const latDeg = effectiveLatitude(point, inp.pole);
  const latFactor = Math.cos(latDeg * DEG2RAD); // 1 at equator, 0 at pole
  const base = inp.poleTempC + (inp.equatorTempC - inp.poleTempC) * latFactor;

  // Seasonal swing: strongest at high latitude, scaled by tilt. season 0..1 is
  // a yearly cycle — 0/1 = midwinter (coldest), 0.5 = midsummer (warmest).
  const seasonPhase = -Math.cos(inp.season * 2 * Math.PI); // -1 at 0, +1 at 0.5
  const swing = (inp.axialTiltDeg / 23.5) * (1 - latFactor) * 18; // up to ~18°C
  const seasonal = seasonPhase * swing;

  const elevationCooling = (Math.max(0, elevationM) / 1000) * inp.lapseRateCPerKm;

  return base + seasonal - elevationCooling + inp.globalTempOffsetC;
}

/**
 * Growing-degree-day-ish score (0..100): warmth available for crops, above a
 * 5°C base, saturating near 25°C. A coarse stand-in for the growing season.
 */
export function growingWarmth(tempC: number): number {
  const gdd = Math.max(0, tempC - 5);
  return Math.max(0, Math.min(100, (gdd / 20) * 100));
}

/** How well land cover supports cultivation (0..1 multiplier). */
const LAND_COVER_CROP: Record<LandCover, number> = {
  cropland: 1.0,
  grassland: 0.8,
  wetland: 0.5,
  forest: 0.45,
  tundra: 0.15,
  desert: 0.1,
  barren: 0.05,
  urban: 0.3,
  water: 0,
};

export interface CropResult {
  /** 0..100 overall suitability. */
  suitability: number;
  tempC: number;
  warmth: number;
  /** The limiting factor, for inspectability. */
  limiting: "temperature" | "water" | "soil" | "land cover" | "balanced";
}

/**
 * Crop suitability for a terrain region: the product of warmth, soil fertility,
 * water availability, and land-cover support. Returns the limiting factor so a
 * result can always be explained — "Denvar valley is water-limited", etc.
 */
export function cropSuitability(
  region: TerrainRegionGeo,
  inp: ClimateInputs,
): CropResult {
  const point = regionCentroid(region.geometry);
  const elev = region.elevation_m ?? 0;
  const tempC = temperatureAt(point, elev, inp);
  const warmth = growingWarmth(tempC) / 100; // 0..1

  const fertility = (region.soil_fertility ?? 50) / 100;
  const water = (region.surface_water ?? 50) / 100;
  const cover = region.land_cover ? LAND_COVER_CROP[region.land_cover] : 0.5;

  const suitability = Math.round(warmth * fertility * water * cover * 100);

  // Identify the smallest factor as the limiter (for narratable output).
  const factors: Array<[CropResult["limiting"], number]> = [
    ["temperature", warmth],
    ["soil", fertility],
    ["water", water],
    ["land cover", cover],
  ];
  factors.sort((a, b) => a[1] - b[1]);
  const limiting = factors[0][1] > 0.7 ? "balanced" : factors[0][0];

  return { suitability, tempC, warmth: warmth * 100, limiting };
}

export type ClimateMetric = "temperature" | "crops";

/** A derived value per terrain region, ready to drive a choropleth overlay. */
export interface RegionDerived {
  id: string;
  tempC: number;
  crop: CropResult;
}

/** Recompute derived climate values for every terrain region. Pure. */
export function deriveClimate(
  regions: TerrainRegionGeo[],
  ws: WorldSettingsGeo | null,
): Map<string, RegionDerived> {
  const inp = climateInputs(ws);
  const out = new Map<string, RegionDerived>();
  for (const r of regions) {
    const crop = cropSuitability(r, inp);
    out.set(r.id, { id: r.id, tempC: crop.tempC, crop });
  }
  return out;
}
