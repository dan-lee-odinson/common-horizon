// Turning the Orbit view by hand: the turn itself, the Sun's disc that turning can bring into the
// picture, and Earth, which must still never stand between the camera and the Moon.

import { describe, expect, it } from 'vitest';
import { geometryAt, TRANSIT_DAYS } from '../api/mock/model';
import { sunWidthDeg } from '../util/bodies';
import { DAY_MS, HOUR_MS, SYNODIC_MONTH_DAYS } from '../util/time';
import { hitBall, ORBIT_VIEW, orbitCameraFrame, orbitCameraLongitude, orbitDistance, orbitRay, orbitZoomDistance, projectOrbit, projectOrbitPoint, worldPoint } from './orbitView';
import { clampTurn, dragTurn, earthFade, isTurned, keyTurn, ORBIT_TURN, SUN_DRAW_DISTANCE, sunBallRadius, sunHiddenBy, sunPlace, sunRadiusPx, turnedElevation } from './orbitTurn';
import { edgeGlow, sunInFrame } from './sunlight';

const LANDING = Date.UTC(2027, 1, 10, 15, 0, 0) + TRANSIT_DAYS * DAY_MS;
const WIDTH = 1440;
const HEIGHT = 900;
const FRAME = { left: 0, top: 0, right: WIDTH, bottom: HEIGHT };

describe('turning the view', () => {
  it('follows a drag: right carries the camera west, down raises it', () => {
    const t = dragTurn({ lon: 0, lat: 0 }, 100, 0);
    expect(t.lon).toBeCloseTo(-100 * ORBIT_TURN.degPerPx, 9);
    expect(t.lat).toBe(0);
    const u = dragTurn({ lon: 10, lat: 5 }, 0, 20);
    expect(u.lon).toBe(10);
    expect(u.lat).toBeCloseTo(5 + 20 * ORBIT_TURN.degPerPx, 9);
  });

  it('turns a drag back into the camera’s own axes when the picture is rolled (phones)', () => {
    // With the picture rolled a quarter turn, a drag down the screen is a drag along the camera's own "right".
    const t = dragTurn({ lon: 0, lat: 0 }, 0, 50, Math.PI / 2);
    expect(t.lon).toBeCloseTo(-50 * ORBIT_TURN.degPerPx, 9);
    expect(t.lat).toBeCloseTo(0, 9);
  });

  it('answers the arrow keys, with bigger steps under Shift, and no other key', () => {
    const zero = { lon: 0, lat: 0 };
    expect(keyTurn(zero, 'ArrowRight')).toEqual({ lon: ORBIT_TURN.keyStep, lat: 0 });
    expect(keyTurn(zero, 'ArrowLeft')).toEqual({ lon: -ORBIT_TURN.keyStep, lat: 0 });
    expect(keyTurn(zero, 'ArrowUp')).toEqual({ lon: 0, lat: ORBIT_TURN.keyStep });
    expect(keyTurn(zero, 'ArrowDown', true)).toEqual({ lon: 0, lat: -ORBIT_TURN.keyStepShift });
    expect(keyTurn(zero, 'Enter')).toBeNull();
    expect(keyTurn(zero, 'a')).toBeNull();
  });

  it('keeps the camera off the Moon’s poles', () => {
    expect(turnedElevation(clampTurn({ lon: 0, lat: 500 }).lat)).toBe(ORBIT_TURN.maxElevation);
    expect(turnedElevation(clampTurn({ lon: 0, lat: -500 }).lat)).toBe(-ORBIT_TURN.maxElevation);
    expect(turnedElevation(0)).toBe(ORBIT_VIEW.elevation);
    // The pointer's lean cannot push it past the limit either.
    expect(turnedElevation(clampTurn({ lon: 0, lat: 500 }).lat, 1.2)).toBe(ORBIT_TURN.maxElevation);
  });

  it('knows the standard view from a turned one', () => {
    expect(isTurned({ lon: 0, lat: 0 })).toBe(false);
    expect(isTurned({ lon: 3, lat: 0 })).toBe(true);
    expect(isTurned({ lon: 0, lat: -3 })).toBe(true);
    // A whole turn round the Moon is the standard view again.
    expect(isTurned({ lon: 360, lat: 0 })).toBe(false);
  });
});

describe('the Sun’s disc', () => {
  it('is as wide as the Sun looks: 0.53 degrees', () => {
    expect(sunWidthDeg()).toBeCloseTo(0.533, 2);
    const seen = 2 * Math.asin(sunBallRadius() / SUN_DRAW_DISTANCE) * (180 / Math.PI);
    expect(seen).toBeCloseTo(sunWidthDeg(), 9);
    // About 14 pixels across in a picture 900 pixels tall with a 34 degree view.
    expect(sunRadiusPx(900) * 2).toBeGreaterThan(13);
    expect(sunRadiusPx(900) * 2).toBeLessThan(15);
  });

  it('is drawn where its direction meets the picture, whatever the camera’s pose', () => {
    let checked = 0;
    for (let h = 0; h <= SYNODIC_MONTH_DAYS * 24; h += 24) {
      const g = geometryAt(LANDING + h * HOUR_MS);
      const sun = worldPoint(g.subsolar_lat, g.subsolar_lon_east, 1);
      for (const turn of [
        { lon: 0, lat: 0 },
        { lon: 80, lat: -30 },
        { lon: -120, lat: 20 },
        { lon: 200, lat: -60 },
      ]) {
        for (const zoom of [0, 1]) {
          const cameraLon = orbitCameraLongitude(g.subearth_lon_east, 'left', turn.lon);
          const elevation = turnedElevation(turn.lat);
          const distance = orbitZoomDistance(orbitDistance(WIDTH, HEIGHT, false), zoom);
          const cam = orbitCameraFrame(cameraLon, elevation, distance);
          const ahead = sun.x * cam.forward.x + sun.y * cam.forward.y + sun.z * cam.forward.z;
          if (ahead < 0.05) continue;
          // The disc's own centre, projected like any point of the scene...
          const disc = projectOrbitPoint(sunPlace(cam.position, sun), cameraLon, elevation, distance, WIDTH, HEIGHT);
          // ...lands where the line of sight along the Sun's direction meets the picture.
          const ray = orbitRay(disc.x, disc.y, cameraLon, elevation, distance, WIDTH, HEIGHT);
          expect(ray.dir.x).toBeCloseTo(sun.x, 9);
          expect(ray.dir.y).toBeCloseTo(sun.y, 9);
          expect(ray.dir.z).toBeCloseTo(sun.z, 9);
          // ...and that is the point a mark infinitely far along the direction lands on.
          const far = projectOrbitPoint(sunPlace(cam.position, sun, 1e9), cameraLon, elevation, distance, WIDTH, HEIGHT);
          expect(Math.abs(disc.x - far.x)).toBeLessThan(1e-6 * (1 + Math.abs(far.x)));
          expect(Math.abs(disc.y - far.y)).toBeLessThan(1e-6 * (1 + Math.abs(far.y)));
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(60);
  });

  it('keeps its place against the stars when the camera moves: only the direction matters, not where the camera is', () => {
    const sun = worldPoint(-0.7, 45.9, 1);
    const star = worldPoint(12, 60, 1);
    const angle = (camera: { x: number; y: number; z: number }) => {
      // The angle between the Sun's disc and a star (both infinitely far, so both placed from the camera).
      const a = sunPlace(camera, sun);
      const b = sunPlace(camera, star);
      const va = { x: a.x - camera.x, y: a.y - camera.y, z: a.z - camera.z };
      const vb = { x: b.x - camera.x, y: b.y - camera.y, z: b.z - camera.z };
      return Math.acos((va.x * vb.x + va.y * vb.y + va.z * vb.z) / (Math.hypot(va.x, va.y, va.z) * Math.hypot(vb.x, vb.y, vb.z)));
    };
    const near = angle(worldPoint(30, 136, 7));
    expect(angle(worldPoint(30, 136, 25))).toBeCloseTo(near, 12);
    expect(angle(worldPoint(-40, 250, 7))).toBeCloseTo(near, 12);
  });

  it('is hidden by the Moon when the Moon is in front of it, and by Earth when Earth is', () => {
    const sun = worldPoint(0, 46, 1);
    const earth = worldPoint(-2, 353, ORBIT_VIEW.earthDistance);
    // Camera straight opposite the Sun: the Moon is exactly in front of it.
    expect(sunHiddenBy(worldPoint(0, 226, 7), sun, earth)).toBe('moon');
    // Just past the Moon's edge (the Moon is 8.2 degrees in radius from 7 radii away): in the clear.
    expect(sunHiddenBy(worldPoint(0, 226 - 9, 7), sun, earth)).toBeNull();
    expect(sunHiddenBy(worldPoint(0, 226 - 7.5, 7), sun, earth)).toBe('moon');
    // The standard view: the Sun is well clear of the Moon (and out of the frame).
    expect(sunHiddenBy(worldPoint(30, 136, 7), sun, earth)).toBeNull();
    // Looking along Earth's direction from beyond the Moon with the Sun behind Earth: Earth hides it...
    const sunBehindEarth = worldPoint(-2, 353, 1);
    const camera = worldPoint(20, 173, 7);
    expect(sunHiddenBy(camera, sunBehindEarth, earth)).toBe('earth');
    // ...unless Earth is not being drawn.
    expect(sunHiddenBy(camera, sunBehindEarth, null)).toBeNull();
  });

  it('shows in place of the edge glow whenever it is inside the frame', () => {
    const g = geometryAt(Date.UTC(2027, 1, 17, 12, 9, 21));
    const sun = worldPoint(g.subsolar_lat, g.subsolar_lon_east, 1);
    const distance = orbitDistance(WIDTH, HEIGHT, false);
    let inside = 0;
    let outside = 0;
    for (let lon = -180; lon < 180; lon += 6) {
      for (const lat of [-60, -30, 0]) {
        const cameraLon = orbitCameraLongitude(g.subearth_lon_east, 'left', lon);
        const elevation = turnedElevation(lat);
        const cam = orbitCameraFrame(cameraLon, elevation, distance);
        const ahead = sun.x * cam.forward.x + sun.y * cam.forward.y + sun.z * cam.forward.z;
        const point = ahead > 1e-3 ? projectOrbitPoint(sunPlace(cam.position, sun), cameraLon, elevation, distance, WIDTH, HEIGHT) : null;
        const moon = { x: WIDTH / 2, y: HEIGHT / 2 };
        // The heading of the Sun's direction at the Moon's centre.
        const step = projectOrbitPoint({ x: sun.x * 0.5, y: sun.y * 0.5, z: sun.z * 0.5 }, cameraLon, elevation, distance, WIDTH, HEIGHT);
        const len = Math.hypot(step.x - moon.x, step.y - moon.y);
        if (len < 1e-6) continue;
        const glow = edgeGlow(moon, { ux: (step.x - moon.x) / len, uy: (step.y - moon.y) / len }, point, sunRadiusPx(HEIGHT), FRAME, []);
        if (sunInFrame(point, FRAME, sunRadiusPx(HEIGHT))) {
          inside++;
          expect(glow, 'the edge glow shows with the Sun in the frame').toBeNull();
        } else {
          outside++;
          expect(glow, 'no edge glow with the Sun out of the frame').not.toBeNull();
        }
      }
    }
    expect(inside).toBeGreaterThan(5);
    expect(outside).toBeGreaterThan(100);
  });
});

describe('Earth never stands between the camera and the Moon', () => {
  it('is drawn in full in the standard view, zoomed in or out, through a lunar day', () => {
    for (let h = 0; h <= SYNODIC_MONTH_DAYS * 24; h += 12) {
      const g = geometryAt(LANDING + h * HOUR_MS);
      const earth = worldPoint(g.subearth_lat, g.subearth_lon_east, ORBIT_VIEW.earthDistance);
      for (const zoom of [0, 1]) {
        const camera = worldPoint(ORBIT_VIEW.elevation, orbitCameraLongitude(g.subearth_lon_east, 'left'), orbitZoomDistance(orbitDistance(WIDTH, HEIGHT, false), zoom));
        expect(earthFade(camera, earth)).toBe(1);
      }
    }
  });

  it('is gone before its disc could touch the Moon’s disc from in front, wherever the view is turned', () => {
    const g = geometryAt(LANDING);
    const earth = worldPoint(g.subearth_lat, g.subearth_lon_east, ORBIT_VIEW.earthDistance);
    let faded = 0;
    let shown = 0;
    for (const zoom of [0, 0.5, 1]) {
      const distance = orbitZoomDistance(orbitDistance(WIDTH, HEIGHT, false), zoom);
      for (let lon = 0; lon < 360; lon += 3) {
        for (let lat = -110; lat <= 50; lat += 10) {
          const cameraLon = orbitCameraLongitude(g.subearth_lon_east, 'left', lon);
          const elevation = turnedElevation(lat);
          const camera = worldPoint(elevation, cameraLon, distance);
          const fade = earthFade(camera, earth);
          if (fade < 1) faded++;
          else shown++;
          if (fade <= 0) continue;
          // Still drawn, however faintly: then no line of sight to the Moon may pass through Earth first.
          // (Checked along the lines of sight to the Moon's centre and round its whole edge.)
          const moonAt = projectOrbit(0, 0, 0, cameraLon, elevation, distance, WIDTH, HEIGHT);
          const half = Math.asin(1 / distance);
          const reach = (HEIGHT / 2 / Math.tan((ORBIT_VIEW.fov * Math.PI) / 360)) * Math.tan(half);
          for (let a = 0; a < 360; a += 30) {
            for (const k of [0, 0.99]) {
              const ray = orbitRay(moonAt.x + Math.cos((a * Math.PI) / 180) * reach * k, moonAt.y + Math.sin((a * Math.PI) / 180) * reach * k, cameraLon, elevation, distance, WIDTH, HEIGHT);
              const earthHit = hitBall(ray.origin, ray.dir, earth, ORBIT_VIEW.earthRadius);
              if (!earthHit) continue;
              // Earth is on this line of sight: it must be farther than the Moon's near side, i.e. behind the Moon.
              const toEarth = Math.hypot(earth.x - ray.origin.x, earth.y - ray.origin.y, earth.z - ray.origin.z);
              expect(toEarth, `Earth stands in front of the Moon at turn ${lon}, ${lat}, zoom ${zoom}`).toBeGreaterThan(distance);
            }
          }
        }
      }
    }
    // Both happen: Earth is drawn for most views and faded for those on its own side of the Moon.
    expect(faded).toBeGreaterThan(100);
    expect(shown).toBeGreaterThan(faded);
  });

  it('fades smoothly, not at a step', () => {
    const earth = worldPoint(0, 0, ORBIT_VIEW.earthDistance);
    let last = earthFade(worldPoint(0, 180, 7), earth);
    expect(last).toBe(1);
    let largest = 0;
    for (let lon = 180; lon >= 0; lon -= 0.5) {
      const fade = earthFade(worldPoint(0, lon, 7), earth);
      largest = Math.max(largest, Math.abs(fade - last));
      last = fade;
    }
    expect(last).toBe(0);
    expect(largest).toBeLessThan(0.1);
  });
});
