// DATA HONESTY: every sky readout equals what the data layer says for that instant.
// The track is built the way the app builds it (through the API layer, here the mock), and each
// quantity is compared with the mock model asked directly.

import { beforeAll, describe, expect, it } from 'vitest';
import sitesJson from '../api/examples/sites.json';
import { configureMock } from '../api/mock';
import { evaluateSite, geometryAt, horizonFor, subearthPoint, subsolarPoint, TRANSIT_DAYS } from '../api/mock/model';
import type { Geometry, HorizonResponse, SiteRef } from '../api/types';
import { horizonStepHours } from '../state/data';
import { clearGeometryCache, loadTrack } from '../state/geometry';
import { azElFromSubpoint, wrap180 } from './geo';
import { nextSunChange, sunAt, sunPathTimes } from './horizon';
import { DASH, fixed, missionDates, siteQuantities, skyQuantities, swingQuantities, type Quantity } from './quantities';
import { DAY_MS, HOUR_MS, LTC_MICROSECONDS_PER_DAY, SYNODIC_MONTH_DAYS } from './time';
import { buildTrack, type GeometryTrack } from './track';

const LAUNCH = Date.UTC(2027, 1, 10, 15, 0, 0);
const LANDING = LAUNCH + TRANSIT_DAYS * DAY_MS;
const site = (id: string) => (sitesJson.sites as SiteRef[]).find((s) => s.id === id)!;

/** The Sun's direction at a site straight from the mock model, with nothing in between. */
function modelSun(s: SiteRef, tMs: number): { az: number; el: number } {
  const p = subsolarPoint(tMs);
  return azElFromSubpoint(s.lat, s.lon_east, p.lat, p.lonEast);
}

/** Every Quantity in an object of readouts. */
function quantitiesOf(x: object): Quantity[] {
  return Object.values(x).filter((v): v is Quantity => typeof v === 'object' && v !== null && 'key' in v && 'text' in v && 'unit' in v);
}

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
      // Two decimals are shown, so the value must be within half of the last one.
      expect(Math.abs(q.subsolarLat.value! - want.subsolar_lat)).toBeLessThan(0.005);
      expect(Math.abs(wrap180(q.subsolarLon.value! - want.subsolar_lon_east))).toBeLessThan(0.005);
      expect(Math.abs(q.subearthLat.value! - want.subearth_lat)).toBeLessThan(0.005);
      expect(Math.abs(wrap180(q.subearthLon.value! - want.subearth_lon_east))).toBeLessThan(0.005);
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

  it('shows the Sun’s direction from the track, lit or dark from the horizon answer, and Earth from its overhead point', () => {
    const s = site('shackleton-ridge');
    const horizon = horizonFor(s, LANDING, LANDING + SYNODIC_MONTH_DAYS * DAY_MS, 1);
    for (const hours of [0, 12.5, 200, 600]) {
      const t = LANDING + hours * HOUR_MS;
      const q = skyQuantities({ track, tMs: t, landingMs: LANDING, site: s, horizon });
      // The Sun's direction is the model's own, to the tenth of a degree shown.
      const sun = modelSun(s, t);
      expect(Math.abs(wrap180(q.sunAz.value! - sun.az))).toBeLessThan(0.05);
      expect(Math.abs(q.sunEl.value! - sun.el)).toBeLessThan(0.05);
      // Lit or dark needs the terrain: that word is the horizon answer's.
      expect(q.sunState.text).toBe(sunAt(horizon, t)!.above ? 'lit' : 'dark');
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
    expect(q.ltcClock.text).toBe('21:00:00.000182');
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

  it('does not take a readout from the spare answers at the two ends of the track', () => {
    const s = site('apollo-11');
    const end = LANDING + SYNODIC_MONTH_DAYS * DAY_MS;
    expect(track.validStartMs).toBe(LANDING);
    expect(track.validEndMs).toBe(end);
    // The track has answers a day either side of the window, but nothing is read from there.
    for (const t of [LANDING - HOUR_MS, LANDING - 23 * HOUR_MS, end + HOUR_MS, track.endMs]) {
      expect(t).toBeGreaterThanOrEqual(track.startMs);
      expect(t).toBeLessThanOrEqual(track.endMs);
      const q = skyQuantities({ track, tMs: t, landingMs: LANDING, site: s, horizon: null });
      for (const key of ['subsolarLat', 'subsolarLon', 'subearthLat', 'subearthLon', 'sunAz', 'sunEl', 'earthAz', 'earthEl', 'discLit'] as const) {
        expect(q[key].text).toBe(DASH);
        expect(q[key].value).toBeNull();
      }
      expect(q.geometry).toBeNull();
    }
    // The two ends of the window themselves are read.
    for (const t of [LANDING, end]) {
      const q = skyQuantities({ track, tMs: t, landingMs: LANDING, site: s, horizon: null });
      expect(q.subearthLon.value).not.toBeNull();
      expect(q.sunEl.value).not.toBeNull();
    }
    // Nor is the swing over a stay read from before the window.
    expect(swingQuantities(track, LANDING - HOUR_MS, LANDING + 14 * DAY_MS).lon.text).toBe(DASH);
  });
});

describe('long windows: a 365.25-day stay after a 30-day delay is the longest the controls allow', () => {
  it.each([186, 365.25, 395])('shows Earth’s and the Sun’s overhead points of the mock model to the two decimals shown, across %s days', async (days) => {
    const long = await loadTrack(LAUNCH, days);
    const s = site('apollo-11');
    let worstPoint = 0;
    let worstEarthEl = 0;
    let worstEarthAz = 0;
    for (let t = LANDING; t <= LANDING + days * DAY_MS; t += 1.7 * HOUR_MS) {
      const q = skyQuantities({ track: long, tMs: t, landingMs: LANDING, site: s, horizon: null });
      const sun = subsolarPoint(t);
      const earth = subearthPoint(t);
      worstPoint = Math.max(
        worstPoint,
        Math.abs(q.subsolarLat.value! - sun.lat),
        Math.abs(wrap180(q.subsolarLon.value! - sun.lonEast)),
        Math.abs(q.subearthLat.value! - earth.lat),
        Math.abs(wrap180(q.subearthLon.value! - earth.lonEast)),
      );
      const dir = azElFromSubpoint(s.lat, s.lon_east, earth.lat, earth.lonEast);
      worstEarthEl = Math.max(worstEarthEl, Math.abs(q.earthEl.value! - dir.el));
      worstEarthAz = Math.max(worstEarthAz, Math.abs(wrap180(q.earthAz.value! - dir.az)));
    }
    expect(worstPoint).toBeLessThan(0.005);
    // Earth's direction is shown to one decimal.
    expect(worstEarthEl).toBeLessThan(0.05);
    expect(worstEarthAz).toBeLessThan(0.05);
  });

  // Apollo 11 is near the equator: the Sun passes almost straight overhead and straight underfoot,
  // which is where a straight line between coarse horizon samples is furthest from the truth.
  it.each([90, 365.25])('shows the Sun’s direction of the mock model to 0.05° across %s days, whatever the horizon sample spacing', async (days) => {
    const s = site('apollo-11');
    const long = await loadTrack(LAUNCH, days);
    const end = LANDING + days * DAY_MS;
    // The horizon answer as the app asks for it now, and as it used to (about 600 points: samples
    // 3.5 h apart at 90 days and 14.5 h apart at 365.25 days).
    const asked = horizonFor(s, LANDING, end, horizonStepHours(LANDING, end));
    const coarse = horizonFor(s, LANDING, end, Math.round(((days * 24) / 600) * 4) / 4);
    let worstEl = 0;
    let worstAz = 0;
    let worstCoarseLine = 0;
    for (let t = LANDING; t <= end; t += 0.61 * HOUR_MS) {
      const want = modelSun(s, t);
      for (const horizon of [asked, coarse, null]) {
        const q = skyQuantities({ track: long, tMs: t, landingMs: LANDING, site: s, horizon });
        worstEl = Math.max(worstEl, Math.abs(q.sunEl.value! - want.el));
        // Azimuth has no meaning with the Sun at the zenith or the nadir; it is compared away from them.
        if (Math.abs(want.el) < 85) worstAz = Math.max(worstAz, Math.abs(wrap180(q.sunAz.value! - want.az)));
      }
      worstCoarseLine = Math.max(worstCoarseLine, Math.abs(sunAt(coarse, t)!.el - want.el));
    }
    expect(worstEl).toBeLessThan(0.05);
    expect(worstAz).toBeLessThan(0.05);
    // What the readout used to show, the straight line between the coarse samples, is far outside
    // that: this test would notice if the horizon answer were preferred again.
    expect(worstCoarseLine).toBeGreaterThan(0.3);
  });

  it('keeps lit or dark and the next sunrise or sunset from the horizon answer when the direction comes from the track', async () => {
    const s = site('shackleton-ridge');
    const long = await loadTrack(LAUNCH, 90);
    const end = LANDING + 90 * DAY_MS;
    const horizon = horizonFor(s, LANDING, end, horizonStepHours(LANDING, end));
    for (const hours of [3.3, 250.5, 1000, 2100.25]) {
      const t = LANDING + hours * HOUR_MS;
      const q = skyQuantities({ track: long, tMs: t, landingMs: LANDING, site: s, horizon });
      expect(q.sunState.text).toBe(sunAt(horizon, t)!.above ? 'lit' : 'dark');
      expect(q.change).toEqual(nextSunChange(horizon, t));
    }
  });
});

describe('the Sun’s direction with no track', () => {
  const s = site('apollo-11');
  const end = LANDING + 90 * DAY_MS;

  it('comes from the horizon answer only where its samples vouch for the tenth of a degree shown', () => {
    const fine = horizonFor(s, LANDING, end, 0.25);
    const coarse = horizonFor(s, LANDING, end, 3.5);
    let shownFine = 0;
    let shownCoarse = 0;
    let blankCoarse = 0;
    for (let t = LANDING + HOUR_MS; t < end; t += 5.3 * HOUR_MS) {
      const want = modelSun(s, t);
      for (const horizon of [fine, coarse]) {
        const q = skyQuantities({ track: null, tMs: t, landingMs: LANDING, site: s, horizon });
        const line = sunAt(horizon, t)!;
        if (q.sunEl.value === null) {
          // Blank, never a doubtful figure; azimuth and elevation go together.
          expect(q.sunEl.text).toBe(DASH);
          expect(q.sunAz.text).toBe(DASH);
          expect(line.uncertaintyDeg).toBeGreaterThan(0.05);
          if (horizon === coarse) blankCoarse++;
        } else {
          expect(q.sunEl.value).toBe(line.el);
          expect(q.sunAz.value).toBe(line.az);
          expect(Math.abs(q.sunEl.value - want.el)).toBeLessThan(0.05);
          if (horizon === fine) shownFine++;
          else shownCoarse++;
        }
        // Lit or dark does not depend on any of this.
        expect(q.sunState.text).toBe(line.above ? 'lit' : 'dark');
      }
    }
    expect(shownFine).toBeGreaterThan(300);
    expect(shownCoarse).toBeGreaterThan(0);
    expect(blankCoarse).toBeGreaterThan(0);
  });

  it('is blank where a track exists but does not cover the instant: the horizon answer does not stand in', () => {
    const horizon = horizonFor(s, LANDING - DAY_MS, end, 0.25);
    const t = LANDING - 6 * HOUR_MS;
    expect(sunAt(horizon, t)!.uncertaintyDeg).toBeLessThan(0.05);
    const q = skyQuantities({ track, tMs: t, landingMs: LANDING, site: s, horizon });
    expect(q.sunEl.text).toBe(DASH);
    expect(q.sunAz.text).toBe(DASH);
    expect(q.sunState.text).not.toBe(DASH);
  });
});

describe('how finely the next sunrise or sunset is shown', () => {
  const s = site('shackleton-ridge');

  /** The first instant, on an hour mark after the landing, that has a change ahead of it. */
  function withChangeAhead(horizon: HorizonResponse): number {
    for (let t = LANDING + 0.5 * HOUR_MS; ; t += HOUR_MS) if (nextSunChange(horizon, t)) return t;
  }

  it('shows one decimal when the horizon samples around the change are an hour apart or closer', () => {
    for (const stepHours of [0.25, 1]) {
      const horizon = horizonFor(s, LANDING, LANDING + 90 * DAY_MS, stepHours);
      const t = withChangeAhead(horizon);
      const change = nextSunChange(horizon, t)!;
      expect(change.sampleGapHours).toBeLessThanOrEqual(1);
      const q = skyQuantities({ track: null, tMs: t, landingMs: LANDING, site: s, horizon });
      expect(q.nextChange.label).toBe(change.kind === 'sunrise' ? 'Sunrise in' : 'Sunset in');
      expect(q.nextChange.text).toBe(change.hours.toFixed(1));
      expect(q.nextChange.text).toMatch(/^\d+\.\d$/);
      expect(q.nextChange.unit).toBe('h');
      expect(q.nextChange.value).toBe(change.hours);
    }
  });

  it('shows whole hours and says "about" when the samples are further apart', () => {
    for (const stepHours of [1.25, 4, 14.5]) {
      const horizon = horizonFor(s, LANDING, LANDING + 365.25 * DAY_MS, stepHours);
      const t = withChangeAhead(horizon);
      const change = nextSunChange(horizon, t)!;
      expect(change.sampleGapHours).toBeGreaterThan(1);
      const q = skyQuantities({ track: null, tMs: t, landingMs: LANDING, site: s, horizon });
      expect(q.nextChange.label).toBe(change.kind === 'sunrise' ? 'Sunrise in about' : 'Sunset in about');
      expect(q.nextChange.text).toBe(String(Math.round(change.hours)));
      expect(q.nextChange.text).toMatch(/^\d+$/);
      expect(q.nextChange.unit).toBe('h');
      expect(q.nextChange.value).toBe(change.hours);
    }
  });

  it('uses the decimal for the app’s own request up to a 112-day window, and whole hours beyond', () => {
    for (const [days, fine] of [
      [14, true],
      [SYNODIC_MONTH_DAYS, true],
      [90, true],
      [112, true],
      [180, false],
      [395.25, false],
    ] as const) {
      const end = LANDING + days * DAY_MS;
      const horizon = horizonFor(s, LANDING, end, horizonStepHours(LANDING, end));
      const q = skyQuantities({ track: null, tMs: withChangeAhead(horizon), landingMs: LANDING, site: s, horizon });
      expect(q.nextChange.label.endsWith('about')).toBe(!fine);
      expect(q.nextChange.text.includes('.')).toBe(fine);
    }
  });

  it('says "about" when the words change between two samples but the heights do not cross the skyline', () => {
    const horizon = horizonFor(s, LANDING, LANDING + 30 * DAY_MS, 0.25);
    const times = sunPathTimes(horizon);
    const i = horizon.sun_path.findIndex((p, k) => k + 1 < horizon.sun_path.length && p.state !== horizon.sun_path[k + 1].state);
    const odd: HorizonResponse = { ...horizon, sun_path: horizon.sun_path.map((p, k) => (k === i || k === i + 1 ? { ...p, el: 60 } : p)) };
    const q = skyQuantities({ track: null, tMs: times[i] - 10.2 * HOUR_MS, landingMs: LANDING, site: s, horizon: odd });
    // The change is only known to lie between the two samples, so no tenth of an hour is claimed.
    expect(q.nextChange.label).toMatch(/ in about$/);
    expect(q.nextChange.text).toBe('10');
  });
});

describe('a missing or non-finite time or value is a dash, never "NaN"', () => {
  const s = site('apollo-11');
  const clean = (qs: Quantity[]) => {
    for (const q of qs) {
      expect(`${q.label} ${q.text} ${q.unit}`).not.toMatch(/NaN|Infinity|undefined|null/);
      if (q.value !== null) expect(Number.isFinite(q.value)).toBe(true);
    }
  };

  it('blanks every readout that needs the instant when the instant is not a real time', () => {
    const horizon = horizonFor(s, LANDING, LANDING + SYNODIC_MONTH_DAYS * DAY_MS, 1);
    for (const tMs of [Number.NaN, Infinity, -Infinity, 9e15, undefined as unknown as number]) {
      const q = skyQuantities({ track, tMs, landingMs: LANDING, site: s, horizon });
      clean(quantitiesOf(q));
      for (const item of quantitiesOf(q)) {
        expect(item.text).toBe(DASH);
        expect(item.value).toBeNull();
      }
      expect(q.geometry).toBeNull();
      expect(q.utc).toBeNull();
      expect(q.ltc).toBeNull();
      expect(q.change).toBeNull();
    }
  });

  it('blanks the clocks that count from the landing when the landing time is not a real time', () => {
    // Date.parse of a missing or unreadable landing_utc gives NaN, not null.
    for (const landingMs of [Number.NaN, Infinity, Date.parse('not a time'), undefined as unknown as number]) {
      const q = skyQuantities({ track, tMs: LANDING + HOUR_MS, landingMs, site: s, horizon: null });
      clean(quantitiesOf(q));
      for (const key of ['ltcClock', 'ltcOffset', 'sinceLanding'] as const) {
        expect(q[key].text).toBe(DASH);
        expect(q[key].value).toBeNull();
      }
      expect(q.ltc).toBeNull();
      // What does not need the landing is still shown.
      expect(q.utcClock.text).toBe('2027-02-15 16:00:00');
      expect(q.subsolarLon.value).not.toBeNull();
    }
  });

  it('blanks the geometry readouts when the track gives a value that is not a number', () => {
    const real = track.at(LANDING);
    for (const hole of ['subsolar_lat', 'subsolar_lon_east', 'subearth_lat', 'subearth_lon_east'] as const) {
      for (const bad of [Number.NaN, Infinity, undefined as unknown as number]) {
        const broken: GeometryTrack = { ...track, at: () => ({ ...real, [hole]: bad }) as Geometry };
        const q = skyQuantities({ track: broken, tMs: LANDING, landingMs: LANDING, site: s, horizon: null });
        clean(quantitiesOf(q));
        for (const key of ['subsolarLat', 'subsolarLon', 'subearthLat', 'subearthLon', 'sunAz', 'sunEl', 'earthAz', 'earthEl', 'discLit'] as const) {
          expect(q[key].text).toBe(DASH);
        }
        expect(q.geometry).toBeNull();
        clean(quantitiesOf(swingQuantities(broken, LANDING, LANDING + DAY_MS)));
      }
    }
  });

  it('leaves an answer with a missing value out of the track, so the readouts beside it stay real', () => {
    const answers = track.samples.map((a, i) => (i === 5 ? { tMs: a.tMs, geometry: { ...a.geometry, subearth_lat: Number.NaN } } : a));
    const holed = buildTrack(answers)!;
    for (let t = holed.startMs; t <= holed.endMs; t += 5 * HOUR_MS) {
      clean(quantitiesOf(skyQuantities({ track: holed, tMs: t, landingMs: LANDING, site: s, horizon: null })));
    }
  });

  it('blanks a site direction when the site’s own coordinates are not numbers', () => {
    const lost: SiteRef = { ...s, lat: Number.NaN };
    const q = skyQuantities({ track, tMs: LANDING, landingMs: LANDING, site: lost, horizon: null });
    clean(quantitiesOf(q));
    expect(q.sunEl.text).toBe(DASH);
    expect(q.earthAz.text).toBe(DASH);
    // The overhead points do not depend on the site.
    expect(q.subsolarLat.value).not.toBeNull();
  });

  it('blanks the swing when either end of the stay is not a real time', () => {
    for (const bad of [Number.NaN, Infinity, -Infinity]) {
      for (const swing of [swingQuantities(track, bad, LANDING + DAY_MS), swingQuantities(track, LANDING, bad)]) {
        clean(quantitiesOf(swing));
        expect(swing.lon.text).toBe(DASH);
        expect(swing.lat.text).toBe(DASH);
      }
    }
  });

  it('blanks a mission date that is not a real time, and gives no season without the Sun’s latitude', () => {
    const g = geometryAt(LANDING);
    const noLanding = missionDates(LAUNCH, 3, Number.NaN, g);
    clean(quantitiesOf(noLanding));
    expect(noLanding.landing.text).toBe(DASH);
    expect(noLanding.launch.text).toBe('2027-02-13 15:00');

    const noLaunch = missionDates(Number.NaN, 3, LANDING, g);
    clean(quantitiesOf(noLaunch));
    expect(noLaunch.plannedLaunch.text).toBe(DASH);
    expect(noLaunch.launch.text).toBe(DASH);
    expect(noLaunch.delay.text).toBe('+3');
    expect(noLaunch.landing.text).toBe('2027-02-15 15:00');

    const noDelay = missionDates(LAUNCH, Number.NaN, LANDING, g);
    clean(quantitiesOf(noDelay));
    expect(noDelay.delay.text).toBe(DASH);
    expect(noDelay.launch.text).toBe(DASH);
    expect(noDelay.plannedLaunch.text).toBe('2027-02-10 15:00');

    // A missing subsolar_lat used to read as "winter".
    for (const lat of [Number.NaN, Infinity, undefined as unknown as number, null as unknown as number]) {
      const d = missionDates(LAUNCH, 0, LANDING, { ...g, subsolar_lat: lat });
      expect(d.season).toBeNull();
      expect(d.seasonLine.text).toBe(DASH);
      expect(d.seasonLine.value).toBeNull();
    }
    // A real latitude still gives its season, zero included.
    expect(missionDates(LAUNCH, 0, LANDING, { ...g, subsolar_lat: -0.3 }).season).toBe('summer');
    expect(missionDates(LAUNCH, 0, LANDING, { ...g, subsolar_lat: 0 }).season).toBe('winter');
  });
});

describe('Earth swing over the stay', () => {
  it('is the range of the mock model’s Earth overhead point, sampled across the stay', () => {
    const stayEnd = LANDING + 14 * DAY_MS;
    let lonMin = Infinity;
    let lonMax = -Infinity;
    let latMin = Infinity;
    let latMax = -Infinity;
    const centre = geometryAt(LANDING).subearth_lon_east;
    for (let t = LANDING; t <= stayEnd; t += HOUR_MS) {
      const g = geometryAt(t);
      const d = wrap180(g.subearth_lon_east - centre);
      lonMin = Math.min(lonMin, d);
      lonMax = Math.max(lonMax, d);
      latMin = Math.min(latMin, g.subearth_lat);
      latMax = Math.max(latMax, g.subearth_lat);
    }
    const q = swingQuantities(track, LANDING, stayEnd);
    expect(Math.abs(q.lon.value! - (lonMax - lonMin))).toBeLessThan(0.15);
    expect(Math.abs(q.lat.value! - (latMax - latMin))).toBeLessThan(0.15);
    expect(q.lon.text).toBe(q.lon.value!.toFixed(2));
    expect(q.lon.unit).toBe('°');
    // A small range: Earth stays near one place in the Moon's sky.
    expect(q.lon.value!).toBeLessThan(20);
    expect(swingQuantities(null, LANDING, stayEnd).lon.text).toBe(DASH);
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
