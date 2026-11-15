// The apparent sizes drawn and shown in the site stage follow from five published values.

import { describe, expect, it } from 'vitest';
import {
  apparentWidthDeg,
  EARTH_MOON_DISTANCE_KM,
  EARTH_RADIUS_KM,
  earthDistanceFromSiteKm,
  earthWidthDeg,
  MOON_RADIUS_KM,
  SUN_DISTANCE_KM,
  SUN_RADIUS_KM,
  sunWidthDeg,
} from './bodies';

describe('body sizes and distances', () => {
  it('holds the published values', () => {
    expect(SUN_RADIUS_KM).toBe(695700);
    expect(SUN_DISTANCE_KM).toBe(149597870.7);
    expect(EARTH_RADIUS_KM).toBe(6371);
    expect(EARTH_MOON_DISTANCE_KM).toBe(384400);
    expect(MOON_RADIUS_KM).toBe(1737.4);
  });

  it('apparent width is 2 asin(radius / distance)', () => {
    // A ball seen from twice its radius fills 60 degrees.
    expect(apparentWidthDeg(1, 2)).toBeCloseTo(60, 10);
    expect(apparentWidthDeg(1, Math.SQRT2)).toBeCloseTo(90, 10);
    // From inside the ball, or with no size, there is no width.
    expect(apparentWidthDeg(2, 1)).toBeNaN();
    expect(apparentWidthDeg(0, 1)).toBeNaN();
    expect(apparentWidthDeg(Number.NaN, 1)).toBeNaN();
  });

  it('the Sun is 0.5329 degrees wide at one astronomical unit', () => {
    expect(sunWidthDeg()).toBeCloseTo(0.5329, 4);
    expect(sunWidthDeg().toFixed(2)).toBe('0.53');
  });

  it('Earth is 1.9079 degrees wide when overhead and 1.8993 on the horizon', () => {
    expect(earthWidthDeg(90)).toBeCloseTo(1.9079, 3);
    expect(earthWidthDeg(0)).toBeCloseTo(1.8993, 4);
    expect(earthWidthDeg(90).toFixed(2)).toBe('1.91');
    expect(earthWidthDeg(0).toFixed(2)).toBe('1.90');
    // Below the horizon the site is further from Earth still.
    expect(earthWidthDeg(-90)).toBeLessThan(earthWidthDeg(0));
    expect(earthWidthDeg(Number.NaN)).toBeNaN();
  });

  it('the site is a Moon radius closer to Earth when Earth is overhead, and a Moon radius further when it is underfoot', () => {
    expect(earthDistanceFromSiteKm(90)).toBeCloseTo(EARTH_MOON_DISTANCE_KM - MOON_RADIUS_KM, 6);
    expect(earthDistanceFromSiteKm(-90)).toBeCloseTo(EARTH_MOON_DISTANCE_KM + MOON_RADIUS_KM, 6);
    expect(earthDistanceFromSiteKm(0)).toBeCloseTo(Math.hypot(EARTH_MOON_DISTANCE_KM, MOON_RADIUS_KM), 6);
  });

  it('every shown width between the horizon and the zenith reads 1.90 or 1.91', () => {
    for (let el = 0; el <= 90; el += 0.5) expect(['1.90', '1.91']).toContain(earthWidthDeg(el).toFixed(2));
  });
});
