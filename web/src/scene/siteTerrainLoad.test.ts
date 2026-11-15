import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import sitesJson from '../api/examples/sites.json';
import { gridHalf, parseGrid } from './siteTerrain';
import { groundWords, manifestEntry, type TerrainManifest } from './siteTerrainLoad';

const DIR = new URL('../../public/site-terrain/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', DIR), 'utf8')) as TerrainManifest;
const presetIds = (sitesJson as { sites: { id: string }[] }).sites.map((s) => s.id);

describe('the site terrain files', () => {
  it('cover every preset site, near and far, each the size its entry states', () => {
    expect(presetIds).toHaveLength(17);
    for (const id of presetIds) {
      const entry = manifestEntry(manifest, id);
      expect(entry, id).not.toBeNull();
      for (const which of ['near', 'far'] as const) {
        const file = entry![which];
        const bytes = readFileSync(new URL(file.file, DIR));
        const grid = parseGrid(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, file.posts, file.spacing_m);
        expect(grid, `${id} ${which}`).not.toBeNull();
        // The middle post is the site itself.
        expect(grid!.heights[(grid!.heights.length - 1) / 2], `${id} ${which}`).toBe(0);
      }
      expect(gridHalf({ posts: entry!.near.posts, spacing: entry!.near.spacing_m })).toBe(640);
      expect(gridHalf({ posts: entry!.far.posts, spacing: entry!.far.spacing_m })).toBe(32_000);
    }
  });

  it('have no entry for a custom point or a site not in the manifest', () => {
    expect(manifestEntry(manifest, 'custom:-88.5,45')).toBeNull();
    expect(manifestEntry(manifest, 'toString')).toBeNull();
    expect(manifestEntry(null, 'apollo-17')).toBeNull();
  });
});

describe('the Ground panel’s words, built from the manifest', () => {
  it('give each model’s pixel size, near and far', () => {
    const words = groundWords(manifestEntry(manifest, 'shackleton-ridge')!, true);
    expect(words.source).toBe('Ground: NASA LOLA via Moon Trek (5 m near, 100 m far), true scale. No cast shadows.');
    expect(words.smoothHorizon).toBeNull();
    // Where the near file is the global model, the model sizes say it.
    expect(groundWords(manifestEntry(manifest, 'apollo-17')!, true).source).toBe('Ground: NASA LOLA via Moon Trek (237 m near, 237 m far), true scale. No cast shadows.');
    expect(groundWords(manifestEntry(manifest, 'nobile')!, true).source).toContain('(30 m near, 100 m far)');
  });

  it('say, with the site’s own figure, where the sunlight numbers use a smooth horizon', () => {
    const a17 = groundWords(manifestEntry(manifest, 'apollo-17')!, true).smoothHorizon;
    expect(a17).not.toBeNull();
    expect(`${a17!.before}${a17!.deg}${a17!.after}`).toBe('Sunlight numbers here use a smooth horizon. The drawn terrain rises to 14.0 degrees and is not in them.');
    expect(groundWords(manifestEntry(manifest, 'shackleton-ridge')!, true).smoothHorizon).toBeNull();
    // Eleven sites use a smooth horizon, six a terrain skyline; each line carries its own figure.
    const smooth = presetIds.filter((id) => groundWords(manifestEntry(manifest, id)!, true).smoothHorizon !== null);
    expect(smooth).toHaveLength(11);
    for (const id of smooth) expect(groundWords(manifestEntry(manifest, id)!, true).smoothHorizon!.deg).toBe(manifest.sites[id].skyline_from_these_files.highest_deg.toFixed(1));
  });

  it('with the near ground alone, say it eases back to level ground, which is an illustration, with no skyline figure', () => {
    expect(groundWords(manifestEntry(manifest, 'nobile')!, false).source).toBe('Ground: NASA LOLA via Moon Trek (30 m near), true scale to 640 m, then level (an illustration). No cast shadows.');
    expect(groundWords(manifestEntry(manifest, 'apollo-17')!, false).smoothHorizon).toBeNull();
  });
});
