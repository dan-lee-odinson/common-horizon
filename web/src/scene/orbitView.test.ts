// The Orbit picture is laid out so the Sun's tick, Earth and the Moon never collide with each other or
// with the side columns of panels. This checks the arithmetic over a whole lunar day of the mock
// model, with the camera at both ends of its sway.

import { describe, expect, it } from 'vitest';
import { geometryAt, TRANSIT_DAYS } from '../api/mock/model';
import { normalizeLon360, wrap180 } from '../util/geo';
import { DAY_MS, HOUR_MS, SYNODIC_MONTH_DAYS } from '../util/time';
import { EARTH_RADIUS_KM, MOON_RADIUS_KM } from '../util/bodies';
import { hitBall, ORBIT_COLUMN_PX, ORBIT_VIEW, orbitCameraFrame, orbitCameraLongitude, orbitDistance, orbitEarthSide, orbitRay, orbitZoomDistance, projectOrbit, projectOrbitPoint, ringRadii, SUN_TICK, worldPoint } from './orbitView';

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

    it('keeps the Sun’s tick on its ring between the side columns, all the way round', () => {
      for (const offset of offsets) {
        for (const el of elevations) {
          const cameraLon = orbitCameraLongitude(earthLon0, 'right', offset);
          for (let lon = 0; lon < 360; lon += 3) {
            // The tick lies in the ring's plane and reaches a little outside the ring.
            const tick = projectOrbit(0, lon, radii[1] + SUN_TICK.outer, cameraLon, el, distance, width, height);
            expect(tick.x - 4).toBeGreaterThan(ORBIT_COLUMN_PX - 40);
            expect(tick.x + 4).toBeLessThan(width - ORBIT_COLUMN_PX + 40);
          }
        }
      }
    });

    it('draws Earth at true size behind the Moon, its limb filling the top-left corner, clear of the Moon, through a lunar day', () => {
      for (const offset of offsets) {
        for (const el of elevations) {
          for (let h = 0; h <= SYNODIC_MONTH_DAYS * 24; h += 6) {
            const g = geometryAt(LANDING + h * HOUR_MS);
            // The camera follows the longitude Earth is over at that instant, so Earth keeps its place
            // from side to side and only its latitude and the camera's own sway move it.
            const cameraLon = orbitCameraLongitude(g.subearth_lon_east, 'left', offset);
            const moon = projectOrbit(0, 0, 0, cameraLon, el, distance, width, height);
            const earth = projectOrbit(g.subearth_lat, g.subearth_lon_east, ORBIT_VIEW.earthDistance, cameraLon, el, distance, width, height);
            const r = ORBIT_VIEW.earthRadius * earth.scale;
            // Farther from the camera than the Moon's centre: never between the camera and the Moon.
            expect(earth.depth).toBeGreaterThan(moon.depth + 1);
            // Visibly larger than the Moon on screen, although it is farther away.
            expect(r).toBeGreaterThan(moon.scale * 1.4);
            // Its disc does not touch the Moon's disc.
            expect(Math.hypot(earth.x - moon.x, earth.y - moon.y)).toBeGreaterThan(moon.scale + r + 12);
            // A limb in the top-left corner: the disc runs off the top and off the left of the window,
            // and covers the corner of the picture under the navigation.
            expect(earth.x - r).toBeLessThan(0);
            expect(earth.y - r).toBeLessThan(0);
            expect(Math.hypot(earth.x - 60, earth.y - 110)).toBeLessThan(r);
            // The rest of it is off screen: it never reaches the middle of the picture.
            expect(earth.x + r).toBeLessThan(width / 2);
          }
        }
      }
    });

    it('brings the whole Earth into view when zoomed all the way out, still clear of the Moon', () => {
      const far = orbitZoomDistance(distance, 1);
      for (const offset of offsets) {
        for (const el of elevations) {
          for (let h = 0; h <= SYNODIC_MONTH_DAYS * 24; h += 6) {
            const g = geometryAt(LANDING + h * HOUR_MS);
            const cameraLon = orbitCameraLongitude(g.subearth_lon_east, 'left', offset);
            const moon = projectOrbit(0, 0, 0, cameraLon, el, far, width, height);
            const earth = projectOrbit(g.subearth_lat, g.subearth_lon_east, ORBIT_VIEW.earthDistance, cameraLon, el, far, width, height);
            const r = ORBIT_VIEW.earthRadius * earth.scale;
            expect(earth.x - r).toBeGreaterThan(0);
            expect(earth.y - r).toBeGreaterThan(0);
            expect(earth.x + r).toBeLessThan(width);
            expect(earth.y + r).toBeLessThan(height);
            expect(Math.hypot(earth.x - moon.x, earth.y - moon.y)).toBeGreaterThan(moon.scale + r + 12);
            expect(r).toBeGreaterThan(moon.scale * 1.4);
          }
        }
      }
    });
  });
}

describe('zooming in Orbit', () => {
  it('runs from the usual distance to the whole-Earth distance and no further', () => {
    expect(orbitZoomDistance(7, 0)).toBe(7);
    expect(orbitZoomDistance(7, 1)).toBeCloseTo(7 * ORBIT_VIEW.zoomOut, 9);
    expect(orbitZoomDistance(7, -3)).toBe(7);
    expect(orbitZoomDistance(7, 9)).toBeCloseTo(7 * ORBIT_VIEW.zoomOut, 9);
  });
  it('draws Earth to scale with the Moon', () => {
    expect(ORBIT_VIEW.earthRadius).toBeCloseTo(EARTH_RADIUS_KM / MOON_RADIUS_KM, 3);
  });
});

describe('which side Earth stands on', () => {
  it('is always the left, so its limb fills the top-left corner', () => {
    expect(orbitEarthSide({ subsolar_lon_east: 70, subearth_lon_east: 0 })).toBe('left');
    expect(orbitEarthSide({ subsolar_lon_east: 290, subearth_lon_east: 0 })).toBe('left');
    expect(orbitEarthSide(null)).toBe('left');
  });
});

describe('lines of sight through the Orbit picture', () => {
  const cameraLon = 136;
  const distance = 7;
  it('run from the camera through the pixel a point lands on', () => {
    for (const p of [worldPoint(10, 40, 1), worldPoint(-50, 200, 3), worldPoint(2, 353, 11.5)]) {
      const at = projectOrbitPoint(p, cameraLon, ORBIT_VIEW.elevation, distance, 1440, 900);
      const ray = orbitRay(at.x, at.y, cameraLon, ORBIT_VIEW.elevation, distance, 1440, 900);
      const cam = orbitCameraFrame(cameraLon, ORBIT_VIEW.elevation, distance).position;
      const to = { x: p.x - cam.x, y: p.y - cam.y, z: p.z - cam.z };
      const len = Math.hypot(to.x, to.y, to.z);
      expect(ray.dir.x).toBeCloseTo(to.x / len, 9);
      expect(ray.dir.y).toBeCloseTo(to.y / len, 9);
      expect(ray.dir.z).toBeCloseTo(to.z / len, 9);
    }
  });
  it('meet the Moon at the middle of the picture on the side facing the camera, and miss it at the corner', () => {
    const middle = orbitRay(720, 450, cameraLon, ORBIT_VIEW.elevation, distance, 1440, 900);
    const n = hitBall(middle.origin, middle.dir, { x: 0, y: 0, z: 0 }, 1)!;
    const cam = worldPoint(ORBIT_VIEW.elevation, cameraLon, 1);
    expect(n.x).toBeCloseTo(cam.x, 9);
    expect(n.y).toBeCloseTo(cam.y, 9);
    expect(n.z).toBeCloseTo(cam.z, 9);
    const corner = orbitRay(5, 5, cameraLon, ORBIT_VIEW.elevation, distance, 1440, 900);
    expect(hitBall(corner.origin, corner.dir, { x: 0, y: 0, z: 0 }, 1)).toBeNull();
  });
});
