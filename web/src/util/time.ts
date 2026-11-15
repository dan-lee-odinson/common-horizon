// Time helpers: UTC formatting and the model value for Lunar Coordinated Time (LTC).
//
// LTC (model value) = UTC + 56.02 microseconds for every day counted from the landing time.
// A clock on the Moon runs slightly fast compared with one on Earth. The official lunar time
// standard is still being defined, so this is a simple linear model, labelled as such in the UI.
// Before the landing the offset is negative (the same straight line, extended backwards).

export const DAY_MS = 86_400_000;
export const HOUR_MS = 3_600_000;
export const LTC_MICROSECONDS_PER_DAY = 56.02;

/** Offset of LTC from UTC, in microseconds, at a UTC instant. */
export function ltcOffsetMicros(utcMs: number, landingUtcMs: number): number {
  const daysSinceLanding = (utcMs - landingUtcMs) / DAY_MS;
  return daysSinceLanding * LTC_MICROSECONDS_PER_DAY;
}

/** LTC instant as whole microseconds since 1970 (UTC epoch), rounded to the nearest microsecond. */
export function utcToLtcMicros(utcMs: number, landingUtcMs: number): number {
  return Math.round(utcMs * 1000 + ltcOffsetMicros(utcMs, landingUtcMs));
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0');
}

function ymdhms(d: Date): string {
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
  );
}

/** Value for <input type="datetime-local">, read as UTC: "2027-02-10T15:00". */
export function toDatetimeLocalUtc(utcMs: number): string {
  const d = new Date(utcMs);
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
  );
}

/** Parse a datetime-local value as UTC. Returns NaN for an empty or broken value. */
export function parseDatetimeLocalUtc(value: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!m) return Number.NaN;
  const [, y, mo, d, h, mi, s] = m;
  return Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s ?? 0));
}

export function toIsoUtc(utcMs: number): string {
  return new Date(utcMs).toISOString().replace('.000Z', 'Z');
}

/** "3 d 4 h" for durations, "45 h" for short ones. */
export function formatHours(hours: number): string {
  if (!Number.isFinite(hours)) return '—';
  const total = Math.round(hours); // round first, so 71.9 h reads "3 d", never "2 d 24 h"
  if (total < 48) return `${total} h`;
  const days = Math.floor(total / 24);
  const rest = total - days * 24;
  return rest === 0 ? `${days} d` : `${days} d ${rest} h`;
}

export function formatDays(days: number): string {
  return Number.isInteger(days) ? `${days}` : days.toFixed(2).replace(/0$/, '');
}

/** Mean length of the lunar day (new moon to new moon), in days. Standard astronomical value. */
export const SYNODIC_MONTH_DAYS = 29.530589;

export interface ClockParts {
  /** "2027-02-15" */
  date: string;
  /** "15:00:00" */
  time: string;
  /** LTC only: the six digits after the seconds, "000056". Empty for UTC. */
  fraction: string;
}

/** A UTC instant split for a running clock display. */
export function utcClock(utcMs: number): ClockParts {
  const [date, time] = ymdhms(new Date(utcMs)).split(' ');
  return { date, time, fraction: '' };
}

/** The LTC (model value) reading at a UTC instant, split for a running clock display. */
export function ltcClock(utcMs: number, landingUtcMs: number): ClockParts {
  const micros = utcToLtcMicros(utcMs, landingUtcMs);
  const wholeMs = Math.floor(micros / 1000);
  const subMs = micros - wholeMs * 1000;
  const d = new Date(wholeMs);
  const [date, time] = ymdhms(d).split(' ');
  return { date, time, fraction: pad(d.getUTCMilliseconds(), 3) + pad(subMs, 3) };
}

/** The LTC offset in microseconds with a sign and two decimals: "+182.07". */
export function formatLtcOffsetMicros(utcMs: number, landingUtcMs: number): string {
  const us = ltcOffsetMicros(utcMs, landingUtcMs);
  const rounded = Math.round(us * 100) / 100;
  const sign = rounded < 0 ? '−' : '+';
  return `${sign}${Math.abs(rounded).toFixed(2)}`;
}

/** "2027-02-15 15:00" (UTC, to the minute) for dates shown beside a control. */
export function formatUtcMinute(utcMs: number): string {
  return ymdhms(new Date(Math.round(utcMs / 60_000) * 60_000)).slice(0, 16);
}

/** Time since (or before) the landing: "+3 d 06 h", "−0 d 12 h". */
export function formatSinceLanding(utcMs: number, landingUtcMs: number): string {
  const hours = (utcMs - landingUtcMs) / HOUR_MS;
  const sign = hours < 0 ? '−' : '+';
  const total = Math.floor(Math.abs(hours));
  return `${sign}${Math.floor(total / 24)} d ${pad(total % 24)} h`;
}
