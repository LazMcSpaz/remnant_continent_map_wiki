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
 * Angular distance (degrees, 0..180) from the authored North Pole. 0 = at the
 * pole, 90 = on the new equator, 180 = the antipodal (south) pole. Moving
 * `pole_geom` remaps the whole climate field. Effective latitude is 90 − this.
 */
export function poleDistanceDeg(point: [number, number], pole: [number, number]): number {
  const km = haversineKm(point, pole);
  return (km / (Math.PI * EARTH_R)) * 180;
}

/** Initial map bearing (deg, 0=N, clockwise) from a point toward the pole. */
function bearingToPole(point: [number, number], pole: [number, number]): number {
  const φ1 = point[1] * DEG2RAD;
  const φ2 = pole[1] * DEG2RAD;
  const dλ = (pole[0] - point[0]) * DEG2RAD;
  const y = Math.sin(dλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(dλ);
  return (Math.atan2(y, x) / DEG2RAD + 360) % 360;
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
  prevailingWindDeg: number;
  seaLevelM: number;
}

/** Pull the climate inputs out of world_settings, with safe fallbacks. */
export function climateInputs(ws: WorldSettingsGeo | null): ClimateInputs {
  const pole = ws?.pole_geometry
    ? ([ws.pole_geometry.coordinates[0], ws.pole_geometry.coordinates[1]] as [number, number])
    : ([-75, -10] as [number, number]); // default new pole: Peru
  return {
    equatorTempC: ws?.equator_temp_c ?? 28,
    poleTempC: ws?.pole_temp_c ?? -30,
    lapseRateCPerKm: ws?.lapse_rate_c_per_km ?? 6.5,
    axialTiltDeg: ws?.axial_tilt_deg ?? 23.5,
    season: ws?.season ?? 0,
    globalTempOffsetC: ws?.global_temp_offset ?? 0,
    pole,
    prevailingWindDeg: ws?.prevailing_wind_deg ?? 270,
    seaLevelM: ws?.sea_level_m ?? 0,
  };
}

/**
 * Mean temperature (°C) at a point + elevation for a season phase.
 *  warmth = sin(distance-from-pole): 0 at either pole, 1 on the new equator
 *  base   = lerp(pole, equator) by warmth   (pole cold, equator hot — corrected)
 *  season = tilt-scaled swing, largest at high latitude, hemisphere-dependent
 *  elevation cools by the lapse rate; global offset shifts everything
 */
export function temperatureAt(
  point: [number, number],
  elevationM: number,
  inp: ClimateInputs,
  maritime = 0,
): number {
  const d = poleDistanceDeg(point, inp.pole); // 0..180
  const warmth = Math.sin(d * DEG2RAD); // 0 at poles, 1 at equator
  const base = inp.poleTempC + (inp.equatorTempC - inp.poleTempC) * warmth;

  // Seasonal swing: bigger toward the poles; flips by hemisphere (which side of
  // the new equator). Water moderates it (mild coasts, extreme interiors).
  const hemisphere = d <= 90 ? 1 : -1;
  const swing = (inp.axialTiltDeg / 23.5) * (1 - warmth) * 22 * (1 - 0.55 * maritime);
  const seasonal = hemisphere * -Math.cos(inp.season * 2 * Math.PI) * swing;

  const elevationCooling = (Math.max(0, elevationM) / 1000) * inp.lapseRateCPerKm;
  return base + seasonal - elevationCooling + inp.globalTempOffsetC;
}

// --- Precipitation & wind (rule-based latitude bands) -----------------------

export type WindBand = "trade easterlies" | "westerlies" | "polar easterlies";

export interface ClimatePoint {
  tempC: number;
  /** 0..100 stylized precipitation. */
  precip: number;
  /** Effective latitude (−90..90); sign = hemisphere relative to the new pole. */
  effLat: number;
  windBand: WindBand;
  /** Prevailing wind direction as a map bearing (deg, 0=N, the way it blows). */
  windBearing: number;
}

export interface Biome {
  id: string;
  label: string;
  color: string;
}

/** Effective latitude in degrees (−90 new-south .. +90 new-north). */
export function effLatitude(point: [number, number], pole: [number, number]): number {
  return 90 - poleDistanceDeg(point, pole);
}

/** Latitude-band precipitation baseline (0..100): ITCZ wet, subtropics dry,
 *  mid-latitudes moderate-wet, poles dry. `absLat` is |effective latitude|. */
function precipBand(absLat: number): number {
  const pts: Array<[number, number]> = [
    [0, 92], [10, 85], [20, 45], [28, 18], [38, 60], [50, 70], [62, 45], [75, 22], [90, 12],
  ];
  for (let i = 1; i < pts.length; i++) {
    if (absLat <= pts[i][0]) {
      const [x0, y0] = pts[i - 1];
      const [x1, y1] = pts[i];
      const t = (absLat - x0) / (x1 - x0);
      return y0 + (y1 - y0) * t;
    }
  }
  return 12;
}

/**
 * Post-shift sea level (m) at a point. A rapid polar shift re-forms the
 * equatorial bulge around the NEW equator, so the sea surface stands higher
 * near the new equator and lower near the new poles — old-Arctic lowlands flood,
 * the new polar regions drain. `sin(distance-from-pole)²` peaks at the equator.
 */
const SEA_BULGE_M = 220; // stylized amplitude of the realigned bulge
export function seaLevelAt(point: [number, number], inp: ClimateInputs): number {
  const d = poleDistanceDeg(point, inp.pole);
  return inp.seaLevelM + SEA_BULGE_M * Math.sin(d * DEG2RAD) ** 2;
}

/** Whittaker-style biome from mean annual temperature + precipitation. */
export function biomeAt(meanTempC: number, precip: number, isWater: boolean): Biome {
  if (isWater) return { id: "water", label: "Sea / lake", color: "#2b5d8a" };
  if (meanTempC < -8) return { id: "ice", label: "Ice / polar desert", color: "#dfe9f0" };
  if (precip < 20) {
    return meanTempC < 4
      ? { id: "tundra", label: "Cold tundra", color: "#9aa7a0" }
      : { id: "desert", label: "Desert", color: "#d8b15f" };
  }
  if (meanTempC < 2) return { id: "tundra", label: "Tundra", color: "#8fa39a" };
  if (meanTempC >= 22) {
    return precip >= 60
      ? { id: "rainforest", label: "Tropical rainforest", color: "#1f7a3a" }
      : { id: "savanna", label: "Savanna", color: "#b7a84a" };
  }
  if (precip >= 55) return { id: "forest", label: "Temperate forest", color: "#2f6b3f" };
  if (precip >= 32) return { id: "woodland", label: "Woodland / steppe", color: "#6f8f4a" };
  return { id: "grassland", label: "Grassland / prairie", color: "#9bab57" };
}

/** Wind band + prevailing bearing at a point, oriented to the new axis. */
export function windAt(point: [number, number], inp: ClimateInputs): { band: WindBand; bearing: number } {
  const d = poleDistanceDeg(point, inp.pole);
  const absLat = Math.abs(90 - d);
  const toPole = bearingToPole(point, inp.pole); // "new north" direction here
  let band: WindBand;
  let rel: number; // wind blows toward this bearing, relative to new-north
  if (absLat < 30) {
    band = "trade easterlies"; // blow toward the new west (and equatorward)
    rel = -100;
  } else if (absLat < 60) {
    band = "westerlies"; // blow toward the new east
    rel = 80;
  } else {
    band = "polar easterlies";
    rel = -90;
  }
  return { band, bearing: (toPole + rel + 360) % 360 };
}

export interface ClimateOptions {
  /** 0..1 proximity to water — moderates seasons, adds coastal moisture. */
  maritime?: number;
  /** −0.5..0.5 orographic precip bonus (windward wet / leeward rain-shadow). */
  oroBonus?: number;
  isWater?: boolean;
}

/**
 * Full per-point climate from the rules: temperature, precipitation, and wind.
 * Optional maritime + orographic factors (from neighbour elevation samples)
 * refine it; pass none for the bare latitude/elevation field.
 */
export function climateAt(
  point: [number, number],
  elevationM: number,
  inp: ClimateInputs,
  opts: ClimateOptions = {},
): ClimatePoint {
  const maritime = opts.maritime ?? 0;
  const tempC = temperatureAt(point, elevationM, inp, maritime);
  const effLat = effLatitude(point, inp.pole);
  let precip = precipBand(Math.abs(effLat));
  // Latitude-band lift from elevation (orographic) + windward/leeward + coastal.
  const elev = Math.max(0, elevationM);
  const elevLift = elev <= 1500 ? 1 + (elev / 1500) * 0.2 : 1.2 - ((elev - 1500) / 3000) * 0.5;
  precip *= Math.max(0.35, elevLift) * (1 + (opts.oroBonus ?? 0)) * (1 + maritime * 0.4);
  precip = Math.max(0, Math.min(100, precip));
  if (tempC < -10) precip *= 0.5; // hard freeze suppresses precipitation
  const w = windAt(point, inp);
  return { tempC, precip: Math.round(precip), effLat, windBand: w.band, windBearing: Math.round(w.bearing) };
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

/** Metric shown by the full-map climate grid overlay. */
export type GridMetric = "temperature" | "precip" | "biome";

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
