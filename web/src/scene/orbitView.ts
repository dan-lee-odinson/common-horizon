// The Orbit stage's picture, as plain arithmetic: where the camera sits, how big the ring system
// is, and where Earth is drawn. Kept free of 3D-library code so the layout can be checked by tests.
//
// NOT TO SCALE. Really Earth is about 221 Moon radii away and 3.67 times the Moon's diameter. Here
// it is drawn as a distant, larger body beyond the rings, in its true DIRECTION from the Moon: far
// enough that it can never come between the camera and the Moon, near enough to stay in the frame.

import { normalizeLon360 } from '../util/geo';

export const ORBIT_VIEW = {
  /** Vertical field of view, degrees. */
  fov: 34,
  /** Degrees the camera sits above the ring plane. */
  elevation: 23,
  /** Earth's distance from the Moon's centre and its radius, in Moon radii (not to scale). */
  earthDistance: 5.5,
  earthRadius: 0.64,
  /** Angle between Earth's direction and the point straight behind the Moon, as the camera sees it. */
  earthAngle: 37,
  /** The camera sways this many degrees either side of its base longitude. */
  sway: 3,
  /** The pointer leans the camera by at most this many degrees. */
  lean: 1.2,
  /** Seconds for one sway from one side to the other. */
  swayPeriod: 26,
} as const;

/** Radii in Moon radii: longitude scale, Sun ring, ring of days, Earth's bracket. */
export function ringRadii(isPhone: boolean): [number, number, number, number] {
  const k = isPhone ? 0.92 : 1;
  return [1.28 * k, 1.7 * k, 1.9 * k, 2.15 * k];
}

/** Pixels each side column of panels takes on wide screens (panel, margin and breathing room). */
export const ORBIT_COLUMN_PX = 20 + 288 + 40;

/**
 * Camera distance (Moon radii) at which the Sun ring just fits between the two side columns, so the
 * Sun on its ring never passes behind a panel. Limited so the Moon stays large but inside the frame.
 */
export function orbitDistance(width: number, height: number, isPhone: boolean): number {
  const tanV = Math.tan((ORBIT_VIEW.fov * Math.PI) / 360);
  const tanH = tanV * (width / Math.max(1, height));
  const sunRing = ringRadii(isPhone)[1];
  if (isPhone) {
    // The picture is rolled on phones (see CameraDirector); fit the ring of days to the narrow side.
    return Math.min(22, Math.max(7, (ringRadii(true)[2] * 0.74) / (tanH * 0.98)));
  }
  const freeHalf = Math.max(0.2, (width / 2 - ORBIT_COLUMN_PX) / (width / 2));
  const fitRing = (sunRing * 1.03) / (tanH * freeHalf);
  // The Moon's disc takes at most 48 % of the height.
  const fitMoon = 1 / (tanV * 0.48);
  return Math.min(13, Math.max(fitRing, fitMoon));
}

/** Which side of the screen Earth stands on in the Orbit picture. */
export type EarthSide = 'left' | 'right';

/**
 * Longitude (degrees east) of the point on the Moon the Orbit camera sits over. The camera looks
 * from the side away from Earth, turned so Earth appears behind the Moon and off to one side.
 */
export function orbitCameraLongitude(earthLonEast: number, side: EarthSide = 'right', offsetDeg = 0): number {
  const turn = side === 'right' ? -180 + ORBIT_VIEW.earthAngle : 180 - ORBIT_VIEW.earthAngle;
  return normalizeLon360(earthLonEast + turn + offsetDeg);
}

/**
 * Earth can stand to the left or to the right of the Moon; both are true to its direction. The side
 * is chosen so that, at the landing, the camera sees as much of the Moon's sunlit half as it can.
 */
export function orbitEarthSide(g: { subsolar_lon_east: number; subearth_lon_east: number } | null): EarthSide {
  if (!g) return 'right';
  const facing = (side: EarthSide) => Math.cos(((g.subsolar_lon_east - orbitCameraLongitude(g.subearth_lon_east, side)) * Math.PI) / 180);
  return facing('left') > facing('right') ? 'left' : 'right';
}

export interface ScreenPoint {
  /** Pixels from the left and top of the view. */
  x: number;
  y: number;
  /** Depth along the view direction, in Moon radii (positive in front of the camera). */
  depth: number;
  /** Pixels per Moon radius at that depth. */
  scale: number;
}

/**
 * Where a point of the Moon world lands on screen for the Orbit camera (no roll, no shift).
 * `lat`/`lon` give the point's direction from the Moon's centre and `r` its distance in Moon radii.
 */
export function projectOrbit(lat: number, lon: number, r: number, cameraLon: number, cameraElevation: number, distance: number, width: number, height: number): ScreenPoint {
  const rad = Math.PI / 180;
  // World axes: +x at longitude 0, +y north, -z at longitude 90 E.
  const p = { x: r * Math.cos(lat * rad) * Math.cos(lon * rad), y: r * Math.sin(lat * rad), z: -r * Math.cos(lat * rad) * Math.sin(lon * rad) };
  const cl = cameraLon * rad;
  const ce = cameraElevation * rad;
  const c = { x: distance * Math.cos(ce) * Math.cos(cl), y: distance * Math.sin(ce), z: -distance * Math.cos(ce) * Math.sin(cl) };
  const f = { x: -c.x / distance, y: -c.y / distance, z: -c.z / distance };
  // right = f x up(0,1,0), then up = right x f
  const rl = Math.hypot(f.z, f.x) || 1;
  const right = { x: -f.z / rl, y: 0, z: f.x / rl };
  const up = { x: right.y * f.z - right.z * f.y, y: right.z * f.x - right.x * f.z, z: right.x * f.y - right.y * f.x };
  const v = { x: p.x - c.x, y: p.y - c.y, z: p.z - c.z };
  const depth = v.x * f.x + v.y * f.y + v.z * f.z;
  const tanV = Math.tan((ORBIT_VIEW.fov * Math.PI) / 360);
  const scale = height / 2 / (Math.max(1e-6, depth) * tanV);
  return {
    x: width / 2 + (v.x * right.x + v.y * right.y + v.z * right.z) * scale,
    y: height / 2 - (v.x * up.x + v.y * up.y + v.z * up.z) * scale,
    depth,
    scale,
  };
}
