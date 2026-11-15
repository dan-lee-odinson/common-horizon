// The maths of the horizon plot: the sky from one site, unrolled.
//   x axis: compass direction, 360 degrees wide, centred on Earth's part of the sky
//   y axis: height above level, in degrees
// Drawn on it: the terrain skyline, the Sun's path over a span of time (solid where the answer says
// the Sun is above the skyline, dashed where the terrain hides it) and the box Earth moves through.
// Everything here is a pure function of a horizon answer and a size, so it can be tested without
// drawing anything. One unit is one CSS pixel.

import type { HorizonResponse, SkyBox, SkyPoint, SunState } from '../api/types';
import { normalizeLon360, sampleProfile, wrap180 } from './geo';

/** Centre of the compass axis: Earth's box (to the nearest 45 degrees) so it never splits at the edges; south when Earth is not in the sky. */
export function axisCenter(box: SkyBox | null): number {
  if (!box || ![box.az_min, box.az_max].every((v) => Number.isFinite(v))) return 180;
  const span = normalizeLon360(box.az_max - box.az_min);
  const mid = normalizeLon360(box.az_min + span / 2);
  return normalizeLon360(Math.round(mid / 45) * 45);
}

/** Where an azimuth sits across the plot, as a share of its width: 0 at the left edge, 1 at the right. */
export function azFraction(az: number, center: number): number {
  return (wrap180(az - center) + 180) / 360;
}

/** Compass directions marked along the bottom, left edge to right edge, `step` degrees apart. */
export function azTickValues(center: number, step: number): number[] {
  const out: number[] = [];
  for (let a = center - 180; a <= center + 180 + 1e-9; a += step) out.push(a);
  return out;
}

const COMPASS: Record<number, string> = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };

/** The letters for a compass direction that is a multiple of 45 degrees; empty for any other. */
export function compassLetters(az: number): string {
  return COMPASS[normalizeLon360(az)] ?? '';
}

// ---------- the height scale ----------

/** Heights up to this are drawn on one straight scale. */
export const LINEAR_MAX_DEG = 12;
/** Above it the scale is in two bands that meet here. */
export const BAND_BREAK_DEG = 10;
/** The lower band's share of the plot's height. */
export const LOWER_BAND_SHARE = 0.6;

export interface ElScale {
  min: number;
  max: number;
  /** The height where the two bands meet, or null for a single straight scale. */
  breakEl: number | null;
  /** Pixel position of a height (down the screen: `top` is `max`). Heights beyond the range continue the nearest band. */
  y: (el: number) => number;
  /** The height at a pixel position: the reverse of `y`. */
  el: (y: number) => number;
}

/**
 * The height scale for a range, over `height` pixels starting at `top`.
 *
 * Near the poles the whole plot is a few degrees tall and one straight scale serves. At a
 * low-latitude site the Sun climbs to 90 degrees while the terrain skyline stays within a degree or
 * two of level: on a straight scale the skyline would be a flat line at the bottom. There the
 * scale has two bands: from the lowest height to 10 degrees takes the lower 60 % of the plot, and
 * 10 degrees to the top takes the rest. The plot marks the break.
 */
export function elScale(range: { min: number; max: number }, top: number, height: number): ElScale {
  const { min, max } = range;
  const bottom = top + height;
  if (max <= LINEAR_MAX_DEG || min >= BAND_BREAK_DEG) {
    const span = max - min || 1;
    return { min, max, breakEl: null, y: (el) => top + ((max - el) / span) * height, el: (y) => max - ((y - top) / height) * span };
  }
  const breakY = bottom - LOWER_BAND_SHARE * height;
  const lowerPx = (bottom - breakY) / (BAND_BREAK_DEG - min);
  const upperPx = (breakY - top) / (max - BAND_BREAK_DEG);
  return {
    min,
    max,
    breakEl: BAND_BREAK_DEG,
    y: (el) => (el <= BAND_BREAK_DEG ? breakY + (BAND_BREAK_DEG - el) * lowerPx : breakY - (el - BAND_BREAK_DEG) * upperPx),
    el: (y) => (y >= breakY ? BAND_BREAK_DEG - (y - breakY) / lowerPx : BAND_BREAK_DEG + (breakY - y) / upperPx),
  };
}

const STEPS = [1, 2, 5, 10, 15, 30, 45];

/** The smallest of the usual steps whose lines are at least `minGapPx` apart at `pxPerDeg`. */
function stepFor(pxPerDeg: number, minGapPx: number): number {
  for (const s of STEPS) if (s * pxPerDeg >= minGapPx) return s;
  return 90;
}

/**
 * Heights that get a grid line and a label: multiples of a step chosen so neighbouring labels never
 * touch (at least `minGapPx` apart). On a two-band scale each band has its own step, and a line too
 * close above the break is left out.
 */
export function elTickValues(scale: ElScale, minGapPx = 18): number[] {
  const out: number[] = [];
  const px = (a: number, b: number) => Math.abs(scale.y(a) - scale.y(b));
  if (scale.breakEl === null) {
    const step = stepFor(px(scale.min, scale.max) / (scale.max - scale.min || 1), minGapPx);
    for (let e = Math.ceil(scale.min / step - 1e-9) * step; e <= scale.max + 1e-9; e += step) out.push(e === 0 ? 0 : e);
    return out;
  }
  const b = scale.breakEl;
  const lower = stepFor(px(scale.min, b) / (b - scale.min), minGapPx);
  for (let e = Math.ceil(scale.min / lower - 1e-9) * lower; e <= b + 1e-9; e += lower) out.push(e === 0 ? 0 : e);
  const upper = stepFor(px(b, scale.max) / (scale.max - b), minGapPx);
  const lastLower = out.length ? out[out.length - 1] : scale.min;
  for (let e = Math.ceil(b / upper) * upper; e <= scale.max + 1e-9; e += upper) {
    if (e > b && px(e, lastLower) >= minGapPx) out.push(e);
  }
  return out;
}

// ---------- shapes ----------

export interface PlotBox {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

function fx(n: number): string {
  return n.toFixed(1);
}

/**
 * The skyline as a line across the plot, left edge to right edge, and as a closed shape down to the
 * plot's bottom edge (for the terrain fill). Empty strings when there is no skyline.
 */
export function skylinePaths(skyline: readonly SkyPoint[], center: number, box: PlotBox, y: (el: number) => number): { line: string; area: string } {
  if (skyline.length === 0) return { line: '', area: '' };
  const width = box.right - box.left;
  const pts = skyline.filter((p) => Number.isFinite(p.az) && Number.isFinite(p.el)).map((p) => ({ x: box.left + azFraction(p.az, center) * width, y: y(p.el) }));
  // The same height at both edges: the left edge is the azimuth 180 degrees round from the centre.
  const edgeY = y(sampleProfile(skyline, center - 180));
  // A point that falls exactly on the left edge is the edge itself.
  const inner = pts.filter((p) => p.x > box.left + 0.01).sort((a, b) => a.x - b.x);
  const line = `M${fx(box.left)},${fx(edgeY)}` + inner.map((p) => `L${fx(p.x)},${fx(p.y)}`).join('') + `L${fx(box.right)},${fx(edgeY)}`;
  return { line, area: `${line}L${fx(box.right)},${fx(box.bottom)}L${fx(box.left)},${fx(box.bottom)}Z` };
}

export interface SunRun {
  state: SunState;
  /** "x,y x,y ..." for a polyline. */
  points: string;
}

/**
 * The Sun's path between two instants as runs of one state each. A run ends where the answer's word
 * changes (the two runs share that point, so solid and dashed parts touch) and where the path leaves
 * one edge of the plot to come back at the other. Samples closer than `minStepPx` to the last one
 * drawn are skipped, so a year-long path does not carry ten thousand points.
 */
export function sunRuns(
  data: HorizonResponse,
  fromMs: number,
  toMs: number,
  center: number,
  box: PlotBox,
  y: (el: number) => number,
  minStepPx = 0.75,
): SunRun[] {
  const out: SunRun[] = [];
  const width = box.right - box.left;
  let current: { state: SunState; pts: string[] } | null = null;
  let prevX: number | null = null;
  let keptX = 0;
  let keptY = 0;
  const close = () => {
    if (current && current.pts.length > 1) out.push({ state: current.state, points: current.pts.join(' ') });
    current = null;
  };
  for (const p of data.sun_path) {
    const t = Date.parse(p.t);
    if (!Number.isFinite(t) || t < fromMs || t > toMs || !Number.isFinite(p.az) || !Number.isFinite(p.el)) continue;
    const x = box.left + azFraction(p.az, center) * width;
    const py = y(p.el);
    const pt = `${fx(x)},${fx(py)}`;
    const jump = prevX !== null && Math.abs(x - prevX) > width / 2;
    prevX = x;
    if (!current || jump) {
      close();
      current = { state: p.state, pts: [pt] };
    } else if (p.state !== current.state) {
      current.pts.push(pt);
      close();
      current = { state: p.state, pts: [pt] };
    } else if (Math.hypot(x - keptX, py - keptY) >= minStepPx) {
      current.pts.push(pt);
    } else {
      continue;
    }
    keptX = x;
    keptY = py;
  }
  close();
  return out;
}

/**
 * Earth's box as rectangles across the plot: one, or two when the box wraps past the plot's edge.
 * `x` and `w` are in pixels; none when there is no box.
 */
export function boxRects(skyBox: SkyBox | null, center: number, box: PlotBox): { x: number; w: number }[] {
  if (!skyBox) return [];
  const width = box.right - box.left;
  const x1 = box.left + azFraction(skyBox.az_min, center) * width;
  const x2 = box.left + azFraction(skyBox.az_max, center) * width;
  if (x2 >= x1) return [{ x: x1, w: Math.max(2, x2 - x1) }];
  return [
    { x: x1, w: Math.max(2, box.right - x1) },
    { x: box.left, w: Math.max(2, x2 - box.left) },
  ];
}
