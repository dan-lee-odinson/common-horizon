// The model descriptions the app reads, checked against the files that are served.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import catalogJson from '../api/examples/catalog.json';
import { MODEL_FOR, modelFor, modelUrl, parseModelMeta, primaryLanderId } from './models';

function file(modelId: string): unknown {
  return JSON.parse(readFileSync(fileURLToPath(new URL(`../../public/${modelUrl(modelId, 'json')}`, import.meta.url)), 'utf8'));
}

describe('catalog items and their models', () => {
  it('maps the nine planner items that have a model, by the planner ids, and nothing else', () => {
    expect(MODEL_FOR).toEqual({
      starship_hls: 'starship-lander',
      griffin: 'griffin-lander',
      blue_moon_mk1: 'blue-moon-mk1',
      surface_habitat: 'habitat-unit',
      fsp_40kwe: 'fission-power-unit',
      vsat: 'solar-array-mast',
      astrolab_clv1: 'crew-rover',
      jaxa_pressurized_rover: 'pressurized-rover',
      science_rover_recharge: 'viper-rover',
    });
    // The power rows of a landed object have no model of their own (its payload row has it), and
    // neither has an id the catalog may add later, nor the old example ids.
    expect(modelFor('fission_40kwe')).toBeNull();
    expect(modelFor('hab_crewed')).toBeNull();
    expect(modelFor('vsat_xl')).toBeNull();
    expect(modelFor('starship')).toBeNull();
    expect(modelFor('toString')).toBeNull();
    expect(modelFor('starship_hls')).toBe('starship-lander');
  });

  it('the Starship HLS lander takes the landing point before the Griffin lander, and Griffin before Blue Moon Mark 1', () => {
    expect(primaryLanderId(['surface_habitat', 'astrolab_clv1', 'vsat', 'starship_hls'])).toBe('starship_hls');
    expect(primaryLanderId(['griffin', 'starship_hls'])).toBe('starship_hls');
    expect(primaryLanderId(['griffin', 'vsat'])).toBe('griffin');
    expect(primaryLanderId(['blue_moon_mk1', 'griffin'])).toBe('griffin');
    expect(primaryLanderId(['blue_moon_mk1', 'vsat'])).toBe('blue_moon_mk1');
    // A rover is not a lander.
    expect(primaryLanderId(['science_rover_recharge', 'astrolab_clv1'])).toBeNull();
    expect(primaryLanderId(['surface_habitat', 'vsat'])).toBeNull();
    expect(primaryLanderId([])).toBeNull();
  });

  it('every mapped id is in the example catalog', () => {
    const ids = new Set(catalogJson.items.map((i) => i.id));
    for (const id of Object.keys(MODEL_FOR)) expect(ids.has(id)).toBe(true);
  });
});

describe('reading a model description', () => {
  it.each(Object.entries(MODEL_FOR))('%s: the served file gives a name, status words and a size in metres', (_catalogId, modelId) => {
    const meta = parseModelMeta(file(modelId), modelId);
    expect(meta).not.toBeNull();
    expect(meta!.id).toBe(modelId);
    expect(meta!.name.length).toBeGreaterThan(3);
    expect(meta!.status.length).toBeGreaterThan(3);
    for (const v of Object.values(meta!.dimensions)) expect(v).toBeGreaterThan(0);
  });

  it('reads the sizes as written', () => {
    expect(parseModelMeta(file('starship-lander'), 'starship-lander')!.dimensions).toEqual({ width: 9, height: 52, depth: 9 });
    expect(parseModelMeta(file('habitat-unit'), 'habitat-unit')!.dimensions.height).toBe(7.8);
    expect(parseModelMeta(file('griffin-lander'), 'griffin-lander')!.dimensions.height).toBe(2);
    expect(parseModelMeta(file('fission-power-unit'), 'fission-power-unit')!.dimensions.height).toBe(6);
    expect(parseModelMeta(file('solar-array-mast'), 'solar-array-mast')!.dimensions.height).toBe(10);
  });

  it('keeps the name, the status and the size, and nothing else of the file', () => {
    const meta = parseModelMeta(file('starship-lander'), 'starship-lander')!;
    expect(Object.keys(meta).sort()).toEqual(['dimensions', 'id', 'name', 'status']);
    expect(Object.keys(meta.dimensions).sort()).toEqual(['depth', 'height', 'width']);
    expect('note' in meta).toBe(false);
  });

  it('refuses a description it cannot trust for true scale', () => {
    const good = file('starship-lander') as Record<string, unknown>;
    expect(parseModelMeta(good, 'habitat-unit')).toBeNull();
    expect(parseModelMeta({ ...good, units: 'feet' }, 'starship-lander')).toBeNull();
    expect(parseModelMeta({ ...good, units: undefined }, 'starship-lander')).toBeNull();
    expect(parseModelMeta({ ...good, dimensions_m: undefined }, 'starship-lander')).toBeNull();
    expect(parseModelMeta({ ...good, dimensions_m: { width_x: 9, depth_z: 9 } }, 'starship-lander')).toBeNull();
    expect(parseModelMeta({ ...good, dimensions_m: { width_x: 9, height_y: 0, depth_z: 9 } }, 'starship-lander')).toBeNull();
    expect(parseModelMeta({ ...good, dimensions_m: { width_x: 9, height_y: '52', depth_z: 9 } }, 'starship-lander')).toBeNull();
    expect(parseModelMeta({ ...good, dimensions_m: { width_x: 9, height_y: Number.NaN, depth_z: 9 } }, 'starship-lander')).toBeNull();
    expect(parseModelMeta(null, 'starship-lander')).toBeNull();
    expect(parseModelMeta('starship-lander', 'starship-lander')).toBeNull();
  });
});
