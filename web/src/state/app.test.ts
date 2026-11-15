// The mission carries one lander at most: the backend refuses a request with two (HTTP 422). The
// reactor's two rows are one choice.

import { beforeEach, describe, expect, it } from 'vitest';
import catalogJson from '../api/examples/catalog.json';
import type { CatalogItem } from '../api/types';
import { check, configureMock } from '../api/mock';
import { PAYLOAD_HEADING_NOTE } from '../util/catalog';
import { actions, appStore, hardwareChoices, hardwareLink } from './app';

const CATALOG = catalogJson.items as unknown as CatalogItem[];
const landers = (ids: string[]) => ids.filter((id) => CATALOG.find((i) => i.id === id)?.kind === 'lander');

describe('one lander at most', () => {
  let first = true;
  let opening: string[] = [];
  beforeEach(() => {
    appStore.set({ hardware: {}, highlightedId: null });
    actions.initHardware(CATALOG);
    // The example mission is ticked on the first catalog only: note it, then start each test from a chosen Starship HLS.
    if (first) opening = hardwareChoices(appStore.get().hardware).map((h) => h.id);
    first = false;
    actions.toggleHardware('starship_hls', true);
  });

  it('opens with the example mission on the planner’s ids, with one lander', () => {
    const ids = opening;
    expect(ids).toEqual(['hab_crewed', 'starship_hls', 'surface_habitat', 'vsat']);
    expect(landers(ids)).toEqual(['starship_hls']);
  });

  it('unticks the other lander when one is ticked', () => {
    actions.toggleHardware('griffin', true);
    expect(landers(hardwareChoices(appStore.get().hardware).map((h) => h.id))).toEqual(['griffin']);
    actions.toggleHardware('blue_moon_mk1', true);
    expect(landers(hardwareChoices(appStore.get().hardware).map((h) => h.id))).toEqual(['blue_moon_mk1']);
  });

  it('does not add a site’s default lander to a mission that already has a lander', () => {
    actions.highlight('nobile', { default_hardware: ['griffin'] });
    expect(landers(hardwareChoices(appStore.get().hardware).map((h) => h.id))).toEqual(['starship_hls']);
    // With no lander chosen, the site's default lander comes in.
    actions.toggleHardware('starship_hls', false);
    actions.highlight('nobile', { default_hardware: ['griffin'] });
    expect(landers(hardwareChoices(appStore.get().hardware).map((h) => h.id))).toEqual(['griffin']);
  });
});

// The reactor is two catalog rows, its mass under Payload and its 40 kW under Power sources: the
// website keeps them as one choice, and still sends both rows to the backend.
describe('the reactor is one choice in the planner', () => {
  const PAYLOAD = 'fsp_40kwe';
  const POWER = 'fission_40kwe';
  const pick = (id: string) => appStore.get().hardware[id];
  const chosen = () => hardwareChoices(appStore.get().hardware);
  const site = { id: 'shackleton-ridge', name: 'Shackleton Connecting Ridge', lat: -89.45, lon_east: 222.69 };
  const margin = async () => {
    const res = await check({ site, landing_utc: '2027-02-15T15:00:00Z', stay_days: 14, hardware: chosen(), storage_kwh: 2000 });
    return res.balance.margin_percent;
  };

  beforeEach(() => {
    configureMock({ latencyMs: 0, scenario: { mode: 'normal', assistant: 'on' } });
    appStore.set({ hardware: {}, highlightedId: null });
    actions.initHardware(CATALOG);
    // The example mission: Starship HLS, the habitat and its crew's load, four solar masts.
    for (const id of ['starship_hls', 'surface_habitat', 'hab_crewed', 'vsat']) actions.toggleHardware(id, true);
    actions.setHardwareCount('vsat', 4, 10);
    actions.toggleHardware(PAYLOAD, false);
  });

  it('each row says it is linked, and the Payload heading says what its rows count for', () => {
    expect(hardwareLink(PAYLOAD)).toEqual({ partner: POWER, note: 'Linked: its mass counts under Payload and its 40 kW under Power sources.' });
    expect(hardwareLink(POWER)?.partner).toBe(PAYLOAD);
    expect(hardwareLink('vsat')).toBeNull();
    expect(PAYLOAD_HEADING_NOTE).toBe('Mass for the fit check only. Power is set under Power sources and Loads.');
  });

  it('ticking the payload row ticks the power row too, both are sent, and the power margin rises', async () => {
    expect(pick(PAYLOAD).selected).toBe(false);
    expect(pick(POWER).selected).toBe(false);
    // The example mission's solar masts and habitat load, without the reactor.
    const without = await margin();
    expect(without).not.toBeNull();
    actions.toggleHardware(PAYLOAD, true);
    expect(pick(POWER)).toMatchObject({ selected: true, count: pick(PAYLOAD).count });
    expect(chosen().map((h) => h.id)).toEqual(expect.arrayContaining([PAYLOAD, POWER]));
    const withReactor = await margin();
    expect(withReactor).not.toBeNull();
    expect(withReactor!).toBeGreaterThan(without!);
  });

  it('keeps the counts equal, whichever row is counted', () => {
    actions.toggleHardware(POWER, true);
    actions.setHardwareCount(PAYLOAD, 3, 10);
    expect([pick(PAYLOAD).count, pick(POWER).count]).toEqual([3, 3]);
    actions.setHardwareCount(POWER, 2, 10);
    expect([pick(PAYLOAD).count, pick(POWER).count]).toEqual([2, 2]);
    expect(chosen().filter((h) => h.id === PAYLOAD || h.id === POWER)).toEqual([
      { id: POWER, count: 2 },
      { id: PAYLOAD, count: 2 },
    ]);
  });

  it('unticking either row clears both', () => {
    actions.toggleHardware(PAYLOAD, true);
    actions.toggleHardware(POWER, false);
    expect([pick(PAYLOAD).selected, pick(POWER).selected]).toEqual([false, false]);
    actions.toggleHardware(POWER, true);
    actions.toggleHardware(PAYLOAD, false);
    expect([pick(PAYLOAD).selected, pick(POWER).selected]).toEqual([false, false]);
  });

  it('a mission loaded with one of the two rows set keeps working, and is linked on the next change', () => {
    const hw = appStore.get().hardware;
    appStore.set({ hardware: { ...hw, [PAYLOAD]: { selected: true, count: 2, userSet: true } } });
    expect(chosen().filter((h) => h.id === PAYLOAD || h.id === POWER)).toEqual([{ id: PAYLOAD, count: 2 }]);
    // Any change on the planner, here another row's count.
    actions.toggleHardware('vsat', true);
    actions.setHardwareCount('vsat', 5, 10);
    expect(pick(POWER)).toMatchObject({ selected: true, count: 2 });
  });
});
