// Geodesic measurement helpers (pure). Distance along a click path and the area
// of a polygon, in km / km², plus imperial formatting. Used by the measure tool
// (ephemeral) and reusable anywhere a length/area readout is wanted.

const EARTH_R_KM = 6371;
const DEG2RAD = Math.PI / 180;
const KM_PER_MILE = 1.609344;

/** Great-circle distance (km) between two [lng, lat] points. */
export function haversineKm(a: [number, number], b: [number, number]): number {
  const dLat = (b[1] - a[1]) * DEG2RAD;
  const dLng = (b[0] - a[0]) * DEG2RAD;
  const lat1 = a[1] * DEG2RAD;
  const lat2 = b[1] * DEG2RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Total length (km) of a path of [lng, lat] points. */
export function pathLengthKm(points: Array<[number, number]>): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += haversineKm(points[i - 1], points[i]);
  return total;
}

/**
 * Spherical polygon area (km²) of a ring of [lng, lat] points via the shoelace
 * formula on the unit sphere (L'Huilier-free approximation good at map scale).
 * The ring need not be explicitly closed; the wrap is handled.
 */
export function polygonAreaKm2(ring: Array<[number, number]>): number {
  if (ring.length < 3) return 0;
  const R = EARTH_R_KM;
  let total = 0;
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const [lng1, lat1] = ring[i];
    const [lng2, lat2] = ring[(i + 1) % n];
    total += (lng2 - lng1) * DEG2RAD * (2 + Math.sin(lat1 * DEG2RAD) + Math.sin(lat2 * DEG2RAD));
  }
  return Math.abs((total * R * R) / 2);
}

/** Length formatted in imperial miles. */
export function formatMiles(lengthKm: number): string {
  const miles = lengthKm / KM_PER_MILE;
  return `${miles.toFixed(miles < 10 ? 1 : 0)} mi`;
}

/** Area formatted in square miles. */
export function formatSqMiles(areaKm2: number): string {
  const sqMi = areaKm2 / (KM_PER_MILE * KM_PER_MILE);
  return `${sqMi < 10 ? sqMi.toFixed(1) : Math.round(sqMi).toLocaleString()} mi²`;
}
