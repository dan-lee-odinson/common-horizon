// The Sun's light across the Orbit picture: the lines of light and the glow at the frame's edge.
// Checked over a whole lunar day of the mock model, with the camera at both ends of its sway and
// zoomed in and out: every line runs along the Sun's direction, stops at the Moon and leaves the
// Moon's shadow empty, is never drawn across Earth's face, and keeps clear of the panels; the glow sits where the Sun's
// direction leaves the frame, clear of the panels, and only while the Sun is out of the frame.

import { describe, expect, it } from 'vitest';
import { geometryAt, TRANSIT_DAYS } from '../api/mock/model';
import { DAY_MS, HOUR_MS, SYNODIC_MONTH_DAYS } from '../util/time';
import { ORBIT_COLUMN_PX, ORBIT_VIEW, orbitCameraFrame, orbitCameraLongitude, orbitDistance, orbitZoomDistance, projectOrbit, projectOrbitPoint, worldPoint } from './orbitView';
import { clipLine, edgeGlow, glowBox, glowRadius, lineLevel, MIN_GLOW, sunExit, sunInFrame, SUNLIGHT, sunlightSheet, sunlightStrength, type Box, type Circle, type ScreenLine, type Segment } from './sunlight';

const LANDING = Date.UTC(2027, 1, 10, 15, 0, 0) + TRANSIT_DAYS * DAY_MS;

/** The panels of the desktop Orbit layout, as boxes: the tall wing at the right, Earth's panel at the lower left, the controls. */
function panels(width: number, height: number): Box[] {
  const column = ORBIT_COLUMN_PX - 40;
  return [
    { left: width - column, top: 76, right: width - 20, bottom: height - 40 },
    { left: 20, top: height - 335, right: column, bottom: height - 20 },
    { left: width / 2 - 320, top: height - 190, right: width / 2 + 320, bottom: height - 16 },
  ];
}

/** The picture at one instant: the lines of light as the scene would hand them to the HUD, the bodies and the Sun's point. */
function picture(tMs: number, width: number, height: number, zoom: number, swayDeg: number) {
  const g = geometryAt(tMs);
  const cameraLon = orbitCameraLongitude(g.subearth_lon_east, 'left', swayDeg);
  const distance = orbitZoomDistance(orbitDistance(width, height, false), zoom);
  const cam = orbitCameraFrame(cameraLon, ORBIT_VIEW.elevation, distance);
  const sun = worldPoint(g.subsolar_lat, g.subsolar_lon_east, 1);
  const project = (p: { x: number; y: number; z: number }) => projectOrbitPoint(p, cameraLon, ORBIT_VIEW.elevation, distance, width, height);
  const ahead = sun.x * cam.forward.x + sun.y * cam.forward.y + sun.z * cam.forward.z;
  const far = (sign: number) => project({ x: cam.position.x + sun.x * sign * 1e6, y: cam.position.y + sun.y * sign * 1e6, z: cam.position.z + sun.z * sign * 1e6 });
  const sunPoint = ahead > 1e-3 ? far(1) : null;
  const opposite = ahead < -1e-3 ? far(-1) : null;
  const sheet = sunlightSheet(sun, cam.position);
  const lines: (ScreenLine & { k: number })[] = [];
  for (const row of sheet.lines) {
    const a = project(row.point);
    const b = project({ x: row.point.x + sun.x * 0.5, y: row.point.y + sun.y * 0.5, z: row.point.z + sun.z * 0.5 });
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (a.depth <= 0 || len < 1e-6) continue;
    lines.push({ k: row.k, x: a.x, y: a.y, ux: (b.x - a.x) / len, uy: (b.y - a.y) / len, to: sunPoint ? Math.hypot(sunPoint.x - a.x, sunPoint.y - a.y) : Infinity, from: opposite ? -Math.hypot(opposite.x - a.x, opposite.y - a.y) : -Infinity });
  }
  const moonAt = project({ x: 0, y: 0, z: 0 });
  const earthAt = projectOrbit(g.subearth_lat, g.subearth_lon_east, ORBIT_VIEW.earthDistance, cameraLon, ORBIT_VIEW.elevation, distance, width, height);
  const moon: Circle = { x: moonAt.x, y: moonAt.y, r: moonAt.scale };
  const earth: Circle = { x: earthAt.x, y: earthAt.y, r: ORBIT_VIEW.earthRadius * earthAt.scale, shadow: false };
  const centreLine = lines.find((l) => l.k === 0)!;
  return { lines, moon, earth, sunPoint, strength: sunlightStrength(sheet.across), gapPx: SUNLIGHT.spacing * moonAt.scale, heading: { ux: centreLine.ux, uy: centreLine.uy }, frame: { left: 0, top: 0, right: width, bottom: height } as Box };
}

function along(piece: Segment, n = 8): { x: number; y: number }[] {
  return Array.from({ length: n + 1 }, (_, i) => ({ x: piece.x1 + ((piece.x2 - piece.x1) * i) / n, y: piece.y1 + ((piece.y2 - piece.y1) * i) / n }));
}

const inside = (p: { x: number; y: number }, b: Box, by = 0) => p.x > b.left - by && p.x < b.right + by && p.y > b.top - by && p.y < b.bottom + by;

for (const [width, height] of [
  [1440, 900],
  [1280, 720],
  [1920, 1080],
] as const) {
  describe(`sunlight at ${width} x ${height}, through a lunar day`, () => {
    const keep = panels(width, height);
    const cases: ReturnType<typeof picture>[] = [];
    for (let h = 0; h <= SYNODIC_MONTH_DAYS * 24; h += 9) {
      for (const zoom of [0, 1]) for (const sway of [-(ORBIT_VIEW.sway + ORBIT_VIEW.lean), ORBIT_VIEW.sway + ORBIT_VIEW.lean]) cases.push(picture(LANDING + h * HOUR_MS, width, height, zoom, sway));
    }

    it('is always drawn: in the standard view the Sun’s direction is never along the line of sight', () => {
      for (const c of cases) expect(c.strength).toBe(1);
    });

    it('never has the Sun in the frame in the standard view (it is at least 10 degrees outside)', () => {
      for (const c of cases) expect(sunInFrame(c.sunPoint, c.frame, 8)).toBe(false);
    });

    it('draws lines that stay in the frame, clear of every panel, and off the Moon and Earth', () => {
      let drawn = 0;
      const faults = new Set<string>();
      for (const c of cases) {
        for (const line of c.lines) {
          for (const piece of clipLine(line, c.frame, [c.moon, c.earth], keep)) {
            drawn++;
            if (Math.hypot(piece.x2 - piece.x1, piece.y2 - piece.y1) < SUNLIGHT.minLength - 1e-6) faults.add('a piece is too short to draw');
            for (const p of along(piece)) {
              if (!inside(p, c.frame, 1e-6)) faults.add('a line of light leaves the frame');
              for (const box of keep) if (inside(p, box, SUNLIGHT.margin - 1e-6)) faults.add('a line of light crosses a panel');
              for (const body of [c.moon, c.earth]) if (Math.hypot(p.x - body.x, p.y - body.y) < body.r + SUNLIGHT.bodyGap - 1e-6) faults.add('a line of light is drawn over the Moon or Earth');
            }
          }
        }
      }
      expect([...faults]).toEqual([]);
      expect(drawn).toBeGreaterThan(cases.length * 6);
    });

    it('leaves the Moon’s shadow empty (no line is drawn beyond the Moon), and gives Earth no shadow', () => {
      let inMoonShadow = 0;
      let beyondEarth = 0;
      for (const c of cases) {
        for (const line of c.lines) {
          for (const piece of clipLine(line, c.frame, [c.moon, c.earth], keep)) {
            for (const p of along(piece, 4)) {
              // From this point on toward the Sun, does the line meet the body? Then the body is between it and the Sun.
              const behind = (body: Circle) => {
                const ox = p.x - body.x;
                const oy = p.y - body.y;
                const b = ox * line.ux + oy * line.uy;
                const disc = b * b - (ox * ox + oy * oy - body.r * body.r);
                return disc > 0 && -b + Math.sqrt(disc) > 1e-6;
              };
              if (behind(c.moon)) inMoonShadow++;
              if (behind(c.earth)) beyondEarth++;
            }
          }
        }
      }
      expect(inMoonShadow).toBe(0);
      // Earth is drawn far nearer than it is: its real shadow reaches the Moon only in an eclipse, so
      // lines carry on beyond its disc (and around full moon they come out from behind it).
      expect(beyondEarth).toBeGreaterThan(100);
    });

    it('draws light at every instant of the lunar day, also with the Sun behind Earth as seen from the Moon', () => {
      for (const c of cases) {
        let drawn = 0;
        for (const line of c.lines) drawn += clipLine(line, c.frame, [c.moon, c.earth], keep).length;
        expect(drawn).toBeGreaterThan(4);
      }
    });

    it('ends the line through the Moon’s centre at the Moon’s sunward edge', () => {
      for (const c of cases) {
        const centre = c.lines.find((l) => l.k === 0)!;
        const pieces = clipLine(centre, c.frame, [c.moon], []);
        expect(pieces.length).toBe(1);
        const start = pieces[0];
        expect(Math.hypot(start.x1 - c.moon.x, start.y1 - c.moon.y)).toBeCloseTo(c.moon.r + SUNLIGHT.bodyGap, 6);
        // On the Sun's side of the Moon.
        expect((start.x1 - c.moon.x) * centre.ux + (start.y1 - c.moon.y) * centre.uy).toBeGreaterThan(0);
      }
    });

    it('heads every line for the Sun’s own point on screen, where its disc is drawn', () => {
      let checked = 0;
      for (const c of cases) {
        if (!c.sunPoint) continue;
        for (const line of c.lines) {
          const dx = c.sunPoint.x - line.x;
          const dy = c.sunPoint.y - line.y;
          const len = Math.hypot(dx, dy);
          expect((dx * line.ux + dy * line.uy) / len).toBeGreaterThan(0.999999);
          checked++;
        }
      }
      expect(checked).toBeGreaterThan(1000);
    });

    it('puts the glow where the Sun’s direction leaves the clear picture, clear of every panel', () => {
      let shown = 0;
      for (const c of cases) {
        const exit = sunExit(c.moon, c.heading, c.frame, keep);
        expect(exit).not.toBeNull();
        // On the frame's edge, or on the edge of a panel's clear margin; never inside one.
        const onFrame = Math.min(exit!.x - c.frame.left, c.frame.right - exit!.x, exit!.y - c.frame.top, c.frame.bottom - exit!.y);
        if (exit!.at === 'frame') expect(Math.abs(onFrame)).toBeLessThan(1e-6);
        for (const box of keep) expect(inside(exit!, box, SUNLIGHT.margin - 1e-6)).toBe(false);
        // The exit lies along the Sun's heading from the Moon.
        expect((exit!.x - c.moon.x) * c.heading.ux + (exit!.y - c.moon.y) * c.heading.uy).toBeGreaterThan(0);

        const glow = edgeGlow(c.moon, c.heading, c.sunPoint, 8, c.frame, keep);
        if (!glow) continue;
        shown++;
        expect(glow.radius).toBeGreaterThanOrEqual(MIN_GLOW);
        expect(glow.radius).toBeLessThanOrEqual(SUNLIGHT.glowRadius);
        expect(glow.box.left).toBeGreaterThanOrEqual(c.frame.left);
        expect(glow.box.top).toBeGreaterThanOrEqual(c.frame.top);
        expect(glow.box.right).toBeLessThanOrEqual(c.frame.right);
        expect(glow.box.bottom).toBeLessThanOrEqual(c.frame.bottom);
        // The light's centre is in its box (or on its edge), and the box touches no panel.
        expect(inside({ x: glow.x, y: glow.y }, glow.box, 0.6)).toBe(true);
        for (const box of keep) {
          const grown = { left: box.left - SUNLIGHT.margin, top: box.top - SUNLIGHT.margin, right: box.right + SUNLIGHT.margin, bottom: box.bottom + SUNLIGHT.margin };
          const overlap = glow.box.left < grown.right - 1e-6 && grown.left < glow.box.right - 1e-6 && glow.box.top < grown.bottom - 1e-6 && grown.top < glow.box.bottom - 1e-6;
          expect(overlap, 'the edge glow overlaps a panel').toBe(false);
        }
      }
      // The glow shows through most of the lunar day (it is left out only where panels leave it no room).
      expect(shown).toBeGreaterThan(cases.length * 0.6);
    });
  });
}

describe('the glow at the frame’s edge shows only while the Sun is outside the frame', () => {
  const frame: Box = { left: 0, top: 0, right: 1440, bottom: 900 };
  const moon = { x: 720, y: 450 };
  const heading = { ux: 0.6, uy: -0.8 };

  it('shows with the Sun beyond the frame’s edge, or behind the camera', () => {
    const outside = edgeGlow(moon, heading, { x: 720 + 0.6 * 900, y: 450 - 0.8 * 900 }, 7, frame, []);
    expect(outside).not.toBeNull();
    // It sits where the heading meets the top edge.
    expect(outside!.y).toBeCloseTo(0, 6);
    expect(outside!.x).toBeCloseTo(720 + (450 / 0.8) * 0.6, 6);
    expect(outside!.at).toBe('frame');
    expect(edgeGlow(moon, heading, null, 7, frame, [])).not.toBeNull();
  });

  it('is not drawn with the Sun inside the frame: the disc shows instead', () => {
    expect(edgeGlow(moon, heading, { x: 720 + 0.6 * 300, y: 450 - 0.8 * 300 }, 7, frame, [])).toBeNull();
    // Not even with only part of the disc showing at the edge.
    expect(edgeGlow(moon, { ux: 0, uy: -1 }, { x: 720, y: -5 }, 7, frame, [])).toBeNull();
    expect(edgeGlow(moon, { ux: 0, uy: -1 }, { x: 720, y: -9 }, 7, frame, [])).not.toBeNull();
  });

  it('knows when the Sun is in the frame', () => {
    expect(sunInFrame({ x: 10, y: 10 }, frame)).toBe(true);
    expect(sunInFrame({ x: -10, y: 10 }, frame)).toBe(false);
    expect(sunInFrame({ x: -5, y: 10 }, frame, 7)).toBe(true);
    expect(sunInFrame(null, frame)).toBe(false);
  });

  it('stops at a panel in its way, and its box is cut clear of that panel', () => {
    const panel: Box = { left: 1100, top: 80, right: 1420, bottom: 860 };
    const right = { ux: 1, uy: 0 };
    const exit = sunExit(moon, right, frame, [panel])!;
    expect(exit.at).toBe('panel');
    expect(exit.x).toBeCloseTo(1100 - SUNLIGHT.margin, 6);
    const box = glowBox(exit, 190, frame, [panel])!;
    expect(box.right).toBeCloseTo(1100 - SUNLIGHT.margin, 6);
    expect(box.left).toBeCloseTo(exit.x - 190, 6);
    // A second panel close below the exit point shortens the glow, so no hard edge hangs in the open picture.
    const below: Box = { left: 800, top: 560, right: 1200, bottom: 700 };
    const cut = glowBox(exit, 190, frame, [panel, below])!;
    expect(cut.bottom).toBeCloseTo(560 - SUNLIGHT.margin, 6);
    expect(glowRadius(exit, cut, frame, 190)).toBeCloseTo(560 - SUNLIGHT.margin - 450, 6);
    // The frame's own edge does not shorten it.
    expect(glowRadius({ x: 0, y: 450 }, { left: 0, top: 260, right: 190, bottom: 640 }, frame, 190)).toBe(190);
  });
});

describe('the lines of light as a row', () => {
  it('lies in a plane that holds the Sun’s direction and faces the camera, evenly spaced, with one line through the Moon’s centre', () => {
    const sun = worldPoint(-0.7, 45.9, 1);
    const cam = worldPoint(30, 136, 7);
    const sheet = sunlightSheet(sun, cam);
    expect(sheet.lines.length).toBe(SUNLIGHT.count * 2 + 1);
    const centre = sheet.lines.find((l) => l.k === 0)!;
    expect(Math.hypot(centre.point.x, centre.point.y, centre.point.z)).toBe(0);
    for (const line of sheet.lines) {
      // Each line's nearest point to the centre is square to the Sun's direction and to the line of sight.
      expect(line.point.x * sun.x + line.point.y * sun.y + line.point.z * sun.z).toBeCloseTo(0, 9);
      expect(line.point.x * cam.x + line.point.y * cam.y + line.point.z * cam.z).toBeCloseTo(0, 9);
      expect(Math.hypot(line.point.x, line.point.y, line.point.z)).toBeCloseTo(Math.abs(line.k) * SUNLIGHT.spacing, 9);
    }
  });

  it('fades out when seen end-on (the Sun straight behind the Moon, or behind the camera)', () => {
    const cam = worldPoint(30, 136, 7);
    expect(sunlightStrength(sunlightSheet(worldPoint(30, 136, 1), cam).across)).toBe(0);
    expect(sunlightStrength(sunlightSheet(worldPoint(-30, 316, 1), cam).across)).toBe(0);
    expect(sunlightStrength(sunlightSheet(worldPoint(0, 46, 1), cam).across)).toBe(1);
  });

  it('thins the row when the lines would crowd: every fourth line always stays, and no line moves', () => {
    for (const gap of [10, 20, 40, 64]) expect(lineLevel(0, gap)).toBe(1);
    expect(lineLevel(4, 12)).toBe(1);
    expect(lineLevel(-8, 12)).toBe(1);
    expect(lineLevel(1, 64)).toBe(1);
    expect(lineLevel(1, 20)).toBe(0);
    expect(lineLevel(2, 20)).toBeGreaterThan(0);
    expect(lineLevel(2, 12)).toBe(0);
    expect(lineLevel(-3, 64)).toBe(1);
  });

  it('cuts a line at a body drawn as an ellipse (Earth near the corner of the picture)', () => {
    const frame: Box = { left: 0, top: 0, right: 1000, bottom: 1000 };
    // An ellipse 300 long (along x) and 200 wide, centred at 500, 500.
    const body: Circle = { x: 500, y: 500, r: 100, long: { ux: 1, uy: 0, r: 150 } };
    const from = (x: number, y: number, ux: number, uy: number): ScreenLine => ({ x, y, ux, uy, from: -Infinity, to: Infinity });
    // A line down the long axis, heading right: only what is right of the ellipse is drawn.
    const axis = clipLine(from(0, 500, 1, 0), frame, [body], []);
    expect(axis.length).toBe(1);
    expect(axis[0].x1).toBeCloseTo(500 + 150 + SUNLIGHT.bodyGap, 6);
    // A line 120 above the centre misses the ellipse (half-width 100), though a circle of radius 150 would catch it.
    const above = clipLine(from(0, 380, 1, 0), frame, [body], []);
    expect(above[0].x1).toBeCloseTo(0, 6);
    expect(above[0].x2).toBeCloseTo(1000, 6);
    // A line across the short axis, heading down: only what is below the ellipse is drawn.
    const across = clipLine(from(500, 0, 0, 1), frame, [body], []);
    expect(across[0].y1).toBeCloseTo(500 + 100 + SUNLIGHT.bodyGap, 6);
  });
});
