// DERIVED: city resource baselines.
//
// The README's model: a city's resources are *derived from geography* (sun,
// wind, water, growing season), and manual overrides act as **pins** that
// survive recomputation and are shown as authored rather than computed. This
// module implements exactly that — it never stores anything.
//
//   terrain region (authored) + climate (derived)  ──►  resource baseline
//   baseline + resource_overrides (authored pins)   ──►  effective value
//
// Cascade: editing the terrain beneath a city, or scrubbing the season, changes
// the baseline; a pin overrides it until the author removes the pin.

import type { TerrainRegionGeo, LandCover } from "../state/db-types";
import type { ClimateInputs } from "./climate";
import { regionAt, temperatureAt, growingWarmth } from "./climate";

export const RESOURCE_KINDS = ["food", "water", "energy", "production"] as const;
export type ResourceKind = (typeof RESOURCE_KINDS)[number];

/** Land-cover support for cultivation (food) — shared shape with crops. */
const LAND_COVER_CROP: Record<LandCover, number> = {
  cropland: 1.0, grassland: 0.8, wetland: 0.5, forest: 0.45, tundra: 0.15,
  desert: 0.1, barren: 0.05, urban: 0.3, water: 0,
};

/** Land-cover support for development/production (buildable land). */
const LAND_COVER_BUILD: Record<LandCover, number> = {
  urban: 1.0, grassland: 0.8, cropland: 0.7, barren: 0.6, desert: 0.5,
  forest: 0.45, tundra: 0.3, wetland: 0.2, water: 0,
};

const clamp100 = (n: number): number => Math.max(0, Math.min(100, Math.round(n)));

export interface ResourceValue {
  kind: ResourceKind;
  /** Geography-derived baseline (0..100). null when no terrain covers the city. */
  baseline: number | null;
  /** Authored pin (resource_overrides), if set. */
  pinned: number | null;
  /** What the world uses: pin if set, else baseline (0 when neither). */
  effective: number;
  /** True when the value comes from an authored pin, not the baseline. */
  isPinned: boolean;
}

export interface CityResources {
  values: Record<ResourceKind, ResourceValue>;
  /** The region the baselines were computed from, if any. */
  regionName: string | null;
}

/**
 * Compute a city's resource baselines from the terrain region beneath it and
 * the climate, then fold in authored overrides as pins.
 *
 * - food:       crop suitability at the city (warmth × soil × water × cover)
 * - water:      surface-water availability
 * - energy:     wind + solar exposure (mean)
 * - production: buildable land (land cover × gentle-slope bonus)
 */
export function deriveCityResources(
  lngLat: [number, number],
  overrides: Record<string, number>,
  regions: TerrainRegionGeo[],
  inp: ClimateInputs,
): CityResources {
  const region = regionAt(lngLat, regions);
  const baseline = region ? baselinesFor(region, lngLat, inp) : null;

  const values = {} as Record<ResourceKind, ResourceValue>;
  for (const kind of RESOURCE_KINDS) {
    const base = baseline ? baseline[kind] : null;
    const pin = typeof overrides[kind] === "number" ? overrides[kind] : null;
    values[kind] = {
      kind,
      baseline: base,
      pinned: pin,
      effective: pin ?? base ?? 0,
      isPinned: pin != null,
    };
  }
  return { values, regionName: region?.name ?? null };
}

function baselinesFor(
  region: TerrainRegionGeo,
  lngLat: [number, number],
  inp: ClimateInputs,
): Record<ResourceKind, number> {
  const elev = region.elevation_m ?? 0;
  const tempC = temperatureAt(lngLat, elev, inp);
  const warmth = growingWarmth(tempC) / 100; // 0..1

  const fertility = (region.soil_fertility ?? 50) / 100;
  const water = (region.surface_water ?? 50) / 100;
  const cover = region.land_cover ? LAND_COVER_CROP[region.land_cover] : 0.5;
  const build = region.land_cover ? LAND_COVER_BUILD[region.land_cover] : 0.5;
  const wind = (region.wind_exposure ?? 50) / 100;
  const solar = (region.solar_exposure ?? 50) / 100;

  // Steep land is harder to build on.
  const slope = region.slope_deg ?? 0;
  const slopeFactor = Math.max(0.3, 1 - slope / 30); // 1 flat → 0.3 at 30°+

  return {
    food: clamp100(warmth * fertility * water * cover * 100),
    water: clamp100(water * 100),
    energy: clamp100(((wind + solar) / 2) * 100),
    production: clamp100(build * slopeFactor * 100),
  };
}
