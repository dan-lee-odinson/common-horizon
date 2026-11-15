// The site stage's picture, as plain arithmetic. Kept free of 3D-library code so it can be checked
// by tests.
//
// The site is a world of its own inside the one canvas, in metres: the landing point is the
// origin, x points east, y up and z south (the frame of `azElToLocal`, and of the hardware models).
// The sky (stars, Earth, the Sun and the terrain skyline) rides on a dome centred on the camera,
// because the data gives directions and no distances.
//
// The HUD measures the part of the window its panels leave free (src/stages/SiteHud.tsx writes
// `siteFrame`); the scene centres the landing point in it, and shows a marker's tag only while the
// marker is inside it.

import { createStore } from '../state/store';
import { EARTH_RADIUS_KM, earthDistanceFromSiteKm, SUN_DISTANCE_KM, SUN_RADIUS_KM } from '../util/bodies';
import { azElToLocal, DEG, sampleProfile, type Vec3 } from '../util/geo';

export const SITE_VIEW = {
  /** Vertical field of view, degrees: wide enough for a 52 m lander and the horizon behind it. */
  fov: 42,
  fovPhone: 58,
  /** Nearest and farthest things drawn, metres. */
  near: 0.5,
  far: 12_000,
  /** Radius of the sky dome around the camera, metres. A drawing distance only: the sky has none. */
  dome: 9_000,
  /** The skyline band reaches this far below level, so the ground's far edge is always in front of it. */
  bandFloorDeg: -12,
  /** Width of the bright line along the skyline, degrees. */
  edgeDeg: 0.12,
  /** The level ground is a disc of this radius, metres. */
  groundRadius: 6_000,
  /** Range rings on the ground: every `ringMinor` metres out to `ringMinorTo`, every `ringMajor` beyond. */
  ringMinor: 10,
  ringMinorTo: 200,
  ringMajor: 100,
  /** Light on the ground with no direct sunlight (a share of full sunlight). */
  ambient: 0.06,
  /**
   * Light on the hardware: the sunlight; a dim fill from above that is always there; and sunlight
   * thrown back up by the lit ground, which follows the ground's own brightness (so it is gone
   * when the site is dark) and keeps a backlit lander from being a plain black shape.
   */
  sunLight: 3.0,
  fillLight: 0.35,
  bounceLight: 3.0,
  /**
   * On arrival the camera looks at the landing point from this many degrees above level; from as
   * little as `pitchMinDeg` while the Sun stands a few degrees up (see `arrivalPitch`).
   */
  pitchDeg: 9,
  pitchMinDeg: 3,
  /**
   * Lower still, down to this, but only when that brings a low Sun into the clear part of the
   * window (a panel across the bottom, such as the Data checks band, leaves the picture less height).
   */
  pitchLowDeg: 1,
  /** How near and how far the visitor may zoom, metres from the point looked at. */
  minDistance: 8,
  maxDistance: 400,
  /**
   * The camera's angle from straight overhead stays between these (radians). As a rule it never
   * goes below the point it looks at; near a tall lander it may, to look up (see `lookUpLimit`),
   * but never lower than `minCameraHeight` metres above the ground.
   */
  minPolar: 0.15,
  maxPolar: Math.PI / 2 - 0.03,
  maxPolarLookUp: Math.PI - 0.3,
  minCameraHeight: 1.2,
} as const;

export interface SiteFrame {
  /** False until the HUD has measured its panels (and on phones before the dock is laid out). */
  measured: boolean;
  /** The window, in CSS pixels. */
  width: number;
  height: number;
  /** The free rectangle: right of the left wing, left of the right wing, below the top strip, above the console. */
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export const siteFrame = createStore<SiteFrame>({ measured: false, width: 0, height: 0, left: 0, top: 0, right: 0, bottom: 0 });

/**
 * Whether the site's camera has come to rest (false during the descent). The scene writes it; the
 * tags and names that point into the picture wait for it, so nothing swings about with the camera
 * on its way down.
 */
export const siteArrival = { settled: false };

/**
 * How far the picture is shifted so that the middle of the view lands in the middle of the free
 * rectangle, in pixels: positive x moves the picture right, positive y moves it up (the same signs
 * as the Moon stages' picture shift). Zero until the panels are measured.
 */
export function frameShift(frame: SiteFrame, viewWidth: number, viewHeight: number): { x: number; y: number } {
  if (!frame.measured || !(frame.right > frame.left) || !(frame.bottom > frame.top)) return { x: 0, y: 0 };
  const cx = (frame.left + frame.right) / 2;
  const cy = (frame.top + frame.bottom) / 2;
  return { x: Math.round(cx - viewWidth / 2), y: Math.round(viewHeight / 2 - cy) };
}

/** True when a point (in pixels) is inside the free rectangle, at least `inset` pixels from its edges. */
export function insideFrame(frame: SiteFrame, x: number, y: number, inset = 0): boolean {
  if (!frame.measured) return true;
  return x >= frame.left + inset && x <= frame.right - inset && y >= frame.top + inset && y <= frame.bottom - inset;
}

/**
 * The compass direction the camera faces on arrival, so the thing worth watching is in the clear
 * middle of the view: just beside the Sun while it is low (the Sun and its raking light together),
 * well to one side of a high Sun, toward Earth when the Sun is far below level, and north with
 * nothing to go by. Degrees clockwise from north.
 */
export function arrivalAzimuth(sun: { az: number; el: number } | null, earth: { az: number; el: number } | null): number {
  const wrap = (deg: number) => ((deg % 360) + 360) % 360;
  if (sun && Number.isFinite(sun.az) && Number.isFinite(sun.el)) {
    if (sun.el >= 25) return wrap(sun.az + 60);
    if (sun.el >= -5) return wrap(sun.az + 12);
  }
  if (earth && Number.isFinite(earth.az) && earth.el > 0) return wrap(earth.az + 12);
  return 0;
}

// ---------- the sky dome ----------

/** Where a direction of the sky sits on the dome, relative to the camera (x east, y up, z south). */
export function domePoint(azDeg: number, elDeg: number, dome: number = SITE_VIEW.dome): Vec3 {
  return azElToLocal(azDeg, elDeg, dome);
}

/**
 * Radius of the ball that stands for the Sun on the dome, metres. A ball of radius
 * dome x (radius / distance) at the dome's distance looks exactly as wide as the real Sun does:
 * 2 x asin(radius / distance). The camera's field of view does not come into it.
 */
export function sunDiscRadius(dome: number = SITE_VIEW.dome): number {
  return (dome * SUN_RADIUS_KM) / SUN_DISTANCE_KM;
}

/** The same for Earth, from a site where it stands `earthElDeg` above level (the site's own place on the Moon counts). */
export function earthDiscRadius(earthElDeg: number, dome: number = SITE_VIEW.dome): number {
  return (dome * EARTH_RADIUS_KM) / earthDistanceFromSiteKm(earthElDeg);
}

/**
 * The Sun's path through a horizon answer's window as points on the dome (x, y, z for each sample,
 * one after another): the same samples the horizon plot draws its path through. Samples that are
 * not numbers are left out.
 */
export function sunPathOnDome(path: readonly { az: number; el: number }[], dome: number = SITE_VIEW.dome): number[] {
  const out: number[] = [];
  for (const p of path) {
    if (!Number.isFinite(p.az) || !Number.isFinite(p.el)) continue;
    const v = azElToLocal(p.az, p.el, dome);
    out.push(v.x, v.y, v.z);
  }
  return out;
}

/** The lowest point of a skyline, degrees; null for an empty one. */
export function skylineMinDeg(skyline: readonly { el: number }[]): number | null {
  let min = Infinity;
  for (const p of skyline) if (Number.isFinite(p.el) && p.el < min) min = p.el;
  return Number.isFinite(min) ? min : null;
}

/**
 * The top of the skyline band at evenly spaced azimuths from 0 to 360 inclusive (the last equals
 * the first): the data's skyline at the spacing it arrives with (720 points for the backend's stored
 * profiles, every 0.5 degrees), and never coarser than a degree, with nothing clamped. The band is
 * built from these values and the scene asks them whether a body stands clear of the terrain, so
 * the two agree.
 */
export function bandProfile(skyline: readonly { az: number; el: number }[]): number[] {
  const steps = Math.max(360, skyline.length);
  const out: number[] = [];
  for (let i = 0; i <= steps; i++) out.push(sampleProfile(skyline, ((i * 360) / steps) % 360));
  return out;
}

/** The azimuth of a band profile's point `i`, degrees. */
export function bandAz(profile: readonly number[], i: number): number {
  return (i * 360) / (profile.length - 1);
}

/** The band's top at any azimuth, degrees: a straight line between the two profile points either side. */
export function bandTopAt(profile: readonly number[], azDeg: number): number {
  if (profile.length < 361) return 0;
  const steps = profile.length - 1;
  const a = ((((azDeg % 360) + 360) % 360) * steps) / 360;
  const i = Math.min(steps - 1, Math.floor(a));
  const f = a - i;
  return profile[i] * (1 - f) + profile[i + 1] * f;
}

// ---------- the ground ----------

/**
 * The level ground is drawn only below this elevation as seen from the camera, degrees (negative:
 * below level). It is always under the lowest point of the skyline, so the illustrative ground can
 * never cover sky that the data says is open (a skyline can dip below level), and it is never
 * closer to level than half a degree, so its far edge never shows as a line.
 */
export function groundCutDeg(skylineMin: number | null): number {
  return skylineMin === null || !Number.isFinite(skylineMin) ? -0.5 : Math.min(-0.5, skylineMin - 0.3);
}

/**
 * How brightly direct sunlight shows on the level ground, 0 to 1, for the Sun's height. A display
 * curve, not photometry: with a true cosine the ground at a polar site (Sun about one degree up)
 * would be nearly black. Zero with the Sun at or below level, rising to one overhead.
 */
export function groundSunTerm(sunElDeg: number): number {
  if (!Number.isFinite(sunElDeg) || sunElDeg <= 0) return 0;
  return Math.sin(Math.min(90, sunElDeg) * DEG) ** 0.35;
}

// ---------- the camera ----------

function clampTo(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

function smoothstep(a: number, b: number, x: number): number {
  const t = clampTo((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Where a camera stands that looks at `target` from `distance` metres, facing compass direction
 * `azDeg` and tipped `polarDeg` from straight overhead (0 = looking straight down).
 */
export function orbitPosition(target: Vec3, distance: number, azDeg: number, polarDeg: number): Vec3 {
  const a = azDeg * DEG;
  const p = polarDeg * DEG;
  return {
    x: target.x - Math.sin(a) * Math.sin(p) * distance,
    y: target.y + Math.cos(p) * distance,
    z: target.z + Math.cos(a) * Math.sin(p) * distance,
  };
}

/**
 * How far above level the camera looks down from on arrival, degrees. As a rule `pitchDeg`. While
 * the Sun stands a few degrees up the camera comes lower, so the horizon sits lower in the picture
 * and the Sun is still inside the clear part of the window: `clearUpDeg` is how far above the
 * middle of the picture the clear part reaches, in degrees.
 */
export function arrivalPitch(sun: { az: number; el: number } | null, clearUpDeg: number): number {
  if (!sun || !Number.isFinite(sun.el) || sun.el < -5 || sun.el >= 25 || !Number.isFinite(clearUpDeg)) return SITE_VIEW.pitchDeg;
  const fit = clearUpDeg - sun.el;
  // Below the usual least pitch only where the Sun then fits; a Sun too high to fit keeps the usual view.
  if (fit < SITE_VIEW.pitchMinDeg && fit >= SITE_VIEW.pitchLowDeg) return fit;
  return clampTo(fit, SITE_VIEW.pitchMinDeg, SITE_VIEW.pitchDeg);
}

/**
 * How far above the middle of the picture the clear part of the window reaches, degrees: half the
 * free height less a margin (room for a body's tag), as an angle at the given field of view.
 */
export function clearUpDeg(freeHeightPx: number, viewHeightPx: number, fovDeg: number, marginPx = 48): number {
  if (!(viewHeightPx > 0) || !(freeHeightPx > 0)) return SITE_VIEW.pitchDeg;
  const focal = viewHeightPx / 2 / Math.tan((fovDeg * DEG) / 2);
  return Math.atan(Math.max(0, freeHeightPx / 2 - marginPx) / focal) / DEG;
}

/**
 * How far from straight overhead the camera may swing, radians, when it looks at a point `targetH`
 * metres up from `distance` metres away. Close to a tall lander the camera may drop below the point
 * it looks at and so look up at the sky (to find a high Sun, or Earth); it is stopped where it
 * would come within `minCameraHeight` of the ground, and well short of straight underneath.
 */
export function lookUpLimit(targetH: number, distance: number): number {
  if (!(distance > 0) || !Number.isFinite(targetH)) return SITE_VIEW.maxPolar;
  const floor = Math.acos(clampTo(-(targetH - SITE_VIEW.minCameraHeight) / distance, -1, 1));
  return Math.max(SITE_VIEW.maxPolar, Math.min(SITE_VIEW.maxPolarLookUp, floor));
}

export interface RestInput {
  /** Height of what stands at the landing point, metres (the lander, else the tallest thing drawn); null with nothing. */
  heightM: number | null;
  /** Radius of the circle round the landing point that holds all the hardware, metres. */
  layoutRadius: number;
  fovDeg: number;
  /** The share of the window's height the panels leave free (1 when not measured). */
  freeShare: number;
  /** Compass direction the camera faces (see `arrivalAzimuth`). */
  viewAzDeg: number;
  /** Degrees above level the camera looks down from (see `arrivalPitch`); `SITE_VIEW.pitchDeg` when left out. */
  pitchDeg?: number;
}

export interface SitePose {
  target: Vec3;
  position: Vec3;
  distance: number;
  /** Compass direction the camera faces, degrees. */
  azDeg: number;
  /** Angle from straight overhead, degrees. */
  polarDeg: number;
}

/**
 * The pose the camera comes to rest in: looking at the middle of the lander from a little above,
 * far enough that the lander fills about three quarters of the free height and most of the
 * hardware around it is in the picture.
 */
export function restPose(input: RestInput): SitePose {
  const H = input.heightM !== null && Number.isFinite(input.heightM) && input.heightM > 0 ? input.heightM : 2;
  const targetH = clampTo(H / 2, 1.5, 30);
  const share = clampTo(input.freeShare, 0.2, 1);
  const span = Math.max(H / 0.72, 0.9 * Math.max(0, input.layoutRadius));
  const distance = clampTo(span / (2 * Math.tan((input.fovDeg * DEG) / 2) * share), 14, 260);
  const target = { x: 0, y: targetH, z: 0 };
  const polarDeg = 90 - clampTo(input.pitchDeg ?? SITE_VIEW.pitchDeg, SITE_VIEW.pitchLowDeg, SITE_VIEW.pitchDeg);
  return { target, position: orbitPosition(target, distance, input.viewAzDeg, polarDeg), distance, azDeg: input.viewAzDeg, polarDeg };
}

export interface FaceInput {
  /** The body to look at. */
  body: { az: number; el: number };
  /** The height the camera looks at when at rest (the middle of the lander), metres. */
  restTargetY: number;
  /** The distance to keep, metres (the visitor's own). */
  distance: number;
  /** How far above the middle of the picture the clear part of the window reaches, degrees (see `clearUpDeg`). */
  clearUpDeg: number;
}

/**
 * A pose that brings a body of the sky (the Sun, Earth) into the clear part of the picture: the
 * camera faces a little to one side of it, so the lander does not stand in front, and looks up
 * far enough to hold it in the upper part of the window. For a low body that is about the rest
 * pose turned round. For a high one the camera comes down to the ground and looks up; if the point
 * it looks at is too low for that, the point is raised straight up above the landing point, so the
 * camera never goes under the ground.
 */
export function facePose(input: FaceInput): SitePose {
  const distance = clampTo(input.distance, SITE_VIEW.minDistance, SITE_VIEW.maxDistance);
  // The view's own elevation: the body sits three quarters of the way up the clear part.
  const lookUp = clampTo(input.body.el - 0.75 * input.clearUpDeg, -SITE_VIEW.pitchDeg, SITE_VIEW.maxPolarLookUp / DEG - 90 - 1);
  const polarDeg = 90 + lookUp;
  const floor = SITE_VIEW.minCameraHeight + 0.3 + distance * Math.sin(lookUp * DEG);
  const target = { x: 0, y: Math.max(input.restTargetY, floor), z: 0 };
  const azDeg = (((input.body.az + 12) % 360) + 360) % 360;
  return { target, position: orbitPosition(target, distance, azDeg, polarDeg), distance, azDeg, polarDeg };
}

/**
 * A request from the HUD to turn the view: to a body of the sky, or (`home`) back to the rest pose
 * beside the lander. Each request carries a new number, so asking twice turns the view twice.
 */
export const siteLook = createStore<{ seq: number; home: boolean; az: number; el: number }>({ seq: 0, home: false, az: 0, el: 0 });

export function lookAtBody(body: { az: number; el: number } | null): void {
  if (!body || !Number.isFinite(body.az) || !Number.isFinite(body.el)) return;
  siteLook.set({ seq: siteLook.get().seq + 1, home: false, az: body.az, el: body.el });
}

export function lookAtLander(): void {
  siteLook.set({ seq: siteLook.get().seq + 1, home: true });
}

/** Where the descent starts: this far up, this close to straight overhead, turned this far from the rest direction. */
export const DESCENT = { startMin: 600, startMax: 1500, startFactor: 8, startPolarDeg: 3, turnDeg: 40 } as const;

export interface DescentPose extends SitePose {
  /** How much of the rest pose's picture shift applies, 0 to 1. */
  shiftShare: number;
}

/**
 * The camera on its way down to the rest pose, for progress u from 0 to 1. It starts high over the
 * landing point looking straight down, with the landing point in the middle of the screen (where
 * the dive from the Moon left it). The height falls on a log scale, so the ground grows at a steady
 * rate; the ground turns under the landing point first, then the camera tips up and the horizon
 * rises into the picture. At u = 1 it is the rest pose exactly.
 */
export function descentPose(u: number, rest: SitePose): DescentPose {
  const t = clampTo(u, 0, 1);
  const d1 = clampTo(DESCENT.startFactor * rest.distance, DESCENT.startMin, DESCENT.startMax);
  const distance = d1 * (rest.distance / d1) ** t;
  const azDeg = rest.azDeg - DESCENT.turnDeg * (1 - smoothstep(0, 0.6, t));
  const polarDeg = DESCENT.startPolarDeg + (rest.polarDeg - DESCENT.startPolarDeg) * smoothstep(0.25, 1, t);
  const target = { x: rest.target.x, y: rest.target.y * smoothstep(0.5, 1, t), z: rest.target.z };
  return { target, position: orbitPosition(target, distance, azDeg, polarDeg), distance, azDeg, polarDeg, shiftShare: smoothstep(0.3, 1, t) };
}
