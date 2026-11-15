// The Orbit picture is laid out so the Sun, Earth and the Moon never collide with each other or
// with the side columns of panels. This checks the arithmetic over a whole lunar day of the mock
// model, with the camera at both ends of its sway.

import { describe, expect, it } from 'vitest';
import { geometryAt, TRANSIT_DAYS } from '../api/mock/model';
import { normalizeLon360, wrap180 } from '../util/geo';
import { DAY_MS, HOUR_MS, SYNODIC_MONTH_DAYS } from '../util/time';
import { ORBIT_COLUMN_PX, ORBIT_VIEW, orbitCameraLongitude, orbitDistance, orbitEarthSide, projectOrbit, ringRadii } from './orbitView';

const LANDING = Date.UTC(2027, 1, 10, 15, 0, 0) + TRANSIT_DAYS * DAY_MS;

function swingCentre(): number {
  const start = geometryAt(LANDING).subearth_lon_east;
  let lo = 0;
  let hi = 0;
  for (let h = 0; h <= SYNODIC_MONTH_DAYS * 24; h += 6) {
    const d = wrap180(geometryAt(LANDING + h * HOUR_MS).subearth_lon_east - start);
    lo = Math.min(lo, d);
    hi = Math.max(hi, d);
  }
  return normalizeLon360(start + (lo + hi) / 2);
}

for (const [width, height] of [
  [1440, 900],
  [1280, 720],
  [1920, 1080],
  [1024, 768],
] as const) {
  describe(`orbit picture at ${width} x ${height}`, () => {
    const distance = orbitDistance(width, height, false);
    // The camera is set by the middle of the range Earth's overhead longitude swings through.
    const earthLon0 = swingCentre();
    const radii = ringRadii(false);
    const offsets = [-(ORBIT_VIEW.sway + ORBIT_VIEW.lean), 0, ORBIT_VIEW.sway + ORBIT_VIEW.lean];
    const elevations = [ORBIT_VIEW.elevation - ORBIT_VIEW.lean, ORBIT_VIEW.elevation + ORBIT_VIEW.lean];

    it('keeps the Moon large and inside the frame', () => {
      const moon = projectOrbit(0, 0, 0, orbitCameraLongitude(earthLon0, 'right'), ORBIT_VIEW.elevation, distance, width, height);
      // Large on ordinary desktop widths; smaller, but still the main object, in a narrow window.
      expect(moon.scale * 2).toBeGreaterThan(height * (width >= 1280 ? 0.34 : 0.24));
      expect(moon.scale * 2).toBeLessThan(height * 0.5);
    });

    it('keeps the Sun on its ring between the side columns, all the way round', () => {
      for (const offset of offsets) {
        for (const el of elevations) {
          const cameraLon = orbitCameraLongitude(earthLon0, 'right', offset);
          for (let lon = 0; lon < 360; lon += 3) {
            const sun = projectOrbit(1.54, lon, radii[1], cameraLon, el, distance, width, height);
            const marker = 0.085 * sun.scale + 4;
            expect(sun.x - marker).toBeGreaterThan(ORBIT_COLUMN_PX - 40);
            expect(sun.x + marker).toBeLessThan(width - ORBIT_COLUMN_PX + 40);
          }
        }
      }
    });

    for (const side of ['left', 'right'] as const) {
    it(`keeps Earth behind the Moon and clear of its disc, in the frame, through a lunar day (Earth on the ${side})`, () => {
      for (const offset of offsets) {
        for (const el of elevations) {
          const cameraLon = orbitCameraLongitude(earthLon0, side, offset);
          const moon = projectOrbit(0, 0, 0, cameraLon, el, distance, width, height);
          for (let h = 0; h <= SYNODIC_MONTH_DAYS * 24; h += 6) {
            const g = geometryAt(LANDING + h * HOUR_MS);
            const earth = projectOrbit(g.subearth_lat, g.subearth_lon_east, ORBIT_VIEW.earthDistance, cameraLon, el, distance, width, height);
            const r = ORBIT_VIEW.earthRadius * earth.scale;
            // Farther from the camera than the Moon's centre: never between the camera and the Moon.
            expect(earth.depth).toBeGreaterThan(moon.depth + 1);
            // Its disc does not touch the Moon's disc.
            expect(Math.hypot(earth.x - moon.x, earth.y - moon.y)).toBeGreaterThan(moon.scale + r + 12);
            // Inside the frame, on its side.
            if (side === 'right') {
              expect(earth.x + r).toBeLessThan(width - 6);
              expect(earth.x - r).toBeGreaterThan(width / 2);
            } else {
              expect(earth.x - r).toBeGreaterThan(6);
              expect(earth.x + r).toBeLessThan(width / 2);
            }
            expect(earth.y - r).toBeGreaterThan(-height * 0.06);
            // Above the panel that sits under it (the lower 39 % of the height).
            expect(earth.y + r).toBeLessThan(height * 0.61);
          }
        }
      }
    });
    }
  });
}

describe('which side Earth stands on', () => {
  it('is the side from which the camera sees more of the sunlit Moon at the landing', () => {
    // Sun overhead 70 degrees east of Earth's overhead point: looking from the east shows the lit half.
    expect(orbitEarthSide({ subsolar_lon_east: 70, subearth_lon_east: 0 })).toBe('left');
    expect(orbitEarthSide({ subsolar_lon_east: 290, subearth_lon_east: 0 })).toBe('right');
    expect(orbitEarthSide(null)).toBe('right');
    for (const sun of [10, 100, 200, 300]) {
      const g = { subsolar_lon_east: sun, subearth_lon_east: 355 };
      const side = orbitEarthSide(g);
      const other = side === 'left' ? 'right' : 'left';
      const lit = (s: 'left' | 'right') => Math.cos(((sun - orbitCameraLongitude(355, s)) * Math.PI) / 180);
      expect(lit(side)).toBeGreaterThanOrEqual(lit(other));
    }
  });
});
