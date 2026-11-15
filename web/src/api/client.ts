// The ONLY file in the website that talks to the network.
//
// Where answers come from:
//   * VITE_API_BASE set (for example in web/.env.local: VITE_API_BASE=http://localhost:8000)
//       -> every call goes to that backend over HTTP (JSON in, JSON out).
//   * VITE_API_BASE unset or empty
//       -> MOCK MODE: answers come from web/src/api/examples/*.json and the small mock model
//          in web/src/api/mock/. Nothing leaves the browser.
//
// Endpoints (backend/docs/WEBSITE_API.md; shapes in ./types.ts, the same for both modes):
//   GET  /health      GET /sites      GET /catalog
//   POST /evaluate    POST /horizon   POST /check    POST /assistant
//   GET  /api/v1/horizons/compare     (live mode only: the physics engine against NASA JPL Horizons)
// And two static files served with the website itself, in both modes: data/horizons-check.json and
// data/moon-trek-sun-check.json (either may be missing: its line is then not shown).
//
// Every POST /evaluate carries transit_days (util/transit.ts). Errors: a 422 shows the backend's
// own message, a 503 says the physics engine is unavailable (the assistant's 503 says it is).

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
  HorizonsCheckFile,
  HorizonsCompareResponse,
  MoonTrekCheckFile,
  SiteListResponse,
} from './types';
import { ApiError, isAbortError } from './errors';
import { TRANSIT_DAYS } from '../util/transit';

export { ApiError } from './errors';

/** Backend address without a trailing slash, or "" for mock mode. */
export function apiBase(): string {
  const raw = (import.meta.env.VITE_API_BASE as string | undefined) ?? '';
  return raw.trim().replace(/\/+$/, '');
}

export function isMockMode(): boolean {
  return apiBase() === '';
}

// The mock code is loaded only when needed, so a live build does not carry it in its first chunk.
type MockModule = typeof import('./mock');
let mockModule: Promise<MockModule> | null = null;
function mock(): Promise<MockModule> {
  mockModule ??= import('./mock');
  return mockModule;
}

async function http<T>(method: 'GET' | 'POST', path: string, body: unknown, signal?: AbortSignal, unavailableOn503 = false): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${apiBase()}${path}`, {
      method,
      headers: body === undefined ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (isAbortError(err)) throw err;
    throw new ApiError('network', 'Could not reach the backend. Check that it is running and that VITE_API_BASE is right.');
  }
  if (res.status === 503 && unavailableOn503) {
    throw new ApiError('unavailable', 'The backend says this service is unavailable right now.', 503);
  }
  if (res.status === 503) {
    throw new ApiError('http', 'The physics engine is unavailable right now (HTTP 503). Try again later.', 503);
  }
  if (res.status === 422) {
    const said = await backendMessage(res);
    throw new ApiError('http', said ?? 'The backend refused the request (HTTP 422).', 422);
  }
  if (res.status === 502) {
    // The Horizons route says why it could not reach JPL Horizons (see HORIZONS-CHECK.md).
    const body = (await res.json().catch(() => null)) as { error?: string; reason?: string } | null;
    if (body?.error === 'horizons_unavailable') {
      throw new ApiError('http', `The backend could not reach NASA JPL Horizons${body.reason ? `: ${body.reason}` : ''} (HTTP 502).`, 502);
    }
  }
  if (!res.ok) {
    throw new ApiError('http', `The backend answered with an error (HTTP ${res.status}).`, res.status);
  }
  try {
    return (await res.json()) as T;
  } catch {
    throw new ApiError('parse', 'The backend sent an answer the website could not read.');
  }
}

/**
 * The backend's own words from an error answer: FastAPI's `detail`, either one sentence or a list of
 * field errors ({loc, msg}), which are joined as "field: message". null when there are none to read.
 */
export async function backendMessage(res: Response): Promise<string | null> {
  try {
    const body = (await res.json()) as { detail?: unknown };
    const detail = body?.detail;
    if (typeof detail === 'string' && detail.trim() !== '') return detail.trim();
    if (Array.isArray(detail)) {
      const lines = detail
        .map((d) => {
          const e = d as { loc?: unknown; msg?: unknown };
          if (typeof e?.msg !== 'string') return null;
          const loc = Array.isArray(e.loc) ? e.loc.filter((x) => x !== 'body').join('.') : '';
          return loc ? `${loc}: ${e.msg}` : e.msg;
        })
        .filter((x): x is string => x !== null);
      if (lines.length > 0) return lines.join('; ');
    }
  } catch {
    // Not JSON: no words of the backend's to show.
  }
  return null;
}

/** A stored check file served with the website: its `sites` table, or null when it is missing or unreadable. */
async function siteCheckFile<T extends { sites: object }>(path: string, signal?: AbortSignal): Promise<T | null> {
  try {
    const res = await fetch(path, { headers: { Accept: 'application/json' }, signal });
    if (!res.ok) return null;
    const body = (await res.json()) as T;
    return body && typeof body === 'object' && body.sites && typeof body.sites === 'object' ? body : null;
  } catch (err) {
    if (isAbortError(err)) throw err;
    return null;
  }
}

export const api = {
  health(signal?: AbortSignal): Promise<HealthResponse> {
    return isMockMode() ? mock().then((m) => m.health(signal)) : http('GET', '/health', undefined, signal);
  },

  listSites(signal?: AbortSignal): Promise<SiteListResponse> {
    return isMockMode() ? mock().then((m) => m.listSites(signal)) : http('GET', '/sites', undefined, signal);
  },

  catalog(signal?: AbortSignal): Promise<CatalogResponse> {
    return isMockMode() ? mock().then((m) => m.catalog(signal)) : http('GET', '/catalog', undefined, signal);
  },

  /** Every evaluation carries the website's transit time (our estimate): the landing comes back in the answer. */
  evaluate(req: EvaluateRequest, signal?: AbortSignal): Promise<EvaluateResponse> {
    const body: EvaluateRequest = { ...req, transit_days: TRANSIT_DAYS };
    return isMockMode() ? mock().then((m) => m.evaluate(body, signal)) : http('POST', '/evaluate', body, signal);
  },

  horizon(req: HorizonRequest, signal?: AbortSignal): Promise<HorizonResponse> {
    return isMockMode() ? mock().then((m) => m.horizon(req, signal)) : http('POST', '/horizon', req, signal);
  },

  check(req: CheckRequest, signal?: AbortSignal): Promise<CheckResponse> {
    return isMockMode() ? mock().then((m) => m.check(req, signal)) : http('POST', '/check', req, signal);
  },

  /**
   * Live mode only: the engine's and NASA JPL Horizons' directions to the Sun and the Earth for one
   * place and minute. Rejects in example mode (there is no engine to compare), and when Horizons does
   * not answer (HTTP 502): the caller then falls back to the stored check.
   */
  horizonsCompare(q: { latitude_deg: number; longitude_deg: number; time_utc: string; site_height_m?: number }, signal?: AbortSignal): Promise<HorizonsCompareResponse> {
    if (isMockMode()) return Promise.reject(new ApiError('unavailable', 'There is no physics engine to compare in example mode.'));
    const params = new URLSearchParams({ latitude_deg: String(q.latitude_deg), longitude_deg: String(q.longitude_deg), time_utc: q.time_utc });
    if (q.site_height_m !== undefined && Number.isFinite(q.site_height_m)) params.set('site_height_m', String(q.site_height_m));
    return http('GET', `/api/v1/horizons/compare?${params}`, undefined, signal);
  },

  /**
   * The stored check against NASA JPL Horizons: a static file served with the website (in both
   * modes), read at run time. Resolves to null when the file is not there or cannot be read.
   */
  horizonsCheck(signal?: AbortSignal): Promise<HorizonsCheckFile | null> {
    return siteCheckFile<HorizonsCheckFile>('data/horizons-check.json', signal);
  },

  /** The stored Sun check against NASA Moon Trek, the same way: null when the file is not there. */
  moonTrekCheck(signal?: AbortSignal): Promise<MoonTrekCheckFile | null> {
    return siteCheckFile<MoonTrekCheckFile>('data/moon-trek-sun-check.json', signal);
  },

  /** The assistant answers in text only. It never changes the interface. */
  ask(req: AskRequest, signal?: AbortSignal): Promise<AskResponse> {
    return isMockMode() ? mock().then((m) => m.ask(req, signal)) : http('POST', '/assistant', req, signal, true);
  },
};

export type Api = typeof api;

/** When an answer counts as "empty" (the call worked but there is nothing to show). */
export const isEmpty = {
  sites: (r: SiteListResponse) => !r.sites || r.sites.length === 0,
  catalog: (r: CatalogResponse) => !r.items || r.items.length === 0,
  evaluate: (r: EvaluateResponse) => !r.results || r.results.length === 0,
  horizon: (r: HorizonResponse) => !r.skyline || r.skyline.length === 0,
  ask: (r: AskResponse) => !r.answer || r.answer.trim() === '',
};
