// A geometry track: where the Sun and Earth are overhead on the Moon, at any time inside a window.
//
// The backend answers "where are the Sun and Earth overhead at the landing time?" (the `geometry`
// field of POST /evaluate). The website asks that once for each day of the window and joins the
// answers with a smooth curve, so the running readouts and the 3D scenes can show any instant in
// between. Nothing here invents a value: outside the first and last answers the track holds the
// end values, and it is null until answers arrive.

import type { Geometry } from '../api/types';
import { normalizeLon360, wrap180 } from './geo';

export interface TrackSample {
  /** The instant this answer is for (UTC, milliseconds). */
  tMs: number;
  geometry: Geometry;
}

export interface GeometryTrack {
  startMs: number;
  endMs: number;
  samples: readonly TrackSample[];
  /** Sub-solar and sub-Earth points at a time, interpolated between the answers. */
  at(tMs: number): Geometry;
}

const CHANNELS = ['subsolar_lat', 'subsolar_lon_east', 'subearth_lat', 'subearth_lon_east'] as const;
type Channel = (typeof CHANNELS)[number];
const IS_LONGITUDE: Record<Channel, boolean> = { subsolar_lat: false, subsolar_lon_east: true, subearth_lat: false, subearth_lon_east: true };

/** Cubic Hermite curve through (t0, v0) and (t1, v1) with slopes m0 and m1 (per millisecond). */
function hermite(t: number, t0: number, t1: number, v0: number, v1: number, m0: number, m1: number): number {
  const h = t1 - t0;
  if (h <= 0) return v0;
  const s = (t - t0) / h;
  const s2 = s * s;
  const s3 = s2 * s;
  return (2 * s3 - 3 * s2 + 1) * v0 + (s3 - 2 * s2 + s) * h * m0 + (-2 * s3 + 3 * s2) * v1 + (s3 - s2) * h * m1;
}

/** Build a track from answers in any order. Returns null when there are none. */
export function buildTrack(input: readonly TrackSample[]): GeometryTrack | null {
  const sorted = [...input].filter((s) => Number.isFinite(s.tMs)).sort((a, b) => a.tMs - b.tMs);
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

  return {
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
