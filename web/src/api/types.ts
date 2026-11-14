/**
 * PROVISIONAL API TYPES — hand-written for the website's mock mode.
 *
 * These describe the answers the website expects from the Python backend (folder backend/).
 * They will be REPLACED by types generated from the backend's OpenAPI file once it exists;
 * until then, treat every name here as a proposal. Field names use snake_case because the
 * backend is Python. Units are in the field names where it matters (_kwh, _deg, _percent...).
 *
 * Conventions: latitude in degrees (-90..90); longitude in degrees EAST (0..360);
 * azimuth clockwise from north (0..360); elevation above level (degrees);
 * all times are ISO 8601 strings in UTC ending in "Z".
 */

export type IsoUtc = string;

// ---------- GET /health ----------
export interface HealthResponse {
  status: 'ok' | 'degraded';
  version: string;
  /** False when the assistant (language model) is switched off or unreachable. */
  assistant_available: boolean;
}

// ---------- GET /sites ----------
export interface Site {
  id: string;
  name: string;
  lat: number;
  lon_east: number;
  /** Plain-text label shown under the name. */
  note?: string | null;
  /** Catalog ids that are in the plan by default when this site is picked. */
  default_hardware?: string[];
}

export interface SiteListResponse {
  sites: Site[];
}

/** A site as sent to the backend: a preset, a saved point or a typed / clicked coordinate. */
export interface SiteRef {
  id: string;
  name: string;
  lat: number;
  lon_east: number;
}

export interface HardwareChoice {
  id: string;
  count: number;
}

/**
 * Battery storage typed by the visitor, in kWh. 0 means none. It is not a catalog row: the planner
 * module takes it as its own figure (`power_check(..., storage_kwh=...)`) and has no default storage.
 */
export type StorageKwh = number;

// ---------- POST /evaluate ----------
export interface EvaluateRequest {
  sites: SiteRef[];
  /** Planned launch time (UTC). */
  launch_utc: IsoUtc;
  /** Launch delay in whole days, 0..30. */
  slip_days: number;
  /** Surface stay in days, 1..365.25. */
  stay_days: number;
  hardware: HardwareChoice[];
  /** Battery storage in kWh; 0 = none. */
  storage_kwh: StorageKwh;
}

export type EarthLink = 'clear' | 'intermittent' | 'none';

export interface Verdict {
  result: 'pass' | 'fail';
  /** The requirement that broke, in plain words, when result is "fail". */
  requirement: string | null;
}

export interface SiteEvaluation {
  site_id: string;
  /** 0..100, higher is better. */
  score: number;
  sunlight_hours: number;
  sunlight_percent: number;
  /** Share of the sky not blocked by terrain, 0..100. */
  clear_sky_percent: number;
  earth_link: EarthLink;
  hardware_fits: boolean;
  /** Net energy over the stay (generation minus load). Negative means a deficit. */
  energy_added_kwh: number;
  /**
   * The site's power balance margin: the worse of the day and night checks (the same number the
   * planner shows for this site). null when there is nothing to check, and also when nothing
   * makes power for a check that has a load: read power_status for the colour.
   */
  power_margin_percent: number | null;
  /** Colour of the balance, as the planner module gives it. Colours the energy figure. */
  power_status: PowerStatus;
  verdict: Verdict;
}

/** Where the Sun and Earth are overhead on the Moon at the landing time. */
export interface Geometry {
  subsolar_lat: number;
  subsolar_lon_east: number;
  subearth_lat: number;
  subearth_lon_east: number;
}

export interface EvaluateResponse {
  launch_utc: IsoUtc;
  /** Launch + transit + slip. */
  landing_utc: IsoUtc;
  slip_days: number;
  stay_days: number;
  geometry: Geometry;
  /** Best first. */
  results: SiteEvaluation[];
}

// ---------- POST /horizon ----------
export interface HorizonRequest {
  site: SiteRef;
  start_utc: IsoUtc;
  end_utc: IsoUtc;
  /** Wanted spacing of sun_path samples; the backend may round it. */
  step_hours: number;
}

export interface SkyPoint {
  az: number;
  el: number;
}

export type SunState = 'above' | 'hidden';

export interface SunPathPoint {
  t: IsoUtc;
  az: number;
  el: number;
  /** "above" when the Sun's centre is above the terrain skyline at that azimuth. */
  state: SunState;
}

/** Part of the sky Earth moves through during the window. az_min > az_max means it wraps past north. */
export interface SkyBox {
  az_min: number;
  az_max: number;
  el_min: number;
  el_max: number;
}

export interface HorizonResponse {
  site_id: string;
  /** Terrain skyline, sorted by azimuth, evenly spaced. */
  skyline: SkyPoint[];
  sun_path: SunPathPoint[];
  /** null when Earth never rises above level during the window. */
  earth_box: SkyBox | null;
}

// ---------- GET /catalog ----------
export type HardwareKind = 'lander' | 'cargo' | 'power';

export interface CatalogItem {
  id: string;
  name: string;
  kind: HardwareKind;
  countable: boolean;
  default_count: number;
  max_count: number;
  mass_kg: number;
  /** Landers only: payload they can bring down. */
  capacity_kg?: number;
  /** Landers only: steepest ground they can land on. */
  max_slope_deg?: number;
  load_day_kw: number;
  load_night_kw: number;
  /** Energy used once per night, per unit, by an item that draws in darkness (for example rover keep-warm). */
  energy_per_night_kwh?: number;
  /** Power produced per unit. */
  gen_kw: number;
  /** True for solar: produces only while the Sun is up. */
  gen_needs_sun: boolean;
  /** Picture URL for the planner row, or null for the empty slot. */
  picture: string | null;
  note?: string | null;
}

export interface CatalogResponse {
  items: CatalogItem[];
}

// ---------- POST /check ----------
export interface CheckRequest {
  /** null = no site chosen yet: a generic day / night check. */
  site: SiteRef | null;
  landing_utc: IsoUtc;
  stay_days: number;
  hardware: HardwareChoice[];
  /** Battery storage in kWh; 0 = none. */
  storage_kwh: StorageKwh;
}

/**
 * Colours as the planner module names them: green at a margin of 25 % or more, yellow from 0 up to
 * 25, red when negative (or when a load has nothing to power it), none when there is nothing to check.
 */
export type PowerStatus = 'green' | 'yellow' | 'red' | 'none';

/**
 * Day check: sources working in sunlight must cover the day load plus the power to refill storage.
 * Margin percent = (available - load) / available x 100, where load = load_kw + refill_kw.
 */
export interface DayCheck {
  /** False when there is nothing to check (status "none"). */
  needed: boolean;
  /** Sources working in sunlight (solar and fission), kW. */
  generation_kw: number;
  /** Loads running in sunlight, kW. */
  load_kw: number;
  /** Power to refill storage over refill_hours, kW. */
  refill_kw: number;
  /** Energy to refill: the storage the longest darkness needs, kWh. */
  refill_kwh: number;
  /** Sunlit hours to refill; null when the darkness length is not known. */
  refill_hours: number | null;
  margin_percent: number | null;
  status: PowerStatus;
  passes: boolean;
}

/**
 * How the night margin was worked out (the planner module's `basis`, shortened):
 *   energy       storage is needed: energy over the longest darkness (kWh)
 *   power        sources working in darkness carry the night on their own (kW)
 *   power only   no darkness length known (no site picked): power compared, storage not counted
 *   no darkness  the stay has no darkness, so there is no night to check
 */
export type NightBasis = 'energy' | 'power' | 'power only' | 'no darkness';

/**
 * Night check: storage must cover (night load - sources working in darkness) x the longest
 * darkness, plus the per-night items.
 */
export interface NightCheck {
  /** False when there is nothing to check (status "none"). */
  needed: boolean;
  basis: NightBasis;
  /** Sources working in darkness, kW. */
  generation_kw: number;
  /** Loads running in darkness, kW. */
  load_kw: number;
  /** Per-night energy items of loads that run in darkness, kWh. */
  per_night_kwh: number;
  /** Longest darkness in the stay, hours. null when no site is picked. */
  longest_darkness_h: number | null;
  /** Storage as typed, kWh. */
  storage_kwh: StorageKwh;
  /** Storage that would cover the longest darkness, kWh. null when no site is picked. */
  storage_needed_kwh: number | null;
  /** With a darkness length: sources in darkness x hours + storage, kWh. */
  available_kwh: number | null;
  /** With a darkness length: night load x hours + per-night items, kWh. */
  load_kwh: number | null;
  margin_percent: number | null;
  status: PowerStatus;
  passes: boolean;
}

export interface PowerBalance {
  /** The worse of the day and night margins. */
  margin_percent: number | null;
  status: PowerStatus;
  /** The check that sets the balance: "day", "night", "day and night" (a tie) or null. */
  limiting: 'day' | 'night' | 'day and night' | null;
}

export interface CheckResponse {
  fits: boolean;
  fit_notes: string[];
  day: DayCheck;
  night: NightCheck;
  balance: PowerBalance;
  /** What the power check could not count, in plain words. */
  power_notes: string[];
  energy_added_kwh: number;
}

// ---------- POST /assistant ----------
export interface AskRequest {
  question: string;
  context: {
    site_id: string | null;
    launch_utc: IsoUtc;
    slip_days: number;
    stay_days: number;
    hardware: HardwareChoice[];
    storage_kwh: StorageKwh;
  };
}

export interface AskResponse {
  answer: string;
  /** True for the built-in example answers in mock mode. */
  example?: boolean;
}
