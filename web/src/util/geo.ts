// Geometry helpers shared by the 3D Moon, the horizon plot and the mock model.
// Conventions used everywhere in this app:
//   latitude  : degrees, -90 (south pole) .. +90 (north pole)
//   longitude : degrees EAST, 0 .. 360 (the backend and the preset list use this form)
//   azimuth   : degrees clockwise from north, 0 .. 360 (N = 0, E = 90, S = 180, W = 270)
//   elevation : degrees above the local level plane (negative = below level)

export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;

/** Wrap any longitude into the east-positive range [0, 360). */
export function normalizeLon360(lon: number): number {
  const wrapped = lon % 360;
  const positive = wrapped < 0 ? wrapped + 360 : wrapped;
  // Avoid "-0" and floating noise like 359.99999999 for an input of -1e-12.
  return positive >= 360 - 1e-12 ? 0 : positive + 0;
}

export type Hemisphere = 'E' | 'W';

/**
 * Convert a longitude typed as "x degrees east" or "x degrees west" into east longitude 0..360.
 * Example: 23.47° W -> 336.53° E. Negative input means the opposite hemisphere.
 */
export function toEastLongitude(value: number, hemisphere: Hemisphere): number {
  if (!Number.isFinite(value)) throw new RangeError('Longitude must be a number');
  return normalizeLon360(hemisphere === 'W' ? -value : value);
}

/** Show an east longitude 0..360 the way people often write it: 0..180 E or W. */
export function toSignedLongitude(lonEast: number): number {
  const lon = normalizeLon360(lonEast);
  return lon > 180 ? lon - 360 : lon;
}

export function isValidLatitude(lat: number): boolean {
  return Number.isFinite(lat) && lat >= -90 && lat <= 90;
}

export function wrap180(deg: number): number {
  const w = normalizeLon360(deg + 180) - 180;
  return w;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * Position on the 3D Moon for a latitude / east longitude.
 * Matches three.js SphereGeometry texture layout when the map has longitude 0 in its centre:
 * +Y is the north pole, lon 0 points to +X, lon 90° E points to -Z.
 */
export function latLonToVec3(lat: number, lonEast: number, radius = 1): Vec3 {
  const phi = lat * DEG;
  const lam = lonEast * DEG;
  return {
    x: radius * Math.cos(phi) * Math.cos(lam),
    y: radius * Math.sin(phi),
    z: -radius * Math.cos(phi) * Math.sin(lam),
  };
}

/** Inverse of latLonToVec3: a point on (or off) the sphere back to latitude and east longitude. */
export function vec3ToLatLon(v: Vec3): { lat: number; lonEast: number } {
  const r = Math.hypot(v.x, v.y, v.z);
  if (r === 0) return { lat: 0, lonEast: 0 };
  const lat = Math.asin(Math.max(-1, Math.min(1, v.y / r))) * RAD;
  const lonEast = normalizeLon360(Math.atan2(-v.z, v.x) * RAD);
  return { lat, lonEast };
}

/**
 * Azimuth and elevation of a far-away body, seen from a point on the Moon.
 * The body is described by its sub-point: the place on the Moon where it is straight overhead
 * (sub-solar point for the Sun, sub-Earth point for Earth). Parallax is ignored, which is fine
 * for the Sun and good to about 1 degree for Earth.
 */
export function azElFromSubpoint(
  obsLat: number,
  obsLonEast: number,
  subLat: number,
  subLonEast: number,
): { az: number; el: number } {
  const p = obsLat * DEG;
  const l = obsLonEast * DEG;
  const d = {
    x: Math.cos(subLat * DEG) * Math.cos(subLonEast * DEG),
    y: Math.cos(subLat * DEG) * Math.sin(subLonEast * DEG),
    z: Math.sin(subLat * DEG),
  };
  // Local axes at the observer (Moon-fixed frame, z through the north pole).
  const up = { x: Math.cos(p) * Math.cos(l), y: Math.cos(p) * Math.sin(l), z: Math.sin(p) };
  const east = { x: -Math.sin(l), y: Math.cos(l), z: 0 };
  const north = { x: -Math.sin(p) * Math.cos(l), y: -Math.sin(p) * Math.sin(l), z: Math.cos(p) };
  const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
  const el = Math.asin(Math.max(-1, Math.min(1, dot(d, up)))) * RAD;
  const az = normalizeLon360(Math.atan2(dot(d, east), dot(d, north)) * RAD);
  return { az, el };
}

/** Unit direction in the local scene (x = east, y = up, z = south) for an azimuth and elevation. */
export function azElToLocal(az: number, el: number, radius = 1): Vec3 {
  const a = az * DEG;
  const e = el * DEG;
  return {
    x: radius * Math.cos(e) * Math.sin(a),
    y: radius * Math.sin(e),
    z: -radius * Math.cos(e) * Math.cos(a),
  };
}

/** Linear interpolation of a periodic profile sampled every (360 / n) degrees of azimuth. */
export function sampleProfile(profile: readonly { az: number; el: number }[], az: number): number {
  const n = profile.length;
  if (n === 0) return 0;
  if (n === 1) return profile[0].el;
  // Profiles are sorted by azimuth and evenly spaced; find the bracketing pair.
  const step = 360 / n;
  const a = normalizeLon360(az - profile[0].az);
  const i = Math.floor(a / step) % n;
  const j = (i + 1) % n;
  const f = (a - i * step) / step;
  return profile[i].el * (1 - f) + profile[j].el * f;
}

/** Format a latitude / east longitude for people: "89.684° S, 196.739° E". */
export function formatLatLon(lat: number, lonEast: number, digits = 3): string {
  const ns = lat < 0 ? 'S' : 'N';
  return `${Math.abs(lat).toFixed(digits)}° ${ns}, ${normalizeLon360(lonEast).toFixed(digits)}° E`;
}
