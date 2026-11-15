// The Moon's real surface: maps made from NASA's CGI Moon Kit (NASA's Scientific Visualization
// Studio). The files and their own README (source, credit, what was changed) are in
// web/public/textures/moon/ and are never edited here.
//
// All four are full-globe maps in a simple cylindrical layout: north is up, the centre column is
// 0 degrees longitude and the left and right edges are 180 degrees. `moonMapUV` is that layout as
// arithmetic; the Moon's shader (MOON_FRAGMENT in shaders.ts) does the same sum from the surface
// direction, and the test beside this file holds the two together.

import { latLonToVec3 } from '../util/geo';

export const MOON_MAPS = {
  /** Desktop: 4096 x 2048. */
  large: { color: 'textures/moon/moon-color-4k.jpg', normal: 'textures/moon/moon-normal-4k.jpg' },
  /** Phones, and any device whose largest texture is under 4096: 2048 x 1024. */
  small: { color: 'textures/moon/moon-color-2k.jpg', normal: 'textures/moon/moon-normal-2k.jpg' },
  credit: "Moon surface: NASA's CGI Moon Kit, NASA's Scientific Visualization Studio",
} as const;

/**
 * How strongly the relief map bends the light. The map is at true scale, where the Moon's slopes
 * are gentle and the terrain reads flat on a globe this small; the shading is strengthened by this
 * factor so craters and mountains catch the Sun's light. The surface itself is not moved.
 */
export const MOON_RELIEF_STRENGTH = 3;

/** Where a point of the Moon is on the maps: u from the left edge, v from the bottom edge, both 0 to 1. */
export function moonMapUV(lat: number, lonEast: number): { u: number; v: number } {
  // The same sum as the shader: from the direction of the point, as the site markers are placed.
  const n = latLonToVec3(lat, lonEast, 1);
  const u = Math.atan2(-n.z, n.x) / (2 * Math.PI) + 0.5;
  const v = Math.asin(Math.min(1, Math.max(-1, n.y))) / Math.PI + 0.5;
  return { u, v };
}

/** The pixel of a map (width x height, row 0 at the top) that shows a point of the Moon. */
export function moonMapPixel(lat: number, lonEast: number, width: number, height: number): { x: number; y: number } {
  const { u, v } = moonMapUV(lat, lonEast);
  return { x: u * width, y: (1 - v) * height };
}
