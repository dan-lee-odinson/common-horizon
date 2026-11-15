// The mission carries one lander at most: the backend refuses a request with two (HTTP 422).

import { beforeEach, describe, expect, it } from 'vitest';
import catalogJson from '../api/examples/catalog.json';
import type { CatalogItem } from '../api/types';
import { actions, appStore, hardwareChoices } from './app';

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
