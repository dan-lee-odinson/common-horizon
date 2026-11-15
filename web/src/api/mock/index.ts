// Mock mode: answers every API call from the example files and the mock model, with a short
// delay so the "waiting" state is visible. No network is used.
//
// Add a query parameter to the page address to see the other states on purpose:
//   ?mock=empty        every call answers with nothing in it
//   ?mock=error        every call fails
//   ?mock=slow         every call takes 2.5 s
//   ?assistant=off     the assistant reports "unavailable"

import healthJson from '../examples/health.json';
import sitesJson from '../examples/sites.json';
import assistantJson from '../examples/assistant.json';
import type {
  AskRequest,
  AskResponse,
  CatalogResponse,
  CheckRequest,
  CheckResponse,
  EvaluateRequest,
  EvaluateResponse,
  HealthResponse,
  HorizonRequest,
  HorizonResponse,
  Site,
  SiteListResponse,
} from '../types';
import { ApiError, abortError } from '../errors';
import { MOCK_CATALOG, MOCK_PROVENANCE, MOCK_STATUS_LABELS, evaluateSite, genericCheck, geometryAt, horizonFor, rankResults } from './model';
import { DAY_MS, toIsoUtc } from '../../util/time';

export interface MockScenario {
  mode: 'normal' | 'empty' | 'error' | 'slow';
  assistant: 'on' | 'off';
}

export function readScenario(search: string = globalThis.location?.search ?? ''): MockScenario {
  const params = new URLSearchParams(search);
  const m = params.get('mock');
  const mode = m === 'empty' || m === 'error' || m === 'slow' ? m : 'normal';
  const assistant = params.get('assistant') === 'off' ? 'off' : 'on';
  return { mode, assistant };
}

let latencyMs = 250;
let scenarioOverride: MockScenario | null = null;

/** For tests: change the simulated delay and the scenario. */
export function configureMock(options: { latencyMs?: number; scenario?: MockScenario | null }): void {
  if (options.latencyMs !== undefined) latencyMs = options.latencyMs;
  if (options.scenario !== undefined) scenarioOverride = options.scenario;
}

function scenario(): MockScenario {
  return scenarioOverride ?? readScenario();
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    if (ms <= 0) return resolve();
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(abortError());
      },
      { once: true },
    );
  });
}

async function respond<T>(signal: AbortSignal | undefined, normal: () => T, empty: () => T): Promise<T> {
  const s = scenario();
  await delay(s.mode === 'slow' ? 2500 : latencyMs, signal);
  if (s.mode === 'error') throw new ApiError('http', 'Example error from mock mode (address has ?mock=error).', 500);
  // Deep copy so callers can never change the example data in place.
  return structuredClone(s.mode === 'empty' ? empty() : normal());
}

const PRESETS = sitesJson.sites as Site[];

export function health(signal?: AbortSignal): Promise<HealthResponse> {
  return respond(
    signal,
    () => ({ ...(healthJson as HealthResponse), assistant_available: scenario().assistant === 'on' }),
    () => ({ ...(healthJson as HealthResponse), assistant_available: scenario().assistant === 'on' }),
  );
}

export function listSites(signal?: AbortSignal): Promise<SiteListResponse> {
  return respond(signal, () => ({ sites: PRESETS }), () => ({ sites: [] }));
}

export function catalog(signal?: AbortSignal): Promise<CatalogResponse> {
  return respond(signal, () => ({ items: MOCK_CATALOG, status_labels: MOCK_STATUS_LABELS }), () => ({ items: [], status_labels: MOCK_STATUS_LABELS }));
}

/** Typed storage from a request; a missing, negative or non-number value counts as none. */
function storageOf(req: { storage_kwh?: number }): number {
  const kwh = req.storage_kwh;
  return typeof kwh === 'number' && Number.isFinite(kwh) && kwh > 0 ? kwh : 0;
}

/** As the backend: launch + transit + slip, with a transit left out counted as 0. */
export function landingMsFor(launchUtc: string, slipDays: number, transitDays: number | null | undefined): number {
  return Date.parse(launchUtc) + ((transitDays ?? 0) + slipDays) * DAY_MS;
}

const NO_TRANSIT_WARNING = 'transit_days was not sent: the transit is counted as 0 days, so the stay starts at launch_utc + slip_days.';

export function evaluate(req: EvaluateRequest, signal?: AbortSignal): Promise<EvaluateResponse> {
  const transit = typeof req.transit_days === 'number' && Number.isFinite(req.transit_days) ? req.transit_days : null;
  const landingMs = landingMsFor(req.launch_utc, req.slip_days, transit);
  const base = {
    launch_utc: req.launch_utc,
    landing_utc: toIsoUtc(landingMs),
    transit_days: transit,
    slip_days: req.slip_days,
    stay_days: req.stay_days,
    time_step_s: Math.round((req.stay_days * DAY_MS) / Math.min(1500, Math.max(200, Math.round(req.stay_days * 24))) / 1000),
    geometry: geometryAt(landingMs),
    provenance: MOCK_PROVENANCE,
    warnings: transit === null ? [NO_TRANSIT_WARNING] : [],
  };
  return respond(
    signal,
    () => ({ ...base, results: rankResults(req.sites.map((site) => evaluateSite(site, landingMs, req.stay_days, req.hardware, storageOf(req)).evaluation)) }),
    () => ({ ...base, results: [] }),
  );
}

export function horizon(req: HorizonRequest, signal?: AbortSignal): Promise<HorizonResponse> {
  return respond(
    signal,
    () => horizonFor(req.site, Date.parse(req.start_utc), Date.parse(req.end_utc), req.step_hours),
    () => ({ site_id: req.site.id, skyline: [], sun_path: [], earth_box: null, skyline_source: 'stored_profile', time_step_s: 0, provenance: MOCK_PROVENANCE, warnings: [] }),
  );
}

export function check(req: CheckRequest, signal?: AbortSignal): Promise<CheckResponse> {
  const landingMs = Date.parse(req.landing_utc);
  return respond(
    signal,
    () => (req.site ? evaluateSite(req.site, landingMs, req.stay_days, req.hardware, storageOf(req)).check : genericCheck(req.stay_days, req.hardware, storageOf(req))),
    () => genericCheck(req.stay_days, []),
  );
}

export async function ask(req: AskRequest, signal?: AbortSignal): Promise<AskResponse> {
  if (scenario().assistant === 'off') {
    await delay(latencyMs, signal);
    throw new ApiError('unavailable', 'The assistant is switched off (address has ?assistant=off).', 503);
  }
  return respond(
    signal,
    () => {
      const q = req.question.toLowerCase();
      const hit = assistantJson.answers.find((a) => a.keywords.some((k) => q.includes(k)));
      return { answer: hit ? hit.answer : assistantJson.fallback, example: true };
    },
    () => ({ answer: '', example: true }),
  );
}
