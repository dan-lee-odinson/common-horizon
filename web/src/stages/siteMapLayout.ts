// How the Site map panel shares its room between the map and Moon Trek's legend.
//
// The panel has a fixed room: the free part of the window (the stage measures it). Everything in
// it must be seen without scrolling, the legend whole. Two kinds of legend come from Moon Trek:
//  - tall ones (50 x 150 px, pixel lettering): drawn at a whole multiple, 3x where the room's
//    height allows, so the lettering stays sharp, in a column the panel's full height, beside
//    the map. Never below it: 450 px is nearly the whole height of the room at 1440 x 900.
//  - wide ones (615 x 145, 1440 x 340): drawn below the map, as wide as the map; the map gives
//    up the height they take.
// The map itself is 16:10. Its height is what the room leaves once the rest of the panel
// (heading, layer buttons, caption, links, legend) is measured: see MapPanel in SiteMap.tsx.

import { VIEW_H, VIEW_W } from '../util/moonTrek';

export const PANEL = {
  /** Glass border, px. */
  border: 1,
  /** Padding inside the panel (p-3), px. */
  pad: 12,
  /** Between the legend column and the map's column (gap-3), px. */
  gap: 12,
  /** Between rows in the map's column (gap-2), px. */
  rowGap: 8,
  /** The column's height besides the map and a legend, as first guessed: heading, layer buttons, caption, links and the gaps between. Measured once drawn. */
  chrome: 166,
  /** The widest the map's column gets, px. */
  maxBody: 456,
  /** The narrowest the map's column may be made to leave room for a tall legend, px. */
  minBody: 200,
  /** The narrowest the map's column is made without a legend, px. */
  minBare: 248,
  /** The narrowest the map's column is made with a wide legend: room for the four layer buttons on one line (328 px), px. */
  minWide: 340,
} as const;

export interface LegendSize {
  w: number;
  h: number;
}

export interface LegendFit {
  placement: 'side' | 'below';
  /** Drawn size over natural size: a whole number for a tall legend. */
  scale: number;
  width: number;
  height: number;
  /** Natural height over natural width. A wide legend is drawn as wide as the map: legendSize gives its size then. */
  ratio: number;
}

export interface PanelFit {
  /** Width of the map's column, px. */
  bodyW: number;
  /** Height the map's column may take, px. */
  bodyH: number;
  legend: LegendFit | null;
}

/**
 * The map's column and the legend for a panel at most `room` tall and `freeW` wide (outer sizes,
 * px). A tall legend gets the largest whole scale, 3x at most, whose height fits the panel's inner
 * height and leaves the map's column at least PANEL.minBody wide.
 */
export function panelFit(room: number, freeW: number, legend: LegendSize | null): PanelFit {
  const { border, pad, gap, rowGap, chrome, maxBody, minBody, minBare, minWide } = PANEL;
  const innerH = room - 2 * border;
  const bodyH = innerH - 2 * pad;
  const byHeight = (bodyH - chrome) * (VIEW_W / VIEW_H);
  if (!legend) {
    const most = freeW - 2 * border - 2 * pad;
    return { bodyW: Math.max(Math.min(minBare, most), Math.min(maxBody, most, byHeight)), bodyH, legend: null };
  }
  if (legend.h > legend.w) {
    // In a column flush with the panel's inner edge (its own white ground), beside the map's column.
    for (const scale of [3, 2, 1]) {
      const width = legend.w * scale;
      const height = legend.h * scale;
      const most = freeW - 2 * border - width - gap - pad;
      if (scale > 1 && (height > innerH || most < minBody)) continue;
      return { bodyW: Math.max(0, Math.min(maxBody, most, byHeight)), bodyH, legend: { placement: 'side', scale, width, height, ratio: legend.h / legend.w } };
    }
  }
  // Below the map, the map's width: the two share the height left by the rest. The column stays
  // wide enough for the layer buttons on one line; the map may then be narrower than it.
  const ratio = legend.h / legend.w;
  const most = freeW - 2 * border - 2 * pad;
  const bodyW = Math.max(Math.min(minWide, most), Math.min(maxBody, most, (bodyH - chrome - rowGap) / (VIEW_H / VIEW_W + ratio)));
  return { bodyW, bodyH, legend: { placement: 'below', scale: bodyW / legend.w, width: bodyW, height: bodyW * ratio, ratio } };
}

/**
 * The map's height in its column: as wide as the column at 16:10, or what the height leaves.
 * `chrome` is the column's height besides the map and a wide legend (measured once drawn). A wide
 * legend is as wide as the map, so the two share what is left: map + gap + legend = the rest.
 */
export function mapHeight(fit: PanelFit, chrome: number): number {
  const below = fit.legend?.placement === 'below' ? fit.legend : null;
  const byHeight = (fit.bodyH - chrome - (below ? PANEL.rowGap : 0)) / (1 + (below ? (VIEW_W / VIEW_H) * below.ratio : 0));
  return Math.max(80, Math.min((fit.bodyW * VIEW_H) / VIEW_W, byHeight));
}

/** The size a legend is drawn at, once the map's height is known. */
export function legendSize(legend: LegendFit, mapH: number): { width: number; height: number; scale: number } {
  if (legend.placement === 'side') return { width: legend.width, height: legend.height, scale: legend.scale };
  const width = (mapH * VIEW_W) / VIEW_H;
  return { width, height: width * legend.ratio, scale: legend.width > 0 ? (legend.scale * width) / legend.width : 0 };
}
