// Loads every answer the screens need and shares it through React context.
// Components read from here; only src/api/client.ts actually makes calls.

import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { api, isEmpty, isMockMode } from '../api/client';
import type {
  CatalogResponse,
  CheckResponse,
  EvaluateResponse,
  Geometry,
  HardwareChoice,
  HealthResponse,
  HorizonResponse,
  HorizonsCheckFile,
  Site,
  SiteListResponse,
  SiteRef,
} from '../api/types';
import { rankRows, type RankedRow } from '../util/ranking';
import { DAY_MS, SYNODIC_MONTH_DAYS, toIsoUtc } from '../util/time';
import type { GeometryTrack } from '../util/track';
import { actions, appStore, hardwareChoices } from './app';
import { loadTrack } from './geometry';
import { loadHorizon } from './horizonLoad';
import { useStore } from './store';
import { useAsync, type AsyncResult } from './useAsync';

export interface EvaluationBundle {
  current: EvaluateResponse;
  /** The same evaluation with no delay, when a delay is set. */
  planned: EvaluateResponse | null;
  rows: RankedRow[];
  /** True when the answer was worked out for a mission with hardware. Only then is it a ranking. */
  forMission: boolean;
  /** The stay, hardware and storage the answer was worked out for (see `missionKey`). */
  mission: string;
}

/**
 * Where the numbers on screen come from, for the label in the top bar:
 *   example  example mode (no backend address): the website's own example model
 *   test     the backend answers with provenance.is_synthetic true: its synthetic test fixture
 *   physics  the backend answers from the real physics engine
 *   unknown  live mode before the backend has said
 */
export type DataSourceKind = 'example' | 'test' | 'physics' | 'unknown';

export type KnownSite = SiteRef & Pick<Site, 'note' | 'default_hardware'> & { custom?: boolean };

export interface DataValue {
  health: AsyncResult<HealthResponse>;
  sites: AsyncResult<SiteListResponse>;
  catalog: AsyncResult<CatalogResponse>;
  evaluation: AsyncResult<EvaluationBundle>;
  check: AsyncResult<CheckResponse>;
  /**
   * The planner's check for the spotlight site, when it belongs to the ranking on screen (the same
   * site, mission and landing). null while a newer check or a newer ranking is on its way.
   */
  focusCheck: CheckResponse | null;
  /** The focus site's horizon over the stay (planned landing to the end of the stay). */
  horizon: AsyncResult<HorizonResponse>;
  /** The reference site's horizon over one lunar day from the landing: the Orbit stage's window. */
  orbitHorizon: AsyncResult<HorizonResponse>;
  /** Where the Sun and Earth are overhead on the Moon across the whole window on screen. */
  track: AsyncResult<GeometryTrack>;
  /** The stored check against NASA JPL Horizons (data/horizons-check.json); null when the file is not there. */
  horizonsCheck: AsyncResult<HorizonsCheckFile | null>;
  /** Where the numbers come from (see DataSourceKind). */
  dataSource: DataSourceKind;
  /** Transit from launch to landing, days, as the evaluation answer gives it; null when the answer does not state one. */
  transitDays: number | null;
  /** Presets, the custom point and saved custom points: everything that gets ranked. */
  allSites: KnownSite[];
  siteById: Map<string, KnownSite>;
  /** The site the visitor picked, if any. */
  highlighted: KnownSite | null;
  /** The site in the spotlight: the picked site, or else the best-ranked one. */
  focus: KnownSite | null;
  focusRow: RankedRow | null;
  /** The site the Orbit readouts are read at: the focus, or else the first site in the list. */
  reference: KnownSite | null;
  /** Ranked rows, best first. Empty until hardware is chosen and the evaluation answers. */
  rows: RankedRow[];
  /**
   * True while a newer ranking is on its way (the delay, the stay or the hardware changed) and the
   * previous one is still on screen. Panels keep showing the previous ranking, marked as updating.
   */
  updating: boolean;
  hardwareChosen: HardwareChoice[];
  /** Battery storage typed in the planner, kWh (0 = none). */
  storageKwh: number;
  landingMs: number | null;
  plannedLandingMs: number | null;
  /** Sun and Earth overhead points at the landing time (straight from the evaluation answer). */
  landingGeometry: Geometry | null;
  /** Horizon timeline window: planned landing to the end of the (delayed) stay. */
  windowStartMs: number | null;
  windowEndMs: number | null;
  /** Orbit preview window: the landing to one lunar day later. */
  orbitEndMs: number | null;
}

/** Exported so a test can render a panel with data it built itself. The app uses <DataProvider>. */
export const DataContext = createContext<DataValue | null>(null);

export function useData(): DataValue {
  const value = useContext(DataContext);
  if (!value) throw new Error('useData must be used inside <DataProvider>');
  return value;
}

export function horizonKey(site: SiteRef | null, startMs: number | null, endMs: number | null): string | null {
  if (!site || startMs === null || endMs === null) return null;
  return JSON.stringify([site.id, site.lat, site.lon_east, startMs, endMs]);
}

/**
 * A site's horizon answer for a window. Its samples are never more than an hour apart, however
 * long the window: a long one is loaded in several requests and joined (state/horizonLoad.ts).
 */
export function useHorizonFor(site: SiteRef | null, startMs: number | null, endMs: number | null): AsyncResult<HorizonResponse> {
  const key = horizonKey(site, startMs, endMs);
  return useAsync(key, (signal) => loadHorizon(site!, startMs!, endMs!, signal), isEmpty.horizon, 60);
}

export function DataProvider({ children }: { children: ReactNode }) {
  const launchUtcMs = useStore(appStore, (s) => s.launchUtcMs);
  const slipDays = useStore(appStore, (s) => s.slipDays);
  const stayDays = useStore(appStore, (s) => s.stayDays);
  const hardware = useStore(appStore, (s) => s.hardware);
  const storageKwh = useStore(appStore, (s) => s.storageKwh);
  const highlightedId = useStore(appStore, (s) => s.highlightedId);
  const customSite = useStore(appStore, (s) => s.customSite);
  const saved = useStore(appStore, (s) => s.saved);
  const stage = useStore(appStore, (s) => s.stage);

  const health = useAsync('health', (signal) => api.health(signal));
  const horizonsCheck = useAsync('horizons-check', (signal) => api.horizonsCheck(signal));
  const sites = useAsync('sites', (signal) => api.listSites(signal), isEmpty.sites);
  const catalog = useAsync('catalog', (signal) => api.catalog(signal), isEmpty.catalog);

  useEffect(() => {
    if (catalog.data) actions.initHardware(catalog.data.items);
  }, [catalog.data]);

  const allSites = useMemo<KnownSite[]>(() => {
    const list: KnownSite[] = (sites.data?.sites ?? []).map((s) => ({ ...s }));
    const ids = new Set(list.map((s) => s.id));
    for (const s of saved) {
      if (!ids.has(s.id)) {
        list.push({ ...s, custom: true });
        ids.add(s.id);
      }
    }
    if (customSite && !ids.has(customSite.id)) list.push({ ...customSite, custom: true });
    return list;
  }, [sites.data, saved, customSite]);

  const siteById = useMemo(() => new Map(allSites.map((s) => [s.id, s])), [allSites]);
  const highlighted = highlightedId ? (siteById.get(highlightedId) ?? null) : null;
  const hardwareChosen = useMemo(() => hardwareChoices(hardware), [hardware]);

  const siteRefs = useMemo<SiteRef[]>(() => allSites.map(({ id, name, lat, lon_east }) => ({ id, name, lat, lon_east })), [allSites]);
  const missionKey = JSON.stringify([stayDays, hardwareChosen, storageKwh]);
  const evalKey = siteRefs.length ? JSON.stringify([siteRefs.map((s) => [s.id, s.lat, s.lon_east]), launchUtcMs, slipDays, stayDays, hardwareChosen, storageKwh]) : null;

  const evaluation = useAsync<EvaluationBundle>(
    evalKey,
    async (signal) => {
      const base = { sites: siteRefs, launch_utc: toIsoUtc(launchUtcMs), stay_days: stayDays, hardware: hardwareChosen, storage_kwh: storageKwh };
      const [current, planned] = await Promise.all([
        api.evaluate({ ...base, slip_days: slipDays }, signal),
        slipDays > 0 ? api.evaluate({ ...base, slip_days: 0 }, signal) : Promise.resolve(null),
      ]);
      return { current, planned, rows: rankRows(current.results, planned?.results ?? null), forMission: hardwareChosen.length > 0, mission: missionKey };
    },
    (b) => isEmpty.evaluate(b.current),
    150,
  );

  // Rows are shown once hardware is chosen: a ranking of an empty mission would mean nothing. That
  // also holds for an answer still on screen from before the hardware was chosen (at start-up the
  // site list can arrive before the hardware list): it is never shown as "the previous ranking".
  const rows = useMemo(
    () => (hardwareChosen.length > 0 && evaluation.data?.forMission ? evaluation.data.rows : []),
    [hardwareChosen.length, evaluation.data],
  );
  const updating = rows.length > 0 && (evaluation.refreshing || evaluation.status === 'waiting');
  const focus = highlighted ?? (rows.length > 0 ? (siteById.get(rows[0].siteId) ?? null) : null);
  const focusRow = focus ? (rows.find((r) => r.siteId === focus.id) ?? null) : null;
  const reference = focus ?? allSites[0] ?? null;

  const landingMs = evaluation.data ? Date.parse(evaluation.data.current.landing_utc) : null;
  const plannedLandingMs = evaluation.data ? Date.parse((evaluation.data.planned ?? evaluation.data.current).landing_utc) : null;
  const landingGeometry = evaluation.data?.current.geometry ?? null;
  const transitDays = evaluation.data ? (evaluation.data.current.transit_days ?? null) : null;
  // The answer's own provenance wins; before the first answer, the health check's engine says.
  const synthetic = evaluation.data?.current.provenance?.is_synthetic ?? health.data?.physics_engine?.is_synthetic;
  const dataSource: DataSourceKind = isMockMode() ? 'example' : synthetic === true ? 'test' : synthetic === false ? 'physics' : 'unknown';
  const windowStartMs = plannedLandingMs;
  const windowEndMs = landingMs === null ? null : landingMs + stayDays * DAY_MS;
  const orbitEndMs = landingMs === null ? null : landingMs + SYNODIC_MONTH_DAYS * DAY_MS;

  const focusRef = useMemo<SiteRef | null>(() => (focus ? { id: focus.id, name: focus.name, lat: focus.lat, lon_east: focus.lon_east } : null), [focus]);
  const checkKey = landingMs === null ? null : JSON.stringify([focusRef, landingMs, stayDays, hardwareChosen, storageKwh]);
  const check = useAsync(
    checkKey,
    (signal) => api.check({ site: focusRef, landing_utc: toIsoUtc(landingMs!), stay_days: stayDays, hardware: hardwareChosen, storage_kwh: storageKwh }, signal),
    () => false,
    120,
  );

  const focusCheck = focusRow && check.status === 'answer' && !check.refreshing && evaluation.data?.mission === missionKey ? check.data : null;

  const horizon = useHorizonFor(focusRef, windowStartMs, windowEndMs);

  const referenceRef = useMemo<SiteRef | null>(
    () => (reference ? { id: reference.id, name: reference.name, lat: reference.lat, lon_east: reference.lon_east } : null),
    [reference],
  );
  // Asked for only while the Orbit stage is showing.
  const orbitHorizon = useHorizonFor(stage === 'orbit' ? referenceRef : null, landingMs, orbitEndMs);

  // The track covers the delay, the stay and one lunar day after the landing, whichever ends last.
  const spanDays = slipDays + Math.max(stayDays, SYNODIC_MONTH_DAYS);
  const track = useAsync<GeometryTrack>(`${launchUtcMs}:${spanDays}`, (signal) => loadTrack(launchUtcMs, spanDays, signal), () => false, 150);

  const value: DataValue = {
    health,
    sites,
    catalog,
    evaluation,
    check,
    focusCheck,
    horizon,
    orbitHorizon,
    track,
    horizonsCheck,
    dataSource,
    transitDays,
    allSites,
    siteById,
    highlighted,
    focus,
    focusRow,
    reference,
    rows,
    updating,
    hardwareChosen,
    storageKwh,
    landingMs,
    plannedLandingMs,
    landingGeometry,
    windowStartMs,
    windowEndMs,
    orbitEndMs,
  };
  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}
