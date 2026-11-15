import { describe, expect, it } from 'vitest';
import { geometryAt, subearthPoint, subsolarPoint } from '../api/mock/model';
import { buildTrack, discLitFromEarth, earthSwing, isWholeSample, trackCovers, trackRange, type TrackSample } from './track';
import { wrap180 } from './geo';
import { DAY_MS, HOUR_MS } from './time';

const T0 = Date.UTC(2027, 1, 15, 15, 0, 0);

function dailySamples(days: number, stepDays = 1): TrackSample[] {
  const out: TrackSample[] = [];
  for (let k = -1; k <= days + 1; k += stepDays) out.push({ tMs: T0 + k * DAY_MS, geometry: geometryAt(T0 + k * DAY_MS) });
  return out;
}

describe('geometry track', () => {
  it('returns null with no answers and holds a single answer', () => {
    expect(buildTrack([])).toBeNull();
    const one = buildTrack([{ tMs: T0, geometry: geometryAt(T0) }])!;
    expect(one.at(T0 + 5 * DAY_MS)).toEqual(geometryAt(T0));
  });

  it('gives each answer back exactly at its own instant', () => {
    const samples = dailySamples(30);
    const track = buildTrack(samples)!;
    for (const s of samples) {
      const g = track.at(s.tMs);
      expect(g.subsolar_lat).toBeCloseTo(s.geometry.subsolar_lat, 9);
      expect(Math.abs(wrap180(g.subsolar_lon_east - s.geometry.subsolar_lon_east))).toBeLessThan(1e-9);
      expect(g.subearth_lat).toBeCloseTo(s.geometry.subearth_lat, 9);
      expect(Math.abs(wrap180(g.subearth_lon_east - s.geometry.subearth_lon_east))).toBeLessThan(1e-9);
    }
  });

  it('follows the mock model between daily answers to within 0.03 degrees', () => {
    const track = buildTrack(dailySamples(30))!;
    let worst = 0;
    for (let h = 0; h <= 30 * 24; h += 1) {
      const t = T0 + h * HOUR_MS;
      const want = geometryAt(t);
      const got = track.at(t);
      worst = Math.max(
        worst,
        Math.abs(got.subsolar_lat - want.subsolar_lat),
        Math.abs(wrap180(got.subsolar_lon_east - want.subsolar_lon_east)),
        Math.abs(got.subearth_lat - want.subearth_lat),
        Math.abs(wrap180(got.subearth_lon_east - want.subearth_lon_east)),
      );
    }
    expect(worst).toBeLessThan(0.03);
  });

  it('crosses the 0 / 360 seam without a jump', () => {
    const track = buildTrack(dailySamples(30))!;
    let prev = track.at(T0).subsolar_lon_east;
    for (let h = 1; h <= 30 * 24; h++) {
      const lon = track.at(T0 + h * HOUR_MS).subsolar_lon_east;
      expect(lon).toBeGreaterThanOrEqual(0);
      expect(lon).toBeLessThan(360);
      // The Sun's overhead point moves west about half a degree an hour, never in leaps.
      expect(Math.abs(wrap180(lon - prev))).toBeLessThan(1);
      prev = lon;
    }
  });

  it('holds the end values outside the answers and accepts answers in any order', () => {
    const samples = dailySamples(10);
    const track = buildTrack([...samples].reverse())!;
    expect(track.startMs).toBe(samples[0].tMs);
    expect(track.endMs).toBe(samples[samples.length - 1].tMs);
    expect(track.at(track.endMs + 99 * DAY_MS)).toEqual(track.at(track.endMs));
    expect(track.at(track.startMs - 99 * DAY_MS)).toEqual(track.at(track.startMs));
  });
});

describe('geometry track over long windows', () => {
  // The readouts show the overhead points to 0.01°. With answers a day apart the curve stays well
  // inside half of that for the whole of the longest window the controls allow.
  it.each([186, 365.25, 395.25])('stays within 0.005° of the mock model across %s days of daily answers', (days) => {
    const track = buildTrack(dailySamples(Math.ceil(days)))!;
    let worst = 0;
    for (let t = T0; t <= T0 + days * DAY_MS; t += 0.5 * HOUR_MS) {
      const got = track.at(t);
      const sun = subsolarPoint(t);
      const earth = subearthPoint(t);
      worst = Math.max(
        worst,
        Math.abs(got.subsolar_lat - sun.lat),
        Math.abs(wrap180(got.subsolar_lon_east - sun.lonEast)),
        Math.abs(got.subearth_lat - earth.lat),
        Math.abs(wrap180(got.subearth_lon_east - earth.lonEast)),
      );
    }
    expect(worst).toBeLessThan(0.005);
  });

  it('is several times worse with answers two days apart, which is why the loader never asks that coarsely', () => {
    const track = buildTrack(dailySamples(186, 2))!;
    let worst = 0;
    for (let t = T0 + DAY_MS; t <= T0 + 180 * DAY_MS; t += HOUR_MS) {
      const got = track.at(t);
      const earth = subearthPoint(t);
      worst = Math.max(worst, Math.abs(got.subearth_lat - earth.lat), Math.abs(wrap180(got.subearth_lon_east - earth.lonEast)));
    }
    expect(worst).toBeGreaterThan(0.005);
  });
});

describe('the part of a track readouts may be taken from', () => {
  const samples = dailySamples(10);
  const valid = { startMs: T0, endMs: T0 + 10 * DAY_MS };

  it('is the whole track when no range was given', () => {
    const track = buildTrack(samples)!;
    expect(track.validStartMs).toBeUndefined();
    expect(trackRange(track)).toEqual({ startMs: track.startMs, endMs: track.endMs });
    expect(trackCovers(track, track.startMs)).toBe(true);
    expect(trackCovers(track, track.endMs)).toBe(true);
    expect(trackCovers(track, track.endMs + HOUR_MS)).toBe(false);
  });

  it('is the given range, without the spare answers at the two ends', () => {
    const track = buildTrack(samples, valid)!;
    expect(track.startMs).toBe(T0 - DAY_MS);
    expect(track.endMs).toBe(T0 + 11 * DAY_MS);
    expect(trackRange(track)).toEqual(valid);
    expect(trackCovers(track, T0)).toBe(true);
    expect(trackCovers(track, T0 + 10 * DAY_MS)).toBe(true);
    // Inside the answers, but in a spare end interval: not covered.
    expect(trackCovers(track, T0 - HOUR_MS)).toBe(false);
    expect(trackCovers(track, T0 + 10 * DAY_MS + HOUR_MS)).toBe(false);
    // A hair of rounding at the edge (the end worked out in two ways) is still the edge.
    expect(trackCovers(track, T0 + 10 * DAY_MS + 0.0005)).toBe(true);
    expect(trackCovers(track, T0 - 0.0005)).toBe(true);
  });

  it('keeps a given range inside the answers', () => {
    const track = buildTrack(samples, { startMs: T0 - 50 * DAY_MS, endMs: T0 + 50 * DAY_MS })!;
    expect(trackRange(track)).toEqual({ startMs: track.startMs, endMs: track.endMs });
    const none = buildTrack(samples, { startMs: Number.NaN, endMs: T0 })!;
    expect(none.validStartMs).toBeUndefined();
  });

  it('never covers a missing or non-finite instant', () => {
    const track = buildTrack(samples, valid)!;
    for (const t of [Number.NaN, Infinity, -Infinity, null]) expect(trackCovers(track, t)).toBe(false);
    expect(trackCovers(null, T0)).toBe(false);
  });
});

describe('answers with a missing value', () => {
  const whole = dailySamples(6);

  it('are left out, so the curve never passes through a non-number', () => {
    const broken: TrackSample[] = whole.map((s, i) => {
      if (i === 2) return { tMs: s.tMs, geometry: { ...s.geometry, subearth_lat: Number.NaN } };
      if (i === 4) return { tMs: s.tMs, geometry: { ...s.geometry, subsolar_lon_east: undefined as unknown as number } };
      if (i === 5) return { tMs: Number.NaN, geometry: s.geometry };
      if (i === 6) return { tMs: s.tMs, geometry: { ...s.geometry, subearth_lon_east: Infinity } };
      return s;
    });
    expect(broken.filter(isWholeSample)).toHaveLength(whole.length - 4);
    const track = buildTrack(broken)!;
    expect(track.samples).toHaveLength(whole.length - 4);
    for (let t = track.startMs; t <= track.endMs; t += 3 * HOUR_MS) {
      for (const v of Object.values(track.at(t))) expect(Number.isFinite(v)).toBe(true);
    }
  });

  it('give no track at all when every answer is broken', () => {
    expect(buildTrack(whole.map((s) => ({ tMs: s.tMs, geometry: { ...s.geometry, subsolar_lat: Number.NaN } })))).toBeNull();
  });
});

describe('Earth swing', () => {
  const track = buildTrack(dailySamples(30), { startMs: T0, endMs: T0 + 30 * DAY_MS })!;

  it('is read inside the valid range only: not from before it, and not past its end', () => {
    // The start is inside the answers but in the spare interval before the valid range.
    expect(earthSwing(track, T0 - 12 * HOUR_MS, T0 + 5 * DAY_MS)).toBeNull();
    expect(earthSwing(track, T0 + 30 * DAY_MS + 12 * HOUR_MS, T0 + 31 * DAY_MS)).toBeNull();
    // An end past the valid range is cut back to it, not read from the spare interval.
    const toEnd = earthSwing(track, T0 + 20 * DAY_MS, T0 + 30 * DAY_MS)!;
    const past = earthSwing(track, T0 + 20 * DAY_MS, T0 + 31 * DAY_MS)!;
    expect(past).toEqual(toEnd);
  });

  it('matches the mock model over a stay', () => {
    const swing = earthSwing(track, T0, T0 + 14 * DAY_MS)!;
    let latMin = Infinity;
    let latMax = -Infinity;
    let lonMin = Infinity;
    let lonMax = -Infinity;
    const centre = subearthPoint(T0).lonEast;
    for (let t = T0; t <= T0 + 14 * DAY_MS; t += 0.25 * HOUR_MS) {
      const p = subearthPoint(t);
      latMin = Math.min(latMin, p.lat);
      latMax = Math.max(latMax, p.lat);
      lonMin = Math.min(lonMin, wrap180(p.lonEast - centre));
      lonMax = Math.max(lonMax, wrap180(p.lonEast - centre));
    }
    expect(Math.abs(swing.latSpan - (latMax - latMin))).toBeLessThan(0.01);
    expect(Math.abs(swing.lonSpan - (lonMax - lonMin))).toBeLessThan(0.01);
  });

  it('gives nothing, and returns at once, for a missing or non-finite instant', () => {
    // A NaN here used to keep the sampling loop running for ever.
    for (const bad of [Number.NaN, Infinity, -Infinity, null]) {
      expect(earthSwing(track, bad, T0 + DAY_MS)).toBeNull();
      expect(earthSwing(track, T0, bad)).toBeNull();
    }
    expect(earthSwing(null, T0, T0 + DAY_MS)).toBeNull();
    // An end before the start is a swing of nothing, not an error.
    expect(earthSwing(track, T0 + DAY_MS, T0)).toMatchObject({ lonSpan: 0, latSpan: 0 });
  });
});

describe('disc lit from Earth', () => {
  it('is full when the Sun and Earth are overhead at the same place, new when opposite', () => {
    expect(discLitFromEarth({ subsolar_lat: 0, subsolar_lon_east: 0, subearth_lat: 0, subearth_lon_east: 0 })).toBeCloseTo(1, 12);
    expect(discLitFromEarth({ subsolar_lat: 0, subsolar_lon_east: 180, subearth_lat: 0, subearth_lon_east: 0 })).toBeCloseTo(0, 12);
    expect(discLitFromEarth({ subsolar_lat: 0, subsolar_lon_east: 90, subearth_lat: 0, subearth_lon_east: 0 })).toBeCloseTo(0.5, 12);
  });
});
