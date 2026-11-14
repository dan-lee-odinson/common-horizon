// Keeps the sample answer files in src/api/examples/ in step with the mock model.
// The backend team can read these files to see the exact shape the website expects.
// After changing the mock model on purpose, refresh them with: npx vitest run -u

import { beforeAll, expect, it } from 'vitest';
import { api } from './client';
import { configureMock } from './mock';
import sitesJson from './examples/sites.json';
import type { SiteRef } from './types';

const SITES = (sitesJson.sites as SiteRef[]).slice(0, 3);

beforeAll(() => configureMock({ latencyMs: 0 }));

const json = (x: unknown) => JSON.stringify(x, null, 2) + '\n';

it('evaluate sample', async () => {
  const r = await api.evaluate({ sites: SITES, launch_utc: '2027-02-10T15:00:00Z', slip_days: 7, stay_days: 14, hardware: [{ id: 'starship', count: 1 }, { id: 'solar', count: 2 }], storage_kwh: 500 });
  await expect(json(r)).toMatchFileSnapshot('./examples/evaluate.sample.json');
});

it('horizon sample', async () => {
  const r = await api.horizon({ site: SITES[0], start_utc: '2027-02-15T15:00:00Z', end_utc: '2027-02-17T15:00:00Z', step_hours: 6 });
  await expect(json({ ...r, skyline: r.skyline.filter((p) => p.az % 10 === 0) })).toMatchFileSnapshot('./examples/horizon.sample.json');
});

it('check sample', async () => {
  const r = await api.check({ site: SITES[1], landing_utc: '2027-02-22T15:00:00Z', stay_days: 14, hardware: [{ id: 'griffin', count: 1 }, { id: 'starship', count: 1 }], storage_kwh: 0 });
  await expect(json(r)).toMatchFileSnapshot('./examples/check.sample.json');
});
