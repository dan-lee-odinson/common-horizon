// The Moon Trek tile math against the figures Planning checked on the live service, and against the
// stored pictures' own record (public/site-context/manifest.json).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import sitesJson from '../api/examples/sites.json';
import {
  chooseLayer,
  gridFor,
  homeView,
  LAYERS,
  layerByLabel,
  legendUrl,
  mapState,
  mapView,
  metersPerPixelAt,
  moonTrekLink,
  perPixelText,
  QUICKMAP_URL_FORMAT,
  quickMapLink,
  scaleBar,
  siteKinds,
  sitePixel,
  STORED_PICTURE_IDS,
  storedPictureUrl,
  tileUrl,
  VIEW_H,
  VIEW_W,
  wrapLon,
} from './moonTrek';

interface ManifestSite {
  file: string;
  grid: 'EQ' | 'SP';
  layer: string;
  layer_title: string;
  zoom: number;
  meters_per_pixel: number;
  latitude_deg: number;
  longitude_east_deg: number;
  tiles: number;
  missing_tiles: number;
}
const manifest = JSON.parse(readFileSync(fileURLToPath(new URL('../../public/site-context/manifest.json', import.meta.url)), 'utf8')) as {
  width_px: number;
  height_px: number;
  sites: Record<string, ManifestSite>;
};
const SITES = sitesJson.sites as { id: string; lat: number; lon_east: number }[];

describe('site pixel, as checked on the live service', () => {
  it.each([
    ['SP', 7, 'shackleton-ridge', -89.684, 196.739, 16342.7, 16521.2],
    ['SP', 5, 'nobile', -85.42088, 31.6218, 4368.2, 3653.9],
    ['SP', 5, 'draper-cp12', -75.0, 132.4, 5358.6, 5248.9],
    ['EQ', 7, 'apollo-15', 26.13239, 3.6333, 33429.4, 11626.7],
    ['EQ', 7, 'blue-ghost-m2', -24.9, 177.4, 65062.7, 20916.9],
  ] as const)('%s zoom %i %s', (grid, zoom, _id, lat, lon, px, py) => {
    expect(gridFor(lat)).toBe(grid);
    const p = sitePixel(grid, lat, lon, zoom);
    expect(p.x).toBeCloseTo(px, 1);
    expect(p.y).toBeCloseTo(py, 1);
  });
});

describe('grids', () => {
  it('uses the polar grid at and below 60° S', () => {
    expect(gridFor(-60)).toBe('SP');
    expect(gridFor(-59.999)).toBe('EQ');
    expect(gridFor(0)).toBe('EQ');
    expect(gridFor(80)).toBe('EQ');
  });

  it('wraps longitude to -180..180', () => {
    expect(wrapLon(196.739)).toBeCloseTo(-163.261, 6);
    expect(wrapLon(336.5781)).toBeCloseTo(-23.4219, 6);
    expect(wrapLon(177.4)).toBeCloseTo(177.4, 6);
    expect(wrapLon(-190)).toBeCloseTo(170, 6);
    expect(wrapLon(540)).toBeCloseTo(-180, 6);
  });

  it('builds the tile address with the row before the column', () => {
    const photo = layerByLabel('LRO_WAC_Mosaic_Global_303ppd_v02')!;
    expect(tileUrl(photo, 7, 45, 130)).toBe('https://trek.nasa.gov/tiles/Moon/EQ/LRO_WAC_Mosaic_Global_303ppd_v02/1.0.0/default/default028mm/7/45/130.jpg');
  });
});

describe('the tiles under a view', () => {
  it('apollo-15: 5 columns by 3 rows at zoom 7, squeezed by cos(lat)', () => {
    const v = mapView(chooseLayer('photo', 26.13239, 3.6333, 7)!, 26.13239, 3.6333, 7);
    expect(v.tileZoom).toBe(7);
    expect(v.squeeze).toBeCloseTo(Math.cos((26.13239 * Math.PI) / 180), 12);
    expect(new Set(v.tiles.map((t) => t.col))).toEqual(new Set([128, 129, 130, 131, 132]));
    expect(new Set(v.tiles.map((t) => t.row))).toEqual(new Set([44, 45, 46]));
    expect(v.tiles).toHaveLength(manifest.sites['apollo-15'].tiles);
  });

  it('blue-ghost-m2: the view crosses 180° and the columns wrap to 0', () => {
    const v = mapView(chooseLayer('photo', -24.9, 177.4, 7)!, -24.9, 177.4, 7);
    const cols = [...new Set(v.tiles.map((t) => t.col))].sort((a, b) => a - b);
    expect(cols).toEqual([0, 252, 253, 254, 255]);
    // The wrapped column is drawn east of the last one, not at the far west.
    const wrapped = v.tiles.find((t) => t.col === 0)!;
    const east = v.tiles.find((t) => t.col === 255 && t.row === wrapped.row)!;
    expect(wrapped.x - east.x).toBeCloseTo(256, 9);
    expect(wrapped.url).toMatch(/\/7\/\d+\/0\.jpg$/);
    for (const t of v.tiles) expect(t.col).toBeLessThan(256);
  });

  it('places every tile so the view is covered with the site at the centre', () => {
    for (const s of SITES) {
      const home = homeView(s.lat);
      const v = mapView(layerByLabel(home.label)!, s.lat, s.lon_east, home.zooms[1]);
      const w = VIEW_W / v.squeeze;
      const minX = Math.min(...v.tiles.map((t) => t.x));
      const maxX = Math.max(...v.tiles.map((t) => t.x + t.size));
      const minY = Math.min(...v.tiles.map((t) => t.y));
      const maxY = Math.max(...v.tiles.map((t) => t.y + t.size));
      expect(minX, s.id).toBeLessThanOrEqual(-w / 2);
      expect(maxX, s.id).toBeGreaterThanOrEqual(w / 2);
      expect(minY, s.id).toBeLessThanOrEqual(-VIEW_H / 2);
      expect(maxY, s.id).toBeGreaterThanOrEqual(VIEW_H / 2);
      // No tile lies wholly outside the view.
      for (const t of v.tiles) {
        expect(t.x + t.size, s.id).toBeGreaterThan(-w / 2);
        expect(t.x, s.id).toBeLessThan(w / 2);
        expect(t.y + t.size, s.id).toBeGreaterThan(-VIEW_H / 2);
        expect(t.y, s.id).toBeLessThan(VIEW_H / 2);
      }
    }
  });

  it('enlarges the finest tiles of a layer that stops short of the zoom', () => {
    // The global slope layer goes to zoom 2 only: at zoom 7 each of its pixels is 32 view pixels.
    const slope = chooseLayer('slope', 26.13239, 3.6333, 7)!;
    const v = mapView(slope, 26.13239, 3.6333, 7);
    expect(v.tileZoom).toBe(2);
    expect(v.tiles.every((t) => t.size === 256 * 32 && t.zoom === 2)).toBe(true);
    expect(v.tiles.length).toBeGreaterThanOrEqual(1);
    expect(v.tiles.length).toBeLessThanOrEqual(4);
    expect(v.metersPerDataPx).toBeGreaterThan(5000);
    expect(v.metersPerDataPx).toBeLessThan(5500);
    expect(slope.scaleNote).toBe('regional, about 5 km per pixel');
  });

  it('asks for no tile outside the grid', () => {
    for (const layer of LAYERS) {
      for (const s of SITES) {
        if (layer.grid !== gridFor(s.lat)) continue;
        for (const z of homeView(s.lat).zooms) {
          if (chooseLayer(layer.kind, s.lat, s.lon_east, z)?.label !== layer.label) continue;
          const v = mapView(layer, s.lat, s.lon_east, z);
          const n = 2 ** v.tileZoom;
          for (const t of v.tiles) {
            expect(t.row).toBeGreaterThanOrEqual(0);
            expect(t.row).toBeLessThan(n);
            expect(t.col).toBeGreaterThanOrEqual(0);
            expect(t.col).toBeLessThan(layer.grid === 'EQ' ? 2 * n : n);
          }
        }
      }
    }
  });
});

describe('south polar layers', () => {
  it('picks the finest layer whose data holds the whole view', () => {
    expect(chooseLayer('terrain', -89.684, 196.739, 7)?.label).toBe('LRO_LOLA_ClrShade_SPole875_5mp_v04');
    expect(chooseLayer('terrain', -85.42088, 31.6218, 5)?.label).toBe('LRO_LOLA_ClrShade_SPole75_30mp_v04');
    expect(chooseLayer('terrain', -69.373, 32.319, 5)?.label).toBe('LRO_LOLA_ClrShade_SPole45_100mp_v04');
    expect(chooseLayer('slope', -89.684, 196.739, 7)?.label).toBe('ColorSlope_LRO_LOLA_DEM_SPole875_5mp_v04');
    expect(chooseLayer('slope', -85.42088, 31.6218, 5)?.label).toBe('LRO_LOLA_ClrSlope_SPole75S_120m');
    expect(chooseLayer('slope10', -85.42088, 31.6218, 5)?.label).toBe('LOLA_RGB_Slope_below_10deg_SPole45');
    expect(chooseLayer('photo', -85.42088, 31.6218, 5)?.label).toBe('LRO_WAC_Mosaic_SPole60_100m_v02');
  });

  it('offers only the layers a site has', () => {
    expect(siteKinds(-89.684, 196.739)).toEqual(['photo', 'terrain', 'slope', 'slope10']);
    expect(siteKinds(-85.42088, 31.6218)).toEqual(['photo', 'terrain', 'slope', 'slope10']);
    // 75° S is just outside the 75° slope layer's square (457,465 m from the pole against 457,440).
    expect(siteKinds(-75.0, 132.4)).toEqual(['photo', 'terrain', 'slope10']);
    expect(siteKinds(-69.373, 32.319)).toEqual(['photo', 'terrain', 'slope10']);
    expect(siteKinds(26.13239, 3.6333)).toEqual(['photo', 'terrain', 'slope']);
  });

  it('every site has the layer of its stored picture', () => {
    for (const s of SITES) expect(siteKinds(s.lat, s.lon_east), s.id).toContain(homeView(s.lat).kind);
  });
});

describe('the stored pictures', () => {
  it('are 960 x 600, like the view', () => {
    expect([manifest.width_px, manifest.height_px]).toEqual([VIEW_W, VIEW_H]);
  });

  it('cover all 17 presets and nothing else', () => {
    expect(new Set(Object.keys(manifest.sites))).toEqual(new Set(STORED_PICTURE_IDS));
    expect(new Set(SITES.map((s) => s.id))).toEqual(new Set(STORED_PICTURE_IDS));
    expect(storedPictureUrl('apollo-15')).toBe('site-context/apollo-15.jpg');
    expect(storedPictureUrl('custom:10.0000:20.0000')).toBeNull();
  });

  it.each(Object.entries(manifest.sites))('%s: the home view is the stored picture’s layer, zoom, place and scale', (id, m) => {
    const site = SITES.find((s) => s.id === id)!;
    expect(site.lat).toBe(m.latitude_deg);
    expect(site.lon_east).toBe(m.longitude_east_deg);
    const home = homeView(m.latitude_deg);
    expect(home.label).toBe(m.layer);
    expect(home.zooms[1]).toBe(m.zoom);
    expect(gridFor(m.latitude_deg)).toBe(m.grid);
    expect(metersPerPixelAt(m.grid, m.latitude_deg, m.zoom)).toBeCloseTo(m.meters_per_pixel, 1);
    expect(mapView(layerByLabel(m.layer)!, m.latitude_deg, m.longitude_east_deg, m.zoom).tiles).toHaveLength(m.tiles);
    // Moon Trek's own title is the caption's.
    expect(layerByLabel(m.layer)!.title).toBe(m.layer_title);
  });
});

describe('scale and captions', () => {
  it('rounds the scale bar to 1, 2 or 5', () => {
    expect(scaleBar(166.57)).toMatchObject({ meters: 20000, text: '20 km' });
    expect(scaleBar(166.57).viewPx).toBeCloseTo(120.07, 1);
    expect(scaleBar(66.89)).toMatchObject({ meters: 10000, text: '10 km' });
    expect(scaleBar(2)).toMatchObject({ meters: 200, text: '200 m' });
    expect(scaleBar(0.4)).toMatchObject({ meters: 50, text: '50 m' });
  });

  it('says the ground scale per pixel', () => {
    expect(perPixelText(166.57)).toBe('167 m per pixel');
    expect(perPixelText(5.3)).toBe('5.3 m per pixel');
    expect(perPixelText(5331)).toBe('5.3 km per pixel');
  });
});

describe('links out', () => {
  it('opens the site in Moon Trek with longitude in -180..180', () => {
    expect(moonTrekLink(-89.684, 196.739)).toBe('https://trek.nasa.gov/moon/#v=0.1&x=-163.261&y=-89.684&z=8&p=urn%3Aogc%3Adef%3Acrs%3AEPSG%3A%3A104903&d=&locale=&b=moon');
    expect(moonTrekLink(26.13239, 3.6333)).toBe('https://trek.nasa.gov/moon/#v=0.1&x=3.6333&y=26.13239&z=8&p=urn%3Aogc%3Adef%3Acrs%3AEPSG%3A%3A104903&d=&locale=&b=moon');
  });

  it('shows no QuickMap link until its format is set', () => {
    expect(QUICKMAP_URL_FORMAT).toBe('');
    expect(quickMapLink(26.13239, 3.6333)).toBeNull();
    expect(quickMapLink(-3.0128, 336.5781, 'https://quickmap.lroc.asu.edu/?lat={lat}&lon={lon}')).toBe('https://quickmap.lroc.asu.edu/?lat=-3.0128&lon=-23.4219');
  });

  it('asks Moon Trek for a slope layer’s own legend', () => {
    expect(legendUrl(layerByLabel('LRO_LOLA_ClrSlope_Global_16ppd')!)).toBe('https://trek.nasa.gov/moon/TrekWS/rest/cat/legend/stream?label=LRO_LOLA_ClrSlope_Global_16ppd');
  });
});

describe('live or stored', () => {
  it('is live once every tile is in', () => {
    expect(mapState(15, 3, false, false)).toBe('loading');
    expect(mapState(15, 15, false, false)).toBe('live');
  });
  it('keeps the stored picture when a tile fails or the time is up', () => {
    expect(mapState(15, 14, true, false)).toBe('stored');
    expect(mapState(15, 14, false, true)).toBe('stored');
    expect(mapState(0, 0, false, false)).toBe('stored');
  });
});
