import { describe, expect, it } from 'vitest';
import { geometryAt } from '../api/mock/model';
import { buildTrack, discLitFromEarth, type TrackSample } from './track';
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

describe('disc lit from Earth', () => {
  it('is full when the Sun and Earth are overhead at the same place, new when opposite', () => {
    expect(discLitFromEarth({ subsolar_lat: 0, subsolar_lon_east: 0, subearth_lat: 0, subearth_lon_east: 0 })).toBeCloseTo(1, 12);
    expect(discLitFromEarth({ subsolar_lat: 0, subsolar_lon_east: 180, subearth_lat: 0, subearth_lon_east: 0 })).toBeCloseTo(0, 12);
    expect(discLitFromEarth({ subsolar_lat: 0, subsolar_lon_east: 90, subearth_lat: 0, subearth_lon_east: 0 })).toBeCloseTo(0.5, 12);
  });
});
