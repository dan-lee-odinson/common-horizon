import { describe, expect, it } from 'vitest';
import type { SiteEvaluation } from '../api/types';
import { movedText, rankRows, rankWindow } from './ranking';

function ev(site_id: string, score: number): SiteEvaluation {
  return {
    site_id,
    score,
    sunlight_hours: 0,
    sunlight_percent: 0,
    clear_sky_percent: 0,
    earth_link: 'clear',
    hardware_fits: true,
    energy_added_kwh: 0,
    power_margin_percent: null,
    power_status: 'none',
    verdict: { result: 'pass', requirement: null },
  };
}

describe('ranking with a slip', () => {
  it('ranks best score first and reports places moved and both scores', () => {
    const planned = [ev('a', 90), ev('b', 80), ev('c', 70)];
    const slipped = [ev('a', 60), ev('b', 85), ev('c', 75)];
    const rows = rankRows(slipped, planned);
    expect(rows.map((r) => r.siteId)).toEqual(['b', 'c', 'a']);
    expect(rows[0]).toMatchObject({ rank: 1, moved: 1, planned: { rank: 2, score: 80 } });
    expect(rows[1]).toMatchObject({ rank: 2, moved: 1, planned: { rank: 3, score: 70 } });
    expect(rows[2]).toMatchObject({ rank: 3, moved: -2, planned: { rank: 1, score: 90 } });
  });
  it('has no planned values without a slip', () => {
    const rows = rankRows([ev('a', 1), ev('b', 2)], null);
    expect(rows.map((r) => [r.siteId, r.rank, r.moved, r.planned])).toEqual([
      ['b', 1, 0, null],
      ['a', 2, 0, null],
    ]);
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
