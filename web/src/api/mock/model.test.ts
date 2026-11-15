// The mock model's power answers: darkness taken from the stay, typed storage counted, and the
// contrast the planner is meant to show between a site with long darkness and one with short.

import { describe, expect, it } from 'vitest';
import sitesJson from '../examples/sites.json';
import type { HardwareChoice, SiteRef } from '../types';
import { landingMsFor } from './index';
import { evaluateSite, fitCheck, genericCheck, geometryAt, longestDarknessHours, rankResults } from './model';
import { wrap180 } from '../../util/geo';
import { storageToCover } from '../../util/power';
import { southPoleSeason } from '../../util/season';

const SITES = sitesJson.sites as SiteRef[];
const site = (id: string) => SITES.find((s) => s.id === id)!;
// The website's default launch (10 Feb 2027, 15:00 UTC) and stay (14 days).
const LANDING = landingMsFor('2027-02-10T15:00:00Z', 0, 5);
const STAY = 14;
// A 3 kW night load (an uncrewed habitat's 2 kW and 1 kW of work-site lighting), with solar or fission.
const LOADS: HardwareChoice[] = [
  { id: 'starship_hls', count: 1 },
  { id: 'hab_uncrewed', count: 1 },
  { id: 'worksite_lighting', count: 1 },
];
const SOLAR: HardwareChoice[] = [...LOADS, { id: 'vsat', count: 7 }];
const NUCLEAR: HardwareChoice[] = [...LOADS, { id: 'fission_40kwe', count: 1 }];
// From this landing the Sun sets at Blue Ghost Mission 1 a week in, and rises at Apollo 12 at once.
const LONG_DARK = site('blue-ghost-m1');
const SHORT_DARK = site('apollo-12');

describe('longest darkness in the stay', () => {
  const sun = (pattern: string) => [...pattern].map((c) => ({ sunAbove: c === '+' }));

  it('is the longest unbroken run of dark samples', () => {
    // 7 samples span 6 steps of 4 h over a 24 h stay; the longest dark run is 3 samples.
    expect(longestDarknessHours(sun('+--+---'), 24)).toBe(12);
  });

  it('is 0 in constant sunlight and never longer than the stay', () => {
    expect(longestDarknessHours(sun('+++++'), 24)).toBe(0);
    expect(longestDarknessHours(sun('-----'), 24)).toBe(24);
  });
});

describe('storage in the mock model', () => {
  it('fails a solar-only plan at night where the stay has darkness', () => {
    const { check, evaluation } = evaluateSite(LONG_DARK, LANDING, STAY, SOLAR, 0);
    expect(check.night.longest_darkness_h).toBeGreaterThan(100);
    expect(check.night.passes).toBe(false);
    expect(check.balance).toMatchObject({ status: 'red', limiting: 'night' });
    expect(evaluation.verdict).toMatchObject({ result: 'fail', requirement: 'night power' });
    expect(evaluation.power_status).toBe('red');
  });

  it('passes the same plan once the storage it asks for is typed', () => {
    const needed = evaluateSite(LONG_DARK, LANDING, STAY, SOLAR, 0).check.night.storage_needed_kwh!;
    const { check, evaluation } = evaluateSite(LONG_DARK, LANDING, STAY, SOLAR, Math.ceil(needed));
    expect(check.night.passes).toBe(true);
    expect(check.balance.status).not.toBe('red');
    expect(evaluation.verdict.requirement).not.toBe('night power');
  });

  it('asks for storage in step with the darkness: long darkness, much more storage', () => {
    const long = evaluateSite(LONG_DARK, LANDING, STAY, SOLAR, 0).check.night;
    const short = evaluateSite(SHORT_DARK, LANDING, STAY, SOLAR, 0).check.night;
    expect(short.longest_darkness_h!).toBeLessThan(long.longest_darkness_h!);
    // Night load x darkness: 3 kW at night, with nothing working in darkness.
    expect(long.storage_needed_kwh).toBeCloseTo(3 * long.longest_darkness_h!, 0);
    expect(short.storage_needed_kwh!).toBeLessThan(long.storage_needed_kwh! / 3);
    // Storage that covers the short darkness is not enough for the long one.
    const shortCover = Math.ceil(short.storage_needed_kwh!);
    expect(evaluateSite(SHORT_DARK, LANDING, STAY, SOLAR, shortCover).check.night.passes).toBe(true);
    expect(evaluateSite(LONG_DARK, LANDING, STAY, SOLAR, shortCover).check.night.passes).toBe(false);
  });

  it('passes the nuclear generator at both sites without storage', () => {
    for (const s of [LONG_DARK, SHORT_DARK]) {
      const { check } = evaluateSite(s, LANDING, STAY, NUCLEAR, 0);
      expect(check.night.basis).toBe('power');
      expect(check.night.passes).toBe(true);
      expect(check.balance.status).toBe('green');
    }
  });

  it('makes the day check pay for refilling the storage', () => {
    const needed = evaluateSite(LONG_DARK, LANDING, STAY, SOLAR, 0).check.night.storage_needed_kwh!;
    const { day } = evaluateSite(LONG_DARK, LANDING, STAY, SOLAR, needed).check;
    expect(day.refill_kwh).toBeCloseTo(needed, 0);
    expect(day.refill_kw).toBeGreaterThan(0);
  });

  it('passes the night check when the suggested "about N kWh" is typed, for every site, stay and plan', () => {
    const plans: HardwareChoice[][] = [
      SOLAR,
      [{ id: 'griffin', count: 1 }, { id: 'keep_alive_heat', count: 1 }],
      [{ id: 'starship_hls', count: 1 }, { id: 'surface_habitat', count: 1 }, { id: 'hab_crewed', count: 1 }, { id: 'crew_rover_keep_warm', count: 2 }],
    ];
    let checked = 0;
    for (const s of SITES) {
      for (const stay of [1, 2, 3.5, 14, 30]) {
        for (const plan of plans) {
          const needed = evaluateSite(s, LANDING, stay, plan, 0).check.night.storage_needed_kwh;
          if (!needed) continue;
          checked++;
          const typed = storageToCover(needed);
          expect(evaluateSite(s, LANDING, stay, plan, typed).check.night.passes, `${s.id}, ${stay} d, ${typed} kWh`).toBe(true);
        }
      }
    }
    expect(checked).toBeGreaterThan(50);
  });

  it('does not count storage before a site is picked (no darkness length yet)', () => {
    const without = genericCheck(STAY, SOLAR, 0);
    const withStorage = genericCheck(STAY, SOLAR, 5000);
    expect(withStorage.night.basis).toBe('power only');
    expect(withStorage.night.passes).toBe(false);
    expect(withStorage.balance).toEqual(without.balance);
    expect(withStorage.power_notes.join(' ')).toMatch(/storage/i);
  });
});

describe('the example model against the physics engine, February 2027', () => {
  // The physics engine's overhead points at two instants (degrees; latitude north positive, longitude east 0 to 360).
  const ENGINE = [
    { t: '2027-02-17T12:09:21Z', sun: { lat: 0.2, lon: 45.14 }, earth: { lat: -4.37, lon: 357.38 } },
    { t: '2027-02-19T16:19:33Z', sun: { lat: 0.29, lon: 18.75 }, earth: { lat: -0.89, lon: 0.93 } },
  ];

  it.each(ENGINE)('$t: the Sun and Earth overhead within its simple formulas’ reach of the engine', ({ t, sun, earth }) => {
    const g = geometryAt(Date.parse(t));
    // The Sun's latitude has the engine's sign (north): it used to be about 0.7 degrees south.
    expect(g.subsolar_lat).toBeGreaterThan(0);
    expect(Math.abs(g.subsolar_lat - sun.lat)).toBeLessThan(0.03);
    expect(Math.abs(wrap180(g.subsolar_lon_east - sun.lon))).toBeLessThan(0.1);
    expect(Math.abs(g.subearth_lat - earth.lat)).toBeLessThan(0.3);
    expect(Math.abs(wrap180(g.subearth_lon_east - earth.lon))).toBeLessThan(0.2);
  });

  it('gives the season line the engine gives: winter at the lunar south pole at the default landing', () => {
    expect(southPoleSeason(geometryAt(LANDING).subsolar_lat)).toBe('winter');
    expect(southPoleSeason(geometryAt(Date.parse(ENGINE[0].t)).subsolar_lat)).toBe('winter');
  });
});

describe('the backend’s rules in the example model', () => {
  it('fits by every published capacity figure: fits, does not fit, or depends on the figure', () => {
    expect(fitCheck([{ id: 'starship_hls', count: 1 }, { id: 'surface_habitat', count: 1 }])).toMatchObject({ fits: true, verdict: 'fits' });
    const between = fitCheck([{ id: 'starship_hls', count: 1 }, { id: 'surface_habitat', count: 1 }, { id: 'logistics', count: 1 }]);
    expect(between).toMatchObject({ fits: null, verdict: 'depends on capacity figure' });
    // One line for each figure, naming it, as the backend gives them.
    expect(between.notes.filter((n) => n.startsWith('Starship HLS, '))).toHaveLength(2);
    expect(fitCheck([{ id: 'griffin', count: 1 }, { id: 'surface_habitat', count: 1 }])).toMatchObject({ fits: false, verdict: 'does not fit' });
    expect(fitCheck([{ id: 'griffin', count: 1 }, { id: 'jaxa_pressurized_rover', count: 1 }])).toMatchObject({ fits: null, verdict: 'mass needed' });
    expect(fitCheck([{ id: 'surface_habitat', count: 1 }])).toMatchObject({ fits: false, verdict: 'no lander' });
    expect(fitCheck([{ id: 'griffin', count: 1 }])).toMatchObject({ fits: true, verdict: 'nothing to fit' });
  });

  it('says UNKNOWN, not pass, when a requirement cannot be checked (no published slope limit), and ranks pass, unknown, fail', () => {
    const hls = evaluateSite(SHORT_DARK, LANDING, STAY, NUCLEAR, 0).evaluation;
    expect(hls.verdict).toEqual({ result: 'unknown', requirement: 'landing slope', unknown_requirements: ['landing slope'] });
    expect(hls.requirements.find((r) => r.requirement === 'landing slope')!.passed).toBeNull();
    const griffin = evaluateSite(SHORT_DARK, LANDING, STAY, [{ id: 'griffin', count: 1 }], 0).evaluation;
    expect(griffin.verdict.result).toBe('pass');
    const failing = evaluateSite(LONG_DARK, LANDING, STAY, SOLAR, 0).evaluation;
    expect(failing.verdict.result).toBe('fail');
    const ranked = rankResults([{ ...failing, site_id: 'c', score: 99 }, { ...hls, site_id: 'b', score: 98 }, { ...griffin, site_id: 'a', score: 1 }]);
    expect(ranked.map((r) => [r.site_id, r.rank])).toEqual([
      ['a', 1],
      ['b', 2],
      ['c', 3],
    ]);
  });
});
