// Play, the scrubber's keys and the timeline's periods.

import { describe, expect, it } from 'vitest';
import type { Period } from './horizon';
import {
  advanceClock,
  clipPeriods,
  dayTicks,
  dayTickStep,
  hoursSinceLanding,
  instantFromHours,
  keyStep,
  playStart,
  rangeFraction,
  rangeInstant,
  scrubValue,
} from './stay';
import { DAY_MS, HOUR_MS } from './time';

const LANDING = Date.UTC(2027, 1, 15, 15, 0, 0);
const END = LANDING + 14 * DAY_MS;

describe('Play moves the clock through the stay', () => {
  it('two days a second for half a second is one day', () => {
    expect(advanceClock(LANDING, 500, 2, LANDING, END)).toEqual({ nowMs: LANDING + DAY_MS, ended: false });
    expect(advanceClock(LANDING + 3 * DAY_MS, 1000, 0.5, LANDING, END)).toEqual({ nowMs: LANDING + 3.5 * DAY_MS, ended: false });
    expect(advanceClock(LANDING, 16, 6, LANDING, END).nowMs).toBeCloseTo(LANDING + 0.096 * DAY_MS, 3);
  });

  it('stops at the end of the stay and says so', () => {
    expect(advanceClock(END - HOUR_MS, 1000, 2, LANDING, END)).toEqual({ nowMs: END, ended: true });
    expect(advanceClock(END, 16, 2, LANDING, END)).toEqual({ nowMs: END, ended: true });
  });

  it('never runs before the landing, and never backwards', () => {
    expect(advanceClock(LANDING - 5 * DAY_MS, 0, 2, LANDING, END)).toEqual({ nowMs: LANDING, ended: false });
    expect(advanceClock(LANDING + DAY_MS, -500, 2, LANDING, END).nowMs).toBe(LANDING + DAY_MS);
    expect(advanceClock(Number.NaN, 500, 2, LANDING, END).nowMs).toBe(LANDING + DAY_MS);
  });

  it('a press on Play starts where the clock is, or at the landing from the end or from before it', () => {
    expect(playStart(LANDING + DAY_MS, LANDING, END)).toBe(LANDING + DAY_MS);
    expect(playStart(END, LANDING, END)).toBe(LANDING);
    expect(playStart(LANDING - 3 * DAY_MS, LANDING, END)).toBe(LANDING);
    expect(playStart(Number.NaN, LANDING, END)).toBe(LANDING);
  });
});

describe('periods along the timeline', () => {
  const periods: Period[] = [
    { start: LANDING - 14 * DAY_MS, end: LANDING - 2.5 * DAY_MS, lit: true },
    { start: LANDING - 2.5 * DAY_MS, end: LANDING + 1.25 * DAY_MS, lit: false },
    { start: LANDING + 1.25 * DAY_MS, end: LANDING + 9 * DAY_MS, lit: true },
    { start: LANDING + 9 * DAY_MS, end: END, lit: false },
  ];

  it('clipped to the stay they keep their inner edges and add up to the stay', () => {
    const stay = clipPeriods(periods, LANDING, END);
    expect(stay).toEqual([
      { start: LANDING, end: LANDING + 1.25 * DAY_MS, lit: false },
      { start: LANDING + 1.25 * DAY_MS, end: LANDING + 9 * DAY_MS, lit: true },
      { start: LANDING + 9 * DAY_MS, end: END, lit: false },
    ]);
    expect(stay.reduce((sum, p) => sum + (p.end - p.start), 0)).toBe(END - LANDING);
  });

  it('a range that covers them all changes nothing, and an empty range gives none', () => {
    expect(clipPeriods(periods, LANDING - 30 * DAY_MS, END + DAY_MS)).toEqual(periods);
    expect(clipPeriods(periods, END, END)).toEqual([]);
    expect(clipPeriods(periods, END + DAY_MS, END + 2 * DAY_MS)).toEqual([]);
  });

  it('places an instant along a range and back', () => {
    expect(rangeFraction(LANDING, LANDING, END)).toBe(0);
    expect(rangeFraction(END, LANDING, END)).toBe(1);
    expect(rangeFraction(LANDING + 3.5 * DAY_MS, LANDING, END)).toBe(0.25);
    expect(rangeFraction(LANDING - DAY_MS, LANDING, END)).toBe(0);
    expect(rangeFraction(END + DAY_MS, LANDING, END)).toBe(1);
    expect(rangeFraction(Number.NaN, LANDING, END)).toBe(0);
    expect(rangeFraction(LANDING, LANDING, LANDING)).toBe(0);
    expect(rangeInstant(0.25, LANDING, END)).toBe(LANDING + 3.5 * DAY_MS);
    expect(rangeInstant(1.4, LANDING, END)).toBe(END);
    expect(rangeInstant(-1, LANDING, END)).toBe(LANDING);
  });
});

describe('day marks', () => {
  it('step: 1 day up to 16 days, 2 up to 32, 7 up to 120, then 30', () => {
    expect(dayTickStep(1)).toBe(1);
    expect(dayTickStep(16)).toBe(1);
    expect(dayTickStep(16.25)).toBe(2);
    expect(dayTickStep(32)).toBe(2);
    expect(dayTickStep(44)).toBe(7);
    expect(dayTickStep(120)).toBe(7);
    expect(dayTickStep(186)).toBe(30);
    expect(dayTickStep(395.25)).toBe(30);
  });

  it('whole days after the landing, with the landing always among them', () => {
    expect(dayTicks(LANDING, END, LANDING)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    // A 14-day delay before a 14-day stay: 28 days on the timeline, a mark every second day.
    expect(dayTicks(LANDING - 14 * DAY_MS, END, LANDING)).toEqual([-14, -12, -10, -8, -6, -4, -2, 0, 2, 4, 6, 8, 10, 12, 14]);
    // A 5-day delay before a 60-day stay: every seventh day, counted from the landing.
    expect(dayTicks(LANDING - 5 * DAY_MS, LANDING + 60 * DAY_MS, LANDING)).toEqual([0, 7, 14, 21, 28, 35, 42, 49, 56]);
    expect(dayTicks(LANDING - 30 * DAY_MS, LANDING + 365.25 * DAY_MS, LANDING)).toEqual([-30, 0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330, 360]);
    expect(dayTicks(LANDING, LANDING, LANDING)).toEqual([]);
  });
});

describe('the scrubber', () => {
  it('counts in hours since the landing, on a quarter-hour grid', () => {
    expect(hoursSinceLanding(LANDING + 3 * DAY_MS, LANDING)).toBe(72);
    expect(hoursSinceLanding(LANDING - 6 * HOUR_MS, LANDING)).toBe(-6);
    expect(instantFromHours(72, LANDING)).toBe(LANDING + 3 * DAY_MS);
    expect(scrubValue(LANDING + 72.1 * HOUR_MS, LANDING)).toBe(72);
    expect(scrubValue(LANDING + 72.2 * HOUR_MS, LANDING)).toBe(72.25);
    expect(scrubValue(LANDING - 0.4 * HOUR_MS, LANDING)).toBe(-0.5);
  });

  it('arrows step an hour, with Shift six; PageUp and PageDown a day; Home and End the ends', () => {
    const t = LANDING + 3 * DAY_MS;
    expect(keyStep(t, 'ArrowRight', false, LANDING, END)).toBe(t + HOUR_MS);
    expect(keyStep(t, 'ArrowUp', false, LANDING, END)).toBe(t + HOUR_MS);
    expect(keyStep(t, 'ArrowLeft', false, LANDING, END)).toBe(t - HOUR_MS);
    expect(keyStep(t, 'ArrowDown', false, LANDING, END)).toBe(t - HOUR_MS);
    expect(keyStep(t, 'ArrowRight', true, LANDING, END)).toBe(t + 6 * HOUR_MS);
    expect(keyStep(t, 'ArrowLeft', true, LANDING, END)).toBe(t - 6 * HOUR_MS);
    expect(keyStep(t, 'PageUp', false, LANDING, END)).toBe(t + DAY_MS);
    expect(keyStep(t, 'PageDown', false, LANDING, END)).toBe(t - DAY_MS);
    expect(keyStep(t, 'Home', false, LANDING, END)).toBe(LANDING);
    expect(keyStep(t, 'End', false, LANDING, END)).toBe(END);
  });

  it('stops at both ends, and leaves other keys alone', () => {
    expect(keyStep(END - 0.5 * HOUR_MS, 'ArrowRight', false, LANDING, END)).toBe(END);
    expect(keyStep(END, 'PageUp', false, LANDING, END)).toBe(END);
    expect(keyStep(LANDING + 2 * HOUR_MS, 'ArrowLeft', true, LANDING, END)).toBe(LANDING);
    expect(keyStep(LANDING, 'PageDown', false, LANDING, END)).toBe(LANDING);
    // With a delay the range starts at the planned landing: Home goes there, before the landing.
    expect(keyStep(LANDING, 'Home', false, LANDING - 14 * DAY_MS, END)).toBe(LANDING - 14 * DAY_MS);
    expect(keyStep(LANDING, 'ArrowLeft', false, LANDING - 14 * DAY_MS, END)).toBe(LANDING - HOUR_MS);
    expect(keyStep(LANDING, 'a', false, LANDING, END)).toBeNull();
    expect(keyStep(LANDING, 'Tab', false, LANDING, END)).toBeNull();
    expect(keyStep(LANDING, ' ', false, LANDING, END)).toBeNull();
  });
});
