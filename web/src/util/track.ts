// A geometry track: where the Sun and Earth are overhead on the Moon, at any time inside a window.
//
// The backend answers "where are the Sun and Earth overhead at the landing time?" (the `geometry`
// field of POST /evaluate). The website asks that once for each day of the window and joins the
// answers with a smooth curve, so the running readouts and the 3D scenes can show any instant in
// between. Nothing here invents a value: outside the first and last answers the track holds the
// end values, and it is null until answers arrive.
//
// How good the join is: with answers a day apart the curve stays within 0.002° of the mock model
// (src/util/track.test.ts), which carries the two decimals the readouts show. That only holds
// between answers that have a neighbour on both sides, so a loaded track also says which part of
// itself readouts may be taken from (`validStartMs` .. `validEndMs`, see `trackCovers`).

import type { Geometry } from '../api/types';
import { normalizeLon360, wrap180 } from './geo';

export interface TrackSample {
  /** The instant this answer is for (UTC, milliseconds). */
  tMs: number;
  geometry: Geometry;
}

export interface GeometryTrack {
  /** The first and last answers' instants. */
  startMs: number;
  endMs: number;
  /**
   * The part of the track readouts may be taken from, when the loader set one: the window that was
   * asked for. The answers before and after it are spares that only steady the curve's ends, and
   * the curve between a spare and its neighbour is less exact, so nothing is read from there.
   */
  validStartMs?: number;
  validEndMs?: number;
  samples: readonly TrackSample[];
  /**
   * Sub-solar and sub-Earth points at a time, interpolated between the answers. Outside the answers
   * it holds the end values, so ask `trackCovers` first when the result is shown as a number.
   */
  at(tMs: number): Geometry;
}

/** The window readouts may be taken from, for `buildTrack`. */
export interface TrackValidRange {
  startMs: number;
  endMs: number;
}

const CHANNELS = ['subsolar_lat', 'subsolar_lon_east', 'subearth_lat', 'subearth_lon_east'] as const;
type Channel = (typeof CHANNELS)[number];
const IS_LONGITUDE: Record<Channel, boolean> = { subsolar_lat: false, subsolar_lon_east: true, subearth_lat: false, subearth_lon_east: true };

/** Room for rounding where a window's end is worked out in two ways: one millisecond. */
const EDGE_MS = 1;

/** True when an answer has a real instant and all four of its values. */
export function isWholeSample(s: TrackSample | null | undefined): s is TrackSample {
  return !!s && Number.isFinite(s.tMs) && !!s.geometry && CHANNELS.every((c) => Number.isFinite(s.geometry[c]));
}

/** The part of a track readouts may be taken from: its valid range when it has one, else all of it. */
export function trackRange(track: GeometryTrack): TrackValidRange {
  return { startMs: track.validStartMs ?? track.startMs, endMs: track.validEndMs ?? track.endMs };
}

/** True when a readout for `tMs` may be taken from the track. A missing or non-finite instant never is. */
export function trackCovers(track: GeometryTrack | null, tMs: number | null): boolean {
  if (!track || tMs === null || !Number.isFinite(tMs)) return false;
  const { startMs, endMs } = trackRange(track);
  return tMs >= startMs - EDGE_MS && tMs <= endMs + EDGE_MS;
}

/** Cubic Hermite curve through (t0, v0) and (t1, v1) with slopes m0 and m1 (per millisecond). */
function hermite(t: number, t0: number, t1: number, v0: number, v1: number, m0: number, m1: number): number {
  const h = t1 - t0;
  if (h <= 0) return v0;
  const s = (t - t0) / h;
  const s2 = s * s;
  const s3 = s2 * s;
  return (2 * s3 - 3 * s2 + 1) * v0 + (s3 - 2 * s2 + s) * h * m0 + (-2 * s3 + 3 * s2) * v1 + (s3 - s2) * h * m1;
}

/**
 * Build a track from answers in any order. Returns null when there are none. An answer with a
 * missing instant or a missing value is left out: the curve is never drawn through a non-number.
 * `valid` (optional) is the window readouts may be taken from; it is kept inside the answers.
 */
export function buildTrack(input: readonly TrackSample[], valid?: TrackValidRange): GeometryTrack | null {
  const sorted = input.filter(isWholeSample).sort((a, b) => a.tMs - b.tMs);
  const samples: TrackSample[] = [];
  for (const s of sorted) if (samples.length === 0 || s.tMs > samples[samples.length - 1].tMs) samples.push(s);
  const n = samples.length;
  if (n === 0) return null;

  const t = samples.map((s) => s.tMs);
  const values = {} as Record<Channel, number[]>;
  const slopes = {} as Record<Channel, number[]>;
  for (const c of CHANNELS) {
    const v: number[] = [];
    for (let i = 0; i < n; i++) {
      const raw = samples[i].geometry[c];
      // Longitudes are unwrapped (carried past 360 or below 0) so the curve never jumps at the seam.
      v.push(i > 0 && IS_LONGITUDE[c] ? v[i - 1] + wrap180(raw - samples[i - 1].geometry[c]) : raw);
    }
    const m: number[] = [];
    for (let i = 0; i < n; i++) {
      if (n === 1) m.push(0);
      else if (i === 0) m.push((v[1] - v[0]) / (t[1] - t[0]));
      else if (i === n - 1) m.push((v[i] - v[i - 1]) / (t[i] - t[i - 1]));
      else {
        // Slope of the parabola through the three neighbouring answers (works for uneven spacing).
        const hb = t[i] - t[i - 1];
        const ha = t[i + 1] - t[i];
        const db = (v[i] - v[i - 1]) / hb;
        const da = (v[i + 1] - v[i]) / ha;
        m.push((db * ha + da * hb) / (ha + hb));
      }
    }
    values[c] = v;
    slopes[c] = m;
  }

  function channelAt(c: Channel, tMs: number, i: number): number {
    const v = values[c];
    if (n === 1) return v[0];
    return hermite(tMs, t[i], t[i + 1], v[i], v[i + 1], slopes[c][i], slopes[c][i + 1]);
  }

  const track: GeometryTrack = {
    startMs: t[0],
    endMs: t[n - 1],
    samples,
    at(tMs: number): Geometry {
      const x = Math.min(t[n - 1], Math.max(t[0], tMs));
      let i = 0;
      let j = n - 1;
      while (j - i > 1) {
        const mid = (i + j) >> 1;
        if (t[mid] <= x) i = mid;
        else j = mid;
      }
      i = Math.min(i, Math.max(0, n - 2));
      return {
        subsolar_lat: Math.max(-90, Math.min(90, channelAt('subsolar_lat', x, i))),
        subsolar_lon_east: normalizeLon360(channelAt('subsolar_lon_east', x, i)),
        subearth_lat: Math.max(-90, Math.min(90, channelAt('subearth_lat', x, i))),
        subearth_lon_east: normalizeLon360(channelAt('subearth_lon_east', x, i)),
      };
    },
  };
  if (valid && Number.isFinite(valid.startMs) && Number.isFinite(valid.endMs)) {
    track.validStartMs = Math.min(t[n - 1], Math.max(t[0], valid.startMs));
    track.validEndMs = Math.max(track.validStartMs, Math.min(t[n - 1], valid.endMs));
  }
  return track;
}

/**
 * Share of the Moon's disc that is sunlit as seen from Earth, 0..1 (0 = new moon, 1 = full moon).
 * It follows from the angle between the Sun's and Earth's overhead points.
 */
export function discLitFromEarth(g: Geometry): number {
  const rad = Math.PI / 180;
  const cosAngle =
    Math.sin(g.subsolar_lat * rad) * Math.sin(g.subearth_lat * rad) +
    Math.cos(g.subsolar_lat * rad) * Math.cos(g.subearth_lat * rad) * Math.cos((g.subsolar_lon_east - g.subearth_lon_east) * rad);
  return (1 + Math.max(-1, Math.min(1, cosAngle))) / 2;
}

export interface EarthSwing {
  /** East longitudes of the two ends of the range, going east from min to max. */
  lonMin: number;
  lonMax: number;
  latMin: number;
  latMax: number;
  /** Width of the longitude range and height of the latitude range, in degrees. */
  lonSpan: number;
  latSpan: number;
}

/**
 * The range Earth's overhead point moves through between two instants (libration): sampled from
 * the track every six hours, inside the part readouts may be taken from. Null when the track does
 * not cover the start, and when either instant is missing or not a real time.
 */
export function earthSwing(track: GeometryTrack | null, fromMs: number | null, toMs: number | null): EarthSwing | null {
  if (!track || fromMs === null || toMs === null || !Number.isFinite(fromMs) || !Number.isFinite(toMs)) return null;
  if (!trackCovers(track, fromMs)) return null;
  const end = Math.min(toMs, trackRange(track).endMs);
  const centre = track.at(fromMs).subearth_lon_east;
  let lo = 0;
  let hi = 0;
  let latMin = Infinity;
  let latMax = -Infinity;
  const step = 6 * 3_600_000;
  for (let t = fromMs; ; t = Math.min(end, t + step)) {
    const g = track.at(t);
    const d = wrap180(g.subearth_lon_east - centre);
    lo = Math.min(lo, d);
    hi = Math.max(hi, d);
    latMin = Math.min(latMin, g.subearth_lat);
    latMax = Math.max(latMax, g.subearth_lat);
    if (t >= end) break;
  }
  return { lonMin: normalizeLon360(centre + lo), lonMax: normalizeLon360(centre + hi), latMin, latMax, lonSpan: hi - lo, latSpan: latMax - latMin };
}
