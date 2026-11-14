import { describe, expect, it } from 'vitest';
import { DAY_MS, LTC_MICROSECONDS_PER_DAY, formatLtc, formatTimeShort, formatUtc, ltcOffsetMicros, parseDatetimeLocalUtc, toDatetimeLocalUtc, utcToLtcMicros } from './time';

const LANDING = Date.UTC(2027, 1, 15, 15, 0, 0);

describe('LTC (model value) = UTC + 56.02 µs per day since landing', () => {
  it('uses the agreed rate', () => {
    expect(LTC_MICROSECONDS_PER_DAY).toBe(56.02);
  });

  it('is zero at the landing time', () => {
    expect(ltcOffsetMicros(LANDING, LANDING)).toBe(0);
  });

  it('adds 56.02 µs after one day', () => {
    expect(ltcOffsetMicros(LANDING + DAY_MS, LANDING)).toBeCloseTo(56.02, 9);
  });

  it('grows linearly: half a day gives half the offset', () => {
    expect(ltcOffsetMicros(LANDING + DAY_MS / 2, LANDING)).toBeCloseTo(28.01, 9);
  });

  it('adds about 20.46 ms over a 365.25-day stay', () => {
    expect(ltcOffsetMicros(LANDING + 365.25 * DAY_MS, LANDING)).toBeCloseTo(20461.305, 6);
  });

  it('is negative before the landing (same line extended backwards)', () => {
    expect(ltcOffsetMicros(LANDING - 2 * DAY_MS, LANDING)).toBeCloseTo(-112.04, 9);
  });

  it('turns a UTC instant into whole LTC microseconds', () => {
    expect(utcToLtcMicros(LANDING + 10 * DAY_MS, LANDING)).toBe((LANDING + 10 * DAY_MS) * 1000 + 560);
  });

  it('formats LTC with microseconds so the small offset is visible', () => {
    expect(formatLtc(LANDING, LANDING)).toBe('2027-02-15 15:00:00.000000 LTC');
    expect(formatLtc(LANDING + DAY_MS, LANDING)).toBe('2027-02-16 15:00:00.000056 LTC');
    expect(formatLtc(LANDING + 100 * DAY_MS, LANDING)).toBe('2027-05-26 15:00:00.005602 LTC');
  });

  it('rounds short labels to the minute instead of cutting them', () => {
    expect(formatTimeShort(LANDING - 4 * DAY_MS, 'LTC', LANDING)).toBe('2027-02-11 15:00 LTC');
    expect(formatTimeShort(LANDING, 'UTC', LANDING)).toBe('2027-02-15 15:00 UTC');
  });

  it('formats UTC plainly', () => {
    expect(formatUtc(LANDING)).toBe('2027-02-15 15:00:00 UTC');
  });
});

describe('datetime-local values are read as UTC', () => {
  it('round-trips', () => {
    expect(toDatetimeLocalUtc(LANDING)).toBe('2027-02-15T15:00');
    expect(parseDatetimeLocalUtc('2027-02-15T15:00')).toBe(LANDING);
  });
  it('rejects a broken value', () => {
    expect(parseDatetimeLocalUtc('')).toBeNaN();
    expect(parseDatetimeLocalUtc('15/02/2027')).toBeNaN();
  });
});
