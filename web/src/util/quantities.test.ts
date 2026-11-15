// DATA HONESTY: every sky readout equals what the data layer says for that instant.
// The track is built the way the app builds it (through the API layer, here the mock), and each
// quantity is compared with the mock model asked directly.

import { beforeAll, describe, expect, it } from 'vitest';
import sitesJson from '../api/examples/sites.json';
import { configureMock } from '../api/mock';
import { evaluateSite, geometryAt, horizonFor, TRANSIT_DAYS } from '../api/mock/model';
import type { SiteRef } from '../api/types';
import { clearGeometryCache, loadTrack } from '../state/geometry';
import { azElFromSubpoint, wrap180 } from './geo';
import { nextSunChange, sunAt } from './horizon';
import { DASH, fixed, missionDates, siteQuantities, skyQuantities } from './quantities';
import { DAY_MS, HOUR_MS, LTC_MICROSECONDS_PER_DAY, SYNODIC_MONTH_DAYS } from './time';
import type { GeometryTrack } from './track';

const LAUNCH = Date.UTC(2027, 1, 10, 15, 0, 0);
const LANDING = LAUNCH + TRANSIT_DAYS * DAY_MS;
const site = (id: string) => (sitesJson.sites as SiteRef[]).find((s) => s.id === id)!;

let track: GeometryTrack;
beforeAll(async () => {
  configureMock({ latencyMs: 0, scenario: { mode: 'normal', assistant: 'on' } });
  clearGeometryCache();
  track = await loadTrack(LAUNCH, SYNODIC_MONTH_DAYS);
});

describe('sky readouts come from the data layer', () => {
  it('covers the whole Orbit window', () => {
    expect(track.startMs).toBeLessThanOrEqual(LANDING);
    expect(track.endMs).toBeGreaterThanOrEqual(LANDING + SYNODIC_MONTH_DAYS * DAY_MS);
  });

  it('shows the Sun and Earth overhead points of the mock model, to the shown precision', () => {
    for (const hours of [0, 1, 7.5, 24, 100.25, 333, 700]) {
      const t = LANDING + hours * HOUR_MS;
      const want = geometryAt(t);
      const q = skyQuantities({ track, tMs: t, landingMs: LANDING, site: null, horizon: null });
      expect(Math.abs(q.subsolarLat.value! - want.subsolar_lat)).toBeLessThan(0.03);
      expect(Math.abs(wrap180(q.subsolarLon.value! - want.subsolar_lon_east))).toBeLessThan(0.03);
      expect(Math.abs(q.subearthLat.value! - want.subearth_lat)).toBeLessThan(0.03);
      expect(Math.abs(wrap180(q.subearthLon.value! - want.subearth_lon_east))).toBeLessThan(0.03);
      // The text is the value itself, formatted: nothing else is shown.
      expect(q.subsolarLat.text).toBe(Math.abs(q.subsolarLat.value!).toFixed(2));
      expect(q.subsolarLon.text).toBe(q.subsolarLon.value!.toFixed(2));
      expect(q.subsolarLon.unit).toBe('° E');
      expect(['° N', '° S', '°']).toContain(q.subearthLat.unit);
    }
  });

  it('is exact at the landing, where the track holds the evaluation answer itself', () => {
    const want = geometryAt(LANDING);
    const q = skyQuantities({ track, tMs: LANDING, landingMs: LANDING, site: null, horizon: null });
    expect(q.subsolarLat.value).toBeCloseTo(want.subsolar_lat, 9);
    expect(q.subearthLon.value).toBeCloseTo(want.subearth_lon_east, 9);
  });

  it('shows the Sun at the site from the horizon answer, and Earth from its overhead point', () => {
    const s = site('shackleton-ridge');
    const horizon = horizonFor(s, LANDING, LANDING + SYNODIC_MONTH_DAYS * DAY_MS, 1);
    for (const hours of [0, 12.5, 200, 600]) {
      const t = LANDING + hours * HOUR_MS;
      const q = skyQuantities({ track, tMs: t, landingMs: LANDING, site: s, horizon });
      const sun = sunAt(horizon, t)!;
      expect(q.sunAz.value).toBe(sun.az);
      expect(q.sunEl.value).toBe(sun.el);
      expect(q.sunState.text).toBe(sun.above ? 'lit' : 'dark');
      const g = geometryAt(t);
      const earth = azElFromSubpoint(s.lat, s.lon_east, g.subearth_lat, g.subearth_lon_east);
      expect(Math.abs(wrap180(q.earthAz.value! - earth.az))).toBeLessThan(0.6);
      expect(Math.abs(q.earthEl.value! - earth.el)).toBeLessThan(0.05);
      const change = nextSunChange(horizon, t);
      if (change) {
        expect(q.nextChange.value).toBe(change.hours);
        expect(q.nextChange.text).toBe(change.hours.toFixed(1));
        expect(q.nextChange.unit).toBe('h');
        expect(q.nextChange.label).toBe(change.kind === 'sunrise' ? 'Sunrise in' : 'Sunset in');
      } else {
        expect(q.nextChange.value).toBeNull();
      }
    }
  });

  it('falls back to the Sun’s overhead point when no horizon answer covers the instant', () => {
    const s = site('apollo-11');
    const t = LANDING + 50 * HOUR_MS;
    const q = skyQuantities({ track, tMs: t, landingMs: LANDING, site: s, horizon: null });
    const g = geometryAt(t);
    const sun = azElFromSubpoint(s.lat, s.lon_east, g.subsolar_lat, g.subsolar_lon_east);
    expect(Math.abs(wrap180(q.sunAz.value! - sun.az))).toBeLessThan(0.1);
    expect(Math.abs(q.sunEl.value! - sun.el)).toBeLessThan(0.05);
    // Lit or dark needs the terrain: without a horizon answer it is not guessed.
    expect(q.sunState.text).toBe(DASH);
    expect(q.nextChange.text).toBe(DASH);
  });

  it('runs the clocks from the instant and the landing time only', () => {
    const t = LANDING + 3.25 * DAY_MS;
    const q = skyQuantities({ track, tMs: t, landingMs: LANDING, site: null, horizon: null });
    expect(q.utcClock.text).toBe('2027-02-18 21:00:00');
    expect(q.ltcOffset.value).toBeCloseTo(3.25 * LTC_MICROSECONDS_PER_DAY, 9);
    expect(q.ltcOffset.text).toBe('+182.07');
    expect(q.ltcOffset.unit).toBe('µs');
    expect(q.ltcClock.text).toBe('2027-02-18 21:00:00.000182');
    expect(q.sinceLanding.text).toBe('+3 d 06 h');
  });

  it('shows a dash, never a made-up number, when the data has not arrived', () => {
    const q = skyQuantities({ track: null, tMs: LANDING, landingMs: null, site: site('apollo-11'), horizon: null });
    for (const key of ['subsolarLat', 'subsolarLon', 'subearthLat', 'subearthLon', 'sunAz', 'sunEl', 'earthAz', 'earthEl', 'discLit', 'sunState', 'nextChange', 'ltcClock', 'ltcOffset'] as const) {
      expect(q[key].text).toBe(DASH);
      expect(q[key].value).toBeNull();
      expect(q[key].unit).toBe('');
    }
    // Outside the track the readouts are blank too: the track does not extrapolate into a readout.
    const outside = skyQuantities({ track, tMs: track.endMs + DAY_MS, landingMs: LANDING, site: null, horizon: null });
    expect(outside.subsolarLon.text).toBe(DASH);
  });
});

describe('mission dates and the south pole season', () => {
  it('reads the season from the Sun’s latitude in the evaluation answer', () => {
    const south = missionDates(LAUNCH, 0, LANDING, { subsolar_lat: -1.2, subsolar_lon_east: 10, subearth_lat: 0, subearth_lon_east: 0 });
    expect(south.season).toBe('summer');
    expect(south.seasonLine.text).toBe('summer');
    const north = missionDates(LAUNCH, 0, LANDING, { subsolar_lat: 0.4, subsolar_lon_east: 10, subearth_lat: 0, subearth_lon_east: 0 });
    expect(north.season).toBe('winter');
    expect(missionDates(LAUNCH, 0, null, null).seasonLine.text).toBe(DASH);
  });

  it('shows the launch, the delay and the landing as given', () => {
    const d = missionDates(LAUNCH, 7, LANDING + 7 * DAY_MS, geometryAt(LANDING + 7 * DAY_MS));
    expect(d.plannedLaunch.text).toBe('2027-02-10 15:00');
    expect(d.launch.text).toBe('2027-02-17 15:00');
    expect(d.delay.text).toBe('+7');
    expect(d.delay.unit).toBe('days');
    expect(d.landing.text).toBe('2027-02-22 15:00');
    expect(missionDates(LAUNCH, 1, null, null).delay.unit).toBe('day');
  });
});

describe('site readouts come from the evaluation answer', () => {
  it('shows the evaluation’s own figures', () => {
    const hardware = [
      { id: 'starship', count: 1 },
      { id: 'hab', count: 1 },
      { id: 'rover', count: 1 },
      { id: 'solar', count: 4 },
    ];
    const { evaluation, check } = evaluateSite(site('apollo-14'), LANDING, 14, hardware, 2000);
    const q = siteQuantities(1, evaluation, check);
    expect(q.rank.text).toBe('01');
    expect(q.score.value).toBe(evaluation.score);
    expect(q.score.text).toBe(String(evaluation.score));
    expect(q.sunlightPercent.text).toBe(evaluation.sunlight_percent.toFixed(1));
    expect(q.sunlightHours.value).toBe(evaluation.sunlight_hours);
    expect(q.powerMargin.value).toBe(check.balance.margin_percent);
    expect(q.powerMargin.unit).toBe('%');
    expect(q.verdict.text).toBe('pass');
    expect(q.passes).toBe(true);
  });

  it('names the failed requirement, and says "no supply" when nothing makes power', () => {
    const { evaluation, check } = evaluateSite(site('blue-ghost-m1'), LANDING, 14, [{ id: 'hab', count: 1 }], 0);
    const q = siteQuantities(12, evaluation, check);
    expect(q.verdict.text).toMatch(/^fail: /);
    expect(q.verdict.tone).toBe('bad');
    expect(q.powerMargin.text).toBe('no supply');
    expect(q.powerMargin.value).toBeNull();
    expect(q.powerMargin.unit).toBe('');
    expect(q.rank.text).toBe('12');
  });

  it('is all dashes with no evaluation', () => {
    const q = siteQuantities(null, null);
    expect(q.score.text).toBe(DASH);
    expect(q.verdict.text).toBe(DASH);
    expect(q.passes).toBeNull();
  });
});

describe('number formatting', () => {
  it('uses a true minus sign and never shows a negative zero', () => {
    expect(fixed(-1.234, 2)).toBe('−1.23');
    expect(fixed(-0.001, 1)).toBe('0.0');
    expect(fixed(2, 1)).toBe('2.0');
  });
});
