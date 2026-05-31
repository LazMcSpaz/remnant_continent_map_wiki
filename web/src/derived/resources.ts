// DERIVED: city resource baselines — fully model-driven.
//
// The README's model: a city's resources are *derived from geography*. Rather
// than require hand-authored terrain regions, the baselines now come straight
// from the **climate model**: the DEM-sampled elevation, the rules-derived
// climate (temperature, precipitation, wind, effective latitude), and the
// resulting biome. Manual overrides still act as **pins** that survive
// recomputation. Nothing is stored.
//
//   sampled climate (DEM + rules)                ──►  resource baseline
//   baseline + resource_overrides (authored pins) ──►  effective value
//
// Cascade: move the pole or scrub the season → the climate changes → the
// baselines change; a pin overrides until the author removes it.

import type { LandCover } from "../state/db-types";
import type { ClimateInputs } from "./climate";
import { cropSuitabilityAt } from "./climate";
import { sampleClimate, type SampledClimate } from "./climate-sample";

export const RESOURCE_KINDS = ["food", "water", "energy", "production"] as const;
export type ResourceKind = (typeof RESOURCE_KINDS)[number];

const DEG = Math.PI / 180;

/** Natural land cover implied by each biome (drives crop + buildability). */
const BIOME_LAND_COVER: Record<string, LandCover> = {
  water: "water",
  ice: "barren",
  tundra: "tundra",
  desert: "desert",
  grassland: "grassland",
  woodland: "grassland",
  forest: "forest",
  savanna: "grassland",
  rainforest: "forest",
};

/** Stylized soil fertility (0..100) by biome. Temperate grassland (the real
 *  Midwest's mollisols) is the most fertile; rainforest soils are leached;
 *  desert/tundra/ice are poor. */
const BIOME_FERTILITY: Record<string, number> = {
  water: 0,
  ice: 5,
  tundra: 20,
  desert: 15,
  grassland: 88,
  woodland: 62,
  forest: 72,
  savanna: 48,
  rainforest: 45,
};

/** Land-cover support for development/production (buildable land). */
const LAND_COVER_BUILD: Record<LandCover, number> = {
  urban: 1.0, grassland: 0.8, cropland: 0.7, barren: 0.6, desert: 0.5,
  forest: 0.45, tundra: 0.3, wetland: 0.2, water: 0,
};

/** Prevailing-wind-band base windiness (0..100) for energy. */
const WIND_BAND_BASE: Record<string, number> = {
  "westerlies": 70,
  "trade easterlies": 50,
  "polar easterlies": 60,
};

const clamp100 = (n: number): number => Math.max(0, Math.min(100, Math.round(n)));

export interface ResourceValue {
  kind: ResourceKind;
  /** Geography-derived baseline (0..100). null only when no coordinates. */
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
  /** Short description of where the baselines came from (the biome). */
  regionName: string | null;
}

/**
 * Compute a city's resource baselines from the sampled climate beneath it, then
 * fold in authored overrides as pins.
 *
 * - food:       crop suitability (growing-season warmth × moisture × soil × cover)
 * - water:      rainfall + proximity to water (100 if submerged)
 * - energy:     insolation (by latitude, less when cloudy) + wind (band/coast/elevation)
 * - production: buildable land (cover × elevation/ruggedness factor)
 */
export async function deriveCityResources(
  lngLat: [number, number],
  overrides: Record<string, number>,
  inp: ClimateInputs,
): Promise<CityResources> {
  const sc = await sampleClimate(lngLat, inp);
  const baseline = baselinesFor(lngLat, sc, inp);

  const values = {} as Record<ResourceKind, ResourceValue>;
  for (const kind of RESOURCE_KINDS) {
    const base = baseline[kind];
    const pin = typeof overrides[kind] === "number" ? overrides[kind] : null;
    values[kind] = {
      kind,
      baseline: base,
      pinned: pin,
      effective: pin ?? base ?? 0,
      isPinned: pin != null,
    };
  }
  const regionName = sc.isWater ? "submerged (below sea level)" : sc.biome.label.toLowerCase();
  return { values, regionName };
}

function baselinesFor(
  lngLat: [number, number],
  sc: SampledClimate,
  inp: ClimateInputs,
): Record<ResourceKind, number> {
  const elev = sc.elevationM ?? 0;
  const biome = sc.biome.id;
  const landCover = BIOME_LAND_COVER[biome] ?? "grassland";
  const fertility = BIOME_FERTILITY[biome] ?? 50;

  // Surface water available to crops: rainfall + coastal/lake proximity.
  const surfaceWater = sc.isWater ? 100 : clamp100(sc.precip * 0.7 + sc.maritime * 60);

  // Food via the shared crop core, at the city's own coordinates, using the
  // model-derived soil/cover/water and the same sampled precipitation.
  const food = sc.isWater
    ? 0
    : cropSuitabilityAt(
        lngLat,
        { elevationM: elev, soilFertility: fertility, surfaceWater, landCover, precip: sc.precip },
        inp,
      ).suitability;

  // Water resource: rainfall + proximity; everything floods to 100 when submerged.
  const water = sc.isWater ? 100 : clamp100(sc.precip * 0.65 + sc.maritime * 55);

  // Energy: solar insolation (peaks at the new equator, dimmed by cloud/rain) +
  // wind (by prevailing band, stronger on coasts and at elevation).
  const solarBase = Math.max(0, Math.cos(sc.effLat * DEG)); // 1 at new equator → 0 at poles
  const solar = clamp100(solarBase * 100 * (1 - sc.precip / 260));
  const windBand = WIND_BAND_BASE[sc.windBand] ?? 55;
  const wind = clamp100(windBand + sc.maritime * 20 + Math.min(15, (elev / 2000) * 15));
  const energy = clamp100((solar + wind) / 2);

  // Production: buildable land. Lowlands build easily; high/rugged ground less.
  const build = LAND_COVER_BUILD[landCover];
  const elevFactor = Math.max(0.3, 1 - Math.max(0, elev - 1000) / 4000);
  const production = sc.isWater ? 0 : clamp100(build * 100 * elevFactor);

  return { food, water, energy, production };
}
