import { describe, expect, it } from 'vitest';
import { DAY_MS, LTC_MICROSECONDS_PER_DAY, formatHours, formatSinceLanding, formatUtcMinute, ltcClock, ltcOffsetMicros, parseDatetimeLocalUtc, toDatetimeLocalUtc, utcClock, utcToLtcMicros } from './time';

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

  it('reads the LTC clock with microseconds so the small offset is visible', () => {
    expect(ltcClock(LANDING, LANDING)).toEqual({ date: '2027-02-15', time: '15:00:00', fraction: '000000' });
    expect(ltcClock(LANDING + DAY_MS, LANDING)).toEqual({ date: '2027-02-16', time: '15:00:00', fraction: '000056' });
    expect(ltcClock(LANDING + 100 * DAY_MS, LANDING)).toEqual({ date: '2027-05-26', time: '15:00:00', fraction: '005602' });
    // Before the landing the LTC reading is a little behind UTC.
    expect(ltcClock(LANDING - 2 * DAY_MS, LANDING)).toEqual({ date: '2027-02-13', time: '14:59:59', fraction: '999888' });
  });

  it('reads the UTC clock plainly, and rounds dates beside a control to the minute instead of cutting them', () => {
    expect(utcClock(LANDING)).toEqual({ date: '2027-02-15', time: '15:00:00', fraction: '' });
    expect(formatUtcMinute(LANDING)).toBe('2027-02-15 15:00');
    expect(formatUtcMinute(LANDING - 4 * DAY_MS + 59_700)).toBe('2027-02-11 15:01');
  });

  it('counts time from the landing with a sign, in days and hours', () => {
    expect(formatSinceLanding(LANDING, LANDING)).toBe('+0 d 00 h');
    expect(formatSinceLanding(LANDING + 78 * 3_600_000, LANDING)).toBe('+3 d 06 h');
    expect(formatSinceLanding(LANDING - 12 * 3_600_000, LANDING)).toBe('−0 d 12 h');
    expect(formatSinceLanding(LANDING - 14 * DAY_MS, LANDING)).toBe('−14 d 00 h');
  });
});

describe('durations', () => {
  it('rounds before splitting into days and hours', () => {
    expect(formatHours(71.9)).toBe('3 d');
    expect(formatHours(743.5)).toBe('31 d');
    expect(formatHours(335)).toBe('13 d 23 h');
    expect(formatHours(47.4)).toBe('47 h');
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
