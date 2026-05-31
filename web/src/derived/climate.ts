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

/** Celsius → Fahrenheit (the UI displays °F; the model computes in °C). */
export function cToF(c: number): number {
  return c * 9 / 5 + 32;
}

/** Format a Celsius temperature for display as whole degrees Fahrenheit. */
export function formatTempF(c: number): string {
  return `${Math.round(cToF(c))} °F`;
}

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

/** Default new North Pole — Peru — used before world_settings loads. */
export const DEFAULT_POLE: [number, number] = [-75, -10];

/** Initial map bearing (deg, 0=N, clockwise) from a point toward the pole. */
export function bearingToPole(point: [number, number], pole: [number, number]): number {
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
    : DEFAULT_POLE; // default new pole: Peru
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

/**
 * Canonical biome palette — the legend, and the stable id→colour mapping the
 * raster overlay indexes into (so the map and the legend never drift apart).
 * The water colour matches the sea-level overlay.
 */
export const BIOME_LEGEND: Biome[] = [
  { id: "water", label: "Sea / lake", color: "#abd2df" },
  { id: "ice", label: "Ice / polar desert", color: "#dfe9f0" },
  { id: "tundra", label: "Tundra", color: "#9aa7a0" },
  { id: "desert", label: "Desert", color: "#d8b15f" },
  { id: "grassland", label: "Grassland / prairie", color: "#9bab57" },
  { id: "woodland", label: "Woodland / steppe", color: "#6f8f4a" },
  { id: "forest", label: "Temperate forest", color: "#2f6b3f" },
  { id: "savanna", label: "Savanna", color: "#b7a84a" },
  { id: "rainforest", label: "Tropical rainforest", color: "#1f7a3a" },
];

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
 * Warm-season ("growing season") mean temperature (°C). Agricultural potential
 * should reflect the warmth a crop sees *while growing*, and it must NOT flip
 * when the season scrubber moves — so we evaluate the warm extreme of the
 * annual swing rather than the current season. Maritime moderation lowers the
 * summer peak (mild coasts, hotter interiors).
 */
export function growingSeasonTempC(
  point: [number, number],
  elevationM: number,
  inp: ClimateInputs,
  maritime = 0,
): number {
  const d = poleDistanceDeg(point, inp.pole);
  const warmth = Math.sin(d * DEG2RAD);
  const base = inp.poleTempC + (inp.equatorTempC - inp.poleTempC) * warmth;
  const swing = (inp.axialTiltDeg / 23.5) * (1 - warmth) * 22 * (1 - 0.55 * maritime);
  const elevationCooling = (Math.max(0, elevationM) / 1000) * inp.lapseRateCPerKm;
  return base + Math.abs(swing) - elevationCooling + inp.globalTempOffsetC;
}

/**
 * Warmth available for crops (0..100) from the growing-season temperature — an
 * **optimum band**, not "hotter is always better": too cold to grow below ~5°C,
 * a temperate optimum ~20–28°C, then heat stress above. This is what rewards
 * the mild temperate zone (the new Midwest) over both frozen ground and the
 * scorching new tropics.
 */
export function growingWarmth(growTempC: number): number {
  if (growTempC <= 5 || growTempC >= 42) return 0;
  if (growTempC < 20) return ((growTempC - 5) / 15) * 100; // ramp up to optimum
  if (growTempC <= 28) return 100; // temperate optimum
  return Math.max(0, (1 - (growTempC - 28) / 14) * 100); // heat falloff
}

/**
 * Moisture available for crops (0..1) from stylized precipitation (0..100):
 * rises out of aridity, plateaus through a well-watered optimum, then eases off
 * where it is wet enough that waterlogging bites. Temperate-forest rainfall
 * sits squarely in the optimum.
 */
export function moistureSuitability(precip: number): number {
  if (precip <= 8) return 0.06;
  if (precip < 55) return 0.06 + ((precip - 8) / 47) * 0.94; // → 1.0 at 55
  if (precip <= 85) return 1; // optimum
  return Math.max(0.75, 1 - (precip - 85) / 60); // mild waterlogging
}

/** How well land cover supports cultivation (0..1 multiplier). */
const LAND_COVER_CROP: Record<LandCover, number> = {
  cropland: 1.0,
  grassland: 0.8,
  forest: 0.6, // temperate forest soils are productive once cleared
  wetland: 0.5,
  tundra: 0.15,
  desert: 0.1,
  barren: 0.05,
  urban: 0.3,
  water: 0,
};

export interface CropResult {
  /** 0..100 overall suitability. */
  suitability: number;
  /** Growing-season temperature (°C) the warmth score came from. */
  tempC: number;
  warmth: number;
  /** The limiting factor, for inspectability. */
  limiting: "temperature" | "water" | "soil" | "land cover" | "balanced";
}

/** The geography a crop calculation needs at a point. */
export interface CropInputs {
  elevationM: number;
  /** 0..100 soil fertility. */
  soilFertility: number;
  /** 0..100 authored surface water (rivers/irrigation, supplements rainfall). */
  surfaceWater: number;
  landCover: LandCover | null;
  /** Stylized precipitation (0..100). If omitted, recomputed from the rules. */
  precip?: number;
}

/**
 * Crop suitability at a point — the shared core used for both a city (its own
 * coordinates) and a terrain region (its centroid), so they never diverge.
 *
 * Warmth (growing-season, optimum band) and moisture (rainfall + irrigation)
 * are **gating** factors; soil fertility and land cover **modulate** without
 * ever zeroing a viable climate — cleared temperate forest is prime farmland,
 * so a forested cover shouldn't disqualify it, but rich soil is rewarded. The
 * smallest factor is returned as the limiter so a result can be explained.
 */
export function cropSuitabilityAt(
  point: [number, number],
  ci: CropInputs,
  inp: ClimateInputs,
): CropResult {
  const growTemp = growingSeasonTempC(point, ci.elevationM, inp);
  const warmth = growingWarmth(growTemp) / 100; // 0..1, temperate optimum

  const precip = ci.precip ?? climateAt(point, ci.elevationM, inp).precip;
  const m0 = moistureSuitability(precip);
  const surface = ci.surfaceWater / 100;
  // Irrigation/rivers can carry a region past what rainfall alone provides.
  const moisture = m0 + 0.4 * surface * (1 - m0);

  const fertility = ci.soilFertility / 100;
  const cover = ci.landCover ? LAND_COVER_CROP[ci.landCover] : 0.5;

  const suitability = Math.round(
    warmth * moisture * (0.45 + 0.55 * fertility) * (0.55 + 0.45 * cover) * 100,
  );

  const factors: Array<[CropResult["limiting"], number]> = [
    ["temperature", warmth],
    ["water", moisture],
    ["soil", fertility],
    ["land cover", cover],
  ];
  factors.sort((a, b) => a[1] - b[1]);
  const limiting = factors[0][1] > 0.7 ? "balanced" : factors[0][0];

  return { suitability, tempC: growTemp, warmth: warmth * 100, limiting };
}

/** Crop suitability for a terrain region (evaluated at its centroid). */
export function cropSuitability(region: TerrainRegionGeo, inp: ClimateInputs): CropResult {
  return cropSuitabilityAt(
    regionCentroid(region.geometry),
    {
      elevationM: region.elevation_m ?? 0,
      soilFertility: region.soil_fertility ?? 50,
      surfaceWater: region.surface_water ?? 50,
      landCover: region.land_cover ?? null,
    },
    inp,
  );
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
    const tempC = temperatureAt(regionCentroid(r.geometry), r.elevation_m ?? 0, inp);
    const crop = cropSuitability(r, inp);
    out.set(r.id, { id: r.id, tempC, crop });
  }
  return out;
}
