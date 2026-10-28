/** Small geometry helpers for Air Watch. Directions are compass degrees, clockwise from north. */
const R_KM = 6371;
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;
const norm = (d: number) => ((d % 360) + 360) % 360;

export interface LatLon { lat: number; lon: number }

export function distanceKm(a: LatLon, b: LatLon): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.sqrt(h));
}

/** Initial bearing from a to b. */
export function bearingDeg(a: LatLon, b: LatLon): number {
  const y = Math.sin(rad(b.lon - a.lon)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) -
    Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon - a.lon));
  return norm(deg(Math.atan2(y, x)));
}

/** Smallest absolute difference between two directions, 0..180. */
export function angleDiff(a: number, b: number): number {
  const d = norm(a - b);
  return d > 180 ? 360 - d : d;
}

export function circularMeanDeg(angles: number[]): number {
  const s = angles.reduce((acc, a) => acc + Math.sin(rad(a)), 0);
  const c = angles.reduce((acc, a) => acc + Math.cos(rad(a)), 0);
  return norm(deg(Math.atan2(s, c)));
}

/** Vector mean of wind samples; fromDeg is the direction the wind blows FROM. */
export function meanWind(samples: { fromDeg: number; speedMs: number }[]): { fromDeg: number; speedMs: number } | null {
  if (!samples.length) return null;
  let u = 0, v = 0;
  for (const s of samples) {
    u += s.speedMs * Math.sin(rad(s.fromDeg));
    v += s.speedMs * Math.cos(rad(s.fromDeg));
  }
  u /= samples.length;
  v /= samples.length;
  return { fromDeg: norm(deg(Math.atan2(u, v))), speedMs: Math.hypot(u, v) };
}
