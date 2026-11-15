// The readout quantities: every number the HUD shows, with its label and unit.
//
// DATA HONESTY. A readout on screen is a `Quantity`, and a Quantity is only ever made here, from
// the app's data: answers of the API layer (in example mode, the mock model), the geometry track
// built from those answers, and the visitor's own inputs (dates, delay). There are no random
// numbers and no filler values anywhere in the interface. When the data has not arrived, or is not
// a real number (a missing field, NaN, an unreadable time), the value is null and the text is a
// dash. A figure is shown only as finely as its data supports: a sunrise read between horizon
// samples hours apart is shown in whole hours and labelled "about". src/util/quantities.test.ts
// and src/hud/readouts.test.tsx hold this in place.

import type { CatalogItem, CheckResponse, EarthLink, Geometry, HardwareChoice, HorizonResponse, SiteEvaluation, SiteRef } from '../api/types';
import { earthWidthDeg, sunWidthDeg } from './bodies';
import { azElFromSubpoint, normalizeLon360 } from './geo';
import { nextSunChange, sunAt, type Period, type SunChange } from './horizon';
import { formatMargin, levelFromStatus, type PowerLevel } from './power';
import { southPoleSeason, type PoleSeason } from './season';
import { compassWord, roundSig, shadowFigures, type ShadowFigures } from './shadow';
import { discLitFromEarth, earthSwing, trackCovers, type GeometryTrack } from './track';
import {
  DAY_MS,
  formatDays,
  formatHours,
  formatLtcOffsetMicros,
  formatSinceLanding,
  formatUtcMinute,
  HOUR_MS,
  ltcClock,
  ltcOffsetMicros,
  utcClock,
  type ClockParts,
} from './time';

export type Tone = 'ink' | 'sun' | 'earth' | 'good' | 'warn' | 'bad' | 'muted';

export interface Quantity {
  /** Stable name, written to the DOM as data-q. */
  key: string;
  label: string;
  /** The number behind the text, or null when there is no data (or the readout is a word). */
  value: number | null;
  /** What is shown. A dash when there is no data. */
  text: string;
  /** Unit or hemisphere shown after the text: "° S", "%", "µs". May be empty for words and clocks. */
  unit: string;
  tone?: Tone;
}

export const DASH = '—';
const MINUS = '−';

function quantity(key: string, label: string, value: number | null, text: string, unit: string, tone?: Tone): Quantity {
  return { key, label, value, text: value === null && text === '' ? DASH : text, unit: text === DASH ? '' : unit, tone };
}

function missing(key: string, label: string, tone?: Tone): Quantity {
  return { key, label, value: null, text: DASH, unit: '', tone };
}

/** The furthest instant a date can hold, either side of 1970 (milliseconds). */
const MAX_DATE_MS = 8.64e15;

/** True for a real instant: a finite number of milliseconds that a date can hold. */
function isInstant(ms: number | null | undefined): ms is number {
  return typeof ms === 'number' && Number.isFinite(ms) && Math.abs(ms) <= MAX_DATE_MS;
}

/** The geometry itself when all four of its values are real numbers, otherwise null. */
function wholeGeometry(g: Geometry | null | undefined): Geometry | null {
  if (!g) return null;
  return [g.subsolar_lat, g.subsolar_lon_east, g.subearth_lat, g.subearth_lon_east].every((v) => Number.isFinite(v)) ? g : null;
}

/**
 * A sunrise or sunset is placed midway between the two samples whose words differ (the nearest
 * sample's word holds between samples: util/horizon.ts), so it is known to half their spacing. A
 * tenth of an hour is shown only when that half is within half a tenth: samples at most six minutes
 * apart (the spacing is the larger of the samples' own and the answer's time_step_s).
 */
const FINE_SAMPLE_HOURS = 0.1;
function fineSamples(gapHours: number): boolean {
  return Number.isFinite(gapHours) && gapHours <= FINE_SAMPLE_HOURS + 1e-9;
}

/** Half of the last digit a direction is shown to (0.1°): a reading must be at least this sure. */
const DIRECTION_TOLERANCE_DEG = 0.05;

/** A number with fixed decimals and a true minus sign. */
export function fixed(value: number, digits: number): string {
  const rounded = Math.round(value * 10 ** digits) / 10 ** digits;
  const text = Math.abs(rounded).toFixed(digits);
  return rounded < 0 ? `${MINUS}${text}` : text;
}

function latitude(key: string, label: string, lat: number | null, tone?: Tone, digits = 2): Quantity {
  if (lat === null || !Number.isFinite(lat)) return missing(key, label, tone);
  const text = Math.abs(lat).toFixed(digits);
  // A latitude that rounds to zero is on the equator: no hemisphere letter to flicker between.
  return quantity(key, label, lat, text, Number(text) === 0 ? '°' : lat < 0 ? '° S' : '° N', tone);
}

function longitude(key: string, label: string, lonEast: number | null, tone?: Tone, digits = 2): Quantity {
  if (lonEast === null || !Number.isFinite(lonEast)) return missing(key, label, tone);
  const lon = normalizeLon360(lonEast);
  const text = lon.toFixed(digits);
  return quantity(key, label, lon, Number(text) === 360 ? (0).toFixed(digits) : text, '° E', tone);
}

function azimuth(key: string, label: string, az: number | null, tone?: Tone): Quantity {
  if (az === null || !Number.isFinite(az)) return missing(key, label, tone);
  const text = normalizeLon360(az).toFixed(1);
  return quantity(key, label, az, text === '360.0' ? '0.0' : text, '°', tone);
}

function elevation(key: string, label: string, el: number | null, tone?: Tone): Quantity {
  if (el === null || !Number.isFinite(el)) return missing(key, label, tone);
  const text = fixed(el, 1);
  return quantity(key, label, el, el >= 0 && text !== '0.0' ? `+${text}` : text, '°', tone);
}

// ---------- the sky at one instant ----------

export interface SkyInput {
  /** Sub-solar and sub-Earth points over time; null until the answers arrive. */
  track: GeometryTrack | null;
  /** The instant shown (UTC, milliseconds). */
  tMs: number;
  /** The mission's landing time; LTC counts from it. */
  landingMs: number | null;
  /** The site whose sky is read. */
  site: SiteRef | null;
  /** That site's horizon answer, when loaded and covering tMs. */
  horizon: HorizonResponse | null;
}

export interface SkyQuantities {
  geometry: Geometry | null;
  subsolarLat: Quantity;
  subsolarLon: Quantity;
  subearthLat: Quantity;
  subearthLon: Quantity;
  sunAz: Quantity;
  sunEl: Quantity;
  earthAz: Quantity;
  earthEl: Quantity;
  discLit: Quantity;
  /** "lit" or "dark" at the site, from the horizon answer. */
  sunState: Quantity;
  /** Hours to the next sunrise or sunset at the site. */
  nextChange: Quantity;
  change: SunChange | null;
  utc: ClockParts | null;
  ltc: ClockParts | null;
  utcClock: Quantity;
  ltcClock: Quantity;
  ltcOffset: Quantity;
  sinceLanding: Quantity;
}

function horizonCovers(horizon: HorizonResponse | null, site: SiteRef | null, tMs: number): horizon is HorizonResponse {
  if (!horizon || !site || horizon.site_id !== site.id || horizon.sun_path.length === 0) return false;
  const first = Date.parse(horizon.sun_path[0].t);
  const last = Date.parse(horizon.sun_path[horizon.sun_path.length - 1].t);
  return tMs >= first && tMs <= last;
}

/** "Sunrise in 12.3 h", or "Sunrise in about 12 h" when the horizon samples are too far apart for the tenth. */
function nextChangeQuantity(change: SunChange | null, horizon: HorizonResponse | null, lit: boolean | null): Quantity {
  if (change) {
    if (!Number.isFinite(change.hours)) return missing('next_change', 'Next sunrise or sunset');
    const word = change.kind === 'sunrise' ? 'Sunrise' : 'Sunset';
    // One decimal (six minutes) only when the two samples around the change are that close.
    // Otherwise whole hours, and the label says "about".
    return fineSamples(change.sampleGapHours)
      ? quantity('next_change', `${word} in`, change.hours, change.hours.toFixed(1), 'h', 'sun')
      : quantity('next_change', `${word} in about`, change.hours, String(Math.round(change.hours)), 'h', 'sun');
  }
  if (horizon && lit !== null) return quantity('next_change', lit ? 'Sunset' : 'Sunrise', null, 'none in view', '', 'muted');
  return missing('next_change', 'Next sunrise or sunset');
}

/** The sky over a site at one instant, as plain values: what the readouts, the plot and the scene all read. */
export interface SkyNow {
  /** Where the Sun and Earth are overhead on the Moon; null outside the track. */
  geometry: Geometry | null;
  /** The Sun's direction at the site. */
  sun: { az: number; el: number } | null;
  /** Earth's direction at the site (parallax ignored: good to about 1 degree). */
  earth: { az: number; el: number } | null;
  /** The horizon answer's word: true lit, false dark (the terrain hides the Sun), null with no answer for this site at this instant. */
  lit: boolean | null;
  /** The next sunrise or sunset inside the answer's window. */
  change: SunChange | null;
  /** The site's horizon answer, when it covers the instant. */
  horizon: HorizonResponse | null;
}

/**
 * The sky over a site at one instant. One function serves the readouts, the horizon plot, the
 * timeline and the 3D scene, so they cannot disagree about where the Sun is or whether the site
 * is lit. Pure: the same inputs always give the same answer.
 */
export function skyAt(input: SkyInput): SkyNow {
  const { track, tMs, site } = input;
  const hasT = isInstant(tMs);
  // Read from the track only inside the window it was loaded for, never from its spare ends.
  const geometry = track !== null && hasT && trackCovers(track, tMs) ? wholeGeometry(track.at(tMs)) : null;
  const horizon = hasT && horizonCovers(input.horizon, site, tMs) ? input.horizon : null;
  const sunInHorizon = horizon ? sunAt(horizon, tMs) : null;

  // The Sun's direction at the site comes from the Sun's overhead point on the track: answers a day
  // apart follow the model to a ten-thousandth of a degree. The horizon answer's samples can be
  // hours apart, and a straight line between them is degrees off when the Sun passes high overhead.
  // So the horizon answer gives the direction only when there is no track at all, and only where
  // its own samples show the straight line to be good for the tenth of a degree shown.
  const sunFromTrack = site && geometry ? azElFromSubpoint(site.lat, site.lon_east, geometry.subsolar_lat, geometry.subsolar_lon_east) : null;
  const sunFromHorizon = track === null && sunInHorizon && sunInHorizon.uncertaintyDeg <= DIRECTION_TOLERANCE_DEG ? sunInHorizon : null;
  const picked = sunFromTrack ?? sunFromHorizon;
  // Earth's direction at the site, from Earth's overhead point (parallax ignored: good to about 1°).
  const earth = site && geometry ? azElFromSubpoint(site.lat, site.lon_east, geometry.subearth_lat, geometry.subearth_lon_east) : null;

  // Lit or dark, and the next sunrise or sunset, need the terrain: they come from the horizon answer.
  return {
    geometry,
    sun: picked ? { az: picked.az, el: picked.el } : null,
    earth,
    lit: sunInHorizon ? sunInHorizon.above : null,
    change: horizon ? nextSunChange(horizon, tMs) : null,
    horizon,
  };
}

/** Every sky readout for one instant. Pure: the same inputs always give the same quantities. */
export function skyQuantities(input: SkyInput): SkyQuantities {
  return skyReadouts(input, skyAt(input));
}

function skyReadouts(input: SkyInput, sky: SkyNow): SkyQuantities {
  const { tMs } = input;
  const hasT = isInstant(tMs);
  // A landing time that is missing or unreadable (NaN from a broken answer) is no landing time.
  const landingMs = isInstant(input.landingMs) ? input.landingMs : null;
  const { geometry, sun, earth, lit, change, horizon } = sky;
  const discLit = geometry ? discLitFromEarth(geometry) * 100 : Number.NaN;

  const utc = hasT ? utcClock(tMs) : null;
  const ltc = hasT && landingMs !== null ? ltcClock(tMs, landingMs) : null;

  return {
    geometry,
    subsolarLat: latitude('subsolar_lat', 'Overhead latitude', geometry?.subsolar_lat ?? null, 'sun'),
    subsolarLon: longitude('subsolar_lon', 'Overhead longitude', geometry?.subsolar_lon_east ?? null, 'sun'),
    subearthLat: latitude('subearth_lat', 'Overhead latitude', geometry?.subearth_lat ?? null, 'earth'),
    subearthLon: longitude('subearth_lon', 'Overhead longitude', geometry?.subearth_lon_east ?? null, 'earth'),
    sunAz: azimuth('sun_az', 'Azimuth', sun?.az ?? null, 'sun'),
    sunEl: elevation('sun_el', 'Elevation', sun?.el ?? null, 'sun'),
    earthAz: azimuth('earth_az', 'Azimuth', earth?.az ?? null, 'earth'),
    earthEl: elevation('earth_el', 'Elevation', earth?.el ?? null, 'earth'),
    discLit: Number.isFinite(discLit) ? quantity('disc_lit', 'Moon lit, from Earth', discLit, discLit.toFixed(1), '%') : missing('disc_lit', 'Moon lit, from Earth'),
    sunState: lit === null ? missing('sun_state', 'Site') : quantity('sun_state', 'Site', null, lit ? 'lit' : 'dark', '', lit ? 'sun' : 'muted'),
    nextChange: nextChangeQuantity(change, horizon, lit),
    change,
    utc,
    ltc,
    utcClock: utc ? quantity('utc', 'UTC', tMs, `${utc.date} ${utc.time}`, 'UTC') : missing('utc', 'UTC'),
    // The time of day only: the date is the UTC date above (the two differ by microseconds).
    ltcClock: ltc ? quantity('ltc', 'LTC, model', tMs, `${ltc.time}.${ltc.fraction}`, 'LTC') : missing('ltc', 'LTC, model'),
    // Both clocks that count from the landing need the instant and the landing time.
    ltcOffset:
      hasT && landingMs !== null
        ? quantity('ltc_offset', 'LTC − UTC', ltcOffsetMicros(tMs, landingMs), formatLtcOffsetMicros(tMs, landingMs), 'µs')
        : missing('ltc_offset', 'LTC − UTC'),
    sinceLanding:
      hasT && landingMs !== null
        ? quantity('since_landing', 'Since landing', (tMs - landingMs) / 3_600_000, formatSinceLanding(tMs, landingMs), '')
        : missing('since_landing', 'Since landing'),
  };
}

// ---------- Earth's swing over the stay ----------

export interface SwingQuantities {
  lon: Quantity;
  lat: Quantity;
}

/** How far Earth's overhead point moves over the stay (libration), from the track. */
export function swingQuantities(track: GeometryTrack | null, landingMs: number | null, stayEndMs: number | null): SwingQuantities {
  const swing = earthSwing(track, landingMs, stayEndMs);
  if (!swing || !Number.isFinite(swing.lonSpan) || !Number.isFinite(swing.latSpan)) {
    return { lon: missing('earth_swing_lon', 'Longitude swing, stay', 'earth'), lat: missing('earth_swing_lat', 'Latitude swing, stay', 'earth') };
  }
  return {
    lon: quantity('earth_swing_lon', 'Longitude swing, stay', swing.lonSpan, swing.lonSpan.toFixed(2), '°', 'earth'),
    lat: quantity('earth_swing_lat', 'Latitude swing, stay', swing.latSpan, swing.latSpan.toFixed(2), '°', 'earth'),
  };
}

// ---------- the mission's dates ----------

/**
 * Transit from launch to landing, as the evaluation answer states it: "5 days (our estimate)". The
 * website sends its estimate (util/transit.ts); an answer that does not state one counts it as 0.
 */
export function transitQuantity(transitDays: number | null | undefined, answered: boolean): Quantity {
  if (!answered) return missing('transit', 'Transit');
  if (typeof transitDays !== 'number' || !Number.isFinite(transitDays)) return quantity('transit', 'Transit', null, 'not stated, counted as 0', '', 'warn');
  return quantity('transit', 'Transit', transitDays, formatDays(transitDays), `${transitDays === 1 ? 'day' : 'days'} (our estimate)`);
}

export interface MissionDates {
  /** The launch as planned, before any delay. */
  plannedLaunch: Quantity;
  /** The launch after the delay. */
  launch: Quantity;
  delay: Quantity;
  landing: Quantity;
  season: PoleSeason | null;
  seasonLine: Quantity;
}

/**
 * Launch, delay and landing, and the lunar south pole's season on the landing date (from the Sun's
 * latitude in the evaluation answer). A date that is missing or not a real time is a dash, and
 * there is no season without the Sun's latitude: it is never guessed.
 */
export function missionDates(launchUtcMs: number, slipDays: number, landingMs: number | null, landingGeometry: Geometry | null): MissionDates {
  const sunLat = landingGeometry ? landingGeometry.subsolar_lat : null;
  const season = typeof sunLat === 'number' && Number.isFinite(sunLat) ? southPoleSeason(sunLat) : null;
  const hasSlip = Number.isFinite(slipDays);
  const delayedMs = launchUtcMs + slipDays * DAY_MS;
  return {
    plannedLaunch: isInstant(launchUtcMs) ? quantity('planned_launch', 'Planned', launchUtcMs, formatUtcMinute(launchUtcMs), 'UTC') : missing('planned_launch', 'Planned'),
    launch: isInstant(delayedMs) ? quantity('launch', 'Launch', delayedMs, formatUtcMinute(delayedMs), 'UTC') : missing('launch', 'Launch'),
    delay: hasSlip ? quantity('delay', 'Launch delay', slipDays, `+${slipDays}`, slipDays === 1 ? 'day' : 'days') : missing('delay', 'Launch delay'),
    landing: isInstant(landingMs) ? quantity('landing', 'Landing', landingMs, formatUtcMinute(landingMs), 'UTC') : missing('landing', 'Landing'),
    season,
    seasonLine: season === null ? missing('season', 'Lunar south pole') : quantity('season', 'Lunar south pole', null, season, '', season === 'summer' ? 'sun' : 'ink'),
  };
}

// ---------- one site's result ----------

export const EARTH_LINK_WORD: Record<EarthLink, string> = {
  clear: 'in contact',
  intermittent: 'intermittent',
  none: 'out of contact',
};

export const EARTH_LINK_TONE: Record<EarthLink, Tone> = {
  clear: 'good',
  intermittent: 'warn',
  none: 'bad',
};

const LEVEL_TONE: Record<PowerLevel, Tone> = { good: 'good', thin: 'warn', short: 'bad', unknown: 'muted' };

export interface SiteQuantities {
  rank: Quantity;
  score: Quantity;
  sunlightPercent: Quantity;
  sunlightHours: Quantity;
  clearSky: Quantity;
  earthLink: Quantity;
  powerMargin: Quantity;
  /** The energy the site's darkness adds (the planner's site_energy), or the net energy when an answer gives one. */
  energy: Quantity;
  /** "pass", "fail: night power" or "UNKNOWN: landing slope". */
  verdict: Quantity;
  /** The verdict's one word: "pass", "fail" or "unknown". */
  verdictWord: string;
  /** The verdict as the answer gives it; null with no result. */
  result: 'pass' | 'fail' | 'unknown' | null;
  /** True only for a pass, false for a fail, null for unknown or no result: unknown is never a pass. */
  passes: boolean | null;
}

/** "unknown" as shown: in capitals, with the requirement that could not be checked. */
export function verdictText(v: SiteEvaluation['verdict']): string {
  if (v.result === 'fail') return `fail: ${v.requirement ?? 'requirement not met'}`;
  if (v.result === 'unknown') return `UNKNOWN: ${v.requirement ?? v.unknown_requirements?.[0] ?? 'requirement not checked'}`;
  return 'pass';
}

const VERDICT_TONE: Record<SiteEvaluation['verdict']['result'], Tone> = { pass: 'good', fail: 'bad', unknown: 'warn' };

/**
 * The score, or, when it is not known (null: a term such as slope is unknown), the range it lies in:
 * score_min to score_max. Never a single invented figure.
 */
export function scoreQuantity(e: Pick<SiteEvaluation, 'score' | 'score_min' | 'score_max'>): Quantity {
  if (typeof e.score === 'number' && Number.isFinite(e.score)) return quantity('score', 'Score', e.score, String(Math.round(e.score)), '/ 100');
  const lo = e.score_min;
  const hi = e.score_max;
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return missing('score', 'Score');
  const a = Math.round(lo);
  const b = Math.round(hi);
  return quantity('score', 'Score, range', null, a === b ? String(a) : `${a}–${b}`, '/ 100');
}

/** The spotlight readouts for one ranked site. `check` (the planner's own check) wins for power when present. */
export function siteQuantities(rank: number | null, e: SiteEvaluation | null, check: CheckResponse | null = null): SiteQuantities {
  if (!e) {
    return {
      rank: missing('rank', 'Rank'),
      score: missing('score', 'Score'),
      sunlightPercent: missing('sunlight_percent', 'Sunlight'),
      sunlightHours: missing('sunlight_hours', 'Sunlit hours'),
      clearSky: missing('clear_sky', 'Clear sky'),
      earthLink: missing('earth_link', 'Earth link'),
      powerMargin: missing('power_margin', 'Power margin'),
      energy: missing('energy', 'Energy over the stay'),
      verdict: missing('verdict', 'Result'),
      verdictWord: '',
      result: null,
      passes: null,
    };
  }
  const margin = check ? check.balance.margin_percent : e.power_margin_percent;
  const level = levelFromStatus(check ? check.balance.status : e.power_status);
  const marginText = formatMargin(margin, level);
  const hasNumber = margin !== null && Number.isFinite(margin);
  const result = e.verdict.result;
  return {
    rank: rank === null ? missing('rank', 'Rank') : quantity('rank', 'Rank', rank, String(rank).padStart(2, '0'), ''),
    score: scoreQuantity(e),
    sunlightPercent: quantity('sunlight_percent', 'Sunlight', e.sunlight_percent, e.sunlight_percent.toFixed(1), '%', 'sun'),
    sunlightHours: quantity('sunlight_hours', 'Sunlit hours', e.sunlight_hours, Math.round(e.sunlight_hours).toLocaleString('en-US'), 'h', 'sun'),
    clearSky:
      typeof e.clear_sky_percent === 'number' && Number.isFinite(e.clear_sky_percent)
        ? quantity('clear_sky', 'Clear sky', e.clear_sky_percent, e.clear_sky_percent.toFixed(1), '%')
        : quantity('clear_sky', 'Clear sky', null, 'not known', '', 'muted'),
    earthLink: quantity('earth_link', 'Earth link', null, EARTH_LINK_WORD[e.earth_link], '', EARTH_LINK_TONE[e.earth_link]),
    powerMargin: hasNumber
      ? quantity('power_margin', 'Power margin', margin, marginText.replace('%', ''), '%', LEVEL_TONE[level])
      : quantity('power_margin', 'Power margin', null, marginText === DASH ? 'no load' : marginText, '', LEVEL_TONE[level]),
    energy: energyQuantity(e, LEVEL_TONE[level]),
    verdict: quantity('verdict', 'Result', null, verdictText(e.verdict), '', VERDICT_TONE[result] ?? 'muted'),
    verdictWord: result,
    result,
    passes: result === 'pass' ? true : result === 'fail' ? false : null,
  };
}

/** The net energy when the answer has one; else the energy the darkness adds (site_energy); else a dash. */
function energyQuantity(e: SiteEvaluation, tone: Tone): Quantity {
  const net = e.energy_added_kwh;
  if (typeof net === 'number' && Number.isFinite(net)) {
    const sign = net > 0 ? '+' : net < 0 ? MINUS : '';
    return quantity('energy', 'Energy over the stay', net, `${sign}${Math.round(Math.abs(net)).toLocaleString('en-US')}`, 'kWh', tone);
  }
  const dark = e.site_energy?.total_kwh;
  if (typeof dark === 'number' && Number.isFinite(dark)) return quantity('energy', 'Darkness adds', dark, Math.round(dark).toLocaleString('en-US'), 'kWh');
  return missing('energy', 'Energy over the stay');
}

// ---------- the site stage ----------

/** A length rounded to a number of significant figures, as text: "50", "3", "1.7", "0.18". */
function significant(value: number, figures: number): string {
  const r = roundSig(value, figures);
  if (!Number.isFinite(r) || r === 0) return '0';
  const decimals = Math.max(0, figures - 1 - Math.floor(Math.log10(Math.abs(r))));
  return r.toFixed(decimals);
}

/** A shadow length on level ground. One figure is labelled "about"; from a kilometre up the unit is km. */
function shadowLength(key: string, label: string, metres: number, figures: 1 | 2): Quantity {
  const name = figures === 1 ? `${label}, about` : label;
  const rounded = roundSig(metres, figures);
  return rounded >= 1000 ? quantity(key, name, metres, significant(metres / 1000, figures), 'km') : quantity(key, name, metres, significant(metres, figures), 'm');
}

export interface SiteLiveInput extends SkyInput {
  /**
   * The lander standing at the landing point: its catalog name, and the height of its model in
   * metres (null when it has no model or the model's description has not been read yet). Null when
   * the mission has no lander.
   */
  lander: { name: string; heightM: number | null } | null;
}

export interface SiteLiveQuantities extends SkyQuantities {
  /** The plain values behind the readouts: the plot's markers and the scene read these. */
  sky: SkyNow;
  /** What can be said about shadows at this instant (see util/shadow.ts). */
  shadow: ShadowFigures;
  /** True when the instant is before the landing (inside the launch delay): no hardware stands there yet. */
  beforeLanding: boolean;
  /** "before landing" or "landed". */
  phase: Quantity;
  /** Time to the landing, while the instant is before it. */
  toLanding: Quantity;
  earthWidth: Quantity;
  shadowPerMetre: Quantity;
  shadowLander: Quantity;
  shadowBearing: Quantity;
}

/**
 * Every readout of the site stage that changes with the clock: the sky readouts, Earth's apparent
 * width, the shadow figures and whether the instant is before the landing. Pure.
 */
export function liveSiteQuantities(input: SiteLiveInput): SiteLiveQuantities {
  const sky = skyAt(input);
  const base = skyReadouts(input, sky);
  const landingMs = isInstant(input.landingMs) ? input.landingMs : null;
  const hasT = isInstant(input.tMs);
  const beforeLanding = hasT && landingMs !== null && input.tMs < landingMs;
  const hoursToLanding = beforeLanding ? (landingMs - input.tMs) / HOUR_MS : null;

  const width = sky.earth ? earthWidthDeg(sky.earth.el) : Number.NaN;
  const shadow = shadowFigures(sky.sun, sky.lit);
  // The three shadow readouts sit together under one heading ("Shadows, level ground"), so their
  // own labels only say which shadow: of a metre of height, of the lander, and where they point.
  const perMetreLabel = 'Per metre of height';
  const landerLabel = input.lander?.name ?? 'Lander';

  let shadowPerMetre: Quantity;
  let shadowLander: Quantity;
  let shadowBearing: Quantity;
  if (shadow.kind === 'unknown') {
    shadowPerMetre = missing('shadow_per_metre', perMetreLabel);
    shadowLander = missing('shadow_lander', landerLabel);
    shadowBearing = missing('shadow_bearing', 'Pointing');
  } else if (shadow.kind === 'dark') {
    // The terrain hides the Sun: nothing casts a shadow, and there is no direction to give.
    shadowPerMetre = quantity('shadow_per_metre', perMetreLabel, null, 'none', '', 'muted');
    shadowLander = quantity('shadow_lander', landerLabel, null, 'none', '', 'muted');
    shadowBearing = missing('shadow_bearing', 'Pointing');
  } else {
    const bearing = Math.round(shadow.bearingDeg) % 360;
    shadowBearing = quantity('shadow_bearing', 'Pointing', shadow.bearingDeg, String(bearing), `° ${compassWord(shadow.bearingDeg)}`);
    if (shadow.kind === 'grazing') {
      // The Sun's disc touches the level plane: a shadow has no far end to measure.
      shadowPerMetre = quantity('shadow_per_metre', perMetreLabel, null, 'past the horizon', '');
      shadowLander = quantity('shadow_lander', landerLabel, null, 'past the horizon', '');
    } else {
      shadowPerMetre = shadowLength('shadow_per_metre', perMetreLabel, shadow.perMetre, shadow.figures);
      const height = input.lander?.heightM;
      shadowLander =
        typeof height === 'number' && Number.isFinite(height) && height > 0
          ? shadowLength('shadow_lander', landerLabel, height * shadow.perMetre, shadow.figures)
          : missing('shadow_lander', landerLabel);
    }
  }
  // Before the landing nothing stands at the landing point, whatever the Sun does.
  if (beforeLanding && input.lander) shadowLander = quantity('shadow_lander', landerLabel, null, 'not landed', '', 'muted');

  return {
    ...base,
    sky,
    shadow,
    beforeLanding,
    phase: !hasT || landingMs === null ? missing('phase', 'Mission') : quantity('phase', 'Mission', null, beforeLanding ? 'before landing' : 'landed', '', beforeLanding ? 'warn' : 'ink'),
    toLanding: hoursToLanding === null ? missing('to_landing', 'Landing in') : quantity('to_landing', 'Landing in', hoursToLanding, formatHours(hoursToLanding), ''),
    earthWidth: Number.isFinite(width) ? quantity('earth_width', 'Earth, apparent width', width, width.toFixed(2), '°', 'earth') : missing('earth_width', 'Earth, apparent width', 'earth'),
    shadowPerMetre,
    shadowLander,
    shadowBearing,
  };
}

export interface SiteStageInput {
  site: SiteRef | null;
  landingMs: number | null;
  /** The landing as planned, before any launch delay. */
  plannedLandingMs: number | null;
  stayEndMs: number | null;
  stayDays: number;
  /** The site's result in the ranking, when it has one. */
  evaluation: SiteEvaluation | null;
  /** The planner's check for this site and mission, when it has answered. */
  check: CheckResponse | null;
}

export interface SiteStageQuantities {
  /** The Sun's apparent width at mean distance: the same from every site. */
  sunWidth: Quantity;
  siteLat: Quantity;
  siteLon: Quantity;
  landing: Quantity;
  plannedLanding: Quantity;
  stayEnd: Quantity;
  stayLength: Quantity;
  longestDark: Quantity;
  /** The Earth link over the whole stay (not at one instant). */
  earthLink: Quantity;
}

/** The site stage's readouts that do not change with the clock. */
export function siteStageQuantities(input: SiteStageInput): SiteStageQuantities {
  const { site, landingMs, plannedLandingMs, stayEndMs, stayDays, evaluation, check } = input;
  const sunWidth = sunWidthDeg();
  const dark = check ? check.night.longest_darkness_h : null;
  const hasStay = Number.isFinite(stayDays);
  return {
    sunWidth: quantity('sun_width', 'Sun, apparent width', sunWidth, sunWidth.toFixed(2), '°', 'sun'),
    siteLat: latitude('site_lat', 'Latitude', site ? site.lat : null, undefined, 3),
    siteLon: longitude('site_lon', 'Longitude', site ? site.lon_east : null, undefined, 3),
    landing: isInstant(landingMs) ? quantity('landing', 'Landing', landingMs, formatUtcMinute(landingMs), 'UTC') : missing('landing', 'Landing'),
    plannedLanding: isInstant(plannedLandingMs)
      ? quantity('planned_landing', 'Planned landing', plannedLandingMs, formatUtcMinute(plannedLandingMs), 'UTC')
      : missing('planned_landing', 'Planned landing'),
    stayEnd: isInstant(stayEndMs) ? quantity('stay_end', 'End of stay', stayEndMs, formatUtcMinute(stayEndMs), 'UTC') : missing('stay_end', 'End of stay'),
    stayLength: hasStay ? quantity('stay_length', 'Stay', stayDays, formatDays(stayDays), stayDays === 1 ? 'day' : 'days') : missing('stay_length', 'Stay'),
    longestDark:
      typeof dark === 'number' && Number.isFinite(dark)
        ? dark > 0
          ? quantity('longest_dark', 'Longest darkness, stay', dark, formatHours(dark), '')
          : quantity('longest_dark', 'Longest darkness, stay', 0, 'none', '', 'muted')
        : missing('longest_dark', 'Longest darkness, stay'),
    earthLink: evaluation
      ? quantity('earth_link', 'Earth link, stay', null, EARTH_LINK_WORD[evaluation.earth_link], '', EARTH_LINK_TONE[evaluation.earth_link])
      : missing('earth_link', 'Earth link, stay'),
  };
}

/** A whole number with a true minus sign. */
function signedWhole(value: number): string {
  const n = Math.round(value);
  return n < 0 ? `${MINUS}${-n}` : String(n);
}

/** The play speeds, in simulated days for each second of play. */
export function speedQuantities(speeds: readonly number[]): Quantity[] {
  return speeds.map((v) => quantity(`speed:${v}`, 'Speed', v, String(v), 'd/s'));
}

/** Day marks under the stay timeline: whole days after the landing (negative before it). */
export function stayTickQuantities(days: readonly number[]): Quantity[] {
  return days.map((d) => quantity(`tick_day:${d}`, 'Days after landing', d, signedWhole(d), 'd'));
}

/** Labels of the horizon plot's height lines: whole degrees above (+) or below (−) level. */
export function horizonAxisQuantities(values: readonly number[]): Quantity[] {
  return values.map((v) => {
    const text = signedWhole(v);
    return quantity(`axis_el:${v}`, 'Height above level', v, v > 0 ? `+${text}` : text, '°');
  });
}

/** The lit and dark periods of a timeline, each from when to when, counted from the landing. */
export function stayPeriodQuantities(periods: readonly Period[], landingMs: number | null): Quantity[] {
  if (!isInstant(landingMs)) return [];
  return periods
    .filter((p) => isInstant(p.start) && isInstant(p.end))
    .map((p, i) =>
      quantity(`period:${i}`, p.lit ? 'Lit' : 'Dark', (p.end - p.start) / HOUR_MS, `${formatSinceLanding(p.start, landingMs)} to ${formatSinceLanding(p.end, landingMs)}`, '', p.lit ? 'sun' : 'muted'),
    );
}

/** What the hardware list needs of a model's description (see state/models.ts). */
export interface ModelSize {
  status: string;
  dimensions: { height: number };
}

export interface HardwareRow {
  id: string;
  /** The catalog's name for the item. */
  name: string;
  count: Quantity;
  /** The model's height, the words "no model", or a dash while the description is being read. */
  height: Quantity;
  /** How well founded the model's size is, in its description's own words; null with no model. */
  status: string | null;
}

/**
 * One row for each item of the mission. `models` holds each item's model description by catalog
 * id: null when the item has no model, undefined while it is still being read.
 */
export function hardwareQuantities(choices: readonly HardwareChoice[], catalog: readonly CatalogItem[], models: Readonly<Record<string, ModelSize | null | undefined>>): HardwareRow[] {
  return choices.map((choice) => {
    const name = catalog.find((c) => c.id === choice.id)?.name ?? choice.id;
    const model = Object.hasOwn(models, choice.id) ? models[choice.id] : undefined;
    const count = Number.isFinite(choice.count) ? quantity(`hw_count:${choice.id}`, 'Count', choice.count, `× ${choice.count}`, '') : missing(`hw_count:${choice.id}`, 'Count');
    let height: Quantity;
    if (model === undefined) height = missing(`hw_height:${choice.id}`, name);
    else if (model === null || !Number.isFinite(model.dimensions.height)) height = quantity(`hw_height:${choice.id}`, name, null, 'no model', '', 'muted');
    else height = quantity(`hw_height:${choice.id}`, name, model.dimensions.height, String(model.dimensions.height), 'm tall');
    return { id: choice.id, name, count, height, status: model ? model.status : null };
  });
}

/** Spacing of the range rings drawn on the ground around the landing point, in metres. */
export function groundRingQuantities(minorM: number, majorM: number): { minor: Quantity; major: Quantity } {
  return {
    minor: quantity('ground_ring_minor', 'Range rings', minorM, String(minorM), 'm'),
    major: quantity('ground_ring_major', 'Range rings', majorM, String(majorM), 'm'),
  };
}
