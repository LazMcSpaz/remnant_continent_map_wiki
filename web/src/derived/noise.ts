// Procedural terrain noise. The source DEM is only ~300–600 m/pixel, so it can't
// show detail when you zoom in — and real terrain is never perfectly smooth.
// We synthesize that missing detail with fractal noise (fBm over gradient
// noise): a deterministic function evaluable at ANY point and ANY frequency, so
// it adds natural ruggedness at every zoom without storing anything.
//
// Deterministic (seeded hash), so the same world always renders the same — no
// shimmering between recomputes.

const SEED = 1337;

/** Integer hash → [0,1). Cheap, deterministic, decent distribution. */
function hash2(ix: number, iy: number): number {
  let h = (ix * 374761393 + iy * 668265263 + SEED * 2147483647) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967296;
}

/** A unit-ish gradient vector at a lattice point (for gradient/Perlin noise). */
function grad(ix: number, iy: number): [number, number] {
  const a = hash2(ix, iy) * Math.PI * 2;
  return [Math.cos(a), Math.sin(a)];
}

function smootherstep(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** 2D gradient (Perlin-style) noise in roughly [-1, 1] at point (x, y). */
function gradientNoise(x: number, y: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;

  const dot = (ix: number, iy: number): number => {
    const g = grad(ix, iy);
    return g[0] * (x - ix) + g[1] * (y - iy);
  };

  const u = smootherstep(fx);
  const v = smootherstep(fy);
  const n00 = dot(x0, y0);
  const n10 = dot(x0 + 1, y0);
  const n01 = dot(x0, y0 + 1);
  const n11 = dot(x0 + 1, y0 + 1);
  const nx0 = n00 + u * (n10 - n00);
  const nx1 = n01 + u * (n11 - n01);
  return (nx0 + v * (nx1 - nx0)) * 1.4; // scale toward [-1,1]
}

/**
 * Fractal Brownian motion: sum octaves of gradient noise at doubling frequency
 * and halving amplitude. `octaves` controls how much fine detail; the result is
 * roughly [-1, 1]. `freq` is in cycles per degree (lng/lat units).
 */
export function fbm(lng: number, lat: number, freq: number, octaves = 5): number {
  let amp = 1;
  let f = freq;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * gradientNoise(lng * f, lat * f);
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return norm > 0 ? sum / norm : 0;
}

/**
 * Ridged multifractal — sharp crests, good for mountainous ruggedness. 1 −
 * |noise| folds valleys into ridges; squaring sharpens them. Roughly [0, 1].
 */
export function ridged(lng: number, lat: number, freq: number, octaves = 5): number {
  let amp = 1;
  let f = freq;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    const r = 1 - Math.abs(gradientNoise(lng * f, lat * f));
    sum += amp * r * r;
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return norm > 0 ? sum / norm : 0;
}
