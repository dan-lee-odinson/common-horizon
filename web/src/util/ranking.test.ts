import { describe, expect, it } from 'vitest';
import type { SiteEvaluation } from '../api/types';
import { movedText, rankRows, rankWindow } from './ranking';

function ev(site_id: string, score: number, rank = 0): SiteEvaluation {
  return {
    site_id,
    rank,
    score,
    score_min: score,
    score_max: score,
    score_components: { sunlight: 0, darkness: 0, earth: 0, slope: 0 },
    longest_darkness_hours: 0,
    earth_visible_percent: 0,
    slope_deg: 0,
    site_energy: null,
    requirements: [],
    elevation_m: 0,
    elevation_source: 'test',
    warnings: [],
    sunlight_hours: 0,
    sunlight_percent: 0,
    clear_sky_percent: 0,
    earth_link: 'clear',
    hardware_fits: true,
    energy_added_kwh: 0,
    power_margin_percent: null,
    power_status: 'none',
    verdict: { result: 'pass', requirement: null, unknown_requirements: [] },
  };
}

describe('ranking with a slip', () => {
  it("keeps the backend's order (its rank), reports places moved and both scores", () => {
    const planned = [ev('a', 90, 1), ev('b', 80, 2), ev('c', 70, 3)];
    const slipped = [ev('b', 85, 1), ev('c', 75, 2), ev('a', 60, 3)];
    const rows = rankRows(slipped, planned);
    expect(rows.map((r) => r.siteId)).toEqual(['b', 'c', 'a']);
    expect(rows[0]).toMatchObject({ rank: 1, moved: 1, planned: { rank: 2, score: 80 } });
    expect(rows[1]).toMatchObject({ rank: 2, moved: 1, planned: { rank: 3, score: 70 } });
    expect(rows[2]).toMatchObject({ rank: 3, moved: -2, planned: { rank: 1, score: 90 } });
  });
  it('has no planned values without a slip', () => {
    const rows = rankRows([ev('b', 2, 1), ev('a', 1, 2)], null);
    expect(rows.map((r) => [r.siteId, r.rank, r.moved, r.planned])).toEqual([
      ['b', 1, 0, null],
      ['a', 2, 0, null],
    ]);
  });
  it('never re-sorts by score: a passing site ranked above a failing one with a higher score stays above', () => {
    const pass = { ...ev('pass', 40, 1) };
    const unknown = { ...ev('unknown', null as unknown as number, 2), score_min: 50, score_max: 90, verdict: { result: 'unknown' as const, requirement: 'landing slope', unknown_requirements: ['landing slope'] } };
    const fail = { ...ev('fail', 95, 3), verdict: { result: 'fail' as const, requirement: 'night power', unknown_requirements: [] } };
    expect(rankRows([pass, unknown, fail], null).map((r) => [r.siteId, r.rank])).toEqual([
      ['pass', 1],
      ['unknown', 2],
      ['fail', 3],
    ]);
    // Listed out of order, the rank field still sets the order.
    expect(rankRows([fail, pass, unknown], null).map((r) => r.siteId)).toEqual(['pass', 'unknown', 'fail']);
  });
  it('words the movement', () => {
    expect(movedText(2)).toBe('up 2 places');
    expect(movedText(-1)).toBe('down 1 place');
    expect(movedText(0)).toBe('no change');
  });
});

describe('a short window of the ranking', () => {
  const rows = Array.from({ length: 17 }, (_, i) => ({ siteId: `s${i + 1}` }));
  const ids = (list: { siteId: string }[]) => list.map((r) => r.siteId).join(' ');

  it('shows the top of the list when no site is chosen', () => {
    expect(ids(rankWindow(rows, null, 5))).toBe('s1 s2 s3 s4 s5');
    expect(ids(rankWindow(rows, 'not-ranked', 5))).toBe('s1 s2 s3 s4 s5');
  });

  it('keeps the chosen site in view, centred where it can be', () => {
    expect(ids(rankWindow(rows, 's9', 5))).toBe('s7 s8 s9 s10 s11');
    expect(ids(rankWindow(rows, 's1', 5))).toBe('s1 s2 s3 s4 s5');
    expect(ids(rankWindow(rows, 's17', 5))).toBe('s13 s14 s15 s16 s17');
    expect(ids(rankWindow(rows, 's16', 5))).toBe('s13 s14 s15 s16 s17');
  });

  it('never shows more than the window, and shows a short list whole', () => {
    expect(rankWindow(rows, 's9', 5)).toHaveLength(5);
    expect(ids(rankWindow(rows.slice(0, 3), 's2', 5))).toBe('s1 s2 s3');
    expect(rankWindow([], null, 5)).toEqual([]);
  });
});
