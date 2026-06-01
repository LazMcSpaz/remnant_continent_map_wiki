// Composite elevation — the single source of truth everything samples.
//
//   composite(lng,lat) = base DEM
//                      + procedural detail noise (the ruggedness the coarse DEM
//                        lacks; scaled so highlands are rough, plains stay flat)
//                      + brush edits (authored deltas; added in the brush chunk)
//
// Hydrology, climate, the coastline, and the hillshade all read THIS, so they
// can never disagree — and editing it (terrain brush) reshapes them all on the
// next Recalculate. Deterministic: same inputs → same surface.

import type { DemBlock } from "./elevation";
import { elevationFromBlock } from "./elevation";
import { fbm, ridged } from "./noise";

/** A soft-brush elevation delta (Gaussian falloff), authored by the terrain
 *  tool. Stored as centre + radius (km) + peak delta (m). */
export interface ElevationEdit {
  id: string;
  lng: number;
  lat: number;
  radiusKm: number;
  /** Peak delta in metres at the centre (positive = raise, negative = lower). */
  deltaM: number;
}

const KM_PER_DEG_LAT = 111.32;

/** Gaussian falloff value (0..1) of an edit at a point. */
function editWeight(edit: ElevationEdit, lng: number, lat: number): number {
  const dLatKm = (lat - edit.lat) * KM_PER_DEG_LAT;
  const dLngKm = (lng - edit.lng) * KM_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
  const distKm = Math.hypot(dLatKm, dLngKm);
  if (distKm > edit.radiusKm) return 0;
  // Gaussian-ish: smooth shoulder, ~0 at the radius. sigma = radius/2.
  const sigma = edit.radiusKm / 2;
  return Math.exp(-(distKm * distKm) / (2 * sigma * sigma));
}

/**
 * Detail noise added to the base DEM (metres). Amplitude scales with elevation
 * so mountains get rugged crests while lowlands stay gentle, and a slope term
 * keeps flat plains nearly smooth. The high frequency is what survives deep
 * zoom — it's a function, so it never pixelates.
 *
 * `baseElev` is the raw DEM here; `relief` is a 0..1 local-ruggedness hint
 * (high near mountains) the caller can pass, else derived from elevation.
 */
export function detailNoise(lng: number, lat: number, baseElev: number): number {
  if (baseElev <= 0) return 0; // ocean floor: leave flat
  // More amplitude with height: ~30 m on plains → ~600 m on high mountains.
  const heightFactor = Math.min(1, baseElev / 2500);
  const amp = 30 + 570 * heightFactor;
  // Mix smooth rolling (fbm) with sharp crests (ridged), more ridged up high.
  const rolling = fbm(lng, lat, 8, 5); // [-1,1], ~14 km features at freq 8
  const crests = (ridged(lng, lat, 12, 5) - 0.5) * 2; // [-1,1], sharper
  const mix = rolling * (1 - heightFactor * 0.6) + crests * (heightFactor * 0.6);
  return mix * amp;
}

/**
 * Composite elevation sampler bound to a loaded DEM block + a set of edits.
 * Returns a synchronous (lng,lat) → metres function — the source of truth.
 */
export function makeCompositeSampler(
  block: DemBlock,
  edits: ElevationEdit[],
  opts: { detail?: boolean } = {},
): (lng: number, lat: number) => number | null {
  const useDetail = opts.detail ?? true;
  return (lng, lat) => {
    const base = elevationFromBlock(block, lng, lat);
    if (base === null) return null;
    let h = base;
    if (useDetail) h += detailNoise(lng, lat, base);
    for (const e of edits) {
      const w = editWeight(e, lng, lat);
      if (w > 0) h += e.deltaM * w;
    }
    return h;
  };
}

export type CompositeSampler = (lng: number, lat: number) => number | null;
