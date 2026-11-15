import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MODEL_FOR, modelUrl, parseModelMeta, type ModelMeta } from '../state/models';
import { footprintGap, hiddenByHardware, shapeMatches, siteLayout } from './siteLayout';

// The layout is checked with the sizes of the models that are really served.
function served(modelId: string): ModelMeta {
  const raw = JSON.parse(readFileSync(fileURLToPath(new URL(`../../public/${modelUrl(modelId, 'json')}`, import.meta.url)), 'utf8')) as unknown;
  return parseModelMeta(raw, modelId)!;
}
const METAS: Record<string, ModelMeta | null> = { ...Object.fromEntries(Object.entries(MODEL_FOR).map(([id, modelId]) => [id, served(modelId)])), hab_crewed: null };

const EXAMPLE = [
  { id: 'surface_habitat', count: 1 },
  { id: 'hab_crewed', count: 1 },
  { id: 'vsat', count: 4 },
  { id: 'starship_hls', count: 1 },
];
/** The largest mission the catalog allows, with all three landers and the three rovers. */
const LARGEST = [
  { id: 'griffin', count: 1 },
  { id: 'blue_moon_mk1', count: 1 },
  { id: 'jaxa_pressurized_rover', count: 1 },
  { id: 'science_rover_recharge', count: 1 },
  { id: 'hab_crewed', count: 1 },
  { id: 'surface_habitat', count: 1 },
  { id: 'fsp_40kwe', count: 1 },
  { id: 'astrolab_clv1', count: 4 },
  { id: 'vsat', count: 10 },
  { id: 'starship_hls', count: 1 },
];

describe('where the hardware stands', () => {
  it('puts the lander on the landing point, the habitat to the east and the masts in a row to the north', () => {
    const layout = siteLayout(EXAMPLE, METAS);
    expect(layout.primaryLanderId).toBe('starship_hls');
    expect(layout.heightM).toBe(52);
    // The crewed habitat's power load is the habitat's own draw: no marker of its own.
    expect(layout.noModel).toEqual([]);
    const of = (id: string) => layout.items.filter((i) => i.id === id);
    expect(of('starship_hls')).toHaveLength(1);
    expect(of('starship_hls')[0]).toMatchObject({ x: 0, z: 0, rotY: 0, height: 52, halfX: 4.5, halfZ: 4.5, modelId: 'starship-lander' });
    // 40 m east; turned a quarter, so its footprint's sides swap.
    expect(of('surface_habitat')[0].modelId).toBe('hab-module');
    expect(of('surface_habitat')[0].halfX).toBeCloseTo(4.07 / 2, 9);
    expect(of('surface_habitat')[0].halfZ).toBeCloseTo(7.551 / 2, 9);
    expect(of('surface_habitat')[0].x).toBeCloseTo(40, 9);
    expect(of('surface_habitat')[0].z).toBeCloseTo(0, 9);
    expect(Math.abs(of('surface_habitat')[0].rotY)).toBeCloseTo(Math.PI / 2, 12);
    // Four masts 45 m north (z is south), nine metres apart, centred on the line north.
    const masts = of('vsat');
    expect(masts.map((m) => m.z)).toEqual([-45, -45, -45, -45]);
    expect(masts.map((m) => Math.round(m.x * 1000) / 1000)).toEqual([-13.5, -4.5, 4.5, 13.5]);
    expect(masts.every((m) => m.rotY === 0 && m.height === 10)).toBe(true);
  });

  it('draws each item as many times as the mission has it, and nothing for an item with no model', () => {
    const layout = siteLayout(LARGEST, METAS);
    const count = (id: string) => layout.items.filter((i) => i.id === id).length;
    expect(count('vsat')).toBe(10);
    expect(count('starship_hls')).toBe(1);
    expect(count('griffin')).toBe(1);
    expect(count('surface_habitat')).toBe(1);
    expect(count('fsp_40kwe')).toBe(1);
    expect(count('astrolab_clv1')).toBe(4);
    expect(count('blue_moon_mk1')).toBe(1);
    expect(count('jaxa_pressurized_rover')).toBe(1);
    expect(count('science_rover_recharge')).toBe(1);
    expect(count('hab_crewed')).toBe(0);
    expect(layout.noModel).toEqual([]);
    expect(new Set(layout.items.map((i) => i.key)).size).toBe(layout.items.length);
    // With both landers the Starship lander takes the landing point and the Griffin lander stands off.
    expect(layout.primaryLanderId).toBe('starship_hls');
    const griffin = layout.items.find((i) => i.id === 'griffin')!;
    expect(Math.hypot(griffin.x, griffin.z)).toBeCloseTo(60, 9);
  });

  it('keeps at least five metres of clear ground between any two footprints, for the largest mission', () => {
    const { items } = siteLayout(LARGEST, METAS);
    expect(items).toHaveLength(21);
    let least = Infinity;
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const gap = footprintGap(items[i], items[j]);
        least = Math.min(least, gap);
        expect(gap, `${items[i].key} and ${items[j].key}`).toBeGreaterThanOrEqual(5 - 1e-9);
      }
    }
    // The masts are the closest neighbours: exactly the row's gap.
    expect(least).toBeCloseTo(5, 9);
  });

  it('keeps footprints apart for any counts, whichever items are doubled', () => {
    for (const id of Object.keys(MODEL_FOR)) {
      const choices = LARGEST.map((c) => (c.id === id ? { ...c, count: c.count + 2 } : c));
      const { items } = siteLayout(choices, METAS);
      for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) expect(footprintGap(items[i], items[j]), `${id}: ${items[i].key} and ${items[j].key}`).toBeGreaterThanOrEqual(5 - 1e-9);
    }
  });

  it('has a place for every item that has a model', () => {
    for (const id of Object.keys(MODEL_FOR)) {
      const layout = siteLayout([{ id, count: 1 }], METAS);
      expect(layout.items.map((i) => i.id), id).toEqual([id]);
      expect(layout.noModel).toEqual([]);
    }
  });

  it('is the same every time, and holds everything inside its radius', () => {
    const a = siteLayout(LARGEST, METAS);
    const b = siteLayout([...LARGEST].reverse(), METAS);
    expect(b).toEqual(a);
    for (const item of a.items) expect(Math.hypot(Math.abs(item.x) + item.halfX, Math.abs(item.z) + item.halfZ)).toBeLessThanOrEqual(a.radius - 8 + 1e-9);
  });

  it('with no hardware there is only the landing point', () => {
    const layout = siteLayout([], {});
    expect(layout).toEqual({ items: [], noModel: [], markers: [], primaryLanderId: null, heightM: null, radius: 12 });
  });

  it('gives every item with no model a plain labelled marker, clear of the drawn hardware, inside the radius', () => {
    const choices = [...EXAMPLE, { id: 'keep_alive_heat', count: 1 }, { id: 'comms_relay', count: 2 }, { id: 'blue_moon_mk1', count: 1 }];
    const layout = siteLayout(choices, { ...METAS, keep_alive_heat: null, comms_relay: null, blue_moon_mk1: null });
    expect(layout.markers.map((m) => [m.id, m.count])).toEqual([
      ['blue_moon_mk1', 1],
      ['comms_relay', 2],
      ['keep_alive_heat', 1],
    ]);
    for (const m of layout.markers) {
      expect(Math.hypot(m.x, m.z)).toBeLessThan(layout.radius);
      for (const item of layout.items) {
        const dx = Math.max(0, Math.abs(m.x - item.x) - item.halfX);
        const dz = Math.max(0, Math.abs(m.z - item.z) - item.halfZ);
        expect(Math.hypot(dx, dz), `${m.id} by ${item.key}`).toBeGreaterThan(3);
      }
    }
  });

  it('with no lander the tallest item gives the height, and nothing stands on the landing point', () => {
    const layout = siteLayout([{ id: 'surface_habitat', count: 1 }, { id: 'vsat', count: 2 }], METAS);
    expect(layout.primaryLanderId).toBeNull();
    expect(layout.heightM).toBe(10);
    expect(layout.items.some((i) => i.x === 0 && i.z === 0)).toBe(false);
  });

  it('leaves out an item whose description is still being read, and lists one that has none or an unknown one', () => {
    const loading = siteLayout(EXAMPLE, { ...METAS, starship_hls: undefined });
    expect(loading.items.some((i) => i.id === 'starship_hls')).toBe(false);
    expect(loading.noModel).toEqual([]);
    const failed = siteLayout(EXAMPLE, { ...METAS, starship_hls: null });
    expect(failed.items.some((i) => i.id === 'starship_hls')).toBe(false);
    expect(failed.noModel).toEqual(['starship_hls']);
    const unknown = siteLayout([{ id: 'drill', count: 2 }], {});
    expect(unknown.items).toEqual([]);
    expect(unknown.noModel).toEqual(['drill']);
  });
});

describe('a shape is drawn only if it is the size its description states', () => {
  it('accepts the stated height to one part in a hundred, standing on the ground', () => {
    expect(shapeMatches(0, 52, 52)).toBe(true);
    expect(shapeMatches(0, 52.5, 52)).toBe(true);
    expect(shapeMatches(0.005, 52.005, 52)).toBe(true);
  });

  it('refuses a shape that is too tall, too short, off the ground or not a number', () => {
    expect(shapeMatches(0, 52.6, 52)).toBe(false);
    expect(shapeMatches(0, 51.4, 52)).toBe(false);
    expect(shapeMatches(0, 5.2, 52)).toBe(false);
    expect(shapeMatches(0.02, 52.02, 52)).toBe(false);
    expect(shapeMatches(-1, 51, 52)).toBe(false);
    expect(shapeMatches(0, Number.NaN, 52)).toBe(false);
    expect(shapeMatches(0, 52, 0)).toBe(false);
  });
});

describe('a body of the sky behind the hardware', () => {
  const { items } = siteLayout(EXAMPLE, METAS);
  const unit = (az: number, el: number) => {
    const a = (az * Math.PI) / 180;
    const e = (el * Math.PI) / 180;
    return { x: Math.cos(e) * Math.sin(a), y: Math.sin(e), z: -Math.cos(e) * Math.cos(a) };
  };

  it('is hidden when the lander stands in the line of sight, and not when the line passes beside or over it', () => {
    // From 165 m south of the lander at 30 m up, looking north: the lander is dead ahead.
    const from = { x: 0, y: 30, z: 165 };
    expect(hiddenByHardware(from, unit(0, 0), items)).toBe(true);
    expect(hiddenByHardware(from, unit(0, 5), items)).toBe(true);
    // Twelve degrees to one side, or above the nose (52 m tall, so above about 7.6 degrees from here): clear.
    expect(hiddenByHardware(from, unit(12, 0), items)).toBe(false);
    expect(hiddenByHardware(from, unit(348, 0), items)).toBe(false);
    expect(hiddenByHardware(from, unit(0, 9), items)).toBe(false);
    // Looking away from it: nothing behind the viewpoint counts.
    expect(hiddenByHardware(from, unit(180, 0), items)).toBe(false);
  });

  it('counts every piece, and nothing when there is none', () => {
    // The habitat stands 40 m east: from further east, level with it, it hides what lies due west.
    expect(hiddenByHardware({ x: 80, y: 4, z: 0 }, unit(270, 0), items)).toBe(true);
    expect(hiddenByHardware({ x: 80, y: 4, z: 0 }, unit(270, 0), [])).toBe(false);
  });
});

describe('mission 1', () => {
  // Starship HLS, the Surface Habitat, the 40 kWe fission unit and one solar array mast.
  const MISSION_1 = [
    { id: 'starship_hls', count: 1 },
    { id: 'surface_habitat', count: 1 },
    { id: 'fsp_40kwe', count: 1 },
    { id: 'vsat', count: 1 },
  ];

  it('stands every piece apart by its footprint, the fission unit\u2019s radiator 13.5 m across', () => {
    const layout = siteLayout(MISSION_1, METAS);
    expect(layout.items.map((i) => i.id).sort()).toEqual(['fsp_40kwe', 'starship_hls', 'surface_habitat', 'vsat']);
    const fission = layout.items.find((i) => i.id === 'fsp_40kwe')!;
    expect(fission.modelId).toBe('fission-surface-power');
    expect(2 * fission.halfX).toBeCloseTo(13.47, 2);
    expect(2 * fission.halfZ).toBeCloseTo(13.5, 2);
    for (let i = 0; i < layout.items.length; i++) {
      for (let j = i + 1; j < layout.items.length; j++) {
        const a = layout.items[i];
        const b = layout.items[j];
        expect(footprintGap(a, b), `${a.key} and ${b.key}`).toBeGreaterThanOrEqual(5);
      }
    }
  });

  it('with the habitat chosen, its power loads get no marker; without it they do', () => {
    const withHabitat = siteLayout([...MISSION_1, { id: 'fission_40kwe', count: 1 }, { id: 'hab_crewed', count: 1 }, { id: 'hab_uncrewed', count: 1 }], METAS);
    expect(withHabitat.markers).toEqual([]);
    expect(withHabitat.noModel).toEqual([]);
    const without = siteLayout([{ id: 'starship_hls', count: 1 }, { id: 'hab_crewed', count: 1 }], METAS);
    expect(without.noModel).toEqual(['hab_crewed']);
  });
});
