// The website's example model. It stands in for the Python backend so every screen has
// believable, slip-dependent numbers, in exactly the backend's shapes (src/api/types.ts). It is
// deliberately simple:
//   * the Sun's overhead point moves once around the Moon every synodic month (29.53 days),
//     with a small north-south swing; Earth's overhead point wobbles around 0° N 0° E (libration).
//     The phases are set so that both points sit close to the physics engine's in February 2027
//     (see mock-model.json and src/api/mock/model.test.ts);
//   * each site gets an invented terrain skyline (seeded, so it is the same on every load);
//   * the stay is sampled in time steps: is any part of the Sun's disc above the skyline? is Earth?
// None of this is ephemeris-grade. The backend replaces it.
// Fit, power, score, requirements and ranking follow the backend's rules (backend/docs/WEBSITE_API.md):
// the planner module's fit and power checks (./power.ts, planner/README.md) and the ranking rules
// (score = 0.40 sunlight + 0.25 darkness + 0.20 Earth + 0.15 slope; requirements in a fixed order).

import modelJson from '../examples/mock-model.json';
import catalogJson from '../examples/catalog.json';
import type {
  CatalogItem,
  CheckResponse,
  DataProvenance,
  DayCheck,
  EarthLink,
  FitVerdict,
  Geometry,
  HardwareChoice,
  HorizonResponse,
  NightBasis,
  NightCheck,
  RequirementCheck,
  SiteEnergy,
  SiteEvaluation,
  SiteRef,
  SkyBox,
  SkyPoint,
  SunPathPoint,
  Verdict,
} from '../types';
import { sunWidthDeg } from '../../util/bodies';
import { azElFromSubpoint, normalizeLon360, sampleProfile, wrap180 } from '../../util/geo';
import { DAY_MS, HOUR_MS, toIsoUtc } from '../../util/time';
import { TRANSIT_DAYS } from '../../util/transit';
import { powerCheck, type PowerResult } from './power';

/** Re-exported for the tests that build a landing time the way the website asks for one. */
export { TRANSIT_DAYS };

interface Terrain {
  slope_deg: number;
  horizon_scale_deg: number;
  horizon_offset_deg: number;
}

const M = modelJson;
const REF_MS = Date.parse(M.reference_new_moon_utc);
const TERRAIN = M.terrain as Record<string, Terrain>;
export const MOCK_CATALOG = catalogJson.items as unknown as CatalogItem[];
export const MOCK_STATUS_LABELS = catalogJson.status_labels as string[];

/** Where the example model's numbers come from, in the backend's provenance shape. */
export const MOCK_PROVENANCE: DataProvenance = {
  source: 'synthetic',
  is_synthetic: true,
  engine_name: 'website-example-model',
  engine_version: '1',
  notice: "EXAMPLE DATA: the website's own simplified model (src/api/mock/). The geometry is simplified and the terrain is invented. Do not use these numbers for planning.",
  sources: [],
};

/** What the example model's slopes are, said the way the backend says what its slope is (`slope_source`). */
export const MOCK_SLOPE_SOURCE = 'example model: an invented slope, not a measured one';

const TAU = Math.PI * 2;
/** Half the Sun's apparent width: "above" means any part of the disc shows over the skyline. */
const SUN_RADIUS_DEG = sunWidthDeg() / 2;

function frac(x: number): number {
  return x - Math.floor(x);
}

// ---------- geometry ----------

/** Where the Sun is straight overhead on the Moon at a UTC instant (example geometry). */
export function subsolarPoint(tMs: number): { lat: number; lonEast: number } {
  const days = (tMs - REF_MS) / DAY_MS;
  const phase = frac(days / M.synodic_month_days); // 0 = new moon, 0.5 = full moon
  return {
    lat: M.subsolar_lat_amplitude_deg * Math.sin((TAU * (days + M.subsolar_lat_phase_days)) / M.subsolar_lat_period_days),
    // New moon: Sun over the far side (180° E). Full moon: over the near side (0° E).
    lonEast: normalizeLon360(180 - 360 * phase + M.subsolar_lon_offset_deg),
  };
}

/** Where Earth is straight overhead on the Moon (libration wobble around 0° N, 0° E). */
export function subearthPoint(tMs: number): { lat: number; lonEast: number } {
  const days = (tMs - REF_MS) / DAY_MS;
  return {
    lat: M.subearth_lat_amplitude_deg * Math.sin((TAU * (days + M.subearth_lat_phase_days)) / M.subearth_lat_period_days),
    lonEast: normalizeLon360(M.subearth_lon_amplitude_deg * Math.sin((TAU * (days + M.subearth_lon_phase_days)) / M.subearth_lon_period_days)),
  };
}

export function geometryAt(tMs: number): Geometry {
  const s = subsolarPoint(tMs);
  const e = subearthPoint(tMs);
  return {
    subsolar_lat: round(s.lat, 4),
    subsolar_lon_east: round(s.lonEast, 4),
    subearth_lat: round(e.lat, 4),
    subearth_lon_east: round(e.lonEast, 4),
  };
}

// ---------- terrain ----------

function hashString(text: string): number {
  // FNV-1a, 32 bit.
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function siteSeed(site: SiteRef): number {
  return hashString(`${site.lat.toFixed(4)},${normalizeLon360(site.lon_east).toFixed(4)}`);
}

export function terrainFor(site: SiteRef): Terrain {
  const known = TERRAIN[site.id];
  if (known) return known;
  const rng = mulberry32(siteSeed(site) ^ 0x9e3779b9);
  const polar = Math.abs(site.lat) > 75;
  return {
    slope_deg: round((polar ? 5 : 2) + rng() * 7, 1),
    horizon_scale_deg: round((polar ? 1.8 : 0.8) + rng() * 1.2, 2),
    horizon_offset_deg: round(rng() * 0.8, 2),
  };
}

/** Invented terrain skyline, one point per degree of azimuth. Same input, same skyline. */
export function skylineFor(site: SiteRef): SkyPoint[] {
  const t = terrainFor(site);
  const rng = mulberry32(siteSeed(site));
  const harmonics = Array.from({ length: 6 }, (_, i) => ({
    k: i + 1,
    a: (rng() * 2 - 1) / (i + 1),
    p: rng() * TAU,
  }));
  const bumps = Array.from({ length: 3 }, () => ({
    c: rng() * 360,
    w: 6 + rng() * 20,
    h: rng() * 1.3,
  }));
  const points: SkyPoint[] = [];
  for (let az = 0; az < 360; az++) {
    let v = 0;
    for (const hm of harmonics) v += hm.a * Math.sin(hm.k * az * (Math.PI / 180) + hm.p);
    v *= 0.5;
    for (const b of bumps) {
      const d = wrap180(az - b.c) / b.w;
      v += b.h * Math.exp(-d * d);
    }
    const el = Math.max(-1.5, t.horizon_offset_deg + t.horizon_scale_deg * v);
    points.push({ az, el: round(el, 3) });
  }
  return points;
}

/** Share of the low sky band (0..band degrees) that terrain leaves open, in percent. */
export function clearSkyPercent(skyline: SkyPoint[]): number {
  const band = M.clear_sky_band_deg;
  let open = 0;
  for (const p of skyline) open += 1 - Math.min(1, Math.max(0, p.el) / band);
  return (open / skyline.length) * 100;
}

// ---------- time sampling ----------

export interface Sample {
  t: number;
  sunAz: number;
  sunEl: number;
  /** Any part of the Sun's disc is above the skyline (the backend's rule for "above" and for sunlight). */
  sunAbove: boolean;
  earthAz: number;
  earthEl: number;
  earthVisible: boolean;
}

export function sampleWindow(site: SiteRef, startMs: number, endMs: number, steps: number, skyline = skylineFor(site)): Sample[] {
  const out: Sample[] = [];
  const n = Math.max(1, Math.round(steps));
  const dt = (endMs - startMs) / n;
  for (let i = 0; i <= n; i++) {
    const t = startMs + i * dt;
    const s = subsolarPoint(t);
    const e = subearthPoint(t);
    const sun = azElFromSubpoint(site.lat, site.lon_east, s.lat, s.lonEast);
    const earth = azElFromSubpoint(site.lat, site.lon_east, e.lat, e.lonEast);
    out.push({
      t,
      sunAz: sun.az,
      sunEl: sun.el,
      sunAbove: sun.el + SUN_RADIUS_DEG > sampleProfile(skyline, sun.az),
      earthAz: earth.az,
      earthEl: earth.el,
      earthVisible: earth.el > sampleProfile(skyline, earth.az) + M.earth_link_margin_deg,
    });
  }
  return out;
}

function stepsForStay(stayDays: number): number {
  return Math.min(1500, Math.max(200, Math.round(stayDays * 24)));
}

// ---------- hardware and power ----------

/**
 * The selected hardware in the planner module's terms. A missing figure (null: not published, or
 * not of this kind) counts as nothing.
 */
interface PowerTotals {
  genSunKw: number;
  genAlwaysKw: number;
  loadDayKw: number;
  loadNightKw: number;
  perNightKwh: number;
}

function selectedItems(hardware: HardwareChoice[], catalog: CatalogItem[]) {
  return hardware
    .map((h) => ({ item: catalog.find((c) => c.id === h.id), count: Math.max(0, h.count) }))
    .filter((x): x is { item: CatalogItem; count: number } => Boolean(x.item) && x.count > 0);
}

function powerTotals(hardware: HardwareChoice[], catalog: CatalogItem[]): PowerTotals {
  const totals: PowerTotals = { genSunKw: 0, genAlwaysKw: 0, loadDayKw: 0, loadNightKw: 0, perNightKwh: 0 };
  for (const { item, count } of selectedItems(hardware, catalog)) {
    const gen = item.gen_kw ?? 0;
    if (item.gen_needs_sun === true) totals.genSunKw += gen * count;
    else totals.genAlwaysKw += gen * count;
    totals.loadDayKw += (item.load_day_kw ?? 0) * count;
    totals.loadNightKw += (item.load_night_kw ?? 0) * count;
    totals.perNightKwh += (item.energy_per_night_kwh ?? 0) * count;
  }
  return totals;
}

function runPowerCheck(p: PowerTotals, storageKwh: number, longestDarknessH: number | null): PowerResult {
  return powerCheck({
    dayLoadKw: p.loadDayKw,
    nightLoadKw: p.loadNightKw,
    perNightKwh: p.perNightKwh,
    sunlightOnlySourcesKw: p.genSunKw,
    continuousSourcesKw: p.genAlwaysKw,
    storageKwh,
    longestDarknessH,
  });
}

/**
 * The longest unbroken spell of darkness inside the stay, in hours. Each sample stands for one
 * time step; the answer never exceeds the stay. 0 when the Sun is up for every sample.
 */
export function longestDarknessHours(samples: readonly Pick<Sample, 'sunAbove'>[], stayHours: number): number {
  if (samples.length === 0 || stayHours <= 0) return 0;
  const stepHours = samples.length > 1 ? stayHours / (samples.length - 1) : stayHours;
  let run = 0;
  let longest = 0;
  for (const s of samples) {
    run = s.sunAbove ? 0 : run + 1;
    longest = Math.max(longest, run);
  }
  return Math.min(stayHours, longest * stepHours);
}

/** How many separate dark spells the samples hold (at least 1, as the planner's site_energy requires). */
function darkSpells(samples: readonly Pick<Sample, 'sunAbove'>[]): number {
  let spells = 0;
  let dark = false;
  for (const s of samples) {
    if (!s.sunAbove && !dark) spells++;
    dark = !s.sunAbove;
  }
  return Math.max(1, spells);
}

const BASIS: Record<PowerResult['night']['basis'], NightBasis> = {
  'energy over the longest darkness': 'energy',
  'power: sources in darkness carry the night': 'power',
  'power (no darkness duration given)': 'power only',
  'no darkness': 'no darkness',
};

function dayCheckOf(r: PowerResult): DayCheck {
  const d = r.day;
  return {
    needed: d.status !== 'none',
    generation_kw: round(d.available, 2),
    load_kw: round(d.load_kw, 2),
    refill_kw: round(d.refill_kw, 2),
    refill_kwh: round(d.refill_kwh, 1),
    refill_hours: d.refill_hours === null ? null : round(d.refill_hours, 1),
    margin_percent: nullableRound(d.margin_percent, 2),
    status: d.status,
    passes: d.passes,
  };
}

function nightCheckOf(r: PowerResult): NightCheck {
  const n = r.night;
  return {
    needed: n.status !== 'none',
    basis: BASIS[n.basis],
    generation_kw: round(n.sources_kw, 2),
    load_kw: round(n.load_kw, 2),
    per_night_kwh: round(n.per_night_kwh, 2),
    longest_darkness_h: n.longest_darkness_h === null ? null : round(n.longest_darkness_h, 1),
    storage_kwh: n.storage_kwh,
    // Rounded up, never down: typing the suggested figure must pass the night check.
    storage_needed_kwh: n.storage_needed_kwh === null ? null : Math.ceil(n.storage_needed_kwh * 10 - 1e-9) / 10,
    available_kwh: nullableRound(n.available_kwh, 1),
    load_kwh: nullableRound(n.load_kwh, 1),
    margin_percent: nullableRound(n.margin_percent, 2),
    status: n.status,
    passes: n.passes,
  };
}

function kg(n: number): string {
  return `${Math.round(n).toLocaleString('en-US')} kg`;
}

export interface FitResult {
  fits: boolean | null;
  verdict: FitVerdict;
  notes: string[];
}

/**
 * The fit check, by the planner's rules as the backend answers them: the payload mass against each
 * of the lander's published capacity figures, one line each. Every figure fits: fits. None: does not
 * fit. Some but not all: it depends on the capacity figure (fits is null). A payload whose mass is
 * not published: mass needed (null). No lander: fails. A lander with no payload: nothing to fit.
 */
export function fitCheck(hardware: HardwareChoice[], catalog: CatalogItem[] = MOCK_CATALOG): FitResult {
  const items = selectedItems(hardware, catalog);
  const landers = items.filter((x) => x.item.kind === 'lander');
  const payload = items.filter((x) => x.item.kind === 'cargo');
  const lander = landers[0]?.item;
  if (!lander) return { fits: false, verdict: 'no lander', notes: ['No lander chosen: pick one to carry the payload.'] };
  if (payload.length === 0) return { fits: true, verdict: 'nothing to fit', notes: [`${lander.name}: no payload chosen, nothing to fit.`] };
  const missing = payload.filter((x) => x.item.mass_kg === null);
  if (missing.length > 0) {
    return { fits: null, verdict: 'mass needed', notes: missing.map((x) => `${x.item.name}: mass not published, so the fit cannot be checked.`) };
  }
  const massKg = payload.reduce((s, x) => s + (x.item.mass_kg ?? 0) * x.count, 0);
  const options = lander.capacity_options;
  if (options.length === 0) return { fits: null, verdict: 'depends on capacity figure', notes: [`${lander.name}: no capacity figure published.`] };
  const results = options.map((o) => {
    const spare = o.capacity_kg - massKg;
    return {
      fits: spare >= 0,
      note: `${lander.name}, ${o.label} (${kg(o.capacity_kg)}): ${spare >= 0 ? `fits with ${kg(spare)} spare` : `does not fit, ${kg(-spare)} over`}.`,
    };
  });
  const notes = [...results.map((r) => r.note), 'Mass only: dimensions are not checked.'];
  if (results.every((r) => r.fits)) return { fits: true, verdict: 'fits', notes };
  if (results.every((r) => !r.fits)) return { fits: false, verdict: 'does not fit', notes };
  return { fits: null, verdict: 'depends on capacity figure', notes };
}

// ---------- score, requirements and ranking (the backend's rules) ----------

/** One lunar night, hours: the darkness term is 0 from here on. */
const DARKNESS_SCALE_H = 354;
/** Slope at which the slope term reaches 0, degrees. */
const SLOPE_SCALE_DEG = 10;

export function scoreComponents(sunlightPercent: number, longestDarkH: number, earthPercent: number, slopeDeg: number | null) {
  return {
    sunlight: round(sunlightPercent, 3),
    darkness: Math.max(0, 100 * (1 - longestDarkH / DARKNESS_SCALE_H)),
    earth: round(earthPercent, 3),
    slope: slopeDeg === null ? null : Math.max(0, 100 * (1 - slopeDeg / SLOPE_SCALE_DEG)),
  };
}

function scoreOf(c: ReturnType<typeof scoreComponents>, slope: number): number {
  return 0.4 * c.sunlight + 0.25 * c.darkness + 0.2 * c.earth + 0.15 * slope;
}

const VERDICT_GROUP: Record<Verdict['result'], number> = { pass: 0, unknown: 1, fail: 2 };

/**
 * The backend's order: passing sites, then unknown, then failing; within each by score (the worst
 * case, score_min, when the score is not known), then the higher score_max, then site id, then the
 * order asked. Sets `rank` (1 = best).
 */
export function rankResults(results: SiteEvaluation[]): SiteEvaluation[] {
  const order = new Map(results.map((r, i) => [r.site_id, i]));
  const sorted = [...results].sort(
    (a, b) =>
      VERDICT_GROUP[a.verdict.result] - VERDICT_GROUP[b.verdict.result] ||
      (b.score ?? b.score_min) - (a.score ?? a.score_min) ||
      b.score_max - a.score_max ||
      (a.site_id < b.site_id ? -1 : a.site_id > b.site_id ? 1 : 0) ||
      (order.get(a.site_id) ?? 0) - (order.get(b.site_id) ?? 0),
  );
  return sorted.map((r, i) => ({ ...r, rank: i + 1 }));
}

// ---------- one site, one stay ----------

export interface SiteStay {
  evaluation: SiteEvaluation;
  check: CheckResponse;
}

export function evaluateSite(
  site: SiteRef,
  landingMs: number,
  stayDays: number,
  hardware: HardwareChoice[],
  storageKwh = 0,
  catalog: CatalogItem[] = MOCK_CATALOG,
): SiteStay {
  const skyline = skylineFor(site);
  const endMs = landingMs + stayDays * DAY_MS;
  const samples = sampleWindow(site, landingMs, endMs, stepsForStay(stayDays), skyline);
  const lit = samples.filter((s) => s.sunAbove).length / samples.length;
  const earthShare = samples.filter((s) => s.earthVisible).length / samples.length;
  const stayHours = stayDays * 24;
  const darkH = longestDarknessHours(samples, stayHours);

  const p = powerTotals(hardware, catalog);
  const power = runPowerCheck(p, storageKwh, darkH);
  const balance = power.balance;
  const fit = fitCheck(hardware, catalog);
  // The backend's classes: none at 0 %, clear at 100 %, intermittent in between.
  const earthLink: EarthLink = earthShare >= 1 ? 'clear' : earthShare <= 0 ? 'none' : 'intermittent';
  // A slope only for the presets, whose terrain the example model describes; a custom point has
  // none, as with the backend's real engine.
  const slope: number | null = Object.hasOwn(TERRAIN, site.id) ? TERRAIN[site.id].slope_deg : null;
  const lander = selectedItems(hardware, catalog).find((x) => x.item.kind === 'lander')?.item ?? null;
  const slopeLimit = lander?.max_slope_deg ?? null;

  const requirements: RequirementCheck[] = [
    { requirement: 'hardware fit', passed: fit.fits, detail: fit.verdict },
    { requirement: 'night power', passed: power.night.passes, detail: `night status ${power.night.status}` },
    { requirement: 'day power', passed: power.day.passes, detail: `day status ${power.day.status}` },
    // The backend's checks and words (as in its Moon Trek slope change), in its order: lander, then
    // its limit, then the site's slope. The sentence names the slope and what it is.
    {
      requirement: 'landing slope',
      passed: lander === null || slopeLimit === null || slope === null ? null : slope <= slopeLimit,
      detail: `${slope === null ? 'Site slope is unknown' : `Slope ${slope} deg (${MOCK_SLOPE_SOURCE})`}; ${
        lander === null
          ? 'no lander chosen, so no slope limit.'
          : slopeLimit === null
            ? `no published slope limit for ${lander.name}, so no pass or fail.`
            : `${lander.name} accepts up to ${slopeLimit} deg.`
      }`,
    },
    { requirement: 'Earth contact', passed: earthLink !== 'none', detail: `Earth link ${earthLink}` },
  ];
  const failed = requirements.find((r) => r.passed === false);
  const unknown = requirements.filter((r) => r.passed === null).map((r) => r.requirement);
  const verdict: Verdict = failed
    ? { result: 'fail', requirement: failed.requirement, unknown_requirements: unknown }
    : unknown.length > 0
      ? { result: 'unknown', requirement: unknown[0], unknown_requirements: unknown }
      : { result: 'pass', requirement: null, unknown_requirements: [] };

  const components = scoreComponents(lit * 100, darkH, earthShare * 100, slope);
  // With the slope unknown, the score is not known: its worst case (slope term 0) and best (100) bound it.
  const scoreMin = scoreOf(components, components.slope ?? 0);
  const scoreMax = scoreOf(components, components.slope ?? 100);
  const sunlitH = lit * stayHours;
  const siteEnergy = siteEnergyOf(p, Math.max(0, stayHours - sunlitH), darkSpells(samples));
  const warnings: string[] = [];

  const evaluation: SiteEvaluation = {
    site_id: site.id,
    rank: 1,
    score: components.slope === null ? null : round(scoreMin, 4),
    score_min: round(scoreMin, 4),
    score_max: round(scoreMax, 4),
    score_components: components,
    sunlight_hours: round(sunlitH, 1),
    sunlight_percent: round(lit * 100, 1),
    longest_darkness_hours: round(darkH, 1),
    earth_visible_percent: round(earthShare * 100, 1),
    clear_sky_percent: round(clearSkyPercent(skyline), 1),
    slope_deg: slope,
    // What the slope is, as the backend says it; null with no slope (a custom point).
    slope_source: slope === null ? null : MOCK_SLOPE_SOURCE,
    earth_link: earthLink,
    hardware_fits: fit.fits,
    energy_added_kwh: null,
    site_energy: siteEnergy,
    power_margin_percent: nullableRound(balance.margin_percent, 2),
    power_status: balance.status,
    verdict,
    requirements,
    elevation_m: 0,
    elevation_source: 'example_model',
    warnings,
  };
  const check: CheckResponse = {
    fits: fit.fits,
    fit_verdict: fit.verdict,
    fit_notes: fit.notes,
    day: dayCheckOf(power),
    night: nightCheckOf(power),
    balance: { margin_percent: nullableRound(balance.margin_percent, 2), status: balance.status, limiting: balance.limiting },
    power_notes: power.notes,
    energy_added_kwh: null,
    site_energy: siteEnergy,
    provenance: MOCK_PROVENANCE,
    warnings: [],
  };
  return { evaluation, check };
}

/** The planner's site_energy without its heating model: night load x dark hours + per-night items x nights. */
function siteEnergyOf(p: PowerTotals, darkHours: number, nights: number): SiteEnergy {
  const night = p.loadNightKw * darkHours + (darkHours > 0 ? p.perNightKwh * nights : 0);
  return { dark_hours: round(darkHours, 1), nights, night_penalty_kwh: round(night, 1), heating_penalty_kwh: 0, total_kwh: round(night, 1) };
}

/**
 * Day / night check when no site is picked yet. Without a site there is no darkness length, so,
 * as in the planner module, the night check compares power only and storage is not counted.
 */
export function genericCheck(stayDays: number, hardware: HardwareChoice[], storageKwh = 0, catalog: CatalogItem[] = MOCK_CATALOG): CheckResponse {
  void stayDays;
  const p = powerTotals(hardware, catalog);
  const power = runPowerCheck(p, storageKwh, null);
  const fit = fitCheck(hardware, catalog);
  const notes = storageKwh > 0 || p.perNightKwh > 0 ? ['No site picked yet: storage counts once a site gives the length of its darkness.'] : [];
  return {
    fits: fit.fits,
    fit_verdict: fit.verdict,
    fit_notes: fit.notes,
    day: dayCheckOf(power),
    night: nightCheckOf(power),
    balance: { margin_percent: nullableRound(power.balance.margin_percent, 2), status: power.balance.status, limiting: power.balance.limiting },
    power_notes: notes,
    energy_added_kwh: null,
    site_energy: null,
    provenance: null,
    warnings: [],
  };
}

// ---------- horizon ----------

export function horizonFor(site: SiteRef, startMs: number, endMs: number, stepHours: number): HorizonResponse {
  const skyline = skylineFor(site);
  const steps = Math.min(4000, Math.max(24, Math.round((endMs - startMs) / (Math.max(0.25, stepHours) * HOUR_MS))));
  const samples = sampleWindow(site, startMs, endMs, steps, skyline);
  const sun_path: SunPathPoint[] = samples.map((s) => ({
    t: toIsoUtc(Math.round(s.t / 1000) * 1000),
    az: round(s.sunAz, 3),
    el: round(s.sunEl, 3),
    state: s.sunAbove ? 'above' : 'hidden',
  }));
  return {
    site_id: site.id,
    skyline,
    sun_path,
    earth_box: earthBox(samples),
    // The example model's own invented profile, stored in mock-model.json: terrain is shown, not smoothed away.
    skyline_source: 'stored_profile',
    time_step_s: Math.round((endMs - startMs) / steps / 1000),
    provenance: MOCK_PROVENANCE,
    warnings: [],
  };
}

function earthBox(samples: Sample[]): SkyBox | null {
  const r = M.earth_angular_radius_deg;
  const maxEl = Math.max(...samples.map((s) => s.earthEl));
  if (maxEl + r < 0) return null;
  // Circular mean of azimuths, then the spread either side of it (handles the wrap at north).
  let sx = 0;
  let sy = 0;
  for (const s of samples) {
    sx += Math.cos((s.earthAz * Math.PI) / 180);
    sy += Math.sin((s.earthAz * Math.PI) / 180);
  }
  const mean = (Math.atan2(sy, sx) * 180) / Math.PI;
  let lo = 0;
  let hi = 0;
  for (const s of samples) {
    const d = wrap180(s.earthAz - mean);
    lo = Math.min(lo, d);
    hi = Math.max(hi, d);
  }
  const els = samples.map((s) => s.earthEl);
  return {
    az_min: round(normalizeLon360(mean + lo - r), 2),
    az_max: round(normalizeLon360(mean + hi + r), 2),
    el_min: round(Math.min(...els) - r, 2),
    el_max: round(Math.max(...els) + r, 2),
  };
}

// ---------- small helpers ----------

function round(x: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(x * f) / f + 0;
}

function nullableRound(x: number | null, digits = 1): number | null {
  return x === null ? null : round(x, digits);
}
