import { describe, expect, it } from 'vitest';
import sitesJson from '../api/examples/sites.json';
import { horizonFor } from '../api/mock/model';
import type { HorizonResponse, SiteRef } from '../api/types';
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
