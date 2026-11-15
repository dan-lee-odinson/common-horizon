// Time through the stay: how Play moves the clock, how the scrubber's keys step it, and how the
// lit and dark periods of a horizon answer are laid along the timeline.
//
// Two ranges matter. The scrub range is what the timeline shows and the scrubber can reach: from
// the planned landing (which is the landing itself when there is no launch delay) to the end of the
// stay. The play range is the stay alone: Play runs from the landing to the end of the stay.

import type { Period } from './horizon';
import { DAY_MS, HOUR_MS } from './time';

export interface ClockStep {
  nowMs: number;
  /** True when the clock reached the end of the play range in this step. */
  ended: boolean;
}

/**
 * Where a press on Play starts from: where the clock is, or the start of the play range when the
 * clock is at its end (play again) or before it (in the delay before the landing).
 */
export function playStart(nowMs: number, fromMs: number, toMs: number): number {
  return nowMs >= toMs || nowMs < fromMs || !Number.isFinite(nowMs) ? fromMs : nowMs;
}

/**
 * One frame of Play: `deltaMs` of real time at `daysPerSecond` simulated days for each real second,
 * inside the play range. The clock stops at the end and says so.
 */
export function advanceClock(nowMs: number, deltaMs: number, daysPerSecond: number, fromMs: number, toMs: number): ClockStep {
  const start = Math.min(toMs, Math.max(fromMs, Number.isFinite(nowMs) ? nowMs : fromMs));
  const step = Math.max(0, deltaMs) * (daysPerSecond * DAY_MS) / 1000;
  const next = start + (Number.isFinite(step) ? step : 0);
  return next >= toMs ? { nowMs: toMs, ended: true } : { nowMs: next, ended: false };
}

/** Periods cut to a range: edges inside the range stay exactly where they were. */
export function clipPeriods(periods: readonly Period[], fromMs: number, toMs: number): Period[] {
  const out: Period[] = [];
  for (const p of periods) {
    const start = Math.max(p.start, fromMs);
    const end = Math.min(p.end, toMs);
    if (end > start) out.push({ start, end, lit: p.lit });
  }
  return out;
}

/** Where an instant sits along a range, 0 at its start and 1 at its end (held at the ends). */
export function rangeFraction(ms: number, startMs: number, endMs: number): number {
  const span = endMs - startMs;
  if (!(span > 0) || !Number.isFinite(ms)) return 0;
  return Math.min(1, Math.max(0, (ms - startMs) / span));
}

/** The instant at a fraction of a range (the reverse of `rangeFraction`). */
export function rangeInstant(fraction: number, startMs: number, endMs: number): number {
  return startMs + Math.min(1, Math.max(0, fraction)) * (endMs - startMs);
}

/** Spacing of the day marks under the timeline, for a range this many days long. */
export function dayTickStep(days: number): number {
  if (days <= 16) return 1;
  if (days <= 32) return 2;
  if (days <= 120) return 7;
  return 30;
}

/**
 * Whole days after the landing that get a mark, inside the scrub range: multiples of the step, the
 * landing (0) always among them, negative before the landing.
 */
export function dayTicks(startMs: number, endMs: number, landingMs: number): number[] {
  if (!(endMs > startMs)) return [];
  const step = dayTickStep((endMs - startMs) / DAY_MS);
  const first = Math.ceil((startMs - landingMs) / DAY_MS / step - 1e-9) * step;
  const out: number[] = [];
  for (let d = first; landingMs + d * DAY_MS <= endMs + 1; d += step) out.push(d === 0 ? 0 : d);
  return out;
}

/** The scrubber's own unit: hours since the landing (negative before it). */
export function hoursSinceLanding(ms: number, landingMs: number): number {
  return (ms - landingMs) / HOUR_MS;
}

export function instantFromHours(hours: number, landingMs: number): number {
  return landingMs + hours * HOUR_MS;
}

/** The scrubber moves in quarter hours. */
export const SCRUB_STEP_HOURS = 0.25;

/** A value of the scrubber's input for an instant: hours since landing, on the quarter-hour grid. */
export function scrubValue(ms: number, landingMs: number): number {
  return Math.round(hoursSinceLanding(ms, landingMs) / SCRUB_STEP_HOURS) * SCRUB_STEP_HOURS;
}

/**
 * Where a key press on the scrubber takes the clock, or null for a key the scrubber does not use.
 * Arrows step an hour (six with Shift), PageUp and PageDown a day, Home and End go to the ends of
 * the scrub range. Every step stops at the ends.
 */
export function keyStep(nowMs: number, key: string, shift: boolean, startMs: number, endMs: number): number | null {
  const clampTo = (ms: number) => Math.min(endMs, Math.max(startMs, ms));
  const arrow = (shift ? 6 : 1) * HOUR_MS;
  switch (key) {
    case 'ArrowRight':
    case 'ArrowUp':
      return clampTo(nowMs + arrow);
    case 'ArrowLeft':
    case 'ArrowDown':
      return clampTo(nowMs - arrow);
    case 'PageUp':
      return clampTo(nowMs + DAY_MS);
    case 'PageDown':
      return clampTo(nowMs - DAY_MS);
    case 'Home':
      return startMs;
    case 'End':
      return endMs;
    default:
      return null;
  }
}
