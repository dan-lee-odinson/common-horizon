// The website's mock model. It stands in for the Python backend so every screen has
// believable, slip-dependent numbers. It is deliberately simple:
//   * the Sun's overhead point moves once around the Moon every synodic month (29.53 days),
//     with a small north-south swing; Earth's overhead point wobbles around 0° N 0° E (libration);
//   * each site gets an invented terrain skyline (seeded, so it is the same on every load);
//   * the stay is sampled in time steps: is the Sun above the skyline? is Earth?
// None of this is ephemeris-grade. The backend replaces it.

import modelJson from '../examples/mock-model.json';
import catalogJson from '../examples/catalog.json';
import type {
  CatalogItem,
  CheckResponse,
  EarthLink,
  Geometry,
  HardwareChoice,
  HorizonResponse,
  SiteEvaluation,
  SiteRef,
  SkyBox,
  SkyPoint,
  SunPathPoint,
  Verdict,
} from '../types';
import { azElFromSubpoint, normalizeLon360, sampleProfile, wrap180 } from '../../util/geo';
import { DAY_MS, HOUR_MS, toIsoUtc } from '../../util/time';

interface Terrain {
  slope_deg: number;
  horizon_scale_deg: number;
  horizon_offset_deg: number;
}

const M = modelJson;
const REF_MS = Date.parse(M.reference_new_moon_utc);
const TERRAIN = M.terrain as Record<string, Terrain>;
export const MOCK_CATALOG = catalogJson.items as CatalogItem[];
export const TRANSIT_DAYS = M.transit_days;

const TAU = Math.PI * 2;

function frac(x: number): number {
  return x - Math.floor(x);
}

// ---------- geometry ----------

/** Where the Sun is straight overhead on the Moon at a UTC instant (mock geometry). */
export function subsolarPoint(tMs: number): { lat: number; lonEast: number } {
  const days = (tMs - REF_MS) / DAY_MS;
  const phase = frac(days / M.synodic_month_days); // 0 = new moon, 0.5 = full moon
  return {
    lat: M.subsolar_lat_amplitude_deg * Math.sin((TAU * days) / M.subsolar_lat_period_days),
    // New moon: Sun over the far side (180° E). Full moon: over the near side (0° E).
    lonEast: normalizeLon360(180 - 360 * phase),
  };
}

/** Where Earth is straight overhead on the Moon (libration wobble around 0° N, 0° E). */
export function subearthPoint(tMs: number): { lat: number; lonEast: number } {
  const days = (tMs - REF_MS) / DAY_MS;
  return {
    lat: M.subearth_lat_amplitude_deg * Math.sin((TAU * days) / M.subearth_lat_period_days),
    lonEast: normalizeLon360(M.subearth_lon_amplitude_deg * Math.sin((TAU * (days + 7)) / M.subearth_lon_period_days)),
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
      sunAbove: sun.el > sampleProfile(skyline, sun.az),
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

interface PowerTotals {
  genSunKw: number;
  genAlwaysKw: number;
  loadDayKw: number;
  loadNightKw: number;
}

function selectedItems(hardware: HardwareChoice[], catalog: CatalogItem[]) {
  return hardware
    .map((h) => ({ item: catalog.find((c) => c.id === h.id), count: Math.max(0, h.count) }))
    .filter((x): x is { item: CatalogItem; count: number } => Boolean(x.item) && x.count > 0);
}

function powerTotals(hardware: HardwareChoice[], catalog: CatalogItem[]): PowerTotals {
  const totals: PowerTotals = { genSunKw: 0, genAlwaysKw: 0, loadDayKw: 0, loadNightKw: 0 };
  for (const { item, count } of selectedItems(hardware, catalog)) {
    if (item.gen_needs_sun) totals.genSunKw += item.gen_kw * count;
    else totals.genAlwaysKw += item.gen_kw * count;
    totals.loadDayKw += item.load_day_kw * count;
    totals.loadNightKw += item.load_night_kw * count;
  }
  return totals;
}

function margin(gen: number, load: number): number | null {
  if (load <= 0) return null;
  return ((gen - load) / load) * 100;
}

function fitCheck(hardware: HardwareChoice[], catalog: CatalogItem[], site: SiteRef | null): { fits: boolean; notes: string[] } {
  const items = selectedItems(hardware, catalog);
  const landers = items.filter((x) => x.item.kind === 'lander');
  const cargoKg = items.filter((x) => x.item.kind !== 'lander').reduce((s, x) => s + x.item.mass_kg * x.count, 0);
  const capacityKg = landers.reduce((s, x) => s + (x.item.capacity_kg ?? 0) * x.count, 0);
  const notes: string[] = [];
  if (cargoKg > 0 && landers.length === 0) {
    notes.push('The cargo needs a lander: add the Starship lander.');
  } else if (cargoKg > capacityKg) {
    notes.push(`Cargo of ${(cargoKg / 1000).toFixed(1)} t is more than the landers carry (${(capacityKg / 1000).toFixed(1)} t).`);
  }
  if (site) {
    const slope = terrainFor(site).slope_deg;
    for (const { item } of landers) {
      if (item.max_slope_deg !== undefined && slope > item.max_slope_deg) {
        notes.push(`${item.name}: ground slope ${slope}° is steeper than its ${item.max_slope_deg}° limit.`);
      }
    }
  }
  return { fits: notes.length === 0, notes };
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
  catalog: CatalogItem[] = MOCK_CATALOG,
): SiteStay {
  const skyline = skylineFor(site);
  const endMs = landingMs + stayDays * DAY_MS;
  const samples = sampleWindow(site, landingMs, endMs, stepsForStay(stayDays), skyline);
  const lit = samples.filter((s) => s.sunAbove).length / samples.length;
  const earthShare = samples.filter((s) => s.earthVisible).length / samples.length;
  const hasDark = lit < 1;
  const hasLight = lit > 0;
  const stayHours = stayDays * 24;

  const p = powerTotals(hardware, catalog);
  const genKwh = (p.genSunKw * lit + p.genAlwaysKw) * stayHours;
  const loadKwh = (p.loadDayKw * lit + p.loadNightKw * (1 - lit)) * stayHours;
  const stayMargin = margin(genKwh, loadKwh);
  const dayMargin = margin(p.genSunKw + p.genAlwaysKw, p.loadDayKw);
  const nightMargin = margin(p.genAlwaysKw, p.loadNightKw);
  const needed = [hasLight ? dayMargin : null, hasDark ? nightMargin : null].filter((m): m is number => m !== null);
  const balance = needed.length ? Math.min(...needed) : null;

  const fit = fitCheck(hardware, catalog, site);
  const earthLink: EarthLink = earthShare >= 0.98 ? 'clear' : earthShare <= 0.02 ? 'none' : 'intermittent';
  const clearSky = clearSkyPercent(skyline);

  let verdict: Verdict = { result: 'pass', requirement: null };
  if (!fit.fits) verdict = { result: 'fail', requirement: 'hardware fit' };
  else if (hasDark && nightMargin !== null && nightMargin < 0) verdict = { result: 'fail', requirement: 'night power' };
  else if (hasLight && dayMargin !== null && dayMargin < 0) verdict = { result: 'fail', requirement: 'day power' };
  else if (earthLink === 'none') verdict = { result: 'fail', requirement: 'Earth contact' };

  const powerScore = stayMargin === null ? 50 : Math.min(100, Math.max(0, 50 + stayMargin / 2));
  let score = 0.45 * lit * 100 + 0.25 * earthShare * 100 + 0.15 * clearSky + 0.15 * powerScore;
  if (!fit.fits) score *= 0.5;
  else if (verdict.result === 'fail') score *= 0.75;

  const evaluation: SiteEvaluation = {
    site_id: site.id,
    score: Math.round(score),
    sunlight_hours: round(lit * stayHours, 1),
    sunlight_percent: round(lit * 100, 1),
    clear_sky_percent: round(clearSky, 1),
    earth_link: earthLink,
    hardware_fits: fit.fits,
    energy_added_kwh: Math.round(genKwh - loadKwh),
    power_margin_percent: stayMargin === null ? null : round(stayMargin, 1),
    verdict,
  };
  const check: CheckResponse = {
    fits: fit.fits,
    fit_notes: fit.notes,
    day: { generation_kw: round(p.genSunKw + p.genAlwaysKw, 2), load_kw: round(p.loadDayKw, 2), margin_percent: nullableRound(dayMargin), needed: hasLight },
    night: { generation_kw: round(p.genAlwaysKw, 2), load_kw: round(p.loadNightKw, 2), margin_percent: nullableRound(nightMargin), needed: hasDark },
    balance_margin_percent: nullableRound(balance),
    energy_added_kwh: Math.round(genKwh - loadKwh),
  };
  return { evaluation, check };
}

/** Day / night check when no site is picked yet: assume both day and night happen, half each. */
export function genericCheck(stayDays: number, hardware: HardwareChoice[], catalog: CatalogItem[] = MOCK_CATALOG): CheckResponse {
  const p = powerTotals(hardware, catalog);
  const dayMargin = margin(p.genSunKw + p.genAlwaysKw, p.loadDayKw);
  const nightMargin = margin(p.genAlwaysKw, p.loadNightKw);
  const both = [dayMargin, nightMargin].filter((m): m is number => m !== null);
  const hours = stayDays * 24;
  const energy = (p.genSunKw * 0.5 + p.genAlwaysKw - (p.loadDayKw + p.loadNightKw) * 0.5) * hours;
  const fit = fitCheck(hardware, catalog, null);
  return {
    fits: fit.fits,
    fit_notes: fit.notes,
    day: { generation_kw: round(p.genSunKw + p.genAlwaysKw, 2), load_kw: round(p.loadDayKw, 2), margin_percent: nullableRound(dayMargin), needed: true },
    night: { generation_kw: round(p.genAlwaysKw, 2), load_kw: round(p.loadNightKw, 2), margin_percent: nullableRound(nightMargin), needed: true },
    balance_margin_percent: both.length ? round(Math.min(...both), 1) : null,
    energy_added_kwh: Math.round(energy),
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
  return { site_id: site.id, skyline, sun_path, earth_box: earthBox(samples) };
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

function nullableRound(x: number | null): number | null {
  return x === null ? null : round(x, 1);
}
