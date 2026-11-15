// The Moon maps sit on the same coordinates as the site markers: 0 degrees longitude at the centre
// column, east to the right, north up, 180 degrees at both edges.

import { describe, expect, it } from 'vitest';
import { MOON_MAPS, moonMapPixel, moonMapUV } from './textures';

describe('where a point of the Moon is on the maps', () => {
  it('puts 0 degrees longitude at the centre column and the equator at the middle row', () => {
    expect(moonMapUV(0, 0).u).toBeCloseTo(0.5, 9);
    expect(moonMapUV(0, 0).v).toBeCloseTo(0.5, 9);
  });

  it('runs east to the right and north up', () => {
    expect(moonMapUV(0, 90).u).toBeCloseTo(0.75, 9);
    expect(moonMapUV(0, 270).u).toBeCloseTo(0.25, 9);
    expect(moonMapUV(45, 0).v).toBeCloseTo(0.75, 9);
    expect(moonMapUV(-90, 0).v).toBeCloseTo(0, 9);
  });

  it('puts 180 degrees at the two edges', () => {
    expect(moonMapUV(0, 179.999).u).toBeCloseTo(1, 4);
    expect(moonMapUV(0, 180.001).u).toBeCloseTo(0, 4);
  });

  it('puts Tycho and Copernicus where their coordinates say', () => {
    // Tycho, 43.3 S, 348.6 E: 11.4 degrees west of the centre column, 43.3 degrees below the equator.
    const tycho = moonMapUV(-43.3, 348.6);
    expect(tycho.u).toBeCloseTo(0.5 - 11.4 / 360, 9);
    expect(tycho.v).toBeCloseTo(0.5 - 43.3 / 180, 9);
    // Copernicus, 9.6 N, 339.9 E: 20.1 degrees west of the centre column, 9.6 degrees above the equator.
    const copernicus = moonMapUV(9.6, 339.9);
    expect(copernicus.u).toBeCloseTo(0.5 - 20.1 / 360, 9);
    expect(copernicus.v).toBeCloseTo(0.5 + 9.6 / 180, 9);
    // On the 4096 x 2048 map (row 0 at the top).
    const px = moonMapPixel(-43.3, 348.6, 4096, 2048);
    expect(px.x).toBeCloseTo(1918.3, 1);
    expect(px.y).toBeCloseTo(1516.7, 1);
  });

  it('names a color map and a relief map for each size, all in the frozen maps folder', () => {
    for (const set of [MOON_MAPS.large, MOON_MAPS.small]) {
      expect(set.color).toMatch(/^textures\/moon\/moon-color-(2k|4k)\.jpg$/);
      expect(set.normal).toMatch(/^textures\/moon\/moon-normal-(2k|4k)\.jpg$/);
    }
  });
});
