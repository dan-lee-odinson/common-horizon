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

describe('the words under the picture, built from the manifest', () => {
  it('give each model’s pixel size, near and far', () => {
    const words = groundWords(manifestEntry(manifest, 'shackleton-ridge')!, true);
    expect(words.source).toBe('Ground: LOLA elevation from NASA Moon Trek (5 m model near, 100 m model far), drawn at true scale. Shading only: shadows cast by terrain are not drawn.');
    expect(words.nearSmooth).toBeNull();
    expect(words.smoothHorizon).toBeNull();
  });

  it('say where the near ground comes from the global model', () => {
    const words = groundWords(manifestEntry(manifest, 'apollo-17')!, true);
    expect(words.source).toContain('(237 m model near, 237 m model far)');
    expect(words.nearSmooth).toBe('The near ground here comes from a 237 m model, so it is smooth with no small detail.');
    for (const id of presetIds) {
      const global = manifest.sites[id].near.layer === 'LRO_LOLA_DEM_Global_128ppd_v04';
      expect(groundWords(manifestEntry(manifest, id)!, true).nearSmooth !== null, id).toBe(global);
    }
  });

  it('say, with the site’s own figure, where the sunlight numbers use a smooth horizon', () => {
    const a17 = groundWords(manifestEntry(manifest, 'apollo-17')!, true).smoothHorizon;
    expect(a17).not.toBeNull();
    expect(`${a17!.before}${a17!.deg}${a17!.after}`).toBe(
      'Sunlight numbers at this site use a smooth horizon. The distant terrain is drawn for scale and is not in those numbers. It rises up to 14.0 degrees above the horizon here.',
    );
    expect(groundWords(manifestEntry(manifest, 'shackleton-ridge')!, true).smoothHorizon).toBeNull();
    // Eleven sites use a smooth horizon, six a terrain skyline; each line carries its own figure.
    const smooth = presetIds.filter((id) => groundWords(manifestEntry(manifest, id)!, true).smoothHorizon !== null);
    expect(smooth).toHaveLength(11);
    for (const id of smooth) expect(groundWords(manifestEntry(manifest, id)!, true).smoothHorizon!.deg).toBe(manifest.sites[id].skyline_from_these_files.highest_deg.toFixed(1));
  });

  it('with the near ground alone, say it eases back to level ground, which is an illustration', () => {
    const words = groundWords(manifestEntry(manifest, 'nobile')!, false);
    expect(words.source).toBe(
      'Ground: LOLA elevation from NASA Moon Trek (30 m model), drawn at true scale for 640 m round the site, then eased back to level ground, which is an illustration. Shading only: shadows cast by terrain are not drawn.',
    );
    expect(groundWords(manifestEntry(manifest, 'apollo-17')!, false).smoothHorizon).toBeNull();
  });
});
