import { describe, expect, it } from 'vitest';
import type { SiteEvaluation } from '../api/types';
import { movedText, rankRows } from './ranking';

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
