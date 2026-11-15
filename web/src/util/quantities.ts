// The readout quantities: every number the HUD shows, with its label and unit.
//
// DATA HONESTY. A readout on screen is a `Quantity`, and a Quantity is only ever made here, from
// the app's data: answers of the API layer (in example mode, the mock model), the geometry track
// built from those answers, and the visitor's own inputs (dates, delay). There are no random
// numbers and no filler values anywhere in the interface. When the data has not arrived, the
// value is null and the text is a dash. src/util/quantities.test.ts and
// src/hud/readouts.test.tsx hold this in place.

import type { CheckResponse, EarthLink, Geometry, HorizonResponse, SiteEvaluation, SiteRef } from '../api/types';
import { azElFromSubpoint, normalizeLon360 } from './geo';
import { nextSunChange, sunAt, type SunChange } from './horizon';
import { formatMargin, levelFromStatus, type PowerLevel } from './power';
import { southPoleSeason, type PoleSeason } from './season';
import { discLitFromEarth, type GeometryTrack } from './track';
import { formatLtcOffsetMicros, formatSinceLanding, formatUtcMinute, ltcClock, ltcOffsetMicros, utcClock, type ClockParts } from './time';

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

/** Every sky readout for one instant. Pure: the same inputs always give the same quantities. */
export function skyQuantities(input: SkyInput): SkyQuantities {
  const { track, tMs, landingMs, site } = input;
  const inTrack = track !== null && tMs >= track.startMs && tMs <= track.endMs;
  const geometry = inTrack ? track.at(tMs) : null;
  const horizon = horizonCovers(input.horizon, site, tMs) ? input.horizon : null;

  // The Sun's direction at the site: the horizon answer when it covers this instant (it is the
  // backend's own figure and matches the horizon plot); otherwise from the Sun's overhead point.
  const sunFromHorizon = horizon ? sunAt(horizon, tMs) : null;
  const sunFromTrack = site && geometry ? azElFromSubpoint(site.lat, site.lon_east, geometry.subsolar_lat, geometry.subsolar_lon_east) : null;
  const sun = sunFromHorizon ?? sunFromTrack;
  // Earth's direction at the site, from Earth's overhead point (parallax ignored: good to about 1°).
  const earth = site && geometry ? azElFromSubpoint(site.lat, site.lon_east, geometry.subearth_lat, geometry.subearth_lon_east) : null;

  const change = horizon ? nextSunChange(horizon, tMs) : null;
  const lit = sunFromHorizon ? sunFromHorizon.above : null;

  const utc = Number.isFinite(tMs) ? utcClock(tMs) : null;
  const ltc = landingMs !== null && Number.isFinite(tMs) ? ltcClock(tMs, landingMs) : null;

  return {
    geometry,
    subsolarLat: latitude('subsolar_lat', 'Sun overhead, latitude', geometry?.subsolar_lat ?? null, 'sun'),
    subsolarLon: longitude('subsolar_lon', 'Sun overhead, longitude', geometry?.subsolar_lon_east ?? null, 'sun'),
    subearthLat: latitude('subearth_lat', 'Earth overhead, latitude', geometry?.subearth_lat ?? null, 'earth'),
    subearthLon: longitude('subearth_lon', 'Earth overhead, longitude', geometry?.subearth_lon_east ?? null, 'earth'),
    sunAz: azimuth('sun_az', 'Sun azimuth', sun?.az ?? null, 'sun'),
    sunEl: elevation('sun_el', 'Sun elevation', sun?.el ?? null, 'sun'),
    earthAz: azimuth('earth_az', 'Earth azimuth', earth?.az ?? null, 'earth'),
    earthEl: elevation('earth_el', 'Earth elevation', earth?.el ?? null, 'earth'),
    discLit: geometry ? quantity('disc_lit', 'Moon disc lit, seen from Earth', discLitFromEarth(geometry) * 100, (discLitFromEarth(geometry) * 100).toFixed(1), '%') : missing('disc_lit', 'Moon disc lit, seen from Earth'),
    sunState: lit === null ? missing('sun_state', 'Site') : quantity('sun_state', 'Site', null, lit ? 'lit' : 'dark', '', lit ? 'sun' : 'muted'),
    nextChange: change
      ? quantity('next_change', change.kind === 'sunrise' ? 'Sunrise in' : 'Sunset in', change.hours, change.hours.toFixed(1), 'h', 'sun')
      : horizon
        ? quantity('next_change', lit ? 'Sunset' : 'Sunrise', null, 'none in view', '', 'muted')
        : missing('next_change', 'Next sunrise or sunset'),
    change,
    utc,
    ltc,
    utcClock: utc ? quantity('utc', 'UTC', tMs, `${utc.date} ${utc.time}`, 'UTC') : missing('utc', 'UTC'),
    ltcClock: ltc ? quantity('ltc', 'LTC, model value', tMs, `${ltc.date} ${ltc.time}.${ltc.fraction}`, 'LTC') : missing('ltc', 'LTC, model value'),
    ltcOffset:
      landingMs !== null
        ? quantity('ltc_offset', 'LTC − UTC', ltcOffsetMicros(tMs, landingMs), formatLtcOffsetMicros(tMs, landingMs), 'µs')
        : missing('ltc_offset', 'LTC − UTC'),
    sinceLanding: landingMs !== null ? quantity('since_landing', 'Since landing', (tMs - landingMs) / 3_600_000, formatSinceLanding(tMs, landingMs), '') : missing('since_landing', 'Since landing'),
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
 * latitude in the evaluation answer).
 */
export function missionDates(launchUtcMs: number, slipDays: number, landingMs: number | null, landingGeometry: Geometry | null): MissionDates {
  const season = landingGeometry ? southPoleSeason(landingGeometry.subsolar_lat) : null;
  return {
    plannedLaunch: quantity('planned_launch', 'Planned launch', launchUtcMs, formatUtcMinute(launchUtcMs), 'UTC'),
    launch: quantity('launch', 'Launch', launchUtcMs + slipDays * 86_400_000, formatUtcMinute(launchUtcMs + slipDays * 86_400_000), 'UTC'),
    delay: quantity('delay', 'Launch delay', slipDays, `+${slipDays}`, slipDays === 1 ? 'day' : 'days'),
    landing: landingMs === null ? missing('landing', 'Landing') : quantity('landing', 'Landing', landingMs, formatUtcMinute(landingMs), 'UTC'),
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
