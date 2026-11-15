// The horizon plot's maths, on answers of the example (mock) model.

import { describe, expect, it } from 'vitest';
import sitesJson from '../api/examples/sites.json';
import { horizonFor, TRANSIT_DAYS } from '../api/mock/model';
import type { HorizonResponse, SiteRef, SkyBox } from '../api/types';
import { naturalElRange } from './horizon';
import { axisCenter, azFraction, azTickValues, BAND_BREAK_DEG, boxRects, compassLetters, elScale, elTickValues, LOWER_BAND_SHARE, skylinePaths, sunRuns, type PlotBox } from './horizonPlot';
import { DAY_MS } from './time';

const LANDING = Date.UTC(2027, 1, 10, 15, 0, 0) + TRANSIT_DAYS * DAY_MS;
const site = (id: string) => (sitesJson.sites as SiteRef[]).find((s) => s.id === id)!;
const BOX: PlotBox = { left: 40, right: 640, top: 8, bottom: 108 };

describe('the compass axis', () => {
  it('is centred on Earth’s box, to the nearest 45 degrees, and on south without one', () => {
    expect(axisCenter(null)).toBe(180);
    expect(axisCenter({ az_min: 170, az_max: 200, el_min: 1, el_max: 6 })).toBe(180);
    expect(axisCenter({ az_min: 30, az_max: 70, el_min: 1, el_max: 6 })).toBe(45);
    // A box that wraps past north is centred on north.
    expect(axisCenter({ az_min: 350, az_max: 12, el_min: 1, el_max: 6 })).toBe(0);
    expect(axisCenter({ az_min: Number.NaN, az_max: 12, el_min: 1, el_max: 6 })).toBe(180);
  });

  it('runs 180 degrees either side of its centre', () => {
    expect(azFraction(180, 180)).toBe(0.5);
    expect(azFraction(0, 180)).toBe(0);
    expect(azFraction(359.9, 180)).toBeCloseTo(0.99972, 4);
    expect(azFraction(90, 0)).toBe(0.75);
    expect(azFraction(270, 0)).toBe(0.25);
    expect(azTickValues(180, 45)).toEqual([0, 45, 90, 135, 180, 225, 270, 315, 360]);
    expect(azTickValues(45, 90)).toEqual([-135, -45, 45, 135, 225]);
    expect(azTickValues(45, 90).map(compassLetters)).toEqual(['SW', 'NW', 'NE', 'SE', 'SW']);
    expect(compassLetters(10)).toBe('');
  });
});

describe('the height scale', () => {
  it('is one straight scale up to 12 degrees', () => {
    const s = elScale({ min: -2, max: 10 }, 8, 100);
    expect(s.breakEl).toBeNull();
    expect(s.y(10)).toBe(8);
    expect(s.y(-2)).toBe(108);
    expect(s.y(4)).toBe(58);
    expect(s.el(58)).toBeCloseTo(4, 10);
  });

  it('has two bands above that: the lowest height to 10 degrees takes the lower 60 %', () => {
    const s = elScale({ min: -2, max: 90 }, 8, 100);
    expect(s.breakEl).toBe(BAND_BREAK_DEG);
    expect(s.y(90)).toBeCloseTo(8, 10);
    expect(s.y(-2)).toBeCloseTo(108, 10);
    expect(s.y(10)).toBeCloseTo(108 - LOWER_BAND_SHARE * 100, 10);
    // A degree of skyline keeps five pixels of height where a straight scale would give it one.
    expect(s.y(0) - s.y(1)).toBeCloseTo(5, 10);
  });

  it('the two-band scale is monotonic, continuous at the break and invertible', () => {
    for (const range of [
      { min: -2, max: 90 },
      { min: -3, max: 30 },
      { min: -2, max: 15 },
      { min: 0, max: 60 },
    ]) {
      const s = elScale(range, 8, 100);
      let prev = Infinity;
      for (let el = range.min; el <= range.max; el += 0.25) {
        const y = s.y(el);
        expect(y).toBeLessThan(prev);
        prev = y;
        expect(s.el(y)).toBeCloseTo(el, 9);
      }
      expect(s.y(BAND_BREAK_DEG - 1e-9)).toBeCloseTo(s.y(BAND_BREAK_DEG + 1e-9), 6);
    }
  });

  it('marks heights that never crowd: labels at least 18 px apart, level always among them', () => {
    for (const [range, height] of [
      [{ min: -2, max: 10 }, 96],
      [{ min: -2, max: 6 }, 70],
      [{ min: -3, max: 90 }, 96],
      [{ min: -2, max: 90 }, 300],
      [{ min: -2, max: 30 }, 110],
      [{ min: -2, max: 15 }, 70],
    ] as const) {
      const s = elScale(range, 8, height);
      const ticks = elTickValues(s);
      expect(ticks).toContain(0);
      expect(ticks.length).toBeGreaterThanOrEqual(2);
      for (let i = 1; i < ticks.length; i++) {
        expect(ticks[i]).toBeGreaterThan(ticks[i - 1]);
        expect(s.y(ticks[i - 1]) - s.y(ticks[i])).toBeGreaterThanOrEqual(18 - 1e-9);
      }
      for (const t of ticks) {
        expect(Number.isInteger(t)).toBe(true);
        expect(t).toBeGreaterThanOrEqual(range.min);
        expect(t).toBeLessThanOrEqual(range.max);
      }
    }
    expect(elTickValues(elScale({ min: -2, max: 10 }, 8, 96))).toEqual([0, 5, 10]);
    expect(elTickValues(elScale({ min: -2, max: 90 }, 8, 96))).toEqual([0, 5, 10, 90]);
    expect(elTickValues(elScale({ min: -2, max: 90 }, 8, 300))).toEqual([-2, 0, 2, 4, 6, 8, 10, 30, 45, 60, 75, 90]);
  });
});

describe('the shapes', () => {
  const polar = horizonFor(site('shackleton-ridge'), LANDING, LANDING + 14 * DAY_MS, 0.25);
  const low = horizonFor(site('apollo-11'), LANDING, LANDING + 30 * DAY_MS, 0.25);

  it('the skyline runs from the left edge to the right edge at one height, and closes along the bottom', () => {
    for (const data of [polar, low]) {
      const center = axisCenter(data.earth_box);
      const scale = elScale(naturalElRange(data), BOX.top, BOX.bottom - BOX.top);
      const { line, area } = skylinePaths(data.skyline, center, BOX, scale.y);
      const pts = [...line.matchAll(/[ML]([\d.-]+),([\d.-]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
      expect(pts.length).toBeGreaterThanOrEqual(data.skyline.length);
      expect(pts[0][0]).toBe(BOX.left);
      expect(pts[pts.length - 1][0]).toBe(BOX.right);
      expect(pts[0][1]).toBe(pts[pts.length - 1][1]);
      for (let i = 1; i < pts.length; i++) expect(pts[i][0]).toBeGreaterThanOrEqual(pts[i - 1][0]);
      expect(area.startsWith(line)).toBe(true);
      expect(area.endsWith(`L${BOX.right.toFixed(1)},${BOX.bottom.toFixed(1)}L${BOX.left.toFixed(1)},${BOX.bottom.toFixed(1)}Z`)).toBe(true);
    }
    expect(skylinePaths([], 180, BOX, (el) => el)).toEqual({ line: '', area: '' });
  });

  /** Points of a run as numbers. */
  const points = (run: { points: string }) => run.points.split(' ').map((p) => p.split(',').map(Number));

  it('the Sun’s path breaks where it wraps past the edge and where the answer’s word changes', () => {
    for (const data of [polar, low]) {
      const center = axisCenter(data.earth_box);
      const scale = elScale(naturalElRange(data), BOX.top, BOX.bottom - BOX.top);
      const runs = sunRuns(data, LANDING, LANDING + 30 * DAY_MS, center, BOX, scale.y);
      expect(runs.length).toBeGreaterThan(0);
      const width = BOX.right - BOX.left;
      for (const run of runs) {
        const pts = points(run);
        expect(pts.length).toBeGreaterThan(1);
        // Inside a run the path never leaps across the plot.
        for (let i = 1; i < pts.length; i++) expect(Math.abs(pts[i][0] - pts[i - 1][0])).toBeLessThanOrEqual(width / 2);
      }
      // Every change of word in the answer starts a new run of the other state, sharing the point of change.
      const words = data.sun_path.map((p) => p.state);
      const changes = words.filter((w, i) => i > 0 && w !== words[i - 1]).length;
      const joins = runs.filter((r, i) => i > 0 && r.state !== runs[i - 1].state && points(r)[0].join() === points(runs[i - 1]).at(-1)!.join()).length;
      expect(joins).toBe(changes);
    }
  });

  it('draws only the span asked for, and thins a long path', () => {
    const center = axisCenter(polar.earth_box);
    const scale = elScale(naturalElRange(polar), BOX.top, BOX.bottom - BOX.top);
    const all = sunRuns(polar, LANDING, LANDING + 14 * DAY_MS, center, BOX, scale.y).reduce((n, r) => n + points(r).length, 0);
    const half = sunRuns(polar, LANDING, LANDING + 7 * DAY_MS, center, BOX, scale.y).reduce((n, r) => n + points(r).length, 0);
    expect(half).toBeLessThan(all);
    expect(half).toBeGreaterThan(all / 4);
    // 1345 samples; at most one point per 0.75 px of travel is kept.
    expect(all).toBeLessThan(polar.sun_path.length);
    expect(sunRuns(polar, LANDING + 20 * DAY_MS, LANDING + 30 * DAY_MS, center, BOX, scale.y)).toEqual([]);
    const unreadable: HorizonResponse = { ...polar, sun_path: polar.sun_path.map((p) => ({ ...p, t: 'not a time' })) };
    expect(sunRuns(unreadable, LANDING, LANDING + 14 * DAY_MS, center, BOX, scale.y)).toEqual([]);
  });

  it('Earth’s box is one rectangle, or two when it wraps past the edge of the plot', () => {
    const box: SkyBox = { az_min: 170, az_max: 200, el_min: 1, el_max: 6 };
    expect(boxRects(null, 180, BOX)).toEqual([]);
    const one = boxRects(box, 180, BOX);
    expect(one).toHaveLength(1);
    expect(one[0].x).toBeCloseTo(40 + (170 / 360) * 600, 6);
    expect(one[0].w).toBeCloseTo((30 / 360) * 600, 6);
    // The same box on an axis centred on north straddles the edge.
    const two = boxRects(box, 0, BOX);
    expect(two).toHaveLength(2);
    expect(two[0].x + two[0].w).toBeCloseTo(BOX.right, 6);
    expect(two[1].x).toBe(BOX.left);
    expect(two[0].w + two[1].w).toBeCloseTo((30 / 360) * 600, 6);
  });
});
