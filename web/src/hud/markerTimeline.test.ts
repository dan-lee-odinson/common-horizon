// The horizon plot's Sun marker and the stay timeline never disagree about lit or dark.
//
// Both take the horizon answer's own word: `state` is "above" when any part of the Sun's disc shows
// over the terrain, and between samples the nearest sample's word holds. The marker gets it through
// the readouts (SiteHud passes `sky.lit` from liveSiteQuantities as SunMark.lit); the timeline draws
// litPeriods of the same answer. Near a grazing skyline the Sun's centre can be below the skyline
// while the answer says "above" (at Shackleton ridge in one answer, 16 of 337 samples): the marker
// must still say lit there.

import { beforeAll, describe, expect, it } from 'vitest';
import sitesJson from '../api/examples/sites.json';
import { configureMock } from '../api/mock';
import { horizonFor, TRANSIT_DAYS } from '../api/mock/model';
import type { HorizonResponse, SiteRef } from '../api/types';
import { clearGeometryCache, loadTrack } from '../state/geometry';
import { sampleProfile } from '../util/geo';
import { litPeriods, sunPathTimes } from '../util/horizon';
import { liveSiteQuantities } from '../util/quantities';
import { DAY_MS, HOUR_MS, SYNODIC_MONTH_DAYS } from '../util/time';
import type { GeometryTrack } from '../util/track';
import { sunMarkerState, type SunMark } from './HorizonPanel';

const SITES = sitesJson.sites as SiteRef[];
// Southern summer at the pole: the Sun grazes the skyline at the polar sites.
const LANDING = Date.UTC(2027, 9, 25, 15, 0, 0);
const END = LANDING + SYNODIC_MONTH_DAYS * DAY_MS;

let track: GeometryTrack;
beforeAll(async () => {
  configureMock({ latencyMs: 0, scenario: { mode: 'normal', assistant: 'on' } });
  clearGeometryCache();
  track = await loadTrack(LANDING - TRANSIT_DAYS * DAY_MS, SYNODIC_MONTH_DAYS);
});

/** What the marker says at an instant, made the way SiteHud makes its SunMark. */
function marker(site: SiteRef, horizon: HorizonResponse, tMs: number): string {
  const l = liveSiteQuantities({ track, tMs, landingMs: LANDING, site, horizon, lander: null });
  const mark: SunMark | null = l.sky.sun ? { az: l.sky.sun.az, el: l.sky.sun.el, lit: l.sky.lit } : null;
  return sunMarkerState(mark);
}

/** What the timeline draws at an instant: the lit flag of the period that holds it. */
function timeline(horizon: HorizonResponse, tMs: number): string {
  const periods = litPeriods(horizon);
  // A period runs from its start up to (not including) its end, except the last, which holds its end.
  const p = periods.find((q, i) => tMs >= q.start && (tMs < q.end || (i === periods.length - 1 && tMs <= q.end)));
  return p ? (p.lit ? 'lit' : 'dark') : 'none';
}

describe('the Sun marker and the stay timeline', () => {
  it('include answers where the word and the Sun’s centre disagree (any part of the disc shows)', () => {
    let disagree = 0;
    for (const s of SITES) {
      const h = horizonFor(s, LANDING, END, 0.25);
      disagree += h.sun_path.filter((p) => (p.state === 'above') !== p.el > sampleProfile(h.skyline, p.az)).length;
    }
    expect(disagree).toBeGreaterThan(10);
  });

  it.each(SITES.map((s) => [s.id, s] as const))('%s: never disagree, at every five minutes through a lunar day, samples and between them', (_id, s) => {
    const h = horizonFor(s, LANDING, END, 0.25);
    const times = sunPathTimes(h);
    // Every sample, every midpoint between samples (where the nearest-sample rule switches), and a five-minute grid.
    const instants = [...times, ...times.slice(1).map((t, i) => (t + times[i]) / 2), ...Array.from({ length: Math.floor((END - LANDING) / (5 * 60_000)) }, (_, k) => LANDING + k * 5 * 60_000)];
    let lit = 0;
    let dark = 0;
    for (const t of instants) {
      const m = marker(s, h, t);
      if (m === 'none') continue;
      expect(m, `${s.id} at +${((t - LANDING) / HOUR_MS).toFixed(3)} h`).toBe(timeline(h, t));
      if (m === 'lit') lit++;
      else dark++;
    }
    expect(lit + dark).toBeGreaterThan(8000);
  });

  it('follow the answer’s word even where the Sun’s centre says otherwise', () => {
    const s = SITES.find((x) => x.id === 'shackleton-ridge')!;
    const h = horizonFor(s, LANDING, END, 0.25);
    // Every word flipped against geometry: the marker and the timeline follow the words, together.
    const flipped: HorizonResponse = { ...h, sun_path: h.sun_path.map((p) => ({ ...p, state: p.state === 'above' ? 'hidden' : 'above' })) };
    for (const t of sunPathTimes(flipped)) {
      const m = marker(s, flipped, t);
      if (m === 'none') continue;
      expect(m).toBe(timeline(flipped, t));
    }
  });
});
