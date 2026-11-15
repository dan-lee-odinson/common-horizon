// Mission select's picture, as plain arithmetic: how far the camera stands from the Moon, where the
// spotlight site's marker lands on screen, and how the picture is shifted so that the marker and
// its name tag stay in the part of the window the glass panels leave free. Kept free of 3D-library
// code so the layout can be checked by tests (src/scene/missionView.test.ts).
//
// The panels are measured on the page (src/stages/MissionHud.tsx writes `missionFrame`); the camera
// (src/scene/CameraDirector.tsx) and the tag (src/stages/AnchorTag.tsx) both read the placement
// worked out here, so they always agree.

import { createStore } from '../state/store';
import { ORBIT_VIEW } from './orbitView';

export const MISSION_VIEW = {
  /** With nothing in the way, the Moon's centre sits this share of the width right of the middle. */
  shiftShare: 0.13,
  /** The camera faces the spotlight site, but never from beyond this latitude (its "up" is the Moon's axis). */
  latLimit: 58,
  /** Site markers float just off the surface, at this many Moon radii from the centre. */
  markerRadius: 1.004,
  /** The reticle on the spotlight site is a square this many Moon radii across, flat on the surface. */
  reticleSize: 0.3,
  /** Radius of the reticle's outer ring, as a share of the reticle's size. The tag sits just outside it. */
  ringShare: 0.34,
  /** Pixels between the reticle's outer ring and the tag. */
  tagGap: 10,
  /** Height of the tag, pixels (12 px capitals, 4 px padding, 1 px border). */
  tagHeight: 22,
  /** Pixels kept between the marker or its tag and the nearest panel. The panels drift a few pixels with the pointer. */
  margin: 14,
  /** Directions the tag may sit in from the marker (degrees clockwise from up), in order of preference. */
  tagDirections: [40, -40, 90, -90, 140, -140],
} as const;

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Distance at which a sphere of `radius` Moon radii just fits the given share of the view. */
export function fitDistance(radius: number, aspect: number, shareX: number, shareY: number): number {
  const tanV = Math.tan((ORBIT_VIEW.fov * Math.PI) / 360);
  return Math.max(radius / (tanV * aspect * shareX), radius / (tanV * shareY));
}

/** The mission-select camera's distance from the Moon's centre, in Moon radii. */
export function missionDistance(width: number, height: number, isPhone: boolean): number {
  const aspect = width / Math.max(1, height);
  const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
  return isPhone ? clamp(fitDistance(1, aspect, 0.86, 0.36), 3.2, 9) : clamp(fitDistance(1, aspect, 0.6, 0.86), 3.3, 6);
}

/** The latitude the mission-select camera looks from, for a site at `siteLat`. */
export function missionCameraLatitude(siteLat: number): number {
  return Math.min(MISSION_VIEW.latLimit, Math.max(-MISSION_VIEW.latLimit, siteLat));
}

/**
 * Where a site's marker sits relative to the Moon's centre on screen, for the camera that faces it:
 * `dy` pixels below the centre (negative = above) and the scale there, in pixels per Moon radius.
 * A site within the latitude limit is dead centre; a polar site sits toward the top or bottom.
 */
export function siteOnScreen(siteLat: number, distance: number, height: number): { dy: number; scale: number } {
  const beyond = ((siteLat - missionCameraLatitude(siteLat)) * Math.PI) / 180;
  const focal = height / 2 / Math.tan((ORBIT_VIEW.fov * Math.PI) / 360);
  const r = MISSION_VIEW.markerRadius;
  const depth = Math.max(1e-3, distance - r * Math.cos(beyond));
  return { dy: (-focal * r * Math.sin(beyond)) / depth, scale: focal / depth };
}

/** The tag's box relative to the marker, for a tag sitting in direction `toward` (degrees clockwise from up). */
export function tagBox(toward: number, ringRadius: number, tagWidth: number): Rect {
  const ux = Math.sin((toward * Math.PI) / 180);
  const uy = -Math.cos((toward * Math.PI) / 180);
  const h = MISSION_VIEW.tagHeight;
  // The same reach the tag itself uses (see AnchorTag): out past the ring, then half its own size.
  const reach = ringRadius + MISSION_VIEW.tagGap + (Math.abs(ux) * tagWidth) / 2 + (Math.abs(uy) * h) / 2;
  return { left: ux * reach - tagWidth / 2, right: ux * reach + tagWidth / 2, top: uy * reach - h / 2, bottom: uy * reach + h / 2 };
}

export interface SitePlacement {
  /** Picture shift in pixels: positive x moves the Moon right, positive y moves it up. */
  shiftX: number;
  shiftY: number;
  /** Where the tag sits from the marker, degrees clockwise from up. */
  toward: number;
  /** Where the marker lands, pixels from the left and top of the window. */
  x: number;
  y: number;
  /** Radius of the reticle (to the tips of its ticks) and of its outer ring, pixels. */
  reticleRadius: number;
  ringRadius: number;
  /** False when the free area is too small to hold the marker and its tag whole. */
  clear: boolean;
}

export interface PlacementInput {
  width: number;
  height: number;
  /** The part of the window the panels leave free; null = nothing measured, the whole window. */
  free: Rect | null;
  /** Latitude of the spotlight site; null = no site. */
  siteLat: number | null;
  /** Width of the site's name tag, pixels. */
  tagWidth: number;
}

/**
 * Where to put the spotlight site's marker and tag. The picture keeps its usual place (the Moon
 * right of centre) whenever the marker and tag are clear of the panels there. Otherwise it moves
 * by the least that brings them clear, with the tag on whichever side needs the smallest move.
 */
export function placeSite({ width, height, free, siteLat, tagWidth }: PlacementInput): SitePlacement {
  const base = { shiftX: width * MISSION_VIEW.shiftShare, shiftY: 0 };
  const distance = missionDistance(width, height, false);
  const site = siteOnScreen(siteLat ?? 0, distance, height);
  const reticleRadius = (MISSION_VIEW.reticleSize / 2) * site.scale;
  const ringRadius = MISSION_VIEW.reticleSize * MISSION_VIEW.ringShare * site.scale;
  const x0 = width / 2 + base.shiftX;
  const y0 = height / 2 + site.dy;
  const fallback: SitePlacement = { ...base, toward: MISSION_VIEW.tagDirections[0], x: x0, y: y0, reticleRadius, ringRadius, clear: true };
  if (siteLat === null || !free) return fallback;

  const m = MISSION_VIEW.margin;
  let best = fallback;
  let bestCost = Infinity;
  for (const [i, toward] of MISSION_VIEW.tagDirections.entries()) {
    const tag = tagBox(toward, ringRadius, tagWidth);
    // Everything that must stay clear, relative to the marker: the reticle and the tag.
    const keep = { left: Math.min(-reticleRadius, tag.left), right: Math.max(reticleRadius, tag.right), top: Math.min(-reticleRadius, tag.top), bottom: Math.max(reticleRadius, tag.bottom) };
    const lo = { x: free.left + m - keep.left, y: free.top + m - keep.top };
    const hi = { x: free.right - m - keep.right, y: free.bottom - m - keep.bottom };
    const short = Math.max(0, lo.x - hi.x) + Math.max(0, lo.y - hi.y);
    // Too little room on an axis: sit in the middle of what there is.
    const x = lo.x <= hi.x ? Math.min(hi.x, Math.max(lo.x, x0)) : (lo.x + hi.x) / 2;
    const y = lo.y <= hi.y ? Math.min(hi.y, Math.max(lo.y, y0)) : (lo.y + hi.y) / 2;
    // The smallest move wins; a placement that does not fit loses to any that does; earlier directions win ties.
    const cost = Math.hypot(x - x0, y - y0) + short * 1000 + i * 0.01;
    if (cost < bestCost) {
      bestCost = cost;
      best = { shiftX: base.shiftX + (x - x0), shiftY: base.shiftY - (y - y0), toward, x, y, reticleRadius, ringRadius, clear: short === 0 };
    }
  }
  return best;
}

/**
 * What mission select's panels leave of the window, measured on the page, and the width of the
 * spotlight site's name tag. `measured` is false until the HUD has been laid out (and on phones,
 * where the panels are arranged differently and the picture keeps its own place).
 */
export interface MissionFrame extends Rect {
  measured: boolean;
  width: number;
  height: number;
  tagWidth: number;
}

export const missionFrame = createStore<MissionFrame>({ measured: false, left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, tagWidth: 0 });

/** The placement for the frame as last measured. Before any measurement: the usual place. */
export function placeInFrame(frame: MissionFrame, fallbackWidth: number, fallbackHeight: number, siteLat: number | null): SitePlacement {
  return placeSite({
    width: frame.measured ? frame.width : fallbackWidth,
    height: frame.measured ? frame.height : fallbackHeight,
    free: frame.measured ? frame : null,
    siteLat,
    tagWidth: frame.tagWidth,
  });
}
