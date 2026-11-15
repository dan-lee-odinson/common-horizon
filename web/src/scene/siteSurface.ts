// The surface picture laid over the real ground round a preset site (public/site-texture/, see its
// README): which picture, how it lies on the ground, how bright it is drawn, and the words that
// say what it is. Kept free of 3D-library code: the HUD reads the same store as the scene, and
// tests check the arithmetic.
//
// A picture is grayscale, 1024 x 1024, over the same 64 km square as the site's far terrain file:
// row 0 the north edge, column 0 the west edge, 62.5 m a pixel. Pixel (row, col) lies over
// east = -32000 + (col + 0.5) x 62.5 and north = 32000 - (row + 0.5) x 62.5. In the scene's frame
// (x east, z south) that is u = (x + half) / (2 half) across and v = (half - z) / (2 half) up, with
// v = 1 at the north edge (the top row of the image, as a texture is read with its rows flipped).

import { createStore, useStore } from '../state/store';

export interface SurfaceEntry {
  file: string;
  layer: string;
  layer_pixel_m: number;
  /** "camera mosaic", or a relief picture worked out from LOLA heights. */
  kind: string;
  /** Mean pixel value of the picture, 0 to 255. */
  mean_brightness: number;
}

export interface SurfaceManifest {
  pixels?: number;
  half_width_m?: number;
  sites: Record<string, SurfaceEntry>;
}

/** Half the width of the square a picture covers, metres. */
export const SURFACE_HALF_M = 32_000;

/** Where a point of the scene (x east, z south, metres) lies on the picture, as texture coordinates (v = 1 at the north edge). */
export function surfaceUV(x: number, z: number, half = SURFACE_HALF_M): { u: number; v: number } {
  return { u: (x + half) / (2 * half), v: (half - z) / (2 * half) };
}

/**
 * The picture's pixel under a point of the scene, read the way a texture is: `pixels` row by row
 * from the north edge, `size` x `size`. The nearest pixel; points off the picture take its edge.
 */
export function pictureAt(pixels: ArrayLike<number>, size: number, x: number, z: number, half = SURFACE_HALF_M): number {
  const { u, v } = surfaceUV(x, z, half);
  const col = Math.min(size - 1, Math.max(0, Math.floor(u * size)));
  const row = Math.min(size - 1, Math.max(0, Math.floor((1 - v) * size)));
  return pixels[row * size + col];
}

/** The least and most a picture may darken or brighten the ground, as a share of the plain ground's tone. */
export const TONE_RANGE = { min: 0.3, max: 2.4 } as const;

/**
 * How a pixel sets the ground's tone, as a share of the plain ground's: the pixel over the
 * picture's mean brightness, so every site sits at about the same level, kept inside TONE_RANGE so
 * no ground comes out black or blown out.
 */
export function pictureTone(pixel: number, meanBrightness: number): number {
  if (!(meanBrightness > 0) || !Number.isFinite(pixel)) return 1;
  return Math.min(TONE_RANGE.max, Math.max(TONE_RANGE.min, pixel / meanBrightness));
}

/** True when the picture is a camera mosaic (else a relief picture worked out from LOLA heights). */
export function isCameraMosaic(entry: Pick<SurfaceEntry, 'kind'>): boolean {
  return /camera mosaic/i.test(entry.kind);
}

/** The sentence that says what the picture is, from its manifest entry. */
export function surfaceWords(entry: Pick<SurfaceEntry, 'kind'>): string {
  return isCameraMosaic(entry) ? 'Surface: LRO camera mosaic (NASA/GSFC/Arizona State University).' : 'Surface: relief drawn from LOLA heights.';
}

/** The manifest's entry for a site, or null when it is missing or not in the expected shape. */
export function surfaceEntry(m: SurfaceManifest | null, siteId: string): SurfaceEntry | null {
  const e = m?.sites && Object.prototype.hasOwnProperty.call(m.sites, siteId) ? m.sites[siteId] : null;
  if (!e || typeof e.file !== 'string' || !/^[a-z0-9-]+\.jpg$/.test(e.file) || typeof e.kind !== 'string' || !(e.mean_brightness > 0 && e.mean_brightness <= 255)) return null;
  return e;
}

export type SurfaceStatus = 'none' | 'loading' | 'ready' | 'failed';

export interface SiteSurfaceState {
  /** 'ready' once the picture is drawn on the ground; 'none' with no picture for the site. */
  status: SurfaceStatus;
  entry: SurfaceEntry | null;
}

/** By site id: each site's surface picture, as far as it has got. The scene loads the picture itself and says when it is drawn. */
export const siteSurfaces = createStore<Record<string, SiteSurfaceState>>({});

const NONE: SiteSurfaceState = { status: 'none', entry: null };
const LOADING: SiteSurfaceState = { status: 'loading', entry: null };

let manifest: Promise<SurfaceManifest | null> | null = null;

/** Address of a site's picture (the app may be served from a sub-folder). */
export function surfaceUrl(entry: SurfaceEntry): string {
  return `${import.meta.env.BASE_URL ?? '/'}site-texture/${entry.file}`;
}

/** Starts looking up a site's picture, once. Custom points have none. */
export function requestSiteSurface(siteId: string | null | undefined): void {
  if (!siteId || siteSurfaces.get()[siteId]) return;
  if (siteId.startsWith('custom:')) {
    siteSurfaces.set({ [siteId]: NONE });
    return;
  }
  siteSurfaces.set({ [siteId]: LOADING });
  manifest ??= fetch(`${import.meta.env.BASE_URL ?? '/'}site-texture/manifest.json`)
    .then((r) => (r.ok ? (r.json() as Promise<SurfaceManifest>) : null))
    .catch(() => null);
  void manifest.then((m) => {
    const entry = surfaceEntry(m, siteId);
    siteSurfaces.set({ [siteId]: entry ? { status: 'loading', entry } : NONE });
  });
}

/** The scene says whether the picture is drawn. */
export function markSurface(siteId: string, status: 'ready' | 'failed'): void {
  const now = siteSurfaces.get()[siteId];
  if (now && now.status !== status) siteSurfaces.set({ [siteId]: { ...now, status } });
}

/** A site's surface picture, as far as it has got (looking it up if need be). */
export function useSiteSurface(siteId: string | null | undefined): SiteSurfaceState {
  const state = useStore(siteSurfaces, (all) => (siteId ? all[siteId] : undefined));
  if (siteId && !state) queueMicrotask(() => requestSiteSurface(siteId));
  return state ?? (siteId ? LOADING : NONE);
}
