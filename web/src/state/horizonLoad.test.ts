// The horizon answer as the app asks for it: samples never more than an hour apart, whatever the
// length of the window, so the lit and dark periods and the next sunrise or sunset are those of the
// model for the longest stays too. Checked against the example (mock) model for every preset site.

import { beforeAll, describe, expect, it, vi } from 'vitest';
import { api } from '../api/client';
import sitesJson from '../api/examples/sites.json';
import { configureMock } from '../api/mock';
import { horizonFor, MOCK_PROVENANCE, skylineFor, subsolarPoint, TRANSIT_DAYS } from '../api/mock/model';
import type { DataProvenance, HorizonResponse, SiteRef } from '../api/types';
import { azElFromSubpoint, sampleProfile } from '../util/geo';
import { litPeriods, nextSunChange, sunAt, sunPathTimes } from '../util/horizon';
import { sunWidthDeg } from '../util/bodies';

/** Half the Sun's apparent width: the answer's "above" is any part of the disc over the skyline. */
const SUN_DISC_RADIUS_DEG = sunWidthDeg() / 2;
import { DAY_MS, HOUR_MS } from '../util/time';
import { horizonRequests, horizonStepHours, loadHorizon, MAX_SAMPLE_HOURS, mergeHorizon, STEPS_PER_REQUEST } from './horizonLoad';

const SITES = sitesJson.sites as SiteRef[];
const site = (id: string) => SITES.find((s) => s.id === id)!;
const LAUNCH = Date.UTC(2027, 1, 10, 15, 0, 0);
const PLANNED = LAUNCH + TRANSIT_DAYS * DAY_MS;

beforeAll(() => configureMock({ latencyMs: 0, scenario: { mode: 'normal', assistant: 'on' } }));

/**
 * The real changes of the mock model, found without any horizon answer: a 3-minute scan of the
 * Sun's height above the skyline, then bisection.
 */
function modelChanges(s: SiteRef, startMs: number, endMs: number): number[] {
  const skyline = skylineFor(s);
  const above = (t: number) => {
    const p = subsolarPoint(t);
    const sun = azElFromSubpoint(s.lat, s.lon_east, p.lat, p.lonEast);
    // The answer's rule: any part of the disc above the skyline.
    return sun.el + SUN_DISC_RADIUS_DEG > sampleProfile(skyline, sun.az);
  };
  const out: number[] = [];
  const dt = 3 * 60_000;
  let prev = above(startMs);
  for (let from = startMs; from < endMs; from += dt) {
    const to = Math.min(endMs, from + dt);
    const cur = above(to);
    if (cur !== prev) {
      let lo = from;
      let hi = to;
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

describe('the requests for a window', () => {
  const span = (days: number) => horizonRequests(PLANNED, PLANNED + days * DAY_MS);

  it('asks for about 2400 points, in quarter hours, never finer than 15 minutes and never coarser than an hour', () => {
    const step = (days: number) => horizonStepHours(PLANNED, PLANNED + days * DAY_MS);
    expect(step(1)).toBe(0.25);
    expect(step(14)).toBe(0.25);
    expect(step(29.53)).toBe(0.25);
    expect(step(60)).toBe(0.5);
    expect(step(90)).toBe(1);
    expect(step(186)).toBe(1);
    expect(step(365.25)).toBe(1);
    expect(step(395.25)).toBe(1);
    for (let days = 1; days <= 395.25; days += 0.25) {
      expect((step(days) * 4) % 1).toBe(0);
      expect(step(days)).toBeLessThanOrEqual(MAX_SAMPLE_HOURS);
    }
  });

  it('is one request up to 150 days and several sub-windows, end to end, beyond', () => {
    expect(span(14)).toEqual([{ startMs: PLANNED, endMs: PLANNED + 14 * DAY_MS, stepHours: 0.25 }]);
    expect(span(150)).toHaveLength(1);
    expect(span(150.25)).toHaveLength(2);
    expect(span(186)).toHaveLength(2);
    expect(span(365.25)).toHaveLength(3);
    expect(span(395.25)).toHaveLength(3);
    expect(span(395.25).map((a) => (a.endMs - a.startMs) / HOUR_MS)).toEqual([3600, 3600, 2286]);
  });

  it('covers every window the controls allow with no gap, a whole number of steps each, under the limit of one answer', () => {
    for (let days = 1; days <= 395.25; days += 0.25) {
      const asks = span(days);
      expect(asks[0].startMs).toBe(PLANNED);
      expect(asks[asks.length - 1].endMs).toBe(PLANNED + days * DAY_MS);
      for (let i = 0; i < asks.length; i++) {
        if (i > 0) expect(asks[i].startMs).toBe(asks[i - 1].endMs);
        const steps = (asks[i].endMs - asks[i].startMs) / HOUR_MS / asks[i].stepHours;
        expect(Math.abs(steps - Math.round(steps))).toBeLessThan(1e-9);
        expect(Math.round(steps)).toBeLessThanOrEqual(STEPS_PER_REQUEST);
        expect(asks[i].stepHours).toBeLessThanOrEqual(MAX_SAMPLE_HOURS);
        // The example model answers with at most 4000 points and at least 24 steps.
        expect(STEPS_PER_REQUEST).toBeLessThan(4000);
      }
    }
  });

  it('keeps to the hour for a window that is not a whole number of hours', () => {
    const asks = horizonRequests(PLANNED, PLANNED + 200 * DAY_MS + 1234567);
    for (const a of asks) expect(a.stepHours).toBeLessThanOrEqual(MAX_SAMPLE_HOURS);
    expect(horizonRequests(PLANNED, PLANNED)).toEqual([]);
    expect(horizonRequests(PLANNED, PLANNED - DAY_MS)).toEqual([]);
    expect(horizonRequests(Number.NaN, PLANNED)).toEqual([]);
  });
});

describe('joining the answers', () => {
  const s = site('shackleton-ridge');
  const a = horizonFor(s, PLANNED, PLANNED + 10 * DAY_MS, 1);
  const b = horizonFor(s, PLANNED + 10 * DAY_MS, PLANNED + 20 * DAY_MS, 1);
  const whole = horizonFor(s, PLANNED, PLANNED + 20 * DAY_MS, 1);

  it('two halves give the same path as the whole, with the meeting sample once', () => {
    const joined = mergeHorizon([a, b])!;
    expect(joined.site_id).toBe(s.id);
    expect(joined.skyline).toEqual(whole.skyline);
    expect(joined.sun_path).toEqual(whole.sun_path);
    expect(joined.sun_path).toHaveLength(a.sun_path.length + b.sun_path.length - 1);
    expect(litPeriods(joined)).toEqual(litPeriods(whole));
  });

  it('Earth’s box is the box around every part', () => {
    const joined = mergeHorizon([a, b])!;
    for (const [got, want] of [
      [joined.earth_box!.el_min, whole.earth_box!.el_min],
      [joined.earth_box!.el_max, whole.earth_box!.el_max],
      [joined.earth_box!.az_min, whole.earth_box!.az_min],
      [joined.earth_box!.az_max, whole.earth_box!.az_max],
    ]) {
      expect(got).toBeCloseTo(want, 1);
    }
    // Boxes either side of north join across it.
    const box = (az_min: number, az_max: number, el_min: number, el_max: number): HorizonResponse => ({ ...a, earth_box: { az_min, az_max, el_min, el_max } });
    expect(mergeHorizon([box(350, 358, 1, 3), box(2, 9, 0, 2)])!.earth_box).toEqual({ az_min: 350, az_max: 9, el_min: 0, el_max: 3 });
    expect(mergeHorizon([box(350, 5, 1, 3), box(2, 9, 0, 2)])!.earth_box).toEqual({ az_min: 350, az_max: 9, el_min: 0, el_max: 3 });
    expect(mergeHorizon([box(100, 120, 1, 3), box(110, 115, 2, 5)])!.earth_box).toEqual({ az_min: 100, az_max: 120, el_min: 1, el_max: 5 });
    // A part in which Earth never rises adds nothing; with none at all there is no box.
    expect(mergeHorizon([box(100, 120, 1, 3), { ...a, earth_box: null }])!.earth_box).toEqual({ az_min: 100, az_max: 120, el_min: 1, el_max: 3 });
    expect(mergeHorizon([{ ...a, earth_box: null }, { ...b, earth_box: null }])!.earth_box).toBeNull();
  });

  it('one answer is passed through, and none gives none', () => {
    expect(mergeHorizon([a])).toBe(a);
    expect(mergeHorizon([])).toBeNull();
  });

  it('an empty answer stays empty', () => {
    const empty: HorizonResponse = { site_id: s.id, skyline: [], sun_path: [], earth_box: null, skyline_source: 'stored_profile', time_step_s: 0, provenance: MOCK_PROVENANCE, warnings: [] };
    expect(mergeHorizon([empty, empty])).toEqual(empty);
  });
});

describe('shorter windows', () => {
  /** Worst distance, in hours, from a change the reader places to the nearest real change. */
  async function worstPlacementHours(id: string, days: number): Promise<number> {
    const s = site(id);
    const end = PLANNED + days * DAY_MS;
    const real = modelChanges(s, PLANNED, end);
    const placed = litPeriods(await loadHorizon(s, PLANNED, end)).slice(1).map((p) => p.start);
    expect(placed.length).toBeGreaterThan(0);
    expect(placed).toHaveLength(real.length);
    let worst = 0;
    for (const t of placed) worst = Math.max(worst, Math.min(...real.map((r) => Math.abs(r - t))) / HOUR_MS);
    return worst;
  }

  // Shackleton ridge is the hard case: near the pole the Sun grazes the skyline.
  // A change is placed midway between the two samples whose words differ (the nearest sample's word
  // holds between samples), so it is within half the spacing of the model's own change.
  it.each([14, 29.53, 90])('places each sunrise and sunset within half a sample spacing of the mock model for a %s-day window', async (days) => {
    const half = horizonStepHours(PLANNED, PLANNED + days * DAY_MS) / 2 + 1e-6;
    expect(await worstPlacementHours('shackleton-ridge', days)).toBeLessThanOrEqual(half);
    expect(await worstPlacementHours('apollo-11', days)).toBeLessThanOrEqual(half);
  });
});

// The three longest cases: a 186-day stay, the longest stay (365.25 days), and the longest stay
// after the longest delay (the window then starts at the planned landing, 30 days earlier).
describe.each([186, 365.25, 395.25])('a %s-day window, every preset site', (days) => {
  const end = PLANNED + days * DAY_MS;

  it.each(SITES.map((s) => [s.id, s] as const))('%s: samples an hour apart at most, and every sunrise and sunset of the model is there', async (_id, s) => {
    const horizon = await loadHorizon(s, PLANNED, end);
    const times = sunPathTimes(horizon);
    expect(times[0]).toBe(PLANNED);
    expect(times[times.length - 1]).toBe(end);
    let widest = 0;
    for (let i = 1; i < times.length; i++) widest = Math.max(widest, times[i] - times[i - 1]);
    expect(widest).toBeLessThanOrEqual(MAX_SAMPLE_HOURS * HOUR_MS);

    // The lit / dark timeline: the same changes as the model, one for one, each within half a
    // sample spacing (half an hour here), where the nearest-sample rule places it.
    const real = modelChanges(s, PLANNED, end);
    const periods = litPeriods(horizon);
    const placed = periods.slice(1).map((p) => p.start);
    expect(placed).toHaveLength(real.length);
    let worst = 0;
    placed.forEach((t, i) => (worst = Math.max(worst, Math.abs(t - real[i]) / HOUR_MS)));
    expect(worst).toBeLessThanOrEqual(MAX_SAMPLE_HOURS / 2 + 1e-6);

    // "Next sunrise / sunset", read just after each change and a third of the way to the next, is
    // the model's next change, of the right kind.
    const startsLit = sunAt(horizon, PLANNED)!.above;
    const askAt = [PLANNED, ...real.flatMap((r, i) => [r + 0.2 * HOUR_MS, r + ((real[i + 1] ?? end) - r) / 3])];
    for (const t of askAt) {
      const next = real.findIndex((r) => r > t + 0.51 * HOUR_MS);
      const change = nextSunChange(horizon, t);
      if (next === -1) {
        // Nothing left in the window (or a change within minutes of the instant asked).
        if (change) expect(real.some((r) => Math.abs(r - change.atMs) < 0.51 * HOUR_MS)).toBe(true);
        continue;
      }
      expect(change).not.toBeNull();
      // The reader may still see the change the instant sits within minutes of; otherwise the next.
      const candidates = [real[next], real[next - 1]].filter((r) => r !== undefined);
      expect(Math.min(...candidates.map((r) => Math.abs(change!.atMs - r))) / HOUR_MS).toBeLessThanOrEqual(0.5 + 1e-6);
      expect(change!.sampleGapHours).toBeLessThanOrEqual(MAX_SAMPLE_HOURS + 1e-9);
      // Placed by the nearest-sample rule, never read off a crossing.
      expect(change!.interpolated).toBe(false);
      if (Math.abs(change!.atMs - real[next]) <= 0.5 * HOUR_MS) {
        // Changes alternate, so the kind follows from how the window starts.
        expect(change!.kind).toBe((next % 2 === 0) === startsLit ? 'sunset' : 'sunrise');
      }
    }
  });
});

describe('what the single coarse request used to miss', () => {
  // One coarse request over a long window steps over short spells: at Shackleton ridge the Sun's
  // disc slips behind the terrain for about half a day at a time, and samples a day apart miss such
  // spells. The joined answer, an hour apart at most, keeps every one.
  it('finds the short spells at Shackleton ridge that samples a day apart step over', async () => {
    const s = site('shackleton-ridge');
    const end = PLANNED + 395.25 * DAY_MS;
    const real = modelChanges(s, PLANNED, end);
    const coarse = horizonFor(s, PLANNED, end, 24);
    const fine = await loadHorizon(s, PLANNED, end);
    expect(litPeriods(coarse).length - 1).toBeLessThan(real.length);
    expect(litPeriods(fine).length - 1).toBe(real.length);
    // A spell shorter than a day exists in the model, and the joined answer shows it, to within a
    // sample spacing (each end is placed within half of one).
    const shortest = Math.min(...real.slice(1).map((t, i) => t - real[i])) / HOUR_MS;
    expect(shortest).toBeLessThan(24);
    const shownShortest = Math.min(...litPeriods(fine).slice(1, -1).map((p) => p.end - p.start)) / HOUR_MS;
    expect(Math.abs(shownShortest - shortest)).toBeLessThanOrEqual(MAX_SAMPLE_HOURS + 1e-6);
  });
});

describe('a window that takes two requests keeps the answer’s added fields when joined', () => {
  const s = site('apollo-11');
  const end = PLANNED + 186 * DAY_MS;
  const physics: DataProvenance = { ...MOCK_PROVENANCE, source: 'physics_engine', is_synthetic: false, engine_name: 'engine', notice: 'From the physics engine.' };

  /** Loads the window with each part answered by the example model, then changed by `alter` (part 0, part 1). */
  async function joined(alter: (part: HorizonResponse, i: number) => HorizonResponse): Promise<HorizonResponse> {
    let i = 0;
    const spy = vi.spyOn(api, 'horizon').mockImplementation(async (req) => alter(horizonFor(req.site, Date.parse(req.start_utc), Date.parse(req.end_utc), req.step_hours), i++));
    try {
      return await loadHorizon(s, PLANNED, end);
    } finally {
      spy.mockRestore();
      expect(i).toBe(2);
    }
  }

  it('needs two requests', () => {
    expect(horizonRequests(PLANNED, end)).toHaveLength(2);
  });

  it('joins the warnings without repeats, keeps the largest step and the source that says less, and labels a mix synthetic', async () => {
    const h = await joined((part, i) =>
      i === 0
        ? { ...part, provenance: physics, warnings: ['First.', 'Shared.'], time_step_s: 3600, skyline_source: 'stored_profile' }
        : { ...part, provenance: MOCK_PROVENANCE, warnings: ['Shared.', 'Second.'], time_step_s: 3720, skyline_source: 'smooth_sphere' },
    );
    expect(h.warnings).toEqual(['First.', 'Shared.', 'Second.']);
    expect(h.time_step_s).toBe(3720);
    expect(h.skyline_source).toBe('smooth_sphere');
    expect(h.provenance.is_synthetic).toBe(true);
    expect(h.provenance).toEqual(MOCK_PROVENANCE);
  });

  it('keeps the provenance all the parts agree on', async () => {
    const h = await joined((part) => ({ ...part, provenance: physics, warnings: [], time_step_s: 3600, skyline_source: 'stored_profile' }));
    expect(h.provenance).toEqual(physics);
    expect(h.provenance.is_synthetic).toBe(false);
    expect(h.warnings).toEqual([]);
    expect(h.time_step_s).toBe(3600);
    expect(h.skyline_source).toBe('stored_profile');
  });
});
