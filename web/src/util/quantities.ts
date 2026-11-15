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

import type { CheckResponse, EarthLink, Geometry, HorizonResponse, SiteEvaluation, SiteRef } from '../api/types';
import { azElFromSubpoint, normalizeLon360 } from './geo';
import { nextSunChange, sunAt, type SunChange } from './horizon';
import { formatMargin, levelFromStatus, type PowerLevel } from './power';
import { southPoleSeason, type PoleSeason } from './season';
import { discLitFromEarth, earthSwing, trackCovers, type GeometryTrack } from './track';
import { DAY_MS, formatLtcOffsetMicros, formatSinceLanding, formatUtcMinute, ltcClock, ltcOffsetMicros, utcClock, type ClockParts } from './time';

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
 * Horizon samples at most this far apart carry the time of a sunrise or sunset to a tenth of an
 * hour (checked against the mock model in src/util/horizon.test.ts). A minute of slack allows for
 * sample times the backend rounded.
 */
const FINE_SAMPLE_HOURS = 1;
function fineSamples(gapHours: number): boolean {
  return Number.isFinite(gapHours) && gapHours <= FINE_SAMPLE_HOURS + 1 / 60;
}

/** Half of the last digit a direction is shown to (0.1°): a reading must be at least this sure. */
const DIRECTION_TOLERANCE_DEG = 0.05;

/** A number with fixed decimals and a true minus sign. */
export function fixed(value: number, digits: number): string {
  const rounded = Math.round(value * 10 ** digits) / 10 ** digits;
  const text = Math.abs(rounded).toFixed(digits);
  return rounded < 0 ? `${MINUS}${text}` : text;
}

function latitude(key: string, label: string, lat: number | null, tone?: Tone): Quantity {
  if (lat === null || !Number.isFinite(lat)) return missing(key, label, tone);
  const text = Math.abs(lat).toFixed(2);
  // A latitude that rounds to zero is on the equator: no hemisphere letter to flicker between.
  return quantity(key, label, lat, text, text === '0.00' ? '°' : lat < 0 ? '° S' : '° N', tone);
}

function longitude(key: string, label: string, lonEast: number | null, tone?: Tone): Quantity {
  if (lonEast === null || !Number.isFinite(lonEast)) return missing(key, label, tone);
  const lon = normalizeLon360(lonEast);
  const text = lon.toFixed(2);
  return quantity(key, label, lon, text === '360.00' ? '0.00' : text, '° E', tone);
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
    // One decimal (six minutes) only when the change was read off a crossing between two close
    // samples. Otherwise whole hours, and the label says "about".
    return change.interpolated && fineSamples(change.sampleGapHours)
      ? quantity('next_change', `${word} in`, change.hours, change.hours.toFixed(1), 'h', 'sun')
      : quantity('next_change', `${word} in about`, change.hours, String(Math.round(change.hours)), 'h', 'sun');
  }
  if (horizon && lit !== null) return quantity('next_change', lit ? 'Sunset' : 'Sunrise', null, 'none in view', '', 'muted');
  return missing('next_change', 'Next sunrise or sunset');
}

/** Every sky readout for one instant. Pure: the same inputs always give the same quantities. */
export function skyQuantities(input: SkyInput): SkyQuantities {
  const { track, tMs, site } = input;
  const hasT = isInstant(tMs);
  // A landing time that is missing or unreadable (NaN from a broken answer) is no landing time.
  const landingMs = isInstant(input.landingMs) ? input.landingMs : null;
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
  const sun = sunFromTrack ?? sunFromHorizon;
  // Earth's direction at the site, from Earth's overhead point (parallax ignored: good to about 1°).
  const earth = site && geometry ? azElFromSubpoint(site.lat, site.lon_east, geometry.subearth_lat, geometry.subearth_lon_east) : null;

  // Lit or dark, and the next sunrise or sunset, need the terrain: they come from the horizon answer.
  const change = horizon ? nextSunChange(horizon, tMs) : null;
  const lit = sunInHorizon ? sunInHorizon.above : null;
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
  energy: Quantity;
  /** "pass", or "fail: night power". */
  verdict: Quantity;
  passes: boolean | null;
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
      passes: null,
    };
  }
  const margin = check ? check.balance.margin_percent : e.power_margin_percent;
  const level = levelFromStatus(check ? check.balance.status : e.power_status);
  const marginText = formatMargin(margin, level);
  const hasNumber = margin !== null && Number.isFinite(margin);
  const fail = e.verdict.result === 'fail';
  const energySign = e.energy_added_kwh > 0 ? '+' : e.energy_added_kwh < 0 ? MINUS : '';
  return {
    rank: rank === null ? missing('rank', 'Rank') : quantity('rank', 'Rank', rank, String(rank).padStart(2, '0'), ''),
    score: quantity('score', 'Score', e.score, String(Math.round(e.score)), '/ 100'),
    sunlightPercent: quantity('sunlight_percent', 'Sunlight', e.sunlight_percent, e.sunlight_percent.toFixed(1), '%', 'sun'),
    sunlightHours: quantity('sunlight_hours', 'Sunlit hours', e.sunlight_hours, Math.round(e.sunlight_hours).toLocaleString('en-US'), 'h', 'sun'),
    clearSky: quantity('clear_sky', 'Clear sky', e.clear_sky_percent, e.clear_sky_percent.toFixed(1), '%'),
    earthLink: quantity('earth_link', 'Earth link', null, EARTH_LINK_WORD[e.earth_link], '', EARTH_LINK_TONE[e.earth_link]),
    powerMargin: hasNumber
      ? quantity('power_margin', 'Power margin', margin, marginText.replace('%', ''), '%', LEVEL_TONE[level])
      : quantity('power_margin', 'Power margin', null, marginText === DASH ? 'no load' : marginText, '', LEVEL_TONE[level]),
    energy: quantity('energy', 'Energy over the stay', e.energy_added_kwh, `${energySign}${Math.round(Math.abs(e.energy_added_kwh)).toLocaleString('en-US')}`, 'kWh', LEVEL_TONE[level]),
    verdict: quantity('verdict', 'Result', null, fail ? `fail: ${e.verdict.requirement ?? 'requirement not met'}` : 'pass', '', fail ? 'bad' : 'good'),
    passes: !fail,
  };
}
