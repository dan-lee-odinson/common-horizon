// Loads every answer the screens need and shares it through React context.
// Components read from here; only src/api/client.ts actually makes calls.

import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { api, isEmpty } from '../api/client';
import type {
  CatalogResponse,
  CheckResponse,
  EvaluateResponse,
  HardwareChoice,
  HealthResponse,
  HorizonResponse,
  Site,
  SiteListResponse,
  SiteRef,
} from '../api/types';
import { rankRows, type RankedRow } from '../util/ranking';
import { DAY_MS, toIsoUtc } from '../util/time';
import { actions, appStore, hardwareChoices } from './app';
import { useStore } from './store';
import { useAsync, type AsyncResult } from './useAsync';

export interface EvaluationBundle {
  current: EvaluateResponse;
  /** The same evaluation with no slip, when a slip is set. */
  planned: EvaluateResponse | null;
  rows: RankedRow[];
}

export type KnownSite = SiteRef & Pick<Site, 'note' | 'default_hardware'> & { custom?: boolean };

export interface DataValue {
  health: AsyncResult<HealthResponse>;
  sites: AsyncResult<SiteListResponse>;
  catalog: AsyncResult<CatalogResponse>;
  evaluation: AsyncResult<EvaluationBundle>;
  check: AsyncResult<CheckResponse>;
  horizon: AsyncResult<HorizonResponse>;
  /** Presets, the custom point and saved custom points: everything that gets ranked. */
  allSites: KnownSite[];
  siteById: Map<string, KnownSite>;
  highlighted: KnownSite | null;
  hardwareChosen: HardwareChoice[];
  landingMs: number | null;
  plannedLandingMs: number | null;
  /** Horizon timeline window: planned landing to the end of the (slipped) stay. */
  windowStartMs: number | null;
  windowEndMs: number | null;
}

const DataContext = createContext<DataValue | null>(null);

export function useData(): DataValue {
  const value = useContext(DataContext);
  if (!value) throw new Error('useData must be used inside <DataProvider>');
  return value;
}

/** Horizon sample spacing: about 600 points across the window, never finer than 15 minutes. */
export function horizonStepHours(startMs: number, endMs: number): number {
  return Math.max(0.25, Math.round(((endMs - startMs) / 3_600_000 / 600) * 4) / 4);
}

export function horizonKey(site: SiteRef | null, startMs: number | null, endMs: number | null): string | null {
  if (!site || startMs === null || endMs === null) return null;
  return JSON.stringify([site.id, site.lat, site.lon_east, startMs, endMs]);
}

export function useHorizonFor(site: SiteRef | null, startMs: number | null, endMs: number | null): AsyncResult<HorizonResponse> {
  const key = horizonKey(site, startMs, endMs);
  return useAsync(
    key,
    (signal) =>
      api.horizon(
        { site: site!, start_utc: toIsoUtc(startMs!), end_utc: toIsoUtc(endMs!), step_hours: horizonStepHours(startMs!, endMs!) },
        signal,
      ),
    isEmpty.horizon,
    60,
  );
}

export function DataProvider({ children }: { children: ReactNode }) {
  const launchUtcMs = useStore(appStore, (s) => s.launchUtcMs);
  const slipDays = useStore(appStore, (s) => s.slipDays);
  const stayDays = useStore(appStore, (s) => s.stayDays);
  const hardware = useStore(appStore, (s) => s.hardware);
  const highlightedId = useStore(appStore, (s) => s.highlightedId);
  const customSite = useStore(appStore, (s) => s.customSite);
  const saved = useStore(appStore, (s) => s.saved);

  const health = useAsync('health', (signal) => api.health(signal));
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
  const evalKey = siteRefs.length ? JSON.stringify([siteRefs.map((s) => [s.id, s.lat, s.lon_east]), launchUtcMs, slipDays, stayDays, hardwareChosen]) : null;

  const evaluation = useAsync<EvaluationBundle>(
    evalKey,
    async (signal) => {
      const base = { sites: siteRefs, launch_utc: toIsoUtc(launchUtcMs), stay_days: stayDays, hardware: hardwareChosen };
      const [current, planned] = await Promise.all([
        api.evaluate({ ...base, slip_days: slipDays }, signal),
        slipDays > 0 ? api.evaluate({ ...base, slip_days: 0 }, signal) : Promise.resolve(null),
      ]);
      return { current, planned, rows: rankRows(current.results, planned?.results ?? null) };
    },
    (b) => isEmpty.evaluate(b.current),
    150,
  );

  const landingMs = evaluation.data ? Date.parse(evaluation.data.current.landing_utc) : null;
  const plannedLandingMs = evaluation.data ? Date.parse((evaluation.data.planned ?? evaluation.data.current).landing_utc) : null;
  const windowStartMs = plannedLandingMs;
  const windowEndMs = landingMs === null ? null : landingMs + stayDays * DAY_MS;

  const highlightedRef = highlighted ? { id: highlighted.id, name: highlighted.name, lat: highlighted.lat, lon_east: highlighted.lon_east } : null;
  const checkKey = landingMs === null ? null : JSON.stringify([highlightedRef, landingMs, stayDays, hardwareChosen]);
  const check = useAsync(
    checkKey,
    (signal) => api.check({ site: highlightedRef, landing_utc: toIsoUtc(landingMs!), stay_days: stayDays, hardware: hardwareChosen }, signal),
    () => false,
    120,
  );

  const horizon = useHorizonFor(highlightedRef, windowStartMs, windowEndMs);

  const value: DataValue = {
    health,
    sites,
    catalog,
    evaluation,
    check,
    horizon,
    allSites,
    siteById,
    highlighted,
    hardwareChosen,
    landingMs,
    plannedLandingMs,
    windowStartMs,
    windowEndMs,
  };
  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}
