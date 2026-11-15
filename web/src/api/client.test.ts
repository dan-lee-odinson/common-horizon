import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { api, apiBase, isEmpty, isMockMode } from './client';
import { ApiError } from './errors';
import { configureMock } from './mock';
import type { EvaluateRequest, SiteRef } from './types';
import sitesJson from './examples/sites.json';

const SITES = sitesJson.sites as SiteRef[];
const LAUNCH = '2027-02-10T15:00:00Z';

function request(slip: number, overrides: Partial<EvaluateRequest> = {}): EvaluateRequest {
  return { sites: SITES, launch_utc: LAUNCH, slip_days: slip, stay_days: 14, hardware: [{ id: 'starship', count: 1 }], storage_kwh: 0, ...overrides };
}

beforeAll(() => configureMock({ latencyMs: 0 }));
afterEach(() => {
  configureMock({ scenario: null });
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('mock mode (VITE_API_BASE unset)', () => {
  it('is on when no backend address is set', () => {
    expect(apiBase()).toBe('');
    expect(isMockMode()).toBe(true);
  });

  it('never calls fetch', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await api.health();
    await api.listSites();
    await api.evaluate(request(0));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('lists the 17 preset sites with east longitudes', async () => {
    const r = await api.listSites();
    expect(r.sites).toHaveLength(17);
    for (const s of r.sites) {
      expect(s.lon_east).toBeGreaterThanOrEqual(0);
      expect(s.lon_east).toBeLessThan(360);
    }
    const nobile = r.sites.find((s) => s.id === 'nobile')!;
    expect(nobile.note).toBe("VIPER study area, Mons Mouton; Griffin's landing point is not published");
    expect(nobile.default_hardware).toEqual(['griffin']);
    expect(r.sites.filter((s) => s.default_hardware?.includes('griffin'))).toHaveLength(1);
  });

  it('returns the six hardware rows in the catalog', async () => {
    const r = await api.catalog();
    expect(r.items.map((i) => i.name)).toEqual(['Starship lander', 'Hab unit', 'Rover 1', 'Nuclear generator', 'Solar panels', 'Griffin lander']);
    expect(r.items.filter((i) => i.countable).map((i) => i.id)).toEqual(['rover', 'solar']);
  });

  it('evaluates every site with every field the list shows', async () => {
    const r = await api.evaluate(request(0));
    expect(r.results).toHaveLength(17);
    expect(Date.parse(r.landing_utc)).toBeGreaterThan(Date.parse(LAUNCH));
    for (const e of r.results) {
      expect(e.score).toBeGreaterThanOrEqual(0);
      expect(e.score).toBeLessThanOrEqual(100);
      expect(e.sunlight_percent).toBeGreaterThanOrEqual(0);
      expect(e.sunlight_percent).toBeLessThanOrEqual(100);
      expect(e.sunlight_hours).toBeLessThanOrEqual(14 * 24);
      expect(['clear', 'intermittent', 'none']).toContain(e.earth_link);
      expect(typeof e.hardware_fits).toBe('boolean');
      expect(Number.isFinite(e.energy_added_kwh)).toBe(true);
      expect(['pass', 'fail']).toContain(e.verdict.result);
      if (e.verdict.result === 'fail') expect(e.verdict.requirement).toBeTruthy();
      else expect(e.verdict.requirement).toBeNull();
    }
    const scores = r.results.map((e) => e.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it('changes with the slip so the ranking reorders', async () => {
    const order = async (slip: number) => (await api.evaluate(request(slip))).results.map((e) => e.site_id);
    const base = await order(0);
    const changed: number[] = [];
    for (const slip of [3, 7, 10, 14, 21]) if ((await order(slip)).join() !== base.join()) changed.push(slip);
    expect(changed.length).toBeGreaterThanOrEqual(4);
  });

  it('gives the same answer for the same question', async () => {
    expect(await api.evaluate(request(7))).toEqual(await api.evaluate(request(7)));
  });

  it('returns a horizon with skyline, Sun path states and Earth box', async () => {
    const site = SITES[0];
    const h = await api.horizon({ site, start_utc: '2027-02-15T15:00:00Z', end_utc: '2027-03-01T15:00:00Z', step_hours: 2 });
    expect(h.skyline).toHaveLength(360);
    expect(h.sun_path.length).toBeGreaterThan(100);
    expect(new Set(h.sun_path.map((p) => p.state)).size).toBeGreaterThan(0);
    for (const p of h.sun_path) expect(['above', 'hidden']).toContain(p.state);
    expect(h.earth_box).not.toBeNull();
  });

  it('runs a day and night power check', async () => {
    const c = await api.check({
      site: null,
      landing_utc: '2027-02-15T15:00:00Z',
      stay_days: 14,
      hardware: [
        { id: 'starship', count: 1 },
        { id: 'hab', count: 1 },
        { id: 'nuclear', count: 1 },
      ],
      storage_kwh: 0,
    });
    expect(c.day.needed && c.night.needed).toBe(true);
    expect(c.night.generation_kw).toBe(40);
    // No site: no darkness length, so the night check compares power only (as in the planner module).
    expect(c.night.basis).toBe('power only');
    expect(c.night.storage_needed_kwh).toBeNull();
    expect(c.balance.margin_percent).toBe(Math.min(c.day.margin_percent!, c.night.margin_percent!));
    expect(c.fits).toBe(true);
  });

  it('says cargo needs a lander', async () => {
    const c = await api.check({ site: null, landing_utc: '2027-02-15T15:00:00Z', stay_days: 14, hardware: [{ id: 'hab', count: 1 }], storage_kwh: 0 });
    expect(c.fits).toBe(false);
    expect(c.fit_notes.join(' ')).toMatch(/lander/);
  });

  it('answers the assistant with a text example', async () => {
    const r = await api.ask({ question: 'Why does the slip matter?', context: { site_id: null, launch_utc: LAUNCH, slip_days: 7, stay_days: 14, hardware: [], storage_kwh: 0 } });
    expect(r.example).toBe(true);
    expect(r.answer).toMatch(/slip/i);
  });

  it('can show the empty state', async () => {
    configureMock({ scenario: { mode: 'empty', assistant: 'on' } });
    expect(isEmpty.sites(await api.listSites())).toBe(true);
    expect(isEmpty.evaluate(await api.evaluate(request(0)))).toBe(true);
    expect(isEmpty.catalog(await api.catalog())).toBe(true);
  });

  it('can show the error state', async () => {
    configureMock({ scenario: { mode: 'error', assistant: 'on' } });
    await expect(api.listSites()).rejects.toBeInstanceOf(ApiError);
  });

  it('can show the assistant as unavailable', async () => {
    configureMock({ scenario: { mode: 'normal', assistant: 'off' } });
    expect((await api.health()).assistant_available).toBe(false);
    await expect(api.ask({ question: 'hi', context: { site_id: null, launch_utc: LAUNCH, slip_days: 0, stay_days: 1, hardware: [], storage_kwh: 0 } })).rejects.toMatchObject({ kind: 'unavailable' });
  });

  it('stops when the caller cancels', async () => {
    configureMock({ latencyMs: 50 });
    const c = new AbortController();
    const p = api.listSites(c.signal);
    c.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    configureMock({ latencyMs: 0 });
  });
});

describe('live mode (VITE_API_BASE set)', () => {
  it('sends requests to the backend address', async () => {
    vi.stubEnv('VITE_API_BASE', 'http://backend.test/api/');
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ sites: [] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    expect(isMockMode()).toBe(false);
    const r = await api.listSites();
    expect(r.sites).toEqual([]);
    expect(fetchSpy).toHaveBeenCalledWith('http://backend.test/api/sites', expect.objectContaining({ method: 'GET' }));
  });

  it('posts JSON for evaluate', async () => {
    vi.stubEnv('VITE_API_BASE', 'http://backend.test');
    const fetchSpy = vi.fn(async (_url: string, _init?: RequestInit) => new Response('{"results":[]}', { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    await api.evaluate(request(5));
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('http://backend.test/evaluate');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body)).slip_days).toBe(5);
  });

  it('maps HTTP 503 from the assistant to "unavailable" and other failures to errors', async () => {
    vi.stubEnv('VITE_API_BASE', 'http://backend.test');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })));
    await expect(api.ask({ question: 'x', context: { site_id: null, launch_utc: LAUNCH, slip_days: 0, stay_days: 1, hardware: [], storage_kwh: 0 } })).rejects.toMatchObject({ kind: 'unavailable' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })));
    await expect(api.evaluate(request(0))).rejects.toMatchObject({ kind: 'http', status: 503 });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 500 })));
    await expect(api.health()).rejects.toMatchObject({ kind: 'http', status: 500 });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not json', { status: 200 })));
    await expect(api.health()).rejects.toMatchObject({ kind: 'parse' });
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    await expect(api.health()).rejects.toMatchObject({ kind: 'network' });
  });
});
