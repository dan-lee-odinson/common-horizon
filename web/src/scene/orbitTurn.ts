// Turning the Orbit view by hand, and what follows from it, as plain arithmetic.
//
// The visitor can drag (one finger on a touch screen) or use the arrow keys to carry the camera
// round the Moon. The view stays where it is left; "Reset view" returns to the standard view.
// A turn is two angles added to the standard camera pose: degrees of longitude (east positive)
// and degrees of elevation above the ring plane.
//
// Turning the view can bring the Sun itself into the picture. The Sun is drawn at its true
// direction, infinitely far away (it keeps its place against the stars however the camera moves),
// at its true apparent size. The Moon and Earth hide it when they are in front of it.
//
// Turning can also carry the camera to Earth's side of the Moon. Earth is drawn far nearer than it
// is, so there it would stand between the camera and the Moon; it is faded out instead.

import { createStore } from '../state/store';
import { sunWidthDeg } from '../util/bodies';
import { hitBall, ORBIT_VIEW, type Vec3 } from './orbitView';

export const ORBIT_TURN = {
  /** Degrees the camera turns for each pixel dragged. */
  degPerPx: 0.3,
  /** Degrees for one press of an arrow key, and with Shift held. */
  keyStep: 3,
  keyStepShift: 15,
  /** The camera never goes nearer a pole of the Moon than this elevation, either side of the ring plane. */
  maxElevation: 80,
  /** A drag shorter than this many pixels is a press, not a drag. */
  dragSlop: 4,
} as const;

export interface Turn {
  /** Degrees added to the camera's longitude (east positive). Not wrapped: a full turn is 360. */
  lon: number;
  /** Degrees added to the camera's elevation above the ring plane. */
  lat: number;
}

/** How the turn last changed: the camera follows a drag closely, a key press quickly, and a reset in one eased move. */
export type TurnVia = 'drag' | 'key' | 'reset';

/** The turn the visitor has asked for. The camera director eases the camera to it. */
export const orbitTurn = createStore<Turn & { via: TurnVia }>({ lon: 0, lat: 0, via: 'reset' });

/** What hides the Sun's disc, if anything; the Sun's tag says so. */
export const orbitSun = createStore<{ hiddenBy: 'moon' | 'earth' | null }>({ hiddenBy: null });

function wrap180(deg: number): number {
  return ((((deg + 180) % 360) + 360) % 360) - 180;
}

/** Is the view turned away from the standard view? (A whole number of full turns is not.) */
export function isTurned(t: Turn): boolean {
  return Math.abs(wrap180(t.lon)) > 1e-6 || Math.abs(t.lat) > 1e-6;
}

/** A turn kept inside its limits: the camera's elevation stays within `maxElevation` of the ring plane. */
export function clampTurn(t: Turn): Turn {
  const max = ORBIT_TURN.maxElevation - ORBIT_VIEW.elevation;
  const min = -ORBIT_TURN.maxElevation - ORBIT_VIEW.elevation;
  return { lon: t.lon, lat: Math.min(max, Math.max(min, t.lat)) };
}

/**
 * The turn after a drag of (dx, dy) pixels (right and down positive). The picture follows the
 * pointer: dragging right carries the Moon's face to the right, so the camera moves west; dragging
 * down carries it down, so the camera rises. `roll` is the picture's roll in radians (the phone
 * picture is rolled): the drag is turned back into the camera's own axes first.
 */
export function dragTurn(t: Turn, dx: number, dy: number, roll = 0): Turn {
  const c = Math.cos(roll);
  const s = Math.sin(roll);
  const x = dx * c + dy * s;
  const y = -dx * s + dy * c;
  return clampTurn({ lon: t.lon - x * ORBIT_TURN.degPerPx, lat: t.lat + y * ORBIT_TURN.degPerPx });
}

/**
 * The turn after an arrow key: Right and Left carry the camera east and west round the Moon, Up and
 * Down raise and lower it. Any other key leaves the turn as it is (null).
 */
export function keyTurn(t: Turn, key: string, shift = false): Turn | null {
  const step = shift ? ORBIT_TURN.keyStepShift : ORBIT_TURN.keyStep;
  if (key === 'ArrowRight') return clampTurn({ lon: t.lon + step, lat: t.lat });
  if (key === 'ArrowLeft') return clampTurn({ lon: t.lon - step, lat: t.lat });
  if (key === 'ArrowUp') return clampTurn({ lon: t.lon, lat: t.lat + step });
  if (key === 'ArrowDown') return clampTurn({ lon: t.lon, lat: t.lat - step });
  return null;
}

/** The camera's elevation above the ring plane for a turn (and any lean), kept off the poles. */
export function turnedElevation(latTurn: number, lean = 0): number {
  return Math.min(ORBIT_TURN.maxElevation, Math.max(-ORBIT_TURN.maxElevation, ORBIT_VIEW.elevation + latTurn + lean));
}

// ---------- Earth, kept from between the camera and the Moon ----------

/** Distance from a point to the straight line of sight from the camera to the Moon's centre (the origin). */
function distanceToSight(point: Vec3, camera: Vec3): number {
  const len2 = camera.x * camera.x + camera.y * camera.y + camera.z * camera.z;
  // The nearest point of the stretch from the Moon's centre (t = 0) to the camera (t = 1).
  const t = len2 > 0 ? Math.min(1, Math.max(0, (point.x * camera.x + point.y * camera.y + point.z * camera.z) / len2)) : 0;
  return Math.hypot(point.x - camera.x * t, point.y - camera.y * t, point.z - camera.z * t);
}

/**
 * How strongly Earth is drawn, 0 to 1. Earth must never stand between the camera and the Moon:
 * when its ball comes near the line of sight from the camera to the Moon (the Moon's own width
 * included) it fades out, and it is gone before it could touch the Moon's disc from in front.
 * Behind the Moon it is always drawn (the Moon then hides part of it, as it should).
 */
export function earthFade(camera: Vec3, earth: Vec3, earthRadius: number = ORBIT_VIEW.earthRadius): number {
  const clear = distanceToSight(earth, camera) - earthRadius - 1;
  const t = Math.min(1, Math.max(0, (clear - 0.4) / 2));
  return t * t * (3 - 2 * t);
}

// ---------- the Sun's disc ----------

/** Distance from the camera at which the Sun's disc is drawn (Moon radii): beyond Earth, inside the camera's far limit. */
export const SUN_DRAW_DISTANCE = 300;

/** Radius of the ball that looks exactly as wide as the Sun (0.53 degrees) from `distance` away. */
export function sunBallRadius(distance: number = SUN_DRAW_DISTANCE): number {
  return distance * Math.sin((sunWidthDeg() / 2) * (Math.PI / 180));
}

/**
 * Where the Sun's disc is put: straight along the Sun's direction from the CAMERA, not from the
 * Moon. That is what "infinitely far away" means in a picture: wherever the camera goes, the disc
 * stays in the same direction, so it keeps its place against the stars.
 */
export function sunPlace(camera: Vec3, sun: Vec3, distance: number = SUN_DRAW_DISTANCE): Vec3 {
  return { x: camera.x + sun.x * distance, y: camera.y + sun.y * distance, z: camera.z + sun.z * distance };
}

/** The Sun's disc on screen is this many pixels in radius at the middle of a picture `height` pixels tall. */
export function sunRadiusPx(height: number): number {
  const focal = height / 2 / Math.tan((ORBIT_VIEW.fov * Math.PI) / 360);
  return focal * Math.tan((sunWidthDeg() / 2) * (Math.PI / 180));
}

/**
 * What stands in front of the Sun's centre as the camera sees it: the Moon, Earth (when it is
 * drawn: pass null while it is faded out), or nothing. `sun` is the unit vector toward the Sun.
 */
export function sunHiddenBy(camera: Vec3, sun: Vec3, earth: Vec3 | null, earthRadius: number = ORBIT_VIEW.earthRadius): 'moon' | 'earth' | null {
  if (hitBall(camera, sun, { x: 0, y: 0, z: 0 }, 1)) return 'moon';
  if (earth && hitBall(camera, sun, earth, earthRadius)) return 'earth';
  return null;
}
