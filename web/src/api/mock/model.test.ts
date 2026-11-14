// The mock model's power answers: darkness taken from the stay, typed storage counted, and the
// contrast the planner is meant to show between a site with long darkness and one with short.

import { describe, expect, it } from 'vitest';
import sitesJson from '../examples/sites.json';
import type { HardwareChoice, SiteRef } from '../types';
import { landingMsFor } from './index';
import { evaluateSite, genericCheck, longestDarknessHours } from './model';
import { storageToCover } from '../../util/power';

const SITES = sitesJson.sites as SiteRef[];
const site = (id: string) => SITES.find((s) => s.id === id)!;
// The website's default launch (10 Feb 2027, 15:00 UTC) and stay (14 days).
const LANDING = landingMsFor('2027-02-10T15:00:00Z', 0);
const STAY = 14;
const SOLAR: HardwareChoice[] = [
  { id: 'starship', count: 1 },
  { id: 'solar', count: 7 },
];
const NUCLEAR: HardwareChoice[] = [
  { id: 'starship', count: 1 },
  { id: 'nuclear', count: 1 },
];
const LONG_DARK = site('blue-ghost-m1');
const SHORT_DARK = site('shackleton-ridge');

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
    expect(evaluation.verdict).toEqual({ result: 'fail', requirement: 'night power' });
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
    // Night load x darkness: the Starship lander's 3 kW at night, with nothing working in darkness.
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
    const plans: HardwareChoice[][] = [SOLAR, [{ id: 'griffin', count: 1 }], [{ id: 'starship', count: 1 }, { id: 'hab', count: 1 }, { id: 'rover', count: 2 }]];
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
