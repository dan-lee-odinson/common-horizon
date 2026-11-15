// How the website words the backend's answers: a null score as its range, an unknown verdict as
// UNKNOWN with its requirement (never a pass), a catalog figure that is not published, the
// terrain note, the data source label and the transit.

import { describe, expect, it } from 'vitest';
import catalogJson from '../api/examples/catalog.json';
import type { CatalogItem, SiteEvaluation } from '../api/types';
import { DATA_SOURCE_LABEL } from '../stages/TopBar';
import { catalogFigureRows, chosenCapacity, figureValue, NOT_PUBLISHED } from './catalog';
import { rankRows } from './ranking';
import { scoreQuantity, siteQuantities, SLOPE_NOT_CHECKED_LANDER, SLOPE_NOT_CHECKED_POINT, transitQuantity, verdictText } from './quantities';
import { TERRAIN_NOT_INCLUDED, terrainNotIncluded } from './terrain';

const CATALOG = catalogJson.items as unknown as CatalogItem[];
const item = (id: string) => CATALOG.find((i) => i.id === id)!;

function evaluation(over: Partial<SiteEvaluation>): SiteEvaluation {
  return {
    site_id: 'a',
    rank: 1,
    score: 80,
    score_min: 80,
    score_max: 80,
    score_components: { sunlight: 80, darkness: 80, earth: 80, slope: 80 },
    sunlight_hours: 100,
    sunlight_percent: 50,
    longest_darkness_hours: 10,
    earth_visible_percent: 100,
    clear_sky_percent: null,
    slope_deg: null,
    earth_link: 'clear',
    hardware_fits: true,
    energy_added_kwh: null,
    site_energy: { dark_hours: 10, nights: 1, night_penalty_kwh: 200, heating_penalty_kwh: 0, total_kwh: 200 },
    power_margin_percent: 30,
    power_status: 'green',
    verdict: { result: 'pass', requirement: null, unknown_requirements: [] },
    requirements: [],
    elevation_m: 0,
    elevation_source: 'synthetic_default',
    warnings: [],
    ...over,
  };
}

describe('the score', () => {
  it('is the score when the backend has one, and the range score_min to score_max when it is null', () => {
    expect(scoreQuantity({ score: 72.6, score_min: 72.6, score_max: 72.6 })).toMatchObject({ text: '73', value: 72.6, unit: '/ 100' });
    const range = scoreQuantity({ score: null, score_min: 61.2, score_max: 76.4 });
    expect(range).toMatchObject({ text: '61–76', value: null, label: 'Score, range' });
    expect(siteQuantities(1, evaluation({ score: null, score_min: 61.2, score_max: 76.4 })).score.text).toBe('61–76');
  });
});

describe('the verdict', () => {
  it('says UNKNOWN with the requirement that could not be checked, never pass, unless the slope alone is unknown', () => {
    const v = { result: 'unknown' as const, requirement: 'hardware fit', unknown_requirements: ['hardware fit'] };
    expect(verdictText(v)).toBe('UNKNOWN: hardware fit');
    const q = siteQuantities(2, evaluation({ verdict: v }));
    expect(q.verdict.text).toBe('UNKNOWN: hardware fit');
    expect(q.verdict.tone).toBe('warn');
    expect(q.verdictWord).toBe('unknown');
    expect(q.passes).toBeNull();
    expect(q.result).toBe('unknown');
    expect(q.slopeNote).toBeNull();
    // The slope and something else unknown: still UNKNOWN, with the first.
    const two = { result: 'unknown' as const, requirement: 'hardware fit', unknown_requirements: ['hardware fit', 'landing slope'] };
    expect(siteQuantities(2, evaluation({ verdict: two })).verdict.text).toBe('UNKNOWN: hardware fit');
  });
  it('says fail with the first failed requirement, and pass only for a pass', () => {
    expect(verdictText({ result: 'fail', requirement: 'night power', unknown_requirements: [] })).toBe('fail: night power');
    expect(siteQuantities(1, evaluation({})).passes).toBe(true);
  });
  it('shows a figure the backend does not have as "not known", and the energy the darkness adds when there is no net figure', () => {
    const q = siteQuantities(1, evaluation({}));
    expect(q.clearSky.text).toBe('not known');
    expect(q.energy).toMatchObject({ label: 'Darkness adds', text: '200', unit: 'kWh' });
  });
});

describe('the catalog in the planner', () => {
  it('shows a figure that is not published as "not published", with its status and source', () => {
    const rows = catalogFigureRows(item('jaxa_pressurized_rover'));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ label: 'Mass', value: NOT_PUBLISHED, published: false });
    expect(rows[0].source).not.toBe('');
    expect(figureValue({ value: null, unit: 'kg', status: [], source: '' }).text).toBe('not published');
  });
  it('words published figures as published: a qualifier, a range, an angle', () => {
    expect(catalogFigureRows(item('fsp_40kwe'))[0]).toMatchObject({ value: 'under 6,000 kg', status: ['NASA goal'] });
    expect(figureValue({ value: [12000, 15000], unit: 'kg', status: [], source: '' }).text).toBe('12,000 to 15,000 kg');
    expect(catalogFigureRows(item('griffin')).find((r) => r.key === 'max_slope')!.value).toBe('10°');
  });
  it('picks the first payload figure until the visitor picks another, and shows the figures as options, not rows', () => {
    const hls = item('starship_hls');
    expect(chosenCapacity(hls, {})!.option).toBe(hls.capacity_options[0].option);
    expect(chosenCapacity(hls, { starship_hls: hls.capacity_options[1].option })!.option).toBe(hls.capacity_options[1].option);
    expect(chosenCapacity(hls, { starship_hls: 'no such option' })!.option).toBe(hls.capacity_options[0].option);
    expect(catalogFigureRows(hls).filter((r) => r.key.startsWith('capacity_'))).toEqual([]);
  });
});

describe('terrain, data source and transit', () => {
  it('says "smooth Moon, terrain not included" when an answer says the terrain is not included', () => {
    expect(TERRAIN_NOT_INCLUDED).toBe('smooth Moon, terrain not included');
    expect(terrainNotIncluded({ warnings: ['Local terrain is NOT included: no stored profile. Visibility uses a smooth sphere.'] })).toBe(true);
    expect(terrainNotIncluded({ warnings: ['Terrain is not modelled: smooth horizon, slope reported as 0.'] })).toBe(true);
    expect(terrainNotIncluded({ warnings: [] }, { skyline_source: 'smooth_sphere', warnings: [] })).toBe(true);
    expect(terrainNotIncluded({ warnings: ['SYNTHETIC FIXTURE: values come from a toy model.'] }, { skyline_source: 'stored_profile', warnings: [] })).toBe(false);
    expect(terrainNotIncluded(null)).toBe(false);
  });
  it('labels the data source: example, test (synthetic) and live physics', () => {
    expect(DATA_SOURCE_LABEL.example.text.toUpperCase()).toBe('EXAMPLE DATA');
    expect(DATA_SOURCE_LABEL.test.text.toUpperCase()).toBe('TEST DATA');
    expect(DATA_SOURCE_LABEL.physics.text.toUpperCase()).toBe('LIVE: PHYSICS ENGINE');
  });
  it('words the transit as the answer gives it', () => {
    expect(transitQuantity(5, true)).toMatchObject({ label: 'Transit', text: '5', unit: 'days (our estimate)' });
    expect(transitQuantity(null, true).text).toBe('not stated, counted as 0');
    expect(transitQuantity(5, false).text).toBe('—');
  });
});

describe('a pass with the slope not checked', () => {
  const slopeOnly = { result: 'unknown' as const, requirement: 'landing slope', unknown_requirements: ['landing slope'] };

  it('shows PASS with "no published slope limit for this lander" when the slope is known and the lander publishes no limit', () => {
    const q = siteQuantities(2, evaluation({ slope_deg: 4.5, verdict: slopeOnly }), null, { custom: false, landerLimitDeg: null });
    expect(q.verdict.text).toBe('pass');
    expect(q.verdict.tone).toBe('good');
    expect(q.result).toBe('pass');
    expect(q.verdictWord).toBe('pass');
    expect(q.passes).toBe(true);
    // The answer's own word is kept beside it.
    expect(q.answerResult).toBe('unknown');
    expect(q.slopeNote).toBe('Slope not checked: no published slope limit for this lander');
    expect(SLOPE_NOT_CHECKED_LANDER).toBe(q.slopeNote);
  });

  it('shows "no slope data for this point" for a custom point with no slope', () => {
    const custom = evaluation({ site_id: 'custom:-45.0000:10.0000', slope_deg: null, verdict: slopeOnly });
    expect(siteQuantities(1, custom, null, { custom: true, landerLimitDeg: null }).slopeNote).toBe('Slope not checked: no slope data for this point');
    // Known as custom by its id when no context is given.
    expect(siteQuantities(1, custom).slopeNote).toBe(SLOPE_NOT_CHECKED_POINT);
  });

  it('says what is missing, as the backend checks it: the lander’s limit first, then the point’s slope', () => {
    // A lander with a published limit, and no slope for the site: the slope data is missing.
    expect(siteQuantities(1, evaluation({ slope_deg: null, verdict: slopeOnly }), null, { custom: false, landerLimitDeg: 10 }).slopeNote).toBe(SLOPE_NOT_CHECKED_POINT);
    // Neither: the lander publishes no limit (the backend's first check).
    expect(siteQuantities(1, evaluation({ slope_deg: null, verdict: slopeOnly }), null, { custom: false, landerLimitDeg: null }).slopeNote).toBe(SLOPE_NOT_CHECKED_LANDER);
    // A custom point with a slope from the answer and no limit: the limit is what is missing.
    expect(siteQuantities(1, evaluation({ site_id: 'custom:1:2', slope_deg: 3, verdict: slopeOnly }), null, { custom: true, landerLimitDeg: null }).slopeNote).toBe(SLOPE_NOT_CHECKED_LANDER);
  });

  it('shows pass or fail as normal when the backend has the slope and a limit, and fail when something else failed', () => {
    expect(siteQuantities(1, evaluation({ slope_deg: 4 })).verdict.text).toBe('pass');
    const steep = { result: 'fail' as const, requirement: 'landing slope', unknown_requirements: [] };
    expect(siteQuantities(1, evaluation({ slope_deg: 12, verdict: steep })).verdict.text).toBe('fail: landing slope');
    const failWithSlopeUnknown = { result: 'fail' as const, requirement: 'night power', unknown_requirements: ['landing slope'] };
    const q = siteQuantities(1, evaluation({ verdict: failWithSlopeUnknown }));
    expect(q.verdict.text).toBe('fail: night power');
    expect(q.slopeNote).toBeNull();
  });

  it('shows slope_deg when present, under the backend’s name for its requirement, with the backend’s sentence', () => {
    const requirements = [{ requirement: 'landing slope', passed: true, detail: 'Slope 4.5 deg; Griffin accepts up to 10 deg.' }];
    const q = siteQuantities(1, evaluation({ slope_deg: 4.5, requirements }));
    expect(q.slope).toMatchObject({ key: 'slope', label: 'Landing slope', value: 4.5, text: '4.5', unit: '°' });
    expect(q.slopeDetail).toBe('Slope 4.5 deg; Griffin accepts up to 10 deg.');
    expect(siteQuantities(1, evaluation({ slope_deg: null })).slope.value).toBeNull();
  });

  it('keeps the backend’s order: a pass without the slope check stays where the backend ranked it', () => {
    const rows = rankRows(
      [
        evaluation({ site_id: 'b', rank: 2, score: 95, slope_deg: 1, verdict: slopeOnly }),
        evaluation({ site_id: 'a', rank: 1, score: 40, slope_deg: 1 }),
        evaluation({ site_id: 'c', rank: 3, score: 99, verdict: { result: 'fail', requirement: 'night power', unknown_requirements: [] } }),
      ],
      null,
    );
    expect(rows.map((r) => [r.siteId, r.rank, siteQuantities(r.rank, r.evaluation).verdict.text])).toEqual([
      ['a', 1, 'pass'],
      ['b', 2, 'pass'],
      ['c', 3, 'fail: night power'],
    ]);
  });
});
