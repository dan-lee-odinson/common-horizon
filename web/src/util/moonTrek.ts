// NASA Moon Trek's public tile service: which tiles cover the ground around a site, where each one
// goes in the Site map, and the links out to Moon Trek. Ported from
// tools/site-context/moon_trek_tiles.py, which made the stored pictures in public/site-context/.
//
// Two grids, both 256-pixel tiles, row before column in the address:
//   SP  south polar stereographic on a 1,737,400 m sphere, metres, for latitudes at or below -60°.
//       One tile matrix for every polar layer: origin (-1,095,930 m, +1,095,930 m) at the top left,
//       8561.953125 m per pixel at zoom 0, halving with each zoom. 0° longitude points up. No wrap.
//   EQ  equirectangular, degrees, everywhere else. Top left (-180°, 90°), 180 / (256 * 2^zoom)
//       degrees per pixel, 2^(zoom+1) columns that wrap at 180°.
//
// The map is a 960 x 600 "view" (the size of the stored pictures) with the site at its centre.
// A view has a zoom: one view pixel is one tile pixel at that zoom. A layer that stops short of
// that zoom is drawn from its finest tiles, enlarged. EQ views are squeezed east-west by the
// cosine of the latitude, so distances at the site read the same both ways (as the stored
// pictures are).

export const R_MOON_M = 1_737_400;
export const TILE_PX = 256;
export const VIEW_W = 960;
export const VIEW_H = 600;
export const TREK_TILES = 'https://trek.nasa.gov/tiles/Moon';
/** The south polar grid is used at or below this latitude. */
export const SP_MAX_LAT = -60;
/** Half the width of the south polar tile matrix, metres. */
export const SP_HALF_M = 1_095_930;
/** Metres per pixel at zoom 0 in the south polar tile matrix. */
export const SP_M_PER_PX_Z0 = 8561.953125;
/** How long the map waits for every tile before it keeps the stored picture. */
export const TILE_TIMEOUT_MS = 6000;

/** Lunar QuickMap (LROC): the map is opened on a box this far either side of the site, metres. */
export const QUICKMAP_HALF_W_M = 150_000;
export const QUICKMAP_HALF_H_M = 73_000;

const DEG = Math.PI / 180;

export type Grid = 'EQ' | 'SP';
export type LayerKind = 'photo' | 'terrain' | 'slope' | 'slope10';

/** The layer buttons, in the order they are shown. */
export const LAYER_KINDS: readonly LayerKind[] = ['photo', 'terrain', 'slope', 'slope10'];
export const LAYER_NAMES: Record<LayerKind, string> = { photo: 'Photo', terrain: 'Terrain', slope: 'Slope', slope10: 'Under 10°' };

export interface TrekLayer {
  kind: LayerKind;
  grid: Grid;
  /** Moon Trek's own name for the layer: it goes in the tile address and the legend address. */
  label: string;
  ext: 'png' | 'jpg';
  maxZoom: number;
  /** South polar layers: the data reaches this far from the pole in x and in y, metres. */
  cover?: number;
  /** Moon Trek's own title for the layer, as its catalog gives it: the caption's title. */
  title: string;
  /** Said in the caption in place of the ground scale. */
  scaleNote?: string;
  /** Slope layers: the size of Moon Trek's own legend picture, pixels (as the service sent it on 15 November 2026). */
  legend?: { w: number; h: number };
}

/** Every layer the map can show. In each grid and kind the finest comes first. */
export const LAYERS: readonly TrekLayer[] = [
  { kind: 'photo', grid: 'SP', label: 'LRO_WAC_Mosaic_SPole60_100m_v02', ext: 'png', maxZoom: 5, cover: 1_095_600, title: 'LRO WAC Mosaic, S Pole v2' },
  { kind: 'terrain', grid: 'SP', label: 'LRO_LOLA_ClrShade_SPole875_5mp_v04', ext: 'png', maxZoom: 9, cover: 75_840, title: 'LRO LOLA DEM, S Pole, 87.5 deg, ColorHillshade' },
  { kind: 'terrain', grid: 'SP', label: 'LRO_LOLA_ClrShade_SPole75_30mp_v04', ext: 'png', maxZoom: 6, cover: 457_440, title: 'LRO LOLA DEM, S Pole, 75 deg, ColorHillshade' },
  { kind: 'terrain', grid: 'SP', label: 'LRO_LOLA_ClrShade_SPole45_100mp_v04', ext: 'png', maxZoom: 4, cover: 1_095_600, title: 'LRO LOLA DEM, S Pole, 45 deg, ColorHillshade' },
  { kind: 'slope', grid: 'SP', label: 'ColorSlope_LRO_LOLA_DEM_SPole875_5mp_v04', ext: 'png', maxZoom: 10, cover: 75_840, title: 'LRO LOLA Color Slope, S Pole, 87.5 deg', legend: { w: 615, h: 145 } },
  { kind: 'slope', grid: 'SP', label: 'LRO_LOLA_ClrSlope_SPole75S_120m', ext: 'png', maxZoom: 4, cover: 457_440, title: 'LOLA Slope Southpole 120m, Colorized', legend: { w: 50, h: 150 } },
  { kind: 'slope10', grid: 'SP', label: 'ColorSlope_10below_LRO_LOLA_DEM_SPole875_5m', ext: 'png', maxZoom: 10, cover: 75_840, title: 'LRO LOLA Color Slope < 10 deg, S Pole, 87.5 deg', legend: { w: 1440, h: 340 } },
  { kind: 'slope10', grid: 'SP', label: 'LOLA_RGB_Slope_below_10deg_SPole45', ext: 'png', maxZoom: 5, cover: 1_095_600, title: 'LRO LOLA Color Slope < 10 deg, S Pole', legend: { w: 615, h: 145 } },
  { kind: 'photo', grid: 'EQ', label: 'LRO_WAC_Mosaic_Global_303ppd_v02', ext: 'jpg', maxZoom: 8, title: 'LRO WAC Mosaic v2' },
  { kind: 'terrain', grid: 'EQ', label: 'LRO_LOLA_ClrShade_Global_128ppd_v04', ext: 'png', maxZoom: 5, title: 'LRO LOLA DEM, ColorHillshade' },
  { kind: 'slope', grid: 'EQ', label: 'LRO_LOLA_ClrSlope_Global_16ppd', ext: 'png', maxZoom: 2, title: 'LOLA Slope 16ppd, Colorized', scaleNote: 'regional, about 5 km per pixel', legend: { w: 50, h: 150 } },
];

export function layerByLabel(label: string): TrekLayer | undefined {
  return LAYERS.find((l) => l.label === label);
}

export function gridFor(lat: number): Grid {
  return lat <= SP_MAX_LAT ? 'SP' : 'EQ';
}

/** East longitude in -180 to 180. */
export function wrapLon(lonEast: number): number {
  return ((((lonEast + 180) % 360) + 360) % 360) - 180;
}

/** A point in the south polar grid, metres: x toward 90° E, y toward 0°. */
export function polarXY(lat: number, lonEast: number): { x: number; y: number } {
  const r = 2 * R_MOON_M * Math.tan(Math.PI / 4 + (lat * DEG) / 2);
  return { x: r * Math.sin(lonEast * DEG), y: r * Math.cos(lonEast * DEG) };
}

export function spMetersPerPixel(zoom: number): number {
  return SP_M_PER_PX_Z0 / 2 ** zoom;
}

export function eqDegreesPerPixel(zoom: number): number {
  return 180 / (TILE_PX * 2 ** zoom);
}

/** The site's position in the grid's pixels at a zoom, from the top left of the whole grid. */
export function sitePixel(grid: Grid, lat: number, lonEast: number, zoom: number): { x: number; y: number } {
  if (grid === 'EQ') {
    const dpp = eqDegreesPerPixel(zoom);
    return { x: (wrapLon(lonEast) + 180) / dpp, y: (90 - lat) / dpp };
  }
  const { x, y } = polarXY(lat, lonEast);
  const mpp = spMetersPerPixel(zoom);
  return { x: (x + SP_HALF_M) / mpp, y: (SP_HALF_M - y) / mpp };
}

/** How much an EQ view is squeezed east-west: cos(latitude). 1 for the polar grid. */
export function squeezeFor(grid: Grid, lat: number): number {
  return grid === 'EQ' ? Math.cos(lat * DEG) : 1;
}

/** How far a polar view reaches from the pole, metres: the largest |x| or |y| at its corners. */
export function polarReach(lat: number, lonEast: number, zoom: number): number {
  const { x, y } = polarXY(lat, lonEast);
  const mpp = spMetersPerPixel(zoom);
  return Math.max(Math.abs(x) + (VIEW_W / 2) * mpp, Math.abs(y) + (VIEW_H / 2) * mpp);
}

/** The finest layer of a kind whose data holds the whole view, or null when none does. */
export function chooseLayer(kind: LayerKind, lat: number, lonEast: number, zoom: number): TrekLayer | null {
  const grid = gridFor(lat);
  const candidates = LAYERS.filter((l) => l.kind === kind && l.grid === grid);
  if (grid === 'EQ') return candidates[0] ?? null;
  const reach = polarReach(lat, lonEast, zoom);
  return candidates.find((l) => (l.cover ?? 0) >= reach) ?? null;
}

/**
 * The view's three zooms (out, the stored picture's, in) and the stored picture's layer: the same
 * choice tools/site-context/make_site_context.py made, so the live tiles land on the stored
 * picture pixel for pixel.
 */
export function homeView(lat: number): { zooms: [number, number, number]; kind: LayerKind; label: string } {
  if (lat <= -87.5) return { zooms: [6, 7, 8], kind: 'terrain', label: 'LRO_LOLA_ClrShade_SPole875_5mp_v04' };
  if (lat <= SP_MAX_LAT) return { zooms: [4, 5, 6], kind: 'photo', label: 'LRO_WAC_Mosaic_SPole60_100m_v02' };
  return { zooms: [6, 7, 8], kind: 'photo', label: 'LRO_WAC_Mosaic_Global_303ppd_v02' };
}

/** The layer buttons a site has: kinds with data under the whole view at every zoom step (the widest is the test). */
export function siteKinds(lat: number, lonEast: number): LayerKind[] {
  const widest = homeView(lat).zooms[0];
  return LAYER_KINDS.filter((k) => chooseLayer(k, lat, lonEast, widest) !== null);
}

export function tileUrl(layer: TrekLayer, zoom: number, row: number, col: number): string {
  return `${TREK_TILES}/${layer.grid}/${layer.label}/1.0.0/default/default028mm/${zoom}/${row}/${col}.${layer.ext}`;
}

export interface TileSpot {
  /** Unique within a view. */
  key: string;
  url: string;
  zoom: number;
  row: number;
  /** The column in the address (wrapped at 180° on the EQ grid). */
  col: number;
  /** Top-left corner from the site, in view pixels before the east-west squeeze. */
  x: number;
  y: number;
  /** Width and height, view pixels before the squeeze. */
  size: number;
}

export interface MapView {
  layer: TrekLayer;
  /** The view's zoom. */
  zoom: number;
  /** The zoom of the tiles fetched: the view's, or the layer's finest when it stops short. */
  tileZoom: number;
  /** The site in the grid's pixels at the view's zoom. */
  pixel: { x: number; y: number };
  squeeze: number;
  tiles: TileSpot[];
  /** Ground metres per view pixel at the site. */
  metersPerViewPx: number;
  /** Ground metres per pixel of the layer's own tiles at the site. */
  metersPerDataPx: number;
}

/** Ground metres per pixel at the site, at a zoom (north-south for EQ; the stereographic scale for SP). */
export function metersPerPixelAt(grid: Grid, lat: number, zoom: number): number {
  if (grid === 'EQ') return (eqDegreesPerPixel(zoom) * Math.PI * R_MOON_M) / 180;
  const k = 2 / (1 + Math.sin(Math.abs(lat) * DEG));
  return spMetersPerPixel(zoom) / k;
}

/** Every tile under the view of a layer at a zoom, and where each goes. */
export function mapView(layer: TrekLayer, lat: number, lonEast: number, zoom: number): MapView {
  const grid = layer.grid;
  const tileZoom = Math.min(zoom, layer.maxZoom);
  const s = 2 ** (zoom - tileZoom);
  const squeeze = squeezeFor(grid, lat);
  const at = sitePixel(grid, lat, lonEast, tileZoom);
  // The view in tile pixels: wider than 960 / s before the squeeze on the EQ grid.
  const halfW = VIEW_W / squeeze / s / 2;
  const halfH = VIEW_H / s / 2;
  const n = 2 ** tileZoom;
  const cols = grid === 'EQ' ? 2 * n : n;
  const tiles: TileSpot[] = [];
  const first = (v: number) => Math.floor(v / TILE_PX);
  const last = (v: number) => Math.ceil(v / TILE_PX) - 1;
  for (let row = first(at.y - halfH); row <= last(at.y + halfH); row++) {
    if (row < 0 || row >= n) continue;
    for (let c = first(at.x - halfW); c <= last(at.x + halfW); c++) {
      // The global grid wraps at 180°: column 2^(zoom+1) is column 0 again. The polar grid does not wrap.
      const col = grid === 'EQ' ? ((c % cols) + cols) % cols : c;
      if (col < 0 || col >= cols) continue;
      tiles.push({
        key: `${tileZoom}/${row}/${c}`,
        url: tileUrl(layer, tileZoom, row, col),
        zoom: tileZoom,
        row,
        col,
        x: (c * TILE_PX - at.x) * s,
        y: (row * TILE_PX - at.y) * s,
        size: TILE_PX * s,
      });
    }
  }
  return {
    layer,
    zoom,
    tileZoom,
    pixel: sitePixel(grid, lat, lonEast, zoom),
    squeeze,
    tiles,
    metersPerViewPx: metersPerPixelAt(grid, lat, zoom),
    metersPerDataPx: metersPerPixelAt(grid, lat, tileZoom),
  };
}

/** A round length for the scale bar: the longest 1, 2 or 5 times a power of ten that fits. */
export function scaleBar(metersPerViewPx: number, maxViewPx = 180): { meters: number; viewPx: number; text: string } {
  const most = metersPerViewPx * maxViewPx;
  let meters = 1;
  for (let p = 10 ** Math.floor(Math.log10(most)); p >= 1e-3; p /= 10) {
    const pick = [5, 2, 1].map((m) => m * p).find((m) => m <= most);
    if (pick !== undefined) {
      meters = pick;
      break;
    }
  }
  return { meters, viewPx: meters / metersPerViewPx, text: lengthText(meters) };
}

export function lengthText(meters: number): string {
  if (meters >= 1000) return `${Number((meters / 1000).toPrecision(3))} km`;
  return `${Number(meters.toPrecision(3))} m`;
}

/** "167 m per pixel", "1.3 km per pixel". */
export function perPixelText(meters: number): string {
  if (meters >= 1000) return `${Number((meters / 1000).toFixed(1))} km per pixel`;
  return `${meters >= 10 ? Math.round(meters) : Number(meters.toFixed(1))} m per pixel`;
}

/** A coordinate for a link: at most five decimals, no trailing zeros. */
function coord(v: number): string {
  return String(Number(v.toFixed(5)));
}

/** The same place in NASA Moon Trek's own viewer. */
export function moonTrekLink(lat: number, lonEast: number): string {
  return `https://trek.nasa.gov/moon/#v=0.1&x=${coord(wrapLon(lonEast))}&y=${coord(lat)}&z=8&p=urn%3Aogc%3Adef%3Acrs%3AEPSG%3A%3A104903&d=&locale=&b=moon`;
}

/**
 * The site in Lunar QuickMap's own map coordinates, metres on a 1,737,400 m sphere:
 *  - south of 70° S, its south polar stereographic map (proj 27): the polar grid's x and y;
 *  - from 70° S to 75° N, its equirectangular map (proj 16): x = R * longitude (-180..180), y = R * latitude, in radians;
 *  - north of 75° N, none (no link).
 */
export function quickMapPoint(lat: number, lonEast: number): { proj: 16 | 27; x: number; y: number } | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lonEast) || lat > 75) return null;
  if (lat < -70) return { proj: 27, ...polarXY(lat, lonEast) };
  return { proj: 16, x: R_MOON_M * wrapLon(lonEast) * DEG, y: R_MOON_M * lat * DEG };
}

/** The same place in Lunar QuickMap (LROC), on a 300 x 146 km box around the site, or null north of 75° N. */
export function quickMapLink(lat: number, lonEast: number): string | null {
  const p = quickMapPoint(lat, lonEast);
  if (!p) return null;
  const box = [p.x - QUICKMAP_HALF_W_M, p.y - QUICKMAP_HALF_H_M, p.x + QUICKMAP_HALF_W_M, p.y + QUICKMAP_HALF_H_M].map((v) => Math.round(v));
  return `https://quickmap.lroc.im-ldi.com/?prjExtent=${box.join('%2C')}&proj=${p.proj}`;
}

/** Moon Trek's own legend picture for a layer. */
export function legendUrl(layer: TrekLayer): string {
  return `https://trek.nasa.gov/moon/TrekWS/rest/cat/legend/stream?label=${encodeURIComponent(layer.label)}`;
}

export function isSlope(kind: LayerKind): boolean {
  return kind === 'slope' || kind === 'slope10';
}

/** The 17 preset sites with a stored picture in public/site-context/. */
export const STORED_PICTURE_IDS: ReadonlySet<string> = new Set([
  'shackleton-ridge',
  'nobile',
  'apollo-11',
  'apollo-12',
  'apollo-14',
  'apollo-15',
  'apollo-16',
  'apollo-17',
  'im-1-odysseus',
  'im-2-athena',
  'blue-ghost-m1',
  'im-3-reiner-gamma',
  'blue-ghost-m2',
  'blue-ghost-m3',
  'draper-cp12',
  'chandrayaan-3',
  'slim',
]);

/** Where the stored picture for a site is, relative to the page (the build is served from any folder). */
export function storedPictureUrl(siteId: string): string | null {
  return STORED_PICTURE_IDS.has(siteId) ? `site-context/${siteId}.jpg` : null;
}

export type MapState = 'loading' | 'live' | 'stored';

/** Live once every tile is in; the stored picture as soon as one fails or the time is up. */
export function mapState(tileCount: number, loaded: number, failed: boolean, timedOut: boolean): MapState {
  if (failed || tileCount === 0) return 'stored';
  if (loaded >= tileCount) return 'live';
  return timedOut ? 'stored' : 'loading';
}
