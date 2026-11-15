import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import sitesJson from '../api/examples/sites.json';
import { azElToLocal } from '../util/geo';
import { isCameraMosaic, pictureAt, pictureTone, surfaceEntry, surfaceUV, surfaceWords, TONE_RANGE, type SurfaceManifest } from './siteSurface';

const DIR = new URL('../../public/site-texture/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', DIR), 'utf8')) as SurfaceManifest;
const presetIds = (sitesJson as { sites: { id: string }[] }).sites.map((s) => s.id);

describe('how a picture lies on the ground', () => {
  // A made-up 8 x 8 picture, row 0 the north edge, column 0 the west edge, over a square 800 m
  // across (100 m a pixel): 0 everywhere, a mark of 255 in the north-east corner pixel's
  // neighbour (row 1, column 6) and 128 in the south-west (row 6, column 1).
  const size = 8;
  const half = 400;
  const pixels = new Uint8Array(size * size);
  pixels[1 * size + 6] = 255;
  pixels[6 * size + 1] = 128;
  const north = azElToLocal(0, 0, 1);
  const east = azElToLocal(90, 0, 1);
  /** The scene point `n` metres north and `e` metres east of the site. */
  const at = (n: number, e: number) => ({ x: north.x * n + east.x * e, z: north.z * n + east.z * e });

  it('puts a mark in the north-east of the picture on the ground north-east of the site', () => {
    // Row 1 spans 200 to 300 m north; column 6 spans 200 to 300 m east.
    const ne = at(250, 250);
    expect(pictureAt(pixels, size, ne.x, ne.z, half)).toBe(255);
    const sw = at(-250, -250);
    expect(pictureAt(pixels, size, sw.x, sw.z, half)).toBe(128);
    // Nowhere else.
    for (const [n, e] of [[250, -250], [-250, 250], [0, 0]] as const) {
      const p = at(n, e);
      expect(pictureAt(pixels, size, p.x, p.z, half)).toBe(0);
    }
  });

  it('gives the texture coordinates of the corners and the middle', () => {
    const nw = at(half, -half);
    expect(surfaceUV(nw.x, nw.z, half)).toEqual({ u: 0, v: 1 });
    const se = at(-half, half);
    expect(surfaceUV(se.x, se.z, half)).toEqual({ u: 1, v: 0 });
    expect(surfaceUV(0, 0, half)).toEqual({ u: 0.5, v: 0.5 });
  });

  it('puts the middle of pixel (row, col) where the README says: east -32000 + (col + 0.5) x 62.5, north 32000 - (row + 0.5) x 62.5', () => {
    for (const [row, col] of [[0, 0], [100, 900], [511, 512], [1023, 1023]] as const) {
      const p = at(32000 - (row + 0.5) * 62.5, -32000 + (col + 0.5) * 62.5);
      const { u, v } = surfaceUV(p.x, p.z);
      expect(u * 1024).toBeCloseTo(col + 0.5, 9);
      expect((1 - v) * 1024).toBeCloseTo(row + 0.5, 9);
    }
  });
});

describe('the tone a picture gives the ground', () => {
  it('is the pixel over the picture’s mean, so every site sits near the plain ground’s level', () => {
    expect(pictureTone(60, 60)).toBe(1);
    expect(pictureTone(90, 60)).toBe(1.5);
    expect(pictureTone(194, 193.8)).toBeCloseTo(1, 2);
  });

  it('never comes out black or blown out', () => {
    expect(pictureTone(0, 42.2)).toBe(TONE_RANGE.min);
    expect(pictureTone(255, 42.2)).toBe(TONE_RANGE.max);
    expect(pictureTone(10, 0)).toBe(1);
  });
});

describe('the surface pictures', () => {
  it('cover every preset site, each a 1024 x 1024 JPEG', () => {
    expect(manifest.pixels).toBe(1024);
    expect(manifest.half_width_m).toBe(32000);
    for (const id of presetIds) {
      const entry = surfaceEntry(manifest, id);
      expect(entry, id).not.toBeNull();
      const bytes = readFileSync(new URL(entry!.file, DIR));
      // A JPEG starts FF D8.
      expect(bytes[0], id).toBe(0xff);
      expect(bytes[1], id).toBe(0xd8);
    }
    expect(surfaceEntry(manifest, 'custom:-88.5,45')).toBeNull();
    expect(surfaceEntry(manifest, 'toString')).toBeNull();
  });

  it('say what they are, from the manifest', () => {
    expect(surfaceWords(surfaceEntry(manifest, 'apollo-15')!)).toBe('Surface: LRO camera mosaic (NASA/GSFC/Arizona State University).');
    expect(surfaceWords(surfaceEntry(manifest, 'shackleton-ridge')!)).toBe('Surface: relief drawn from LOLA heights.');
    expect(surfaceWords(surfaceEntry(manifest, 'nobile')!)).toBe('Surface: relief drawn from LOLA heights.');
    const mosaics = presetIds.filter((id) => isCameraMosaic(surfaceEntry(manifest, id)!));
    expect(mosaics).toHaveLength(15);
  });
});
