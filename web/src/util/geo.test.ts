import { describe, expect, it } from 'vitest';
import { azElFromSubpoint, latLonToVec3, normalizeLon360, toEastLongitude, toSignedLongitude, vec3ToLatLon } from './geo';

describe('west-to-east longitude conversion (east longitude 0..360)', () => {
  it('turns a west longitude into east', () => {
    expect(toEastLongitude(23.47, 'W')).toBeCloseTo(336.53, 10);
    expect(toEastLongitude(90, 'W')).toBe(270);
    expect(toEastLongitude(180, 'W')).toBe(180);
  });
  it('keeps an east longitude', () => {
    expect(toEastLongitude(23.47, 'E')).toBe(23.47);
    expect(toEastLongitude(196.739, 'E')).toBe(196.739);
  });
  it('maps 0° W and 360° to 0', () => {
    expect(toEastLongitude(0, 'W')).toBe(0);
    expect(Object.is(toEastLongitude(0, 'W'), -0)).toBe(false);
    expect(toEastLongitude(360, 'E')).toBe(0);
  });
  it('treats a negative number as the other hemisphere', () => {
    expect(toEastLongitude(-10, 'E')).toBe(350);
    expect(toEastLongitude(-10, 'W')).toBe(10);
  });
  it('rejects something that is not a number', () => {
    expect(() => toEastLongitude(Number.NaN, 'W')).toThrow(RangeError);
  });
  it('normalizes and converts back', () => {
    expect(normalizeLon360(-23.42194)).toBeCloseTo(336.57806, 10);
    expect(toSignedLongitude(336.5781)).toBeCloseTo(-23.4219, 10);
  });
});

describe('3D positions on the Moon', () => {
  it('round-trips latitude and longitude', () => {
    for (const [lat, lon] of [
      [-89.684, 196.739],
      [0.67416, 23.47314],
      [26.13239, 3.6333],
      [-3.0128, 336.5781],
    ]) {
      const back = vec3ToLatLon(latLonToVec3(lat, lon));
      expect(back.lat).toBeCloseTo(lat, 9);
      expect(back.lonEast).toBeCloseTo(lon, 9);
    }
  });
});

describe('azimuth and elevation from a sub-point', () => {
  it('puts the body overhead at its sub-point', () => {
    expect(azElFromSubpoint(10, 20, 10, 20).el).toBeCloseTo(90, 6);
  });
  it('puts a body over the equator due north and low for a site near the south pole', () => {
    const { az, el } = azElFromSubpoint(-89, 0, 0, 0);
    expect(el).toBeCloseTo(1, 6);
    expect(az).toBeCloseTo(0, 6);
  });
  it('rises in the east', () => {
    const { az, el } = azElFromSubpoint(0, 0, 0, 90);
    expect(el).toBeCloseTo(0, 6);
    expect(az).toBeCloseTo(90, 6);
  });
});
