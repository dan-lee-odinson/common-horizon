// The hardware models: which model stands for which catalog item, and each model's published size.
//
// The models are static files served with the app (public/models/): a shape (.glb) and a small
// description beside it (.json) with the model's size in metres and where that size comes from.
// This module reads the descriptions only. It needs no 3D code, so the HUD can show a lander's
// height (and work out its shadow) on a browser with no WebGL.
//
// The models are drawn at true scale: one model unit is one metre. A catalog item with no model is
// listed as "no model" and stands in the scene as a plain labelled marker.

import { useEffect, useState } from 'react';
import { createStore } from './store';

/**
 * THE table from catalog item to 3D model: catalog id (the planner's) -> model file name (without
 * extension) in public/models/. Every other catalog item has no model.
 *
 * A model stands for the object that is landed, at its published size. The planner lists some
 * objects twice, as a payload mass and as a power figure (backend/docs/WEBSITE_API.md, decision 8):
 * the model goes with the payload row (`surface_habitat`, `fsp_40kwe`), so one habitat or fission
 * unit is never drawn twice. The power rows (`fission_40kwe`, `hab_crewed`, ...) get a marker.
 * `vsat` is the solar array mast the model was made for; VSAT-XL is a larger mast, so it has none.
 * Blue Moon Mark 1 is a lander. The crew rover stands for Astrolab's FLEX-class `astrolab_clv1`, the
 * pressurized rover for JAXA's, and VIPER stands in for the science rover (`science_rover_recharge`).
 *
 * How each shape was made differs, and each description says so in its own `note`: code-built
 * (Starship, Griffin, the habitat, the fission unit, the mast: "built with SI/AI-written code"),
 * imported (Blue Moon Mark 1: "from a community CAD model") or generated (the three rovers:
 * "SI/AI-generated from a photo"). Every one is drawn at its published size.
 */
export const MODEL_FOR: Readonly<Record<string, string>> = {
  starship_hls: 'starship-lander',
  griffin: 'griffin-lander',
  blue_moon_mk1: 'blue-moon-mk1',
  surface_habitat: 'habitat-unit',
  fsp_40kwe: 'fission-power-unit',
  vsat: 'solar-array-mast',
  astrolab_clv1: 'crew-rover',
  jaxa_pressurized_rover: 'pressurized-rover',
  science_rover_recharge: 'viper-rover',
};

/** The model that stands for a catalog item, or null when it has none. */
export function modelFor(catalogId: string): string | null {
  return Object.hasOwn(MODEL_FOR, catalogId) ? MODEL_FOR[catalogId] : null;
}

/** Models of landers, in the order they take the landing point when a mission has more than one. */
export const LANDER_MODELS: readonly string[] = ['starship-lander', 'griffin-lander', 'blue-moon-mk1'];

/** True when the catalog item's model is a lander's. */
export function isLanderModel(catalogId: string): boolean {
  const m = modelFor(catalogId);
  return m !== null && LANDER_MODELS.includes(m);
}

/**
 * The lander that stands at the landing point (the scene's origin, where the reticle sits): the
 * first chosen item whose model is a lander's, in LANDER_MODELS order, else none.
 */
export function primaryLanderId(chosenIds: readonly string[]): string | null {
  for (const model of LANDER_MODELS) {
    const id = chosenIds.find((c) => modelFor(c) === model);
    if (id !== undefined) return id;
  }
  return null;
}

export interface ModelMeta {
  id: string;
  /** The model's own name, for example "Starship lander (stand-in)". */
  name: string;
  /** How well founded the size is, in the description's own words: "NASA study", "our estimate, ...". */
  status: string;
  /** Size in metres: x across, y up, z deep. The lowest point is on the ground (y = 0). */
  dimensions: { width: number; height: number; depth: number };
}

function isSize(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

/**
 * A model description as the app uses it: the name, the status words and the size, and nothing
 * else of the file. Null when the file is not a description this app can trust for "true scale":
 * another model's file, units other than metres, or a size that is missing or not a positive number.
 */
export function parseModelMeta(raw: unknown, modelId: string): ModelMeta | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (r.id !== modelId || r.units !== 'meters') return null;
  const d = r.dimensions_m;
  if (typeof d !== 'object' || d === null) return null;
  const { width_x: width, height_y: height, depth_z: depth } = d as Record<string, unknown>;
  if (!isSize(width) || !isSize(height) || !isSize(depth)) return null;
  return {
    id: modelId,
    name: typeof r.name === 'string' ? r.name : modelId,
    status: typeof r.status === 'string' ? r.status : '',
    dimensions: { width, height, depth },
  };
}

/** Address of a model file, beside the page (the app may be served from a sub-folder). */
export function modelUrl(modelId: string, extension: 'json' | 'glb'): string {
  return `models/${modelId}.${extension}`;
}

const cache = new Map<string, Promise<ModelMeta | null>>();

/**
 * A model's description, read once and remembered. It resolves to null when the file cannot be
 * fetched or read: the item is then treated as having no model. It never rejects.
 */
export function loadModelMeta(modelId: string): Promise<ModelMeta | null> {
  let hit = cache.get(modelId);
  if (!hit) {
    hit = fetch(modelUrl(modelId, 'json'))
      .then((res) => (res.ok ? res.json() : null))
      .then((raw: unknown) => parseModelMeta(raw, modelId))
      .catch(() => null);
    cache.set(modelId, hit);
  }
  return hit;
}

/**
 * Model descriptions for a set of catalog items, by catalog id:
 *   undefined  still loading
 *   null       the item has no model (or its description could not be read)
 */
export type ModelMetas = Readonly<Record<string, ModelMeta | null | undefined>>;

export function useModelMetas(catalogIds: readonly string[]): ModelMetas {
  const key = [...catalogIds].sort().join(',');
  const [metas, setMetas] = useState<ModelMetas>(() => Object.fromEntries(catalogIds.filter((id) => modelFor(id) === null).map((id) => [id, null])));
  useEffect(() => {
    let live = true;
    const ids = key === '' ? [] : key.split(',');
    // Items with no model are known at once; the rest arrive as their files are read.
    setMetas((prev) => Object.fromEntries(ids.map((id) => [id, modelFor(id) === null ? null : prev[id]])));
    for (const id of ids) {
      const model = modelFor(id);
      if (model === null) continue;
      loadModelMeta(model).then((meta) => {
        if (live) setMetas((prev) => (prev[id] === meta && id in prev ? prev : { ...prev, [id]: meta }));
      });
    }
    return () => {
      live = false;
    };
  }, [key]);
  return metas;
}

/**
 * Whether each chosen item's shape is in the 3D scene, by catalog id: being loaded, drawn, or not
 * drawn because its file could not be loaded or did not match its description. The scene writes
 * it; the hardware list reads it, so the list says so when something it names is not in the picture.
 */
export type ShapeState = 'loading' | 'ready' | 'failed';
export const modelShapes = createStore<Readonly<Record<string, ShapeState>>>({});
