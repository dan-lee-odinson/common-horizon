// Reading a horizon answer (POST /horizon): where the Sun is at a time, when it next rises or sets
// behind the terrain, and the lit and dark periods of the window.
//
// LIT OR DARK IS THE ANSWER'S OWN WORD, used as given: a sample's `state` is "above" when ANY PART
// of the Sun's disc is visible over the terrain (the rule /evaluate counts as sunlight). Nothing
// here works it out again from the Sun's centre and the skyline (the two disagree near a grazing
// skyline: at Shackleton ridge at 16 of 337 samples of one answer). Between two samples the state is
// that of the NEAREST sample (at equal distance, the later one), so a sunrise or sunset is placed
// midway between the two samples whose words differ, and is known only to that spacing. Every lit or
// dark display (the readouts, the timeline, the plot's Sun marker, the scene's light) reads it here.
//
// How finely anything here is known depends on the samples, so each reading says so. A sunrise or
// sunset gives the spacing of the samples it falls between, or the answer's own `time_step_s` when
// that is coarser (`sampleGapHours`), and the Sun's position gives how far a straight line between
// its two samples can be from the truth (`uncertaintyDeg`). The readouts use these to choose how
// many digits to show, or to show none.

import type { HorizonResponse, SunPathPoint } from '../api/types';
import { normalizeLon360, wrap180 } from './geo';
import { HOUR_MS } from './time';

export interface SunNow {
  /** The Sun's centre, read off a straight line between the two samples around the time. */
  az: number;
  el: number;
  /** The answer's word at the nearest sample: true for "above" (some of the disc shows), false for "hidden". */
  above: boolean;
  /**
   * How far az and el can be from the Sun's true direction because they were read off a straight
   * line between two samples, in degrees (an upper estimate). 0 at either end of the path, where
   * it is the end sample itself; Infinity when it cannot be judged.
   */
  uncertaintyDeg: number;
}

export interface SunChange {
  kind: 'sunrise' | 'sunset';
  /** Midway between the two samples whose words differ. */
  atMs: number;
  /** Hours from the asked time to the change. */
  hours: number;
  /**
   * Hours between the two samples the change falls between, or the answer's time_step_s when that is
   * coarser: the change's time is not known more finely than this.
   */
  sampleGapHours: number;
  /**
   * Always false: the change is placed by the nearest-sample rule, midway between two samples, not
   * read off a crossing of the skyline. Kept so a reader can tell.
   */
  interpolated: boolean;
}

export interface Period {
  start: number;
  end: number;
  lit: boolean;
}

interface Crossing {
  atMs: number;
  /** The state after the change. */
  toAbove: boolean;
  /** Time between the two samples around the change, or the answer's step when coarser. */
  gapMs: number;
}

interface Prepared {
  /** The samples whose time can be read, in the answer's order. Every reading is taken from these. */
  path: SunPathPoint[];
  /** Their times, in milliseconds: times[i] belongs to path[i]. */
  times: number[];
  crossings: Crossing[];
  startsAbove: boolean;
}

const prepared = new WeakMap<HorizonResponse, Prepared>();

/** The answer's own sample spacing, milliseconds; 0 when it does not give one. */
export function answerStepMs(data: Pick<HorizonResponse, 'time_step_s'>): number {
  const s = data.time_step_s;
  return typeof s === 'number' && Number.isFinite(s) && s > 0 ? s * 1000 : 0;
}

function prepare(data: HorizonResponse): Prepared {
  const hit = prepared.get(data);
  if (hit) return hit;
  const path: SunPathPoint[] = [];
  const times: number[] = [];
  for (const p of data.sun_path) {
    const t = Date.parse(p.t);
    // A sample whose time cannot be read is left out: nothing can be placed by it, and a change
    // beside it is placed between the readable samples around it.
    if (!Number.isFinite(t)) continue;
    path.push(p);
    times.push(t);
  }
  const stepMs = answerStepMs(data);
  const crossings: Crossing[] = [];
  for (let i = 0; i + 1 < path.length; i++) {
    if (path[i].state === path[i + 1].state) continue;
    const gapMs = times[i + 1] - times[i];
    // The nearest sample's word: the change is midway between the two samples.
    crossings.push({ atMs: times[i] + gapMs / 2, toAbove: path[i + 1].state === 'above', gapMs: Math.max(gapMs, stepMs) });
  }
  const out: Prepared = { path, times, crossings, startsAbove: path.length > 0 && path[0].state === 'above' };
  prepared.set(data, out);
  return out;
}

function aboveAt(p: Prepared, tMs: number): boolean {
  let above = p.startsAbove;
  for (const c of p.crossings) {
    if (c.atMs > tMs) break;
    above = c.toAbove;
  }
  return above;
}

/**
 * How far a reading off the straight line between samples i and i + 1 can be from the Sun's true
 * direction, in degrees. It is judged by how much the path bends at those two samples (the change
 * in step from one sample to the next, in height and in azimuth): half the largest bend. On a
 * smooth stretch that is about four times the real error. It still holds where the Sun passes
 * almost straight overhead and its height turns sharply between two samples, which is where a
 * straight line is furthest out. Infinity when neither sample has a neighbour on both sides to
 * judge the bend by. Assumes evenly spaced samples, as the answer gives them.
 */
function lineUncertaintyDeg(path: readonly SunPathPoint[], i: number): number {
  let worst = -1;
  for (const k of [i, i + 1]) {
    if (k < 1 || k + 1 >= path.length) continue;
    const bendEl = path[k - 1].el - 2 * path[k].el + path[k + 1].el;
    const bendAz = wrap180(path[k + 1].az - path[k].az) - wrap180(path[k].az - path[k - 1].az);
    worst = Math.max(worst, Math.abs(bendEl), Math.abs(bendAz));
  }
  return worst < 0 || !Number.isFinite(worst) ? Infinity : worst / 2;
}

/**
 * Sample times of the Sun's path, in milliseconds (cached per answer). One for each sample of
 * `sun_path`, in order; a sample whose time cannot be read is left out.
 */
export function sunPathTimes(data: HorizonResponse): readonly number[] {
  return prepare(data).times;
}

/**
 * The Sun at a time: its direction read off a straight line between the two samples around it, and
 * lit or dark as the nearest sample's word says. Null when the answer has no readable path.
 */
export function sunAt(data: HorizonResponse, tMs: number): SunNow | null {
  const p = prepare(data);
  const times = p.times;
  const n = times.length;
  if (n === 0) return null;
  let i = 0;
  let j = n - 1;
  if (tMs <= times[0]) j = 0;
  else if (tMs >= times[n - 1]) i = n - 1;
  else {
    while (j - i > 1) {
      const m = (i + j) >> 1;
      if (times[m] <= tMs) i = m;
      else j = m;
    }
  }
  const hi = Math.max(i, j);
  const a = p.path[i];
  const b = p.path[hi];
  const span = times[hi] - times[i];
  const f = span > 0 ? (tMs - times[i]) / span : 0;
  return {
    az: normalizeLon360(a.az + wrap180(b.az - a.az) * f),
    el: a.el + (b.el - a.el) * f,
    above: aboveAt(p, Math.min(times[n - 1], Math.max(times[0], tMs))),
    uncertaintyDeg: hi === i ? 0 : lineUncertaintyDeg(p.path, i),
  };
}

/** The next sunrise or sunset after a time, or null when the Sun does not change inside the window. */
export function nextSunChange(data: HorizonResponse, tMs: number): SunChange | null {
  const p = prepare(data);
  for (const c of p.crossings) {
    if (c.atMs > tMs) {
      return { kind: c.toAbove ? 'sunrise' : 'sunset', atMs: c.atMs, hours: (c.atMs - tMs) / HOUR_MS, sampleGapHours: c.gapMs / HOUR_MS, interpolated: false };
    }
  }
  return null;
}

/** Lit and dark periods across the whole window, in order. */
export function litPeriods(data: HorizonResponse): Period[] {
  const p = prepare(data);
  const n = p.times.length;
  if (n === 0) return [];
  const out: Period[] = [];
  let start = p.times[0];
  let lit = p.startsAbove;
  for (const c of p.crossings) {
    out.push({ start, end: c.atMs, lit });
    start = c.atMs;
    lit = c.toAbove;
  }
  out.push({ start, end: p.times[n - 1], lit });
  return out;
}

function niceStep(range: number): number {
  for (const s of [1, 2, 5, 10, 15, 30]) if (range / s <= 6) return s;
  return 30;
}

/** Spacing of the height grid lines for a height range. */
export function elevationStep(range: number): number {
  return niceStep(range);
}

/** The height range a plot of this data needs: terrain, the Sun's path and Earth's box. */
export function naturalElRange(data: HorizonResponse): { min: number; max: number } {
  const skyMin = Math.min(...data.skyline.map((p) => p.el));
  const skyMax = Math.max(...data.skyline.map((p) => p.el));
  const sunMax = data.sun_path.length ? Math.max(...data.sun_path.map((p) => p.el)) : 0;
  const earthTop = data.earth_box ? data.earth_box.el_max : -90;
  const min = Math.floor(Math.min(-2, skyMin - 0.5));
  const rawMax = Math.max(skyMax + 2, earthTop + 1, Math.min(sunMax + 1, 90), 6);
  const step = niceStep(rawMax - min);
  return { min, max: Math.min(90, Math.ceil(rawMax / step) * step) };
}
