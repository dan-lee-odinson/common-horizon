// The mock's power arithmetic must give the planner module's answers. Figures come from the worked
// example in planner/README.md ("power_check"); the cases marked "planner run" were worked out by
// running planner.power_check on the same inputs.
//
// The worked example's site: crewed habitat 20 kW (always), worksite lighting 1 kW (dark),
// comms relay 0.2 kW (always), one keep-alive heater 0.14 kW (dark), crew rover recharge 2 kW
// (sunlight) and rover keep-warm 9.7 kWh per night.
//   night load = 20 + 1 + 0.2 + 0.14 = 21.34 kW     day load = 20 + 0.2 + 2 = 22.2 kW

import { describe, expect, it } from 'vitest';
import { LUNAR_MONTH_HOURS, balanceOf, marginPercent, marginStatus, powerCheck, type PowerInputs } from './power';

const SITE: PowerInputs = { dayLoadKw: 22.2, nightLoadKw: 21.34, perNightKwh: 9.7, longestDarknessH: null };
/** The site plus the ISRU pilot plant (20 kW in sunlight). */
const SITE_ISRU: PowerInputs = { ...SITE, dayLoadKw: 42.2 };
const FISSION_40 = { continuousSourcesKw: 40 };
const FISSION_100 = { continuousSourcesKw: 100 };
/** Five 10 kW solar arrays (VSAT): sunlight only. */
const SOLAR_50 = { sunlightOnlySourcesKw: 50 };

describe('margin and colour (planner rules)', () => {
  it('works out margin percent as (available - load) / available x 100', () => {
    expect(marginPercent(40, 21.34)).toBe(46.65);
    expect(marginPercent(100, 21.34)).toBe(78.66);
    expect(marginPercent(100, 125)).toBe(-25);
    expect(marginPercent(0, 5)).toBeNull();
  });

  it('is green at 25 or more, yellow from 0 up to 25, red when negative', () => {
    expect(marginStatus(25, 1)).toBe('green');
    expect(marginStatus(24.99, 1)).toBe('yellow');
    expect(marginStatus(0, 1)).toBe('yellow');
    expect(marginStatus(-0.01, 1)).toBe('red');
  });

  it('is red when a load has nothing to power it, and none when there is nothing at all', () => {
    expect(marginStatus(null, 3)).toBe('red');
    expect(marginStatus(null, 0)).toBe('none');
  });
});

describe('night check: storage covers the longest darkness', () => {
  it('needs about 1,546 kWh at 72 hours of darkness (21.34 kW night load, 9.7 kWh per night)', () => {
    const r = powerCheck({ ...SITE, longestDarknessH: 72 });
    expect(r.night.load_kw).toBeCloseTo(21.34, 9);
    expect(r.night.per_night_kwh).toBe(9.7);
    expect(r.night.storage_needed_kwh).toBeCloseTo(1546.18, 6);
  });

  it('needs about 2,571 kWh at 120 hours of darkness', () => {
    expect(powerCheck({ ...SITE, longestDarknessH: 120 }).night.storage_needed_kwh).toBeCloseTo(2570.5, 6);
  });

  it('gives fission 40 kWe a night margin of 46.65 % and 100 kWe 78.66 %, with or without a darkness length', () => {
    for (const dark of [null, 72]) {
      const f40 = powerCheck({ ...SITE, ...FISSION_40, longestDarknessH: dark });
      expect(f40.night.margin_percent).toBe(46.65);
      expect(f40.night.status).toBe('green');
      expect(f40.night.storage_needed_kwh).toBe(dark === null ? null : 0);
      expect(powerCheck({ ...SITE, ...FISSION_100, longestDarknessH: dark }).night.margin_percent).toBe(78.66);
    }
    expect(powerCheck({ ...SITE, ...FISSION_40, longestDarknessH: 72 }).night.basis).toBe('power: sources in darkness carry the night');
  });

  it('fails a solar-only plan at night with no storage: nothing to power the night load', () => {
    const r = powerCheck({ ...SITE, ...SOLAR_50, longestDarknessH: 72 });
    expect(r.night.basis).toBe('energy over the longest darkness');
    expect(r.night.margin_percent).toBeNull();
    expect(r.night.status).toBe('red');
    expect(r.night.passes).toBe(false);
    expect(r.balance).toEqual({ margin_percent: null, status: 'red', limiting: 'night' });
  });

  it('passes the same plan once enough storage is typed (planner run)', () => {
    const exact = powerCheck({ ...SITE, ...SOLAR_50, storageKwh: 1546.18, longestDarknessH: 72 });
    expect(exact.night.margin_percent).toBe(0);
    expect(exact.night.status).toBe('yellow');
    expect(exact.night.passes).toBe(true);

    const ample = powerCheck({ ...SITE, ...SOLAR_50, storageKwh: 2100, longestDarknessH: 72 });
    expect(ample.night.margin_percent).toBeCloseTo(26.372380952, 6);
    expect(ample.night.status).toBe('green');
    expect(ample.passes).toBe(true);
  });

  it('counts storage as energy over the darkness: 3,000 kWh at 120 hours is a thin margin (planner run)', () => {
    const r = powerCheck({ ...SITE, ...SOLAR_50, storageKwh: 3000, longestDarknessH: 120 });
    expect(r.night.margin_percent).toBeCloseTo(14.316666667, 6);
    expect(r.night.status).toBe('yellow');
    expect(r.balance.limiting).toBe('night');
  });

  it('uses night-only sources before storage (planner run: fuel cell 10 kW, 1,000 kWh stored)', () => {
    const r = powerCheck({ ...SITE, ...SOLAR_50, nightOnlySourcesKw: 10, storageKwh: 1000, longestDarknessH: 72 });
    expect(r.night.storage_needed_kwh).toBeCloseTo(826.18, 6);
    expect(r.night.margin_percent).toBeCloseTo(10.105813953, 6);
    expect(r.day.refill_kwh).toBeCloseTo(1546.18, 6); // fuel cell energy plus storage, both refilled by day
  });

  it('has no night to check when the stay has no darkness, and drops the per-night items', () => {
    const r = powerCheck({ ...SITE, ...SOLAR_50, longestDarknessH: 0 });
    expect(r.night.status).toBe('none');
    expect(r.night.per_night_kwh).toBe(0);
    expect(r.night.passes).toBe(true);
    expect(r.balance.limiting).toBe('day');
  });

  it('compares power only, and does not count storage, without a darkness length', () => {
    const r = powerCheck({ ...SITE, sunlightOnlySourcesKw: 10, storageKwh: 5000, longestDarknessH: null });
    expect(r.night.basis).toBe('power (no darkness duration given)');
    expect(r.night.storage_needed_kwh).toBeNull();
    expect(r.night.status).toBe('red');
    expect(r.day.margin_percent).toBe(-122); // planner run
    expect(r.balance.limiting).toBe('night');
    expect(r.notes.join(' ')).toMatch(/storage/);
  });
});

describe('day check: sunlight covers the day load plus the refill', () => {
  it('gives fission 100 kWe a day margin of 57.8 % with the ISRU pilot plant', () => {
    expect(powerCheck({ ...SITE_ISRU, ...FISSION_100, longestDarknessH: null }).day.margin_percent).toBe(57.8);
  });

  it('leaves fission 40 kWe 2.2 kW short in daylight with the ISRU pilot plant', () => {
    const r = powerCheck({ ...SITE_ISRU, ...FISSION_40, longestDarknessH: null });
    expect(r.day.surplus).toBeCloseTo(-2.2, 9);
    expect(r.day.margin_percent).toBe(-5.5);
    expect(r.day.status).toBe('red');
    expect(r.balance).toEqual({ margin_percent: -5.5, status: 'red', limiting: 'day' });
  });

  it('adds the power to refill storage over one lunar month minus the darkness (planner run)', () => {
    const r = powerCheck({ ...SITE, ...SOLAR_50, storageKwh: 2100, longestDarknessH: 72 });
    expect(r.day.refill_hours).toBeCloseTo(LUNAR_MONTH_HOURS - 72, 9);
    expect(r.day.refill_kwh).toBeCloseTo(1546.18, 6);
    expect(r.day.refill_kw).toBeCloseTo(1546.18 / 636.73, 9);
    expect(r.day.margin_percent).toBeCloseTo(50.743373172, 6);
    expect(powerCheck({ ...SITE, ...SOLAR_50, storageKwh: 3000, longestDarknessH: 120 }).day.margin_percent).toBeCloseTo(46.867643911, 6);
  });

  it('refills the full storage need even when typed storage falls short', () => {
    const r = powerCheck({ ...SITE, ...SOLAR_50, storageKwh: 100, longestDarknessH: 72 });
    expect(r.day.refill_kwh).toBeCloseTo(1546.18, 6);
  });

  it('fails the day check when storage must be refilled but there are no sunlit hours', () => {
    const r = powerCheck({ ...SITE, ...SOLAR_50, storageKwh: 20000, longestDarknessH: 800 });
    expect(r.day.passes).toBe(false);
    expect(r.day.status).toBe('red');
    expect(r.notes.join(' ')).toMatch(/no sunlit hours/);
  });
});

describe('balance: the worse of the two checks', () => {
  it('takes the lower margin and names it', () => {
    expect(balanceOf({ margin_percent: 44.5, status: 'green' }, { margin_percent: 46.65, status: 'green' })).toEqual({ margin_percent: 44.5, status: 'green', limiting: 'day' });
  });

  it('names both on a tie and skips checks with nothing to check', () => {
    expect(balanceOf({ margin_percent: null, status: 'red' }, { margin_percent: null, status: 'red' }).limiting).toBe('day and night');
    expect(balanceOf({ margin_percent: 30, status: 'green' }, { margin_percent: null, status: 'none' }).limiting).toBe('day');
    expect(balanceOf({ margin_percent: null, status: 'none' }, { margin_percent: null, status: 'none' })).toEqual({ margin_percent: null, status: 'none', limiting: null });
  });
});
