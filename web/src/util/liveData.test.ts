// How the website words the backend's answers: a null score as its range, an unknown verdict as
// UNKNOWN with its requirement (never a pass), a catalog figure that is not published, the
// terrain note, the data source label and the transit.

import { describe, expect, it } from 'vitest';
import catalogJson from '../api/examples/catalog.json';
import type { CatalogItem, SiteEvaluation } from '../api/types';
import { DATA_SOURCE_LABEL } from '../stages/TopBar';
import { catalogFigureRows, chosenCapacity, figureValue, NOT_PUBLISHED } from './catalog';
import { scoreQuantity, siteQuantities, transitQuantity, verdictText } from './quantities';
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
  it('says UNKNOWN with the requirement that could not be checked, never pass', () => {
    const v = { result: 'unknown' as const, requirement: 'landing slope', unknown_requirements: ['landing slope'] };
    expect(verdictText(v)).toBe('UNKNOWN: landing slope');
    const q = siteQuantities(2, evaluation({ verdict: v }));
    expect(q.verdict.text).toBe('UNKNOWN: landing slope');
    expect(q.verdict.tone).toBe('warn');
    expect(q.verdictWord).toBe('unknown');
    expect(q.passes).toBeNull();
    expect(q.result).toBe('unknown');
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
