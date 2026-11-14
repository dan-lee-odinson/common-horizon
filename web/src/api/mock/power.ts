// Power arithmetic for mock mode. It follows the planner module's rules as planner/README.md states
// them ("power_check"), so the example answers behave like the real ones will. The backend calls
// the planner module itself; this copy only feeds the website's mock. If the planner's rules change,
// change this file and its tests (power.test.ts) with them.
//
//   Margin percent = (available - load) / available x 100.
//   Colour: green at 25 or more, yellow from 0 up to 25, red when negative.
//   Day check:   sources working in sunlight cover the day load plus the power to refill storage.
//   Night check: storage covers (night load - sources working in darkness) x the longest darkness,
//                plus the per-night items. Sources are used in this order: continuous sources,
//                then night-only sources, then storage.
//   Balance:     the worse of the two.

/** One lunar month in hours (the planner catalog's constant). */
export const LUNAR_MONTH_HOURS = 708.73;
/** The green line in percent (Pre-Phase A value in GSFC-STD-1000 Rev I, Table 1.06-1). */
export const GREEN_AT_PERCENT = 25;

/** Tolerance for comparing floating-point energies and powers (the planner's _EPS). */
const EPS = 1e-9;

export type Status = 'green' | 'yellow' | 'red' | 'none';

/** (available - load) / available x 100, rounded to 9 decimals; null when nothing is available. */
export function marginPercent(available: number, load: number): number | null {
  if (available <= 0) return null;
  return Math.round(((available - load) / available) * 100 * 1e9) / 1e9 + 0;
}

/** Colour for a margin. A load with nothing to power it is red; nothing at all is "none". */
export function marginStatus(margin: number | null, load: number, greenAt = GREEN_AT_PERCENT): Status {
  if (margin === null) return load > EPS ? 'red' : 'none';
  if (margin >= greenAt) return 'green';
  if (margin >= 0) return 'yellow';
  return 'red';
}

export interface PowerInputs {
  /** Loads that draw in sunlight (run "always" or "light"), kW. */
  dayLoadKw: number;
  /** Loads that draw in darkness (run "always" or "dark"), kW. */
  nightLoadKw: number;
  /** Per-night energy items of the loads that run in darkness, kWh. */
  perNightKwh?: number;
  /** Sources that work in sunlight only (solar), kW. */
  sunlightOnlySourcesKw?: number;
  /** Sources that work day and night (fission), kW. */
  continuousSourcesKw?: number;
  /** Sources that work in darkness only (a regenerative fuel cell), kW. */
  nightOnlySourcesKw?: number;
  /** Typed storage, kWh. There is no default storage. */
  storageKwh?: number;
  /** Longest darkness at the site, hours. null = not known: the night check then compares power only. */
  longestDarknessH: number | null;
  /** Sunlit hours to refill storage. Default: one lunar month minus the longest darkness (our estimate). */
  refillHours?: number | null;
}

export type NightBasis =
  | 'power (no darkness duration given)'
  | 'no darkness'
  | 'power: sources in darkness carry the night'
  | 'energy over the longest darkness';

export interface DayResult {
  available: number;
  /** Day load plus refill power, kW. */
  load: number;
  load_kw: number;
  refill_kw: number;
  refill_kwh: number;
  refill_hours: number | null;
  surplus: number;
  margin_percent: number | null;
  status: Status;
  passes: boolean;
}

export interface NightResult {
  basis: NightBasis;
  longest_darkness_h: number | null;
  /** In the unit of `unit`: kW for a power basis, kWh for the energy basis; null with no darkness. */
  available: number | null;
  load: number | null;
  unit: 'kW' | 'kWh' | null;
  surplus: number | null;
  margin_percent: number | null;
  status: Status;
  passes: boolean;
  load_kw: number;
  sources_kw: number;
  continuous_sources_kw: number;
  night_only_sources_kw: number;
  per_night_kwh: number;
  storage_kwh: number;
  storage_needed_kwh: number | null;
  available_kwh: number | null;
  load_kwh: number | null;
  surplus_kwh: number | null;
  power_margin_percent: number | null;
  energy_margin_percent: number | null;
}

export interface BalanceResult {
  margin_percent: number | null;
  status: Status;
  limiting: 'day' | 'night' | 'day and night' | null;
}

export interface PowerResult {
  day: DayResult;
  night: NightResult;
  balance: BalanceResult;
  passes: boolean;
  notes: string[];
}

function nonNegative(x: number | undefined | null): number {
  return x !== undefined && x !== null && Number.isFinite(x) && x > 0 ? x : 0;
}

export function powerCheck(inputs: PowerInputs): PowerResult {
  const dayLoad = nonNegative(inputs.dayLoadKw);
  const nightLoad = nonNegative(inputs.nightLoadKw);
  let perNight = nonNegative(inputs.perNightKwh);
  const sunlightOnly = nonNegative(inputs.sunlightOnlySourcesKw);
  const continuous = nonNegative(inputs.continuousSourcesKw);
  const nightOnly = nonNegative(inputs.nightOnlySourcesKw);
  const storage = nonNegative(inputs.storageKwh);
  const daySources = sunlightOnly + continuous;
  const nightSources = continuous + nightOnly;
  const powerMargin = marginPercent(nightSources, nightLoad);
  const notes: string[] = [];

  const base = {
    load_kw: nightLoad,
    sources_kw: nightSources,
    continuous_sources_kw: continuous,
    night_only_sources_kw: nightOnly,
    storage_kwh: storage,
    power_margin_percent: powerMargin,
  };

  let night: NightResult;
  let refillKwh = 0;

  if (inputs.longestDarknessH === null || !Number.isFinite(inputs.longestDarknessH)) {
    night = {
      ...base,
      basis: 'power (no darkness duration given)',
      longest_darkness_h: null,
      per_night_kwh: perNight,
      available: nightSources,
      load: nightLoad,
      unit: 'kW',
      surplus: nightSources - nightLoad,
      margin_percent: powerMargin,
      status: 'none',
      passes: nightSources + EPS >= nightLoad,
      storage_needed_kwh: null,
      available_kwh: null,
      load_kwh: null,
      surplus_kwh: null,
      energy_margin_percent: null,
    };
    if (storage > 0 || perNight > 0 || nightOnly > 0) {
      notes.push('No darkness length is known yet, so storage, per-night energy and refilling are not counted.');
    }
  } else {
    const dark = Math.max(0, inputs.longestDarknessH);
    if (dark === 0) {
      if (perNight > 0) notes.push('No darkness at this site: per-night energy items do not apply.');
      perNight = 0;
    }
    const availableKwh = nightSources * dark + storage;
    const loadKwh = nightLoad * dark + perNight;
    // Order of use through the night: continuous sources, then night-only sources, then storage.
    const deficit = Math.max(0, loadKwh - continuous * dark);
    const nightOnlyUsed = Math.min(nightOnly * dark, deficit);
    const storageNeeded = Math.max(0, deficit - nightOnlyUsed);
    refillKwh = nightOnlyUsed + storageNeeded;
    const energyMargin = marginPercent(availableKwh, loadKwh);
    const common = {
      ...base,
      longest_darkness_h: dark,
      per_night_kwh: perNight,
      available_kwh: availableKwh,
      load_kwh: loadKwh,
      surplus_kwh: availableKwh - loadKwh,
      storage_needed_kwh: storageNeeded,
      energy_margin_percent: energyMargin,
      passes: storage + EPS >= storageNeeded,
      status: 'none' as Status,
    };
    if (dark === 0) {
      night = { ...common, basis: 'no darkness', available: null, load: null, unit: null, surplus: null, margin_percent: null };
    } else if (storageNeeded <= EPS) {
      // The sources working in darkness carry the whole night, per-night items included.
      night = {
        ...common,
        basis: 'power: sources in darkness carry the night',
        available: nightSources,
        load: nightLoad,
        unit: 'kW',
        surplus: nightSources - nightLoad,
        margin_percent: powerMargin,
      };
    } else {
      night = {
        ...common,
        basis: 'energy over the longest darkness',
        available: availableKwh,
        load: loadKwh,
        unit: 'kWh',
        surplus: availableKwh - loadKwh,
        margin_percent: energyMargin,
      };
    }
  }
  night.status = night.basis === 'no darkness' ? 'none' : marginStatus(night.margin_percent, night.load ?? 0);

  // Day: sources working in sunlight against the day load plus the refill power.
  let refillKw = 0;
  let refillHours: number | null = null;
  let refillImpossible = false;
  if (night.longest_darkness_h !== null) {
    refillHours =
      inputs.refillHours !== undefined && inputs.refillHours !== null ? Math.max(0, inputs.refillHours) : Math.max(0, LUNAR_MONTH_HOURS - night.longest_darkness_h);
    if (refillKwh > EPS) {
      if (refillHours <= 0) {
        // The planner stops with an error here ("type refill_hours"); the mock reports a failed day check instead.
        refillImpossible = true;
        notes.push('Storage must be refilled, but there are no sunlit hours to do it.');
      } else {
        refillKw = refillKwh / refillHours;
      }
    }
  }
  const dayTotal = dayLoad + refillKw;
  const dayMargin = refillImpossible ? null : marginPercent(daySources, dayTotal);
  const day: DayResult = {
    available: daySources,
    load: dayTotal,
    load_kw: dayLoad,
    refill_kw: refillKw,
    refill_kwh: refillKwh,
    refill_hours: refillHours,
    surplus: daySources - dayTotal,
    margin_percent: dayMargin,
    status: refillImpossible ? 'red' : marginStatus(dayMargin, dayTotal),
    passes: !refillImpossible && daySources + EPS >= dayTotal,
  };

  return { day, night, balance: balanceOf(day, night), passes: day.passes && night.passes, notes };
}

/** The worse of the day and night checks; checks with status "none" do not count. */
export function balanceOf(day: Pick<DayResult, 'margin_percent' | 'status'>, night: Pick<NightResult, 'margin_percent' | 'status'>): BalanceResult {
  const candidates: { rank: number; name: 'day' | 'night'; margin: number | null; status: Status }[] = [];
  for (const [name, block] of [
    ['day', day],
    ['night', night],
  ] as const) {
    if (block.status === 'none') continue;
    candidates.push({ rank: block.margin_percent ?? Number.NEGATIVE_INFINITY, name, margin: block.margin_percent, status: block.status });
  }
  if (candidates.length === 0) return { margin_percent: null, status: 'none', limiting: null };
  const worst = Math.min(...candidates.map((c) => c.rank));
  const tied = candidates.filter((c) => c.rank === worst);
  return {
    margin_percent: tied[0].margin,
    status: tied[0].status,
    limiting: tied.length === 2 ? 'day and night' : tied[0].name,
  };
}
