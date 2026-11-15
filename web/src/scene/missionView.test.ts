// Mission select keeps the spotlight site's marker and its name tag clear of the glass panels.
// This checks the arithmetic for every latitude a site can have, at three window sizes, with the
// drawer open or closed and the assistant's history open or closed. (A browser test checks the
// real screen: e2e/path.spec.ts.)

import { describe, expect, it } from 'vitest';
import { MISSION_VIEW, missionCameraLatitude, missionDistance, placeSite, siteOnScreen, tagBox, type Rect } from './missionView';

const REM = 16;

/**
 * What the panels leave free, from the layout of src/stages/MissionHud.tsx: the spotlight column
 * (20 px in, 25rem wide), the mission bar (from 4.75rem down; taller when its lines wrap), the
 * assistant along the bottom (20 px up, 54 px tall, and its history on top when open) and the
 * drawer (20 px in, 23rem wide) when open.
 */
function freeArea(width: number, height: number, drawerOpen: boolean, historyOpen: boolean): Rect {
  // The bar's dates fit one line in a wide bar and wrap to two, then three, as it narrows.
  const barWidth = width - 27.5 * REM - (drawerOpen ? 25 : 18.5) * REM;
  const barHeight = barWidth >= 700 ? 175 : barWidth >= 500 ? 197 : 219;
  const top = 4.75 * REM + barHeight;
  // The history's height limit, as in src/styles/index.css (.chat-panel).
  const history = Math.min(0.4 * height, Math.max(12.25 * REM, 0.825 * height - top - 6.5 * REM));
  return {
    left: 20 + 25 * REM,
    top,
    right: drawerOpen ? width - 20 - 23 * REM : width,
    bottom: height - 20 - 54 - (historyOpen ? history : 0),
  };
}

/** The marker's reticle and the tag, as boxes on screen. */
function boxes(p: ReturnType<typeof placeSite>, tagWidth: number): { reticle: Rect; tag: Rect } {
  const t = tagBox(p.toward, p.ringRadius, tagWidth);
  return {
    reticle: { left: p.x - p.reticleRadius, right: p.x + p.reticleRadius, top: p.y - p.reticleRadius, bottom: p.y + p.reticleRadius },
    tag: { left: p.x + t.left, right: p.x + t.right, top: p.y + t.top, bottom: p.y + t.bottom },
  };
}

function inside(box: Rect, area: Rect, margin: number): boolean {
  return box.left >= area.left + margin - 1e-6 && box.right <= area.right - margin + 1e-6 && box.top >= area.top + margin - 1e-6 && box.bottom <= area.bottom - margin + 1e-6;
}

const SIZES = [
  [1440, 900],
  [1280, 720],
  [1920, 1080],
] as const;
/** A short name ("Apollo 14") and the longest the tag shows (28 characters). */
const TAG_WIDTHS = [91, 252];
const LATITUDES = Array.from({ length: 37 }, (_, i) => -90 + i * 5);

describe('where a site sits in the mission-select picture', () => {
  it('is dead centre within the latitude limit and toward the top or bottom beyond it', () => {
    const d = missionDistance(1440, 900, false);
    for (const lat of [-58, -30, 0, 30, 58]) expect(siteOnScreen(lat, d, 900).dy).toBeCloseTo(0, 9);
    expect(missionCameraLatitude(-89.7)).toBe(-58);
    expect(missionCameraLatitude(72)).toBe(58);
    // South of the limit the marker is below the centre, north of it above, and further out the nearer the pole.
    expect(siteOnScreen(-70, d, 900).dy).toBeGreaterThan(0);
    expect(siteOnScreen(70, d, 900).dy).toBeLessThan(0);
    expect(siteOnScreen(-90, d, 900).dy).toBeGreaterThan(siteOnScreen(-70, d, 900).dy);
    // A polar site still faces the camera: it is inside the Moon's disc (one Moon radius is `scale` pixels at the centre).
    const centreScale = 900 / 2 / Math.tan((34 * Math.PI) / 360) / d;
    expect(siteOnScreen(-90, d, 900).dy).toBeLessThan(centreScale);
  });

  it('keeps the usual picture when nothing is in the way', () => {
    for (const [width, height] of SIZES) {
      const p = placeSite({ width, height, free: freeArea(width, height, false, false), siteLat: 0, tagWidth: 91 });
      expect(p.shiftX).toBeCloseTo(width * MISSION_VIEW.shiftShare, 6);
      expect(p.shiftY).toBeCloseTo(0, 6);
      expect(p.clear).toBe(true);
      // The tag sits up and to the right; in the shortest window, where the bar is close above, beside the marker.
      expect(p.toward).toBe(height >= 900 ? 40 : 90);
    }
    // Before anything is measured, and with no site: the usual picture too.
    expect(placeSite({ width: 1440, height: 900, free: null, siteLat: -89.7, tagWidth: 252 }).shiftY).toBe(0);
    expect(placeSite({ width: 1440, height: 900, free: freeArea(1440, 900, true, true), siteLat: null, tagWidth: 0 }).shiftX).toBeCloseTo(1440 * MISSION_VIEW.shiftShare, 6);
  });

  for (const [width, height] of SIZES) {
    for (const drawerOpen of [false, true]) {
      for (const historyOpen of [false, true]) {
        it(`keeps the marker and its tag clear of the panels at ${width} x ${height}${drawerOpen ? ', drawer open' : ''}${historyOpen ? ', history open' : ''}`, () => {
          const free = freeArea(width, height, drawerOpen, historyOpen);
          for (const tagWidth of TAG_WIDTHS) {
            for (const siteLat of LATITUDES) {
              const p = placeSite({ width, height, free, siteLat, tagWidth });
              const { reticle, tag } = boxes(p, tagWidth);
              const where = `lat ${siteLat}, tag ${tagWidth}`;
              expect(p.clear, where).toBe(true);
              expect(inside(reticle, free, MISSION_VIEW.margin), `reticle, ${where}`).toBe(true);
              expect(inside(tag, free, MISSION_VIEW.margin), `tag, ${where}`).toBe(true);
              // The tag never lies over the reticle's ring.
              const overRing = tag.left < p.x + p.ringRadius && tag.right > p.x - p.ringRadius && tag.top < p.y + p.ringRadius && tag.bottom > p.y - p.ringRadius;
              expect(overRing, `tag over the ring, ${where}`).toBe(false);
              // The shift is where the marker lands: nothing else moves the picture.
              expect(p.x).toBeCloseTo(width / 2 + p.shiftX, 6);
              expect(p.y).toBeCloseTo(height / 2 + siteOnScreen(siteLat, missionDistance(width, height, false), height).dy - p.shiftY, 6);
            }
          }
        });
      }
    }
  }

  it('moves the tag to the other side, not the picture, when the drawer opens beside a long name', () => {
    const closed = placeSite({ width: 1440, height: 900, free: freeArea(1440, 900, false, false), siteLat: -30, tagWidth: 252 });
    const open = placeSite({ width: 1440, height: 900, free: freeArea(1440, 900, true, false), siteLat: -30, tagWidth: 252 });
    expect(closed.toward).toBe(40);
    expect(open.toward).toBe(-40);
    expect(open.shiftX).toBeCloseTo(closed.shiftX, 6);
    expect(open.shiftY).toBeCloseTo(closed.shiftY, 6);
  });

  it('moves the picture by no more than it must', () => {
    // A site at the north pole sits high on the Moon, under the mission bar: the picture comes
    // down until the reticle's top is one margin below the bar, and no further.
    const free = freeArea(1440, 900, false, false);
    const p = placeSite({ width: 1440, height: 900, free, siteLat: 90, tagWidth: 91 });
    expect(p.shiftY).toBeLessThan(0);
    expect(p.y - p.reticleRadius).toBeCloseTo(free.top + MISSION_VIEW.margin, 6);
    expect(p.shiftX).toBeCloseTo(1440 * MISSION_VIEW.shiftShare, 6);
  });

  it('says so, and sits in the middle, when the free area cannot hold the marker', () => {
    const free = { left: 440, top: 300, right: 1420, bottom: 380 };
    const p = placeSite({ width: 1440, height: 900, free, siteLat: 0, tagWidth: 91 });
    expect(p.clear).toBe(false);
    expect(p.y).toBeCloseTo((free.top + free.bottom) / 2, 6);
  });
});
