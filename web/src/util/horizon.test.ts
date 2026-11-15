import { describe, expect, it } from 'vitest';
import sitesJson from '../api/examples/sites.json';
import { horizonFor, skylineFor, subsolarPoint } from '../api/mock/model';
import type { HorizonResponse, SiteRef } from '../api/types';
import { horizonStepHours } from '../state/data';
import { azElFromSubpoint, sampleProfile, wrap180 } from './geo';
import { litPeriods, naturalElRange, nextSunChange, sunAt, sunPathTimes } from './horizon';
import { DAY_MS, HOUR_MS } from './time';

const site = (id: string) => (sitesJson.sites as SiteRef[]).find((s) => s.id === id)!;
const T0 = Date.UTC(2027, 1, 15, 15, 0, 0);
const month = (id: string): HorizonResponse => horizonFor(site(id), T0, T0 + 29.53 * DAY_MS, 1);

describe('reading a horizon answer', () => {
  const h = month('apollo-11');
  const times = sunPathTimes(h);

  it('gives the sample itself at a sample time, with the answer’s own lit or dark word', () => {
    for (const i of [0, 10, 200, h.sun_path.length - 1]) {
      const p = h.sun_path[i];
      const s = sunAt(h, times[i])!;
      expect(s.az).toBeCloseTo(p.az, 6);
      expect(s.el).toBeCloseTo(p.el, 6);
    }
    // Away from a sunrise or sunset the word matches the neighbouring samples.
    for (let i = 1; i + 1 < h.sun_path.length; i++) {
      if (h.sun_path[i - 1].state === h.sun_path[i].state && h.sun_path[i].state === h.sun_path[i + 1].state) {
        expect(sunAt(h, times[i])!.above).toBe(h.sun_path[i].state === 'above');
      }
    }
  });

  it('finds the next sunrise or sunset between the two samples whose words differ', () => {
    let checked = 0;
    for (let i = 0; i + 1 < h.sun_path.length; i++) {
      if (h.sun_path[i].state === h.sun_path[i + 1].state) continue;
      const change = nextSunChange(h, times[i] - 5 * HOUR_MS)!;
      expect(change.kind).toBe(h.sun_path[i + 1].state === 'above' ? 'sunrise' : 'sunset');
      expect(change.atMs).toBeGreaterThanOrEqual(times[i]);
      expect(change.atMs).toBeLessThanOrEqual(times[i + 1]);
      expect(change.hours).toBeCloseTo((change.atMs - (times[i] - 5 * HOUR_MS)) / HOUR_MS, 9);
      checked++;
    }
    // Near the equator the Sun rises and sets once each in a lunar day.
    expect(checked).toBeGreaterThanOrEqual(2);
    expect(nextSunChange(h, times[times.length - 1])).toBeNull();
  });

  it('splits the window into lit and dark periods that join end to end', () => {
    const periods = litPeriods(h);
    expect(periods[0].start).toBe(times[0]);
    expect(periods[periods.length - 1].end).toBe(times[times.length - 1]);
    for (let i = 1; i < periods.length; i++) {
      expect(periods[i].start).toBe(periods[i - 1].end);
      expect(periods[i].lit).toBe(!periods[i - 1].lit);
    }
    // The middle of each period agrees with the Sun's state there.
    for (const p of periods) expect(sunAt(h, (p.start + p.end) / 2)!.above).toBe(p.lit);
  });

  it('reports no change when the answer has no sunrise or sunset', () => {
    const allLit: HorizonResponse = { ...h, sun_path: h.sun_path.map((p) => ({ ...p, state: 'above' as const })) };
    expect(nextSunChange(allLit, times[0])).toBeNull();
    expect(litPeriods(allLit)).toEqual([{ start: times[0], end: times[times.length - 1], lit: true }]);
    expect(sunAt({ ...h, sun_path: [] }, T0)).toBeNull();
    expect(litPeriods({ ...h, sun_path: [] })).toEqual([]);
  });

  it('picks a height range that holds the terrain and Earth', () => {
    const r = naturalElRange(h);
    expect(r.min).toBeLessThanOrEqual(-2);
    expect(r.max).toBeGreaterThanOrEqual(Math.max(...h.skyline.map((p) => p.el)));
    if (h.earth_box) expect(r.max).toBeGreaterThanOrEqual(h.earth_box.el_max);
  });
});

describe('how finely a reading is known', () => {
  const h = month('apollo-11');
  const times = sunPathTimes(h);

  it('gives the end sample itself, with nothing to doubt, at either end of the path', () => {
    expect(sunAt(h, times[0])!.uncertaintyDeg).toBe(0);
    expect(sunAt(h, times[times.length - 1])!.uncertaintyDeg).toBe(0);
    // Two samples only: no neighbour to judge the bend by, so the line between them is not vouched for.
    const two: HorizonResponse = { ...h, sun_path: h.sun_path.slice(0, 2) };
    expect(sunAt(two, (times[0] + times[1]) / 2)!.uncertaintyDeg).toBe(Infinity);
  });

  // Every preset site, at the sample spacings the app asks for and at coarser ones: wherever the
  // reader says its straight line is good to 0.05°, it is, against the mock model itself.
  it.each([
    [29.53, 0.25],
    [90, 1],
    [90, 3.5],
    [365.25, 3.75],
    [365.25, 14.5],
  ])('vouches for the Sun’s position only where the straight line is within 0.05° (%s days, samples %s h apart)', (days, stepHours) => {
    let vouched = 0;
    let doubted = 0;
    for (const s of sitesJson.sites as SiteRef[]) {
      const answer = horizonFor(s, T0, T0 + days * DAY_MS, stepHours);
      for (let t = T0; t <= T0 + days * DAY_MS; t += 0.71 * stepHours * HOUR_MS) {
        const got = sunAt(answer, t)!;
        if (got.uncertaintyDeg > 0.05) {
          doubted++;
          continue;
        }
        vouched++;
        const p = subsolarPoint(t);
        const want = azElFromSubpoint(s.lat, s.lon_east, p.lat, p.lonEast);
        expect(Math.abs(got.el - want.el)).toBeLessThan(0.05);
        expect(Math.abs(wrap180(got.az - want.az))).toBeLessThan(0.05);
      }
    }
    expect(vouched).toBeGreaterThan(0);
    // Fine samples are vouched for nearly everywhere; coarse ones are doubted where the path bends.
    if (stepHours <= 0.25) expect(doubted / (vouched + doubted)).toBeLessThan(0.02);
    if (stepHours >= 3.5) expect(doubted).toBeGreaterThan(0);
  });

  it('doubts the straight line where the Sun passes almost overhead between coarse samples', () => {
    // Apollo 11 is near the equator. With samples 3.5 h apart the line is up to half a degree out
    // near the top of the Sun's path, and the reader says so there.
    const s = site('apollo-11');
    const coarse = horizonFor(s, T0, T0 + 90 * DAY_MS, 3.5);
    let worstError = 0;
    let uncertaintyThere = 0;
    for (let t = T0; t <= T0 + 90 * DAY_MS; t += 0.25 * HOUR_MS) {
      const p = subsolarPoint(t);
      const error = Math.abs(sunAt(coarse, t)!.el - azElFromSubpoint(s.lat, s.lon_east, p.lat, p.lonEast).el);
      if (error > worstError) {
        worstError = error;
        uncertaintyThere = sunAt(coarse, t)!.uncertaintyDeg;
      }
    }
    expect(worstError).toBeGreaterThan(0.3);
    expect(uncertaintyThere).toBeGreaterThanOrEqual(worstError);
  });

  it('says how far apart the samples around a sunrise or sunset are', () => {
    const change = nextSunChange(h, times[0])!;
    expect(change.sampleGapHours).toBeCloseTo(1, 2);
    expect(change.interpolated).toBe(true);
    const coarse = horizonFor(site('apollo-11'), T0, T0 + 29.53 * DAY_MS, 6);
    const coarseChange = nextSunChange(coarse, T0)!;
    expect(coarseChange.sampleGapHours).toBeGreaterThan(5.9);
    expect(coarseChange.sampleGapHours).toBeLessThan(6.1);
  });

  it('marks a change as not interpolated when the heights do not cross the skyline between the samples', () => {
    const i = h.sun_path.findIndex((p, k) => k + 1 < h.sun_path.length && p.state !== h.sun_path[k + 1].state);
    // The words still change between sample i and the next, but both heights are far above the terrain.
    const odd: HorizonResponse = { ...h, sun_path: h.sun_path.map((p, k) => (k === i || k === i + 1 ? { ...p, el: 60 } : p)) };
    const change = nextSunChange(odd, times[i] - HOUR_MS)!;
    expect(change.interpolated).toBe(false);
    // Placed mid-way: all that is known is that it lies between the two samples.
    expect(change.atMs).toBe((times[i] + times[i + 1]) / 2);
    expect(change.sampleGapHours).toBeCloseTo(1, 2);
  });
});

describe('a horizon answer with a missing value', () => {
  // Shackleton ridge has several sunrises and sunsets in a month.
  const h = month('shackleton-ridge');
  const times = sunPathTimes(h);
  const i = h.sun_path.findIndex((p, k) => k + 1 < h.sun_path.length && p.state !== h.sun_path[k + 1].state);
  const before = h.sun_path[i].state === 'above';

  it('does not throw when a sample beside a sunrise or sunset has no direction: the change is placed mid-way', () => {
    // A missing azimuth here used to throw while looking up the skyline, and took the readouts with it.
    for (const k of [i, i + 1]) {
      for (const field of ['az', 'el'] as const) {
        for (const bad of [Number.NaN, Infinity, undefined, null]) {
          const broken: HorizonResponse = { ...h, sun_path: h.sun_path.map((p, n) => (n === k ? { ...p, [field]: bad as unknown as number } : p)) };
          const change = nextSunChange(broken, times[i] - HOUR_MS)!;
          expect(change.kind).toBe(before ? 'sunset' : 'sunrise');
          // No crossing can be read off a sample without a direction.
          expect(change.interpolated).toBe(false);
          expect(change.atMs).toBe((times[i] + times[i + 1]) / 2);
          // The words either side of the change are still the answer's own.
          expect(sunAt(broken, times[i] - HOUR_MS)!.above).toBe(before);
          expect(sunAt(broken, times[i + 1])!.above).toBe(!before);
          // A position read beside the broken sample is not vouched for.
          const beside = sunAt(broken, (times[k] + times[k + 1]) / 2)!;
          expect(Number.isFinite(beside.az) && Number.isFinite(beside.el) && beside.uncertaintyDeg <= 0.05).toBe(false);
        }
      }
    }
  });

  it('reads no crossing off an answer without a skyline', () => {
    for (const skyline of [[], undefined as unknown as HorizonResponse['skyline']]) {
      const bare: HorizonResponse = { ...h, skyline };
      const change = nextSunChange(bare, times[i] - HOUR_MS)!;
      expect(change.interpolated).toBe(false);
      expect(change.atMs).toBe((times[i] + times[i + 1]) / 2);
    }
  });

  it('leaves out a sample whose time cannot be read, and places a change beside it between its readable neighbours', () => {
    for (const k of [i, i + 1]) {
      for (const bad of ['not a time', '', undefined, null]) {
        const broken: HorizonResponse = { ...h, sun_path: h.sun_path.map((p, n) => (n === k ? { ...p, t: bad as unknown as string } : p)) };
        expect(sunPathTimes(broken)).toHaveLength(h.sun_path.length - 1);
        for (const t of sunPathTimes(broken)) expect(Number.isFinite(t)).toBe(true);
        const change = nextSunChange(broken, times[i - 1] - HOUR_MS)!;
        expect(change.kind).toBe(before ? 'sunset' : 'sunrise');
        // Somewhere between the readable samples around it, which are now two steps apart.
        expect(change.atMs).toBeGreaterThanOrEqual(times[k - 1]);
        expect(change.atMs).toBeLessThanOrEqual(times[k + 1]);
        expect(change.sampleGapHours).toBeCloseTo(2, 2);
        // An unreadable time used to flip the lit or dark word for every instant before the change.
        expect(sunAt(broken, times[0])!.above).toBe(h.sun_path[0].state === 'above');
        expect(sunAt(broken, times[i - 1])!.above).toBe(before);
        expect(sunAt(broken, times[i + 2])!.above).toBe(!before);
        for (const p of litPeriods(broken)) expect(Number.isFinite(p.start) && Number.isFinite(p.end)).toBe(true);
      }
    }
    // No readable sample at all is no path.
    const none: HorizonResponse = { ...h, sun_path: h.sun_path.map((p) => ({ ...p, t: 'not a time' })) };
    expect(sunAt(none, times[0])).toBeNull();
    expect(nextSunChange(none, times[0])).toBeNull();
    expect(litPeriods(none)).toEqual([]);
  });
});

describe('the horizon answer the app asks for', () => {
  const stay = (days: number) => horizonStepHours(T0, T0 + days * DAY_MS);
  const points = (days: number) => (days * 24) / stay(days);

  it('asks for about 2400 points, in quarter hours, never finer than 15 minutes', () => {
    expect(stay(1)).toBe(0.25);
    expect(stay(14)).toBe(0.25);
    expect(stay(29.53)).toBe(0.25);
    expect(stay(90)).toBe(1);
    expect(stay(365.25)).toBe(3.75);
    expect(stay(395.25)).toBe(4);
    for (const days of [30, 45, 60, 90, 120, 180, 270, 365.25, 395.25]) {
      expect((stay(days) * 4) % 1).toBe(0);
      expect(points(days)).toBeGreaterThan(1800);
      // The mock model answers with at most 4000 points; staying under it keeps the spacing asked for.
      expect(points(days)).toBeLessThan(4000);
    }
    // Every window from the shortest stay to the longest stays under that limit.
    for (let days = 1; days <= 395.25; days += 0.25) expect(points(days)).toBeLessThan(4000);
  });

  it('keeps samples an hour apart or closer for windows up to 112 days, and 4 hours at the longest', () => {
    for (let days = 1; days <= 112; days += 0.25) expect(stay(days)).toBeLessThanOrEqual(1);
    for (let days = 113; days <= 395.25; days += 0.25) {
      expect(stay(days)).toBeGreaterThan(1);
      expect(stay(days)).toBeLessThanOrEqual(4);
    }
  });

  // The real changes of the mock model, found without the horizon answer: a 3-minute scan of the
  // Sun's height above the skyline, then bisection.
  function modelChanges(s: SiteRef, startMs: number, endMs: number): number[] {
    const skyline = skylineFor(s);
    const above = (t: number) => {
      const p = subsolarPoint(t);
      const sun = azElFromSubpoint(s.lat, s.lon_east, p.lat, p.lonEast);
      return sun.el > sampleProfile(skyline, sun.az);
    };
    const out: number[] = [];
    const dt = 3 * 60_000;
    let prev = above(startMs);
    for (let t = startMs + dt; t <= endMs; t += dt) {
      const cur = above(t);
      if (cur !== prev) {
        let lo = t - dt;
        let hi = t;
        for (let k = 0; k < 24; k++) {
          const mid = (lo + hi) / 2;
          if (above(mid) === prev) lo = mid;
          else hi = mid;
        }
        out.push((lo + hi) / 2);
      }
      prev = cur;
    }
    return out;
  }

  /** Worst distance, in hours, from a change the reader places to the nearest real change. */
  function worstPlacementHours(id: string, days: number): number {
    const s = site(id);
    const end = T0 + days * DAY_MS;
    const real = modelChanges(s, T0, end);
    const placed = litPeriods(horizonFor(s, T0, end, stay(days))).slice(1).map((p) => p.start);
    expect(placed.length).toBeGreaterThan(0);
    let worst = 0;
    for (const t of placed) worst = Math.max(worst, Math.min(...real.map((r) => Math.abs(r - t))) / HOUR_MS);
    return worst;
  }

  // Shackleton ridge is the hard case: near the pole the Sun grazes the skyline.
  it.each([14, 29.53, 90])('places each sunrise and sunset within 0.05 h of the mock model for a %s-day window (shown to 0.1 h)', (days) => {
    expect(stay(days)).toBeLessThanOrEqual(1);
    expect(worstPlacementHours('shackleton-ridge', days)).toBeLessThan(0.05);
    expect(worstPlacementHours('apollo-11', days)).toBeLessThan(0.05);
  });

  it.each([180, 365.25, 395.25])('places them within half an hour for a %s-day window (shown in whole hours, as "about")', (days) => {
    expect(stay(days)).toBeGreaterThan(1);
    expect(worstPlacementHours('shackleton-ridge', days)).toBeLessThan(0.5);
    expect(worstPlacementHours('apollo-11', days)).toBeLessThan(0.5);
  });
});
