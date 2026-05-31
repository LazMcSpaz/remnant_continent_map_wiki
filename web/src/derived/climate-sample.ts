// Async climate sampling: gathers the elevation samples the rules need
// (the point, a ring around it for maritime proximity, and an upwind point for
// orographic rain-shadow), then computes the full climate + biome. Bridges the
// pure rules (climate.ts) and the browser DEM sampler (elevation.ts).

import type { ClimateInputs, ClimatePoint, Biome } from "./climate";
import { climateAt, biomeAt, temperatureAt, seaLevelAt, windAt } from "./climate";
import { sampleElevation } from "./elevation";

export interface SampledClimate extends ClimatePoint {
  /** Sampled elevation (m), or null if the DEM tile was unavailable. */
  elevationM: number | null;
  /** True if below the post-shift sea level here (inundated). */
  isWater: boolean;
  /** 0..1 proximity to water. */
  maritime: number;
  biome: Biome;
  /** Annual mean temperature (seasonless) used for the biome. */
  meanTempC: number;
}

const KM_PER_DEG_LAT = 111.32;

/** Offset a [lng,lat] by a distance (km) along a map bearing (deg). */
function offset(point: [number, number], km: number, bearingDeg: number): [number, number] {
  const b = (bearingDeg * Math.PI) / 180;
  const dLat = (km * Math.cos(b)) / KM_PER_DEG_LAT;
  const dLng = (km * Math.sin(b)) / (KM_PER_DEG_LAT * Math.cos((point[1] * Math.PI) / 180));
  return [point[0] + dLng, point[1] + dLat];
}

const RING_KM = 70;
const RING_N = 8;
const UPWIND_KM = 40;

/** Compute the full climate at a point by sampling the DEM around it. */
export async function sampleClimate(point: [number, number], inp: ClimateInputs): Promise<SampledClimate> {
  const elevRaw = await sampleElevation(point[0], point[1]);
  const elev = elevRaw ?? 0;
  const sea = seaLevelAt(point, inp);
  const isWater = elev <= sea;

  // Maritime proximity: fraction of a surrounding ring that's below sea level.
  let waterCount = 0;
  for (let i = 0; i < RING_N; i++) {
    const p = offset(point, RING_KM, (360 / RING_N) * i);
    const e = (await sampleElevation(p[0], p[1])) ?? 0;
    if (e <= seaLevelAt(p, inp)) waterCount++;
  }
  const maritime = isWater ? 1 : waterCount / RING_N;

  // Orographic: compare elevation to the upwind point. Air climbing toward the
  // point (point higher than upwind) wrings out rain; sitting leeward of higher
  // ground (upwind higher) is a rain shadow.
  const wind = windAt(point, inp);
  const upwind = offset(point, UPWIND_KM, (wind.bearing + 180) % 360);
  const upElev = (await sampleElevation(upwind[0], upwind[1])) ?? elev;
  const oroBonus = Math.max(-0.5, Math.min(0.5, (elev - upElev) / 800));

  const c = climateAt(point, elev, inp, { maritime, oroBonus, isWater });
  const meanTempC = temperatureAt(point, elev, { ...inp, season: 0.25 }, maritime); // seasonless
  const biome = biomeAt(meanTempC, c.precip, isWater);

  return { ...c, elevationM: elevRaw, isWater, maritime, biome, meanTempC };
}
