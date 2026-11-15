// Where the mission's hardware stands round the landing point. Plain arithmetic, no 3D-library
// code, so it can be checked by tests.
//
// The data says which hardware a mission has and how many of each; it says nothing about where
// anything stands. The places below are therefore an illustration (the screen says so), chosen so
// that nothing overlaps and the picture reads at a glance. They are fixed: the same mission always
// gives the same picture. Sizes are never changed: every footprint is the model's own, in metres.
//
// Frame: the landing point is the origin, x east, z south (y up). A compass bearing b at distance d
// is the point (d sin b, -d cos b).

import type { HardwareChoice } from '../api/types';
import { modelFor, primaryLanderId } from '../state/models';
import { DEG } from '../util/geo';

/** What the layout needs of a model's description (see state/models.ts). */
export interface ModelFootprint {
  dimensions: { width: number; height: number; depth: number };
}

export interface PlacedItem {
  /** Unique in the layout: the catalog id and which one of its count. */
  key: string;
  /** Catalog id. */
  id: string;
  /** Model file name (without extension). */
  modelId: string;
  /** Where the middle of its footprint stands, metres. */
  x: number;
  z: number;
  /** Turn about the vertical, radians. Only ever 0 or a quarter turn, so footprints stay square to the axes. */
  rotY: number;
  /** Half the footprint along x and along z, after the turn, metres. */
  halfX: number;
  halfZ: number;
  height: number;
}

export interface SiteLayout {
  items: PlacedItem[];
  /** Catalog ids in the mission that have no model: listed on screen, never drawn. */
  noModel: string[];
  /** The lander at the landing point, when the mission has one and its model is known. */
  primaryLanderId: string | null;
  /** Height of what stands at the landing point: the primary lander, else the tallest item; null with nothing to draw. */
  heightM: number | null;
  /** Radius of the circle round the landing point that holds every footprint, plus a margin, metres. */
  radius: number;
}

interface Slot {
  bearingDeg: number;
  distance: number;
  /** Quarter turns about the vertical. */
  quarterTurns: 0 | 1 | -1;
  /** Least distance between the middles of two of the same item in a row, metres. */
  pitch: number;
}

/** Clear ground kept between two footprints in a row, metres. */
const ROW_GAP = 5;
/** Margin added round the outermost footprint for the layout's radius, metres. */
const RADIUS_MARGIN = 8;
const MIN_RADIUS = 12;

const SLOTS: Readonly<Record<string, Slot | undefined>> = {
  // A second kind of lander stands off to the south-west; more of the kind on the landing point, further south.
  lander2: { bearingDeg: 240, distance: 60, quarterTurns: 0, pitch: 0 },
  landerMore: { bearingDeg: 200, distance: 110, quarterTurns: 0, pitch: 0 },
  // The habitat stands east of the lander, turned a quarter so its hatch faces it.
  hab: { bearingDeg: 90, distance: 40, quarterTurns: -1, pitch: 0 },
  // The fission unit stands well away to the north-west.
  nuclear: { bearingDeg: 300, distance: 120, quarterTurns: 0, pitch: 0 },
  // Solar masts stand in a row north of the lander, nine metres apart.
  solar: { bearingDeg: 0, distance: 45, quarterTurns: 0, pitch: 9 },
};

/**
 * Places `count` of one item in a row centred on a slot. The row runs across the line from the
 * landing point to the slot, so a long row never points at the lander.
 */
function placeRow(id: string, modelId: string, count: number, slot: Slot, model: ModelFootprint, out: PlacedItem[]): void {
  const turned = slot.quarterTurns !== 0;
  const halfX = (turned ? model.dimensions.depth : model.dimensions.width) / 2;
  const halfZ = (turned ? model.dimensions.width : model.dimensions.depth) / 2;
  const b = slot.bearingDeg * DEG;
  const cx = slot.distance * Math.sin(b);
  const cz = -slot.distance * Math.cos(b);
  // Along the row: at right angles to the bearing. Footprints stay square to the axes, so the
  // pitch is set by the axis the row mostly runs along: there, two neighbours are a footprint and
  // the gap apart, whatever the row's direction.
  const rx = Math.cos(b);
  const rz = Math.sin(b);
  const mostlyX = Math.abs(rx) >= Math.abs(rz);
  const pitch = Math.max(slot.pitch, ((mostlyX ? 2 * halfX : 2 * halfZ) + ROW_GAP) / Math.max(Math.abs(rx), Math.abs(rz)));
  for (let i = 0; i < count; i++) {
    const offset = (i - (count - 1) / 2) * pitch;
    out.push({
      key: `${id}:${i}`,
      id,
      modelId,
      x: cx + rx * offset,
      z: cz + rz * offset,
      rotY: (slot.quarterTurns * Math.PI) / 2,
      halfX,
      halfZ,
      height: model.dimensions.height,
    });
  }
}

/**
 * The layout for a mission. `models` holds each chosen item's model description by catalog id:
 * null when the item has no model, undefined while its description is still being read (such an
 * item is left out until it arrives).
 */
export function siteLayout(choices: readonly HardwareChoice[], models: Readonly<Record<string, ModelFootprint | null | undefined>>): SiteLayout {
  const items: PlacedItem[] = [];
  const noModel: string[] = [];
  const known = (id: string): ModelFootprint | null => {
    const m = Object.hasOwn(models, id) ? models[id] : undefined;
    return m ?? null;
  };
  const counted = choices.filter((c) => Number.isFinite(c.count) && c.count >= 1).map((c) => ({ id: c.id, count: Math.floor(c.count) }));
  const primary = primaryLanderId(counted.filter((c) => known(c.id) !== null).map((c) => c.id));

  for (const { id, count } of [...counted].sort((a, b) => a.id.localeCompare(b.id))) {
    const modelId = modelFor(id);
    const model = known(id);
    if (modelId === null || (Object.hasOwn(models, id) && models[id] === null)) {
      noModel.push(id);
      continue;
    }
    if (model === null) continue; // still being read
    let rest = count;
    if (id === primary) {
      // The primary lander stands on the landing point itself.
      items.push({ key: `${id}:0`, id, modelId, x: 0, z: 0, rotY: 0, halfX: model.dimensions.width / 2, halfZ: model.dimensions.depth / 2, height: model.dimensions.height });
      rest -= 1;
      if (rest <= 0) continue;
    }
    const lander = id === 'starship' || id === 'griffin';
    const slot = lander ? (id === primary ? SLOTS.landerMore : SLOTS.lander2) : SLOTS[id];
    if (!slot) {
      // A model with no place in this layout is not drawn (and is listed with the others that are not).
      noModel.push(id);
      continue;
    }
    const row: PlacedItem[] = [];
    placeRow(id, modelId, rest, slot, model, row);
    // Keys stay unique when one of the item already stands on the landing point.
    const first = count - rest;
    row.forEach((item, i) => items.push({ ...item, key: `${id}:${first + i}` }));
  }

  const atOrigin = items.find((i) => i.x === 0 && i.z === 0);
  const tallest = items.reduce<number | null>((h, i) => (h === null || i.height > h ? i.height : h), null);
  const reach = items.reduce((r, i) => Math.max(r, Math.hypot(Math.abs(i.x) + i.halfX, Math.abs(i.z) + i.halfZ)), 0);
  return {
    items,
    noModel,
    primaryLanderId: primary,
    heightM: atOrigin ? atOrigin.height : tallest,
    radius: Math.max(MIN_RADIUS, reach + RADIUS_MARGIN),
  };
}

/** The clear ground between two footprints, metres (negative when they overlap). */
export function footprintGap(a: PlacedItem, b: PlacedItem): number {
  const dx = Math.abs(a.x - b.x) - (a.halfX + b.halfX);
  const dz = Math.abs(a.z - b.z) - (a.halfZ + b.halfZ);
  // Apart along one axis is apart: the gap is the larger of the two, or the diagonal when apart on both.
  if (dx > 0 && dz > 0) return Math.hypot(dx, dz);
  return Math.max(dx, dz);
}

/**
 * True when a loaded shape is the size its description states: as tall as `heightM` to one part in
 * a hundred, with its lowest point on the ground (within a centimetre). A shape that fails is not
 * drawn, so "true scale" cannot be broken by a file that does not match its description.
 */
export function shapeMatches(minY: number, maxY: number, heightM: number): boolean {
  if (![minY, maxY, heightM].every(Number.isFinite) || !(heightM > 0)) return false;
  return Math.abs(maxY - minY - heightM) <= heightM * 0.01 && Math.abs(minY) <= 0.01;
}

/**
 * True when a piece of hardware stands between a viewpoint and a far-off body of the sky: the ray
 * from `from` along `dir` passes through one of the footprints, taken as a box as tall as the item.
 * The scene uses it to drop the Sun's or Earth's tag while the body is behind the lander.
 */
export function hiddenByHardware(from: { x: number; y: number; z: number }, dir: { x: number; y: number; z: number }, items: readonly PlacedItem[]): boolean {
  for (const item of items) {
    let near = 0;
    let far = Infinity;
    const slabs: [number, number, number, number][] = [
      [from.x, dir.x, item.x - item.halfX, item.x + item.halfX],
      [from.y, dir.y, 0, item.height],
      [from.z, dir.z, item.z - item.halfZ, item.z + item.halfZ],
    ];
    let hit = true;
    for (const [o, d, lo, hi] of slabs) {
      if (Math.abs(d) < 1e-12) {
        if (o < lo || o > hi) hit = false;
      } else {
        const a = (lo - o) / d;
        const b = (hi - o) / d;
        near = Math.max(near, Math.min(a, b));
        far = Math.min(far, Math.max(a, b));
      }
      if (!hit || near > far) {
        hit = false;
        break;
      }
    }
    if (hit) return true;
  }
  return false;
}
