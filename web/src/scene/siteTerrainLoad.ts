// Loads the real ground round a preset site (public/site-terrain/, see its README): the manifest
// once, then each site's height files the first time the Site view needs them. The scene draws
// what has loaded; the HUD reads the same store, so the words under the picture always describe
// the ground actually drawn. A site with no entry in the manifest (a custom point), or whose near
// file cannot be read, keeps the level illustration and its caption.

import { createStore, useStore } from '../state/store';
import { parseGrid, type TerrainGrid } from './siteTerrain';

export interface TerrainFileEntry {
  file: string;
  posts: number;
  spacing_m: number;
  /** The NASA Moon Trek layer the heights come from, and its pixel size in metres. */
  layer: string;
  layer_pixel_m: number;
}

export interface TerrainSiteEntry {
  near: TerrainFileEntry;
  far: TerrainFileEntry;
  skyline_from_these_files: { highest_deg: number; highest_at_azimuth_deg?: number };
  /** True where the physics engine's sunlight numbers use a stored terrain skyline; false where they use a smooth horizon. */
  engine_sunlight_uses_terrain_skyline: boolean;
}

export interface TerrainManifest {
  source?: string;
  sites: Record<string, TerrainSiteEntry>;
}

export type LoadStatus = 'loading' | 'ready' | 'failed';

export interface SiteTerrainState {
  /** 'none': the site has no files (a custom point, or no manifest). */
  status: LoadStatus | 'none';
  entry: TerrainSiteEntry | null;
  near: TerrainGrid | null;
  far: TerrainGrid | null;
  farStatus: LoadStatus | 'none';
}

const NONE: SiteTerrainState = { status: 'none', entry: null, near: null, far: null, farStatus: 'none' };
const LOADING: SiteTerrainState = { status: 'loading', entry: null, near: null, far: null, farStatus: 'loading' };

/** By site id: what has loaded of each site's ground. */
export const siteTerrains = createStore<Record<string, SiteTerrainState>>({});

const base = (): string => `${import.meta.env.BASE_URL ?? '/'}site-terrain/`;

let manifest: Promise<TerrainManifest | null> | null = null;

function isFileEntry(v: unknown): v is TerrainFileEntry {
  const e = v as TerrainFileEntry | null;
  return Boolean(e) && typeof e!.file === 'string' && /^[a-z0-9-]+\.(near|far)\.f32$/.test(e!.file) && Number.isInteger(e!.posts) && e!.spacing_m > 0 && typeof e!.layer === 'string' && e!.layer_pixel_m > 0;
}

/** The manifest's entry for a site, or null when it is missing or not in the expected shape. */
export function manifestEntry(m: TerrainManifest | null, siteId: string): TerrainSiteEntry | null {
  const e = m?.sites && Object.prototype.hasOwnProperty.call(m.sites, siteId) ? m.sites[siteId] : null;
  if (!e || !isFileEntry(e.near) || !isFileEntry(e.far)) return null;
  if (typeof e.engine_sunlight_uses_terrain_skyline !== 'boolean' || !Number.isFinite(e.skyline_from_these_files?.highest_deg)) return null;
  return e;
}

function loadManifest(): Promise<TerrainManifest | null> {
  manifest ??= fetch(`${base()}manifest.json`)
    .then((r) => (r.ok ? (r.json() as Promise<TerrainManifest>) : null))
    .catch(() => null);
  return manifest;
}

function loadGrid(entry: TerrainFileEntry): Promise<TerrainGrid | null> {
  return fetch(`${base()}${entry.file}`)
    .then((r) => (r.ok ? r.arrayBuffer() : null))
    .then((b) => (b ? parseGrid(b, entry.posts, entry.spacing_m) : null))
    .catch(() => null);
}

function put(siteId: string, patch: Partial<SiteTerrainState>): void {
  siteTerrains.set((all) => ({ [siteId]: { ...(all[siteId] ?? LOADING), ...patch } }));
}

/** Starts loading a site's ground, once. Custom points have none. */
export function requestSiteTerrain(siteId: string | null | undefined): void {
  if (!siteId || siteTerrains.get()[siteId]) return;
  if (siteId.startsWith('custom:')) {
    put(siteId, NONE);
    return;
  }
  put(siteId, LOADING);
  void loadManifest().then((m) => {
    const entry = manifestEntry(m, siteId);
    if (!entry) {
      put(siteId, NONE);
      return;
    }
    put(siteId, { entry });
    // The near ground first: it is what the hardware stands on.
    void loadGrid(entry.near).then((near) => {
      put(siteId, near ? { status: 'ready', near } : { status: 'failed', farStatus: 'none' });
      if (!near) return;
      // Then the far ground. If it cannot be read, the near ground stays, eased back to level past its edge.
      void loadGrid(entry.far).then((far) => put(siteId, far ? { farStatus: 'ready', far } : { farStatus: 'failed' }));
    });
  });
}

/** What has loaded of a site's ground (requesting it if need be). */
export function useSiteTerrain(siteId: string | null | undefined): SiteTerrainState {
  const state = useStore(siteTerrains, (all) => (siteId ? all[siteId] : undefined));
  if (siteId && !state) queueMicrotask(() => requestSiteTerrain(siteId));
  return state ?? (siteId ? LOADING : NONE);
}

/** What is said under the picture about the ground drawn: each sentence built from the manifest. */
export interface GroundWords {
  /** Where the heights come from and how they are drawn. */
  source: string;
  /** Where the near file comes from the global model: it is smooth. */
  nearSmooth: string | null;
  /** Where the engine's sunlight uses a smooth horizon: the sentence, and the highest ground in view in degrees (one decimal). */
  smoothHorizon: { before: string; deg: string; after: string } | null;
}

const metres = (m: number): string => `${Math.round(m)} m`;

/**
 * The words for a site's ground. `far` says whether the far ground is drawn too; without it the near
 * ground eases back to level ground past its edge, and the words say so.
 */
export function groundWords(entry: TerrainSiteEntry, far: boolean): GroundWords {
  const nearReachM = ((entry.near.posts - 1) / 2) * entry.near.spacing_m;
  const source = far
    ? `Ground: LOLA elevation from NASA Moon Trek (${metres(entry.near.layer_pixel_m)} model near, ${metres(entry.far.layer_pixel_m)} model far), drawn at true scale. Shading only: shadows cast by terrain are not drawn.`
    : `Ground: LOLA elevation from NASA Moon Trek (${metres(entry.near.layer_pixel_m)} model), drawn at true scale for ${metres(nearReachM)} round the site, then eased back to level ground, which is an illustration. Shading only: shadows cast by terrain are not drawn.`;
  const nearSmooth = /global/i.test(entry.near.layer) ? `The near ground here comes from a ${metres(entry.near.layer_pixel_m)} model, so it is smooth with no small detail.` : null;
  const smoothHorizon = entry.engine_sunlight_uses_terrain_skyline
    ? null
    : far
      ? {
          before: 'Sunlight numbers at this site use a smooth horizon. The distant terrain is drawn for scale and is not in those numbers. It rises up to ',
          deg: entry.skyline_from_these_files.highest_deg.toFixed(1),
          after: ' degrees above the horizon here.',
        }
      : null;
  return { source, nearSmooth, smoothHorizon };
}
