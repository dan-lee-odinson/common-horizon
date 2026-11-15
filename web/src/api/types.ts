/**
 * API TYPES — one set for both modes: the live backend (backend/, routes in
 * backend/docs/WEBSITE_API.md) and the website's example mode (src/api/mock/), which answers in
 * exactly these shapes. They follow the backend's pydantic models in backend/app/models/website.py
 * and website_horizon.py field for field. Field names use snake_case because the backend is Python.
 * Units are in the field names where it matters (_kwh, _deg, _percent...).
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
  /** False when the assistant (language model) is switched off or unreachable. The backend sends false: it has no assistant. */
  assistant_available: boolean;
  /** Backend only (additive). */
  service?: string;
  contract_version?: string;
  physics_engine?: { name: string; version: string; is_synthetic: boolean; available: boolean };
}

// ---------- provenance (on /evaluate, /check and /horizon answers) ----------

/**
 * Where an answer's numbers come from. `is_synthetic` true: placeholder fixtures (the backend's
 * synthetic engine, or the website's example model), not physics results.
 */
export interface DataProvenance {
  /** "synthetic" or "physics_engine" from the backend; "example" from the website's example model. */
  source: string;
  is_synthetic: boolean;
  engine_name: string;
  engine_version: string;
  /** A sentence that says where the numbers come from. */
  notice: string;
  sources: string[];
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
  /**
   * Launch to landing, days. The website always sends TRANSIT_DAYS (state/app.ts, our estimate).
   * Left out, the backend counts it as 0 and says so in `warnings`.
   */
  transit_days?: number | null;
}

export type EarthLink = 'clear' | 'intermittent' | 'none';

/**
 * Requirements are checked in this order: "hardware fit", "night power", "day power",
 * "landing slope", "Earth contact".
 */
export interface Verdict {
  /** "unknown": nothing failed, but at least one requirement could not be checked. Never a pass. */
  result: 'pass' | 'fail' | 'unknown';
  /** fail: the first requirement that failed. unknown: the first that could not be checked. */
  requirement: string | null;
  /** Every requirement that could not be checked, in order. */
  unknown_requirements: string[];
}

/** One requirement's line: passed, failed, or null when it could not be checked. */
export interface RequirementCheck {
  requirement: string;
  passed: boolean | null;
  detail: string;
}

/** The four 0..100 terms of the score; null when the input is unknown. */
export interface ScoreComponents {
  sunlight: number;
  darkness: number;
  earth: number;
  slope: number | null;
}

/** The planner's site_energy: the energy a site's darkness adds (night load plus heating). */
export interface SiteEnergy {
  dark_hours: number;
  nights: number;
  night_penalty_kwh: number;
  heating_penalty_kwh: number;
  total_kwh: number;
}

export interface SiteEvaluation {
  site_id: string;
  /** Position in this answer, 1 = best. The backend owns the order: the website never re-sorts. */
  rank: number;
  /** 0..100, higher is better. null when a term is unknown (today: slope): see score_min and score_max. */
  score: number | null;
  /** The score with every unknown term at its worst. */
  score_min: number;
  /** The score with every unknown term at its best. */
  score_max: number;
  score_components: ScoreComponents;
  sunlight_hours: number;
  sunlight_percent: number;
  longest_darkness_hours: number;
  earth_visible_percent: number;
  /** Share of the sky not blocked by terrain, 0..100. null without a terrain skyline for the site. */
  clear_sky_percent: number | null;
  slope_deg: number | null;
  /**
   * What slope_deg is, when it is given (from the backend's Moon Trek slopes, feat/moon-trek-slope):
   * for example "slope of the best-fit plane to LOLA heights within 500 m (NASA Moon Trek)". Absent
   * from backends without it, and null where there is no slope (a custom point). Shown as the slope's label.
   */
  slope_source?: string | null;
  earth_link: EarthLink;
  /** null when the planner cannot decide (several capacity figures, a mass missing). */
  hardware_fits: boolean | null;
  /** Always null from the backend: the planner has no net generation-minus-load figure (see site_energy). */
  energy_added_kwh: number | null;
  site_energy: SiteEnergy | null;
  /**
   * The site's power balance margin: the worse of the day and night checks (the same number the
   * planner shows for this site). null when there is nothing to check, and also when nothing
   * makes power for a check that has a load: read power_status for the colour.
   */
  power_margin_percent: number | null;
  /** Colour of the balance, as the planner module gives it. Colours the energy figure. */
  power_status: PowerStatus;
  verdict: Verdict;
  requirements: RequirementCheck[];
  elevation_m: number;
  elevation_source: string;
  /** About this site only, for example that its terrain is not included. */
  warnings: string[];
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
  /** Launch + transit + slip. The website reads the landing from here only. */
  landing_utc: IsoUtc;
  /** As sent; null means not stated (counted as 0, with a warning). */
  transit_days: number | null;
  slip_days: number;
  stay_days: number;
  /** Sampling step used for every site in this answer, seconds. */
  time_step_s: number;
  /** null only if the engine returned no positions. */
  geometry: Geometry | null;
  /** Best first, ranked by the backend (each result carries its `rank`). */
  results: SiteEvaluation[];
  provenance: DataProvenance;
  warnings: string[];
}

// ---------- POST /horizon ----------
export interface HorizonRequest {
  site: SiteRef;
  start_utc: IsoUtc;
  end_utc: IsoUtc;
  /** Wanted spacing of sun_path samples. The backend rounds it to whole minutes and may coarsen it (see time_step_s). */
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
  /**
   * "above" when ANY PART of the Sun's disc is visible above the terrain skyline (the rule
   * /evaluate counts as sunlight), otherwise "hidden". az and el are the Sun's centre. Used as given.
   */
  state: SunState;
}

/** Part of the sky Earth moves through during the window. az_min > az_max means it wraps past north. */
export interface SkyBox {
  az_min: number;
  az_max: number;
  el_min: number;
  el_max: number;
}

/**
 * stored_profile: the site's stored terrain horizon profile. smooth_sphere: no terrain, only the
 * geometric dip of a sphere through the site (the answer's warnings say terrain is not included).
 */
export type SkylineSource = 'stored_profile' | 'smooth_sphere';

export interface HorizonResponse {
  site_id: string;
  /** Terrain skyline, sorted by azimuth, evenly spaced, at whatever spacing the source has (0.5 degrees for stored profiles). */
  skyline: SkyPoint[];
  sun_path: SunPathPoint[];
  /** null when Earth never rises above level during the window. */
  earth_box: SkyBox | null;
  skyline_source: SkylineSource;
  /** Spacing of sun_path actually used, seconds. */
  time_step_s: number;
  provenance: DataProvenance;
  warnings: string[];
}

// ---------- GET /catalog ----------
/** lander; cargo (payload mass); power (a power source); load (a power load). */
export type HardwareKind = 'lander' | 'cargo' | 'power' | 'load';

/** One figure exactly as the planner catalog stores it: its published unit, status labels and source. */
export interface CatalogFigure {
  /** A number, a published range [low, high], or null when not published. */
  value: number | number[] | null;
  unit: string;
  /** Status labels, from the catalog's `status_labels` ("NASA figure", "our estimate", ...). */
  status: string[];
  source: string;
  qualifier?: string | null;
  note?: string | null;
}

/** One published payload figure of a lander. */
export interface CapacityOption {
  option: string;
  label: string;
  /** The value a fit check uses (the low end of a published range). */
  capacity_kg: number;
  figure: CatalogFigure;
}

/**
 * A catalog row. Ids are the planner's (`griffin`, `starship_hls`, `fission_40kwe`, ...). A null
 * figure is not published (or does not apply to the kind): the website shows "not published".
 */
export interface CatalogItem {
  id: string;
  name: string;
  kind: HardwareKind;
  countable: boolean;
  default_count: number;
  max_count: number;
  /** Payload mass. null when not published, and for landers, sources and loads. */
  mass_kg: number | null;
  /** Landers only: payload they can bring down. null with several published figures: see capacity_options. */
  capacity_kg?: number | null;
  /** Landers: every published payload figure. The visitor picks one; the first is the default. */
  capacity_options: CapacityOption[];
  /** Landers only: steepest ground they can land on. null when none is published. */
  max_slope_deg?: number | null;
  /** Loads only: power drawn in sunlight. */
  load_day_kw: number | null;
  /** Loads only: power drawn in darkness. */
  load_night_kw: number | null;
  /** Energy used once per night, per unit (for example rover keep-warm). */
  energy_per_night_kwh?: number | null;
  /** Sources only: power produced per unit. */
  gen_kw: number | null;
  /** Sources only: true for solar, which produces only while the Sun is up. */
  gen_needs_sun: boolean | null;
  /** Picture URL for the planner row, or null for the empty slot. */
  picture: string | null;
  note?: string | null;
  /** The planner's figures behind the numbers above, by name, each with its status and source. */
  figures: Record<string, CatalogFigure>;
}

export interface CatalogResponse {
  items: CatalogItem[];
  /** Every status label a figure can carry, in the catalog's order. */
  status_labels: string[];
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

export type FitVerdict = 'fits' | 'does not fit' | 'depends on capacity figure' | 'mass needed' | 'no lander' | 'nothing to fit';

export interface CheckResponse {
  /** null when the planner cannot decide (several capacity figures disagree, a mass is missing). */
  fits: boolean | null;
  fit_verdict: FitVerdict;
  /** One line for each capacity figure of the lander, then any other notes. */
  fit_notes: string[];
  day: DayCheck;
  night: NightCheck;
  balance: PowerBalance;
  /** What the power check could not count, in plain words. */
  power_notes: string[];
  /** Always null from the backend (see site_energy). */
  energy_added_kwh: number | null;
  /** null when no site is given (no darkness length). */
  site_energy: SiteEnergy | null;
  /** Where the darkness length came from. null without a site. */
  provenance: DataProvenance | null;
  warnings: string[];
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

// ---------- GET /api/v1/horizons/compare (live mode only) ----------
// The physics engine's and NASA JPL Horizons' directions to the Sun and the Earth for one place and
// one minute (backend/docs/HORIZONS-CHECK.md). 502 with `error: "horizons_unavailable"` when
// Horizons does not answer.

export interface AzEl {
  azimuth_deg: number;
  elevation_deg: number;
}

export interface BodyComparison {
  horizons: AzEl;
  /** null when the engine could not run; see engine_unavailable_reason. */
  engine: AzEl | null;
  /** Angle on the sky between the two directions, degrees. */
  angle_between_deg: number | null;
}

export interface HorizonsCompareResponse {
  site: { latitude_deg: number; longitude_deg: number; site_height_m: number; observer_height_m: number };
  requested_time_utc: IsoUtc;
  /** The requested time rounded to the minute; both sides use it. */
  time_utc: IsoUtc;
  sun: BodyComparison;
  earth: BodyComparison;
  engine_unavailable_reason: string | null;
  provenance: { horizons: { service: string; url: string; api_url: string; api_version: string | null; retrieved_utc: IsoUtc; from_cache: boolean } & Record<string, unknown> } & Record<string, unknown>;
}

// ---------- /data/moon-trek-sun-check.json (a static file served with the website) ----------
// The same layout as horizons-check.json, for the Sun only: the physics engine against NASA Moon
// Trek's Sun angle service (backend/scripts/validate_against_moon_trek.py).

export interface MoonTrekCheckSite {
  sun_max_angle_deg: number;
  samples?: number;
  period?: { start_utc: string; stop_utc: string; step_minutes: number };
  retrieved_utc?: string;
  moon_trek_url?: string;
}

export interface MoonTrekCheckFile {
  format: string;
  format_version: number;
  what?: string;
  source?: string;
  sites: Record<string, MoonTrekCheckSite>;
}

// ---------- /data/horizons-check.json (a static file served with the website) ----------

export interface HorizonsCheckSite {
  sun_max_angle_deg: number;
  earth_max_angle_deg: number;
  samples: { sun: number; earth: number };
  period: { start_utc: string; stop_utc: string; step_minutes: number };
  retrieved_utc: string;
  horizons_url: string;
}

export interface HorizonsCheckFile {
  format: string;
  format_version: number;
  what?: string;
  source?: string;
  sites: Record<string, HorizonsCheckSite>;
}
