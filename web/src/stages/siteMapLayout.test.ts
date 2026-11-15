// How the Site map panel shares its room, at the window sizes the browser tests use. The panel's
// room was measured on the Site stage at 1440 x 900: from below the top strip (114 to 131 px, as
// the strip's text wraps) down to the console's top (609 to 611 px; the Data checks band, which
// rests on the console, steps aside while the panel is open), and from 344.6 px to 1114.9 px across
// between the wings. The tighter of each is used here.

import { describe, expect, it } from 'vitest';
import { layerByLabel, VIEW_H, VIEW_W } from '../util/moonTrek';
import { legendSize, mapHeight, PANEL, panelFit } from './siteMapLayout';

/** The panel's room as SiteMap gives it: 6 px from the top strip and the console, 12 px from the wings. */
function roomAt(top: number, bottom: number, left: number, right: number) {
  return { room: bottom - top - 12, freeW: right - left - 24 };
}
const DESK = roomAt(131.3, 609.1, 344.6, 1114.9);
/** A shorter window: 316 px from the top strip to the console (1280 x 720 before the band came). */
const SMALL = roomAt(110.7, 427.1, 350.5, 940.8);
const TALL = layerByLabel('LRO_LOLA_ClrSlope_Global_16ppd')!.legend!;
const WIDE = layerByLabel('ColorSlope_LRO_LOLA_DEM_SPole875_5mp_v04')!.legend!;
const WIDER = layerByLabel('ColorSlope_10below_LRO_LOLA_DEM_SPole875_5m')!.legend!;

/** The panel's outer height with the map at its height and the rest as first guessed. */
function outerHeight(fit: ReturnType<typeof panelFit>): number {
  const mapH = mapHeight(fit, PANEL.chrome);
  const below = fit.legend?.placement === 'below' ? legendSize(fit.legend, mapH).height + PANEL.rowGap : 0;
  const column = PANEL.chrome + mapH + below + 2 * PANEL.pad;
  const legendColumn = fit.legend?.placement === 'side' ? fit.legend.height : 0;
  return Math.max(column, legendColumn) + 2 * PANEL.border;
}

describe('the Site map panel’s room at 1440 x 900', () => {
  it('draws a tall legend at 3x beside the map, the panel’s full height', () => {
    const fit = panelFit(DESK.room, DESK.freeW, TALL);
    expect(fit.legend).toEqual({ placement: 'side', scale: 3, width: 150, height: 450, ratio: 3 });
    expect(fit.bodyW).toBeGreaterThanOrEqual(400);
    expect(outerHeight(fit)).toBeLessThanOrEqual(DESK.room);
    // The whole panel within the free width.
    expect(PANEL.border * 2 + 150 + PANEL.gap + fit.bodyW + PANEL.pad).toBeLessThanOrEqual(DESK.freeW);
  });

  it.each([
    ['615 x 145', WIDE],
    ['1440 x 340', WIDER],
  ])('fits a wide legend (%s) below the map, whole, the map giving up the height', (_name, legend) => {
    const fit = panelFit(DESK.room, DESK.freeW, legend);
    expect(fit.legend?.placement).toBe('below');
    // Room for the four layer buttons on one line.
    expect(fit.bodyW).toBe(PANEL.minWide);
    expect(outerHeight(fit)).toBeLessThanOrEqual(DESK.room + 0.5);
    expect((mapHeight(fit, PANEL.chrome) * VIEW_W) / VIEW_H).toBeGreaterThanOrEqual(290);
    // However tall the rest turns out, the legend stays as wide as the map and the column still fits.
    for (const chrome of [PANEL.chrome, PANEL.chrome + 40]) {
      const mapH = mapHeight(fit, chrome);
      const drawn = legendSize(fit.legend!, mapH);
      expect(drawn.width).toBeCloseTo((mapH * VIEW_W) / VIEW_H, 9);
      expect(drawn.height).toBeCloseTo((drawn.width * legend.h) / legend.w, 9);
      expect(chrome + mapH + PANEL.rowGap + drawn.height).toBeLessThanOrEqual(fit.bodyH + 1e-9);
    }
  });

  it('without a legend, the map takes the room at 16:10', () => {
    const fit = panelFit(DESK.room, DESK.freeW, null);
    expect(fit.legend).toBeNull();
    expect(mapHeight(fit, PANEL.chrome)).toBeCloseTo((fit.bodyW * VIEW_H) / VIEW_W, 6);
    expect(outerHeight(fit)).toBeLessThanOrEqual(DESK.room + 0.5);
  });
});

describe('in a shorter window', () => {
  it('steps a tall legend down to the largest whole scale that fits (2x at 1280 x 720)', () => {
    const fit = panelFit(SMALL.room, SMALL.freeW, TALL);
    expect(fit.legend).toMatchObject({ placement: 'side', scale: 2, height: 300 });
    expect(outerHeight(fit)).toBeLessThanOrEqual(SMALL.room);
  });

  it('keeps 1x when nothing larger fits', () => {
    expect(panelFit(200, 700, TALL).legend).toMatchObject({ placement: 'side', scale: 1 });
  });

  it('on a phone, gives the map at least the narrowest column', () => {
    // The phone panel: 390 px wide less 12 px each side, from the top bar to the dock.
    const fit = panelFit(514, 366, TALL);
    expect(fit.legend?.scale).toBe(2);
    expect(fit.bodyW).toBeGreaterThanOrEqual(PANEL.minBody);
  });
});
