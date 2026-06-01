// Turn hydrology river chains into nice-looking rivers: Catmull-Rom spline
// resampling for smooth curves, plus a gentle procedural MEANDER (perpendicular
// fBm offset that tightens as the river narrows), so a river reads as a natural
// watercourse — never a coarse zigzag or a "rectangle with blurred edges".
// Width tapers with flow strength so trunks are bold and headwaters are thin.

import type { FeatureCollection, LineString } from "geojson";
import type { RiverChain } from "./hydrology";
import { fbm } from "./noise";

const KM_PER_DEG_LAT = 111.32;

/** Catmull-Rom interpolation of one coordinate channel. */
function catmull(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (
    2 * p1 +
    (-p0 + p2) * t +
    (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
    (-p0 + 3 * p1 - 3 * p2 + p3) * t3
  );
}

interface Pt { lng: number; lat: number; strength: number }

/** Resample a chain along a Catmull-Rom spline at ~`stepDeg` spacing. */
function spline(points: Pt[], stepDeg: number): Pt[] {
  if (points.length < 3) return points;
  const out: Pt[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    const segLen = Math.hypot(p2.lng - p1.lng, p2.lat - p1.lat);
    const steps = Math.max(2, Math.ceil(segLen / stepDeg));
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      out.push({
        lng: catmull(p0.lng, p1.lng, p2.lng, p3.lng, t),
        lat: catmull(p0.lat, p1.lat, p2.lat, p3.lat, t),
        strength: p1.strength + (p2.strength - p1.strength) * t,
      });
    }
  }
  out.push(points[points.length - 1]);
  return out;
}

/**
 * Add a perpendicular meander to a smoothed path. Offset = fBm along the path's
 * arc length, amplitude shrinking with flow strength (big rivers wander less per
 * km than creeks). Keeps rivers looking alive at deep zoom — the noise is a
 * function, so it never pixelates.
 */
function meander(points: Pt[]): Pt[] {
  if (points.length < 2) return points;
  const out: Pt[] = [];
  let arc = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(points.length - 1, i + 1)];
    // Tangent → perpendicular (in degree space).
    let tx = next.lng - prev.lng;
    let ty = next.lat - prev.lat;
    const tlen = Math.hypot(tx, ty) || 1;
    tx /= tlen;
    ty /= tlen;
    const px = -ty;
    const py = tx;
    arc += Math.hypot(p.lng - prev.lng, p.lat - prev.lat);
    // Narrower rivers wander more (relative); amplitude in degrees (~0.5–4 km).
    const narrow = 1 - Math.min(1, p.strength / 100);
    const ampDeg = (0.004 + 0.03 * narrow) / 1; // ~0.45–3.8 km
    const w = fbm(arc * 60 + i * 0.01, p.lat, 1.0, 4); // along-path noise
    out.push({
      lng: p.lng + px * w * ampDeg,
      lat: p.lat + py * w * ampDeg,
      strength: p.strength,
    });
  }
  return out;
}

/**
 * Render river chains as smooth, meandering polylines tagged with strength.
 * `detailDeg` controls spline spacing (smaller = finer; default ~0.02° ≈ 2 km).
 */
export function renderRivers(
  chains: RiverChain[],
  minStrength: number,
  detailDeg = 0.02,
): FeatureCollection<LineString, { strength: number }> {
  const features: FeatureCollection<LineString, { strength: number }>["features"] = [];
  for (const chain of chains) {
    const pts = chain.points.filter((p) => p.strength >= minStrength);
    if (pts.length < 2) continue;
    const smoothed = meander(spline(pts, detailDeg));
    // Average strength for width styling; keep the trunk's max so it stays bold.
    let maxS = 0;
    for (const p of smoothed) if (p.strength > maxS) maxS = p.strength;
    features.push({
      type: "Feature",
      geometry: { type: "LineString", coordinates: smoothed.map((p) => [p.lng, p.lat]) },
      properties: { strength: maxS },
    });
  }
  return { type: "FeatureCollection", features };
}

export { KM_PER_DEG_LAT };
