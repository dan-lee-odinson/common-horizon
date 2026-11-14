// The ONLY file in the website that talks to the network.
//
// Where answers come from:
//   * VITE_API_BASE set (for example in web/.env.local: VITE_API_BASE=http://localhost:8000)
//       -> every call goes to that backend over HTTP (JSON in, JSON out).
//   * VITE_API_BASE unset or empty
//       -> MOCK MODE: answers come from web/src/api/examples/*.json and the small mock model
//          in web/src/api/mock/. Nothing leaves the browser.
//
// Endpoints (provisional, to be matched to the backend's OpenAPI file):
//   GET  /health      GET /sites      GET /catalog
//   POST /evaluate    POST /horizon   POST /check    POST /assistant

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
  SiteListResponse,
} from './types';
import { ApiError, isAbortError } from './errors';

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
  if (!res.ok) {
    throw new ApiError('http', `The backend answered with an error (HTTP ${res.status}).`, res.status);
  }
  try {
    return (await res.json()) as T;
  } catch {
    throw new ApiError('parse', 'The backend sent an answer the website could not read.');
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

  evaluate(req: EvaluateRequest, signal?: AbortSignal): Promise<EvaluateResponse> {
    return isMockMode() ? mock().then((m) => m.evaluate(req, signal)) : http('POST', '/evaluate', req, signal);
  },

  horizon(req: HorizonRequest, signal?: AbortSignal): Promise<HorizonResponse> {
    return isMockMode() ? mock().then((m) => m.horizon(req, signal)) : http('POST', '/horizon', req, signal);
  },

  check(req: CheckRequest, signal?: AbortSignal): Promise<CheckResponse> {
    return isMockMode() ? mock().then((m) => m.check(req, signal)) : http('POST', '/check', req, signal);
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
