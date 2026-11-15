// Earth in the Orbit stage: lit from the Sun's direction, dark on its night side, showing NASA's
// map and turning once a day.
//
// The fault this guards: at 2027-02-17 12:09:21 UTC on the example data the part of Earth on screen
// is its night side, but it was drawn at about a quarter of full brightness and read as daylight.

import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { geometryAt } from '../api/mock/model';
import { DAY_MS, HOUR_MS } from '../util/time';
import { displayLevel, EARTH_LIGHT, EARTH_MAPS, earthBrightness, earthDaylight, earthMapUV, earthTurnDeg, ORBIT_ATMOSPHERE_FRAGMENT, ORBIT_EARTH_FRAGMENT } from './orbitEarth';
import { hitBall, ORBIT_VIEW, orbitCameraLongitude, orbitDistance, orbitRay, projectOrbit, worldPoint } from './orbitView';

const INSTANT = Date.UTC(2027, 1, 17, 12, 9, 21);
const WIDTH = 1440;
const HEIGHT = 900;

/** Every point of Earth the standard camera could see through a grid of pixels, on screen or off it. */
function earthSeen(tMs: number, step: number, reach = 0) {
  const g = geometryAt(tMs);
  const cameraLon = orbitCameraLongitude(g.subearth_lon_east, 'left');
  const distance = orbitDistance(WIDTH, HEIGHT, false);
  const centre = worldPoint(g.subearth_lat, g.subearth_lon_east, ORBIT_VIEW.earthDistance);
  const sun = worldPoint(g.subsolar_lat, g.subsolar_lon_east, 1);
  const disc = projectOrbit(g.subearth_lat, g.subearth_lon_east, ORBIT_VIEW.earthDistance, cameraLon, ORBIT_VIEW.elevation, distance, WIDTH, HEIGHT);
  const points: { x: number; y: number; cosSun: number; edge: number; onScreen: boolean }[] = [];
  for (let y = -reach; y <= HEIGHT + reach; y += step) {
    for (let x = -reach; x <= WIDTH + reach; x += step) {
      const ray = orbitRay(x, y, cameraLon, ORBIT_VIEW.elevation, distance, WIDTH, HEIGHT);
      const n = hitBall(ray.origin, ray.dir, centre, ORBIT_VIEW.earthRadius);
      if (!n) continue;
      points.push({ x, y, cosSun: n.x * sun.x + n.y * sun.y + n.z * sun.z, edge: -(n.x * ray.dir.x + n.y * ray.dir.y + n.z * ray.dir.z), onScreen: x >= 0 && x <= WIDTH && y >= 0 && y <= HEIGHT });
    }
  }
  return { g, cameraLon, points, disc };
}

describe('Earth at 2027-02-17 12:09:21 UTC, the standard Orbit view', () => {
  const seen = earthSeen(INSTANT, 6, 900);
  const onScreen = seen.points.filter((p) => p.onScreen);

  // The example model's Sun and Earth were fitted to the physics engine's for February 2027
  // (web/live-data): the report's instant read Sun 45.91 E and Earth 352.92 E before that; the
  // engine has 45.14 E and 357.38 E. The fault is the same at either: the night side faces the camera.
  it('is the instant of the report: Sun overhead at 45.19 E, Earth at 357.22 E, camera near 140 E', () => {
    expect(seen.g.subsolar_lon_east).toBeCloseTo(45.194, 2);
    expect(seen.g.subearth_lon_east).toBeCloseTo(357.225, 2);
    expect(seen.cameraLon).toBeCloseTo(140.225, 2);
  });

  it('shows about a quarter of Earth lit, as a crescent on its left edge', () => {
    const lit = seen.points.filter((p) => p.cosSun > 0);
    const share = lit.length / seen.points.length;
    expect(share).toBeGreaterThan(0.2);
    expect(share).toBeLessThan(0.3);
    // Every lit point is left of the middle of the disc.
    for (const p of lit) expect(p.x).toBeLessThan(seen.disc.x);
  });

  it('has only the night side on screen', () => {
    expect(onScreen.length).toBeGreaterThan(1500);
    // Away from the limb the Sun is below the horizon everywhere on screen; at the limb, at the far
    // left of the screen, it is at most 6 degrees up.
    for (const p of onScreen) expect(p.cosSun).toBeLessThan(p.edge > 0.35 ? 0 : 0.1);
  });

  it('draws that part dark: even white ground there shows at under a sixth of full brightness', () => {
    const face = onScreen.filter((q) => q.edge > 0.35);
    // Nearly all of it is in full night (the Sun more than 6 degrees down); the rest, at the far
    // left of the screen, is in the twilight band beside the day-night line.
    const night = face.filter((q) => q.cosSun < EARTH_LIGHT.twilightFrom);
    expect(night.length).toBeGreaterThan(face.length * 0.9);
    for (const p of night) {
      expect(earthDaylight(p.cosSun)).toBe(0);
      expect(displayLevel(earthBrightness(p.cosSun))).toBeLessThan(0.16);
    }
    // Nowhere on screen is in full daylight.
    for (const p of face) expect(earthDaylight(p.cosSun)).toBeLessThan(0.5);
  });
});

describe('how Earth is lit', () => {
  it('is brightest where the Sun is overhead and darkest on the side away from the Sun', () => {
    let last = -1;
    for (let c = -1; c <= 1.0001; c += 0.02) {
      const b = earthBrightness(Math.min(1, c));
      expect(b).toBeGreaterThanOrEqual(last);
      last = b;
    }
    expect(earthBrightness(1)).toBeCloseTo(EARTH_LIGHT.night + 1, 9);
    expect(earthBrightness(-1)).toBe(EARTH_LIGHT.night);
    expect(earthDaylight(1)).toBe(1);
    expect(earthDaylight(-0.5)).toBe(0);
  });

  it('keeps the night side dim but not black: readable as Earth, and many times darker than the day side', () => {
    const night = displayLevel(earthBrightness(-1));
    const day = displayLevel(earthBrightness(0.8));
    expect(night).toBeGreaterThan(0.05);
    expect(night).toBeLessThan(0.16);
    expect(day).toBeGreaterThan(0.9);
    expect(day).toBeGreaterThan(night * 6);
  });

  it('changes from night to day in a narrow band at the day-night line', () => {
    // Under 15 degrees wide in all, and centred close to the line itself.
    const width = (Math.asin(EARTH_LIGHT.twilightTo) - Math.asin(EARTH_LIGHT.twilightFrom)) * (180 / Math.PI);
    expect(width).toBeLessThan(15);
    expect(EARTH_LIGHT.twilightFrom).toBeLessThan(0);
    expect(EARTH_LIGHT.twilightTo).toBeGreaterThan(0);
  });

  it('writes the same numbers into the shader, which is lit by the Sun’s direction alone', () => {
    expect(ORBIT_EARTH_FRAGMENT).toContain(`smoothstep(${EARTH_LIGHT.twilightFrom}, ${EARTH_LIGHT.twilightTo}, cosSun)`);
    expect(ORBIT_EARTH_FRAGMENT).toContain(`* ${EARTH_LIGHT.night} +`);
    expect(ORBIT_EARTH_FRAGMENT).toContain(`uColor * ${EARTH_LIGHT.nightAir};`);
    expect(ORBIT_EARTH_FRAGMENT).toContain('float cosSun = dot(n, uSunDir);');
    expect(ORBIT_ATMOSPHERE_FRAGMENT).toContain('dot(n, uSunDir)');
    expect(ORBIT_ATMOSPHERE_FRAGMENT).toContain(`${EARTH_LIGHT.shellNight} +`);
  });
});

describe('Earth turns once for each day of time', () => {
  it('comes back to the same face after 24 hours and has turned a quarter after 6', () => {
    const t = Date.UTC(2027, 1, 15, 15, 0, 0);
    expect(earthTurnDeg(t + DAY_MS)).toBeCloseTo(earthTurnDeg(t), 6);
    expect((earthTurnDeg(t + 6 * HOUR_MS) - earthTurnDeg(t) + 360) % 360).toBeCloseTo(90, 6);
    expect(earthTurnDeg(t)).toBeGreaterThanOrEqual(0);
    expect(earthTurnDeg(t)).toBeLessThan(360);
  });
});

describe('where a point of Earth is on NASA’s map', () => {
  it('puts the prime meridian down the middle, east to the right and north up', () => {
    expect(earthMapUV(0, 0).u).toBeCloseTo(0.5, 9);
    expect(earthMapUV(0, 0).v).toBeCloseTo(0.5, 9);
    expect(earthMapUV(0, 90).u).toBeCloseTo(0.75, 9);
    expect(earthMapUV(0, 270).u).toBeCloseTo(0.25, 9);
    expect(earthMapUV(60, 0).v).toBeCloseTo(0.5 + 60 / 180, 9);
    expect(earthMapUV(-90, 0).v).toBeCloseTo(0, 9);
  });

  it('names the two copies of the map, which are in the app’s own files, with NASA’s credit', () => {
    expect(EARTH_MAPS.large).toBe('textures/earth/earth-color-4k.jpg');
    expect(EARTH_MAPS.small).toBe('textures/earth/earth-color-2k.jpg');
    for (const path of [EARTH_MAPS.large, EARTH_MAPS.small]) expect(existsSync(`public/${path}`), path).toBe(true);
    expect(EARTH_MAPS.credit).toContain('NASA');
    expect(EARTH_MAPS.credit).toContain('Reto Stöckli');
  });
});
