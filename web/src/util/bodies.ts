// Sizes and distances of the Sun, Earth and the Moon, and how wide a body looks from a site.
//
// The API answers carry directions only (where the Sun and Earth are overhead), no distances and no
// radii. Where a true size is drawn or shown, it comes from the published values below and from
// nowhere else. Their sources are listed in web/SOURCES-web.md. The two distances are mean values,
// so every figure worked out from them is "at mean distance": the real widths grow and shrink a
// little as the real distances do, and the screen says "mean distances" wherever a width is given.

import { DEG, RAD } from './geo';

/** Nominal solar radius, km (IAU 2015 Resolution B3). */
export const SUN_RADIUS_KM = 695_700;
/** One astronomical unit, km (IAU 2012 Resolution B2): the Sun's distance used throughout. */
export const SUN_DISTANCE_KM = 149_597_870.7;
/** Earth's volumetric mean radius, km (NASA Earth Fact Sheet). */
export const EARTH_RADIUS_KM = 6_371.0;
/** Mean distance between the centres of Earth and the Moon, km (NASA Moon Fact Sheet, semi-major axis). */
export const EARTH_MOON_DISTANCE_KM = 384_400;
/** The Moon's volumetric mean radius, km (NASA Moon Fact Sheet). */
export const MOON_RADIUS_KM = 1_737.4;

/**
 * How wide a ball of a given radius looks from a given distance to its centre, in degrees:
 * 2 x asin(radius / distance). Not a number when the viewer would be inside the ball.
 */
export function apparentWidthDeg(radiusKm: number, distanceKm: number): number {
  if (!(radiusKm > 0) || !(distanceKm > radiusKm)) return Number.NaN;
  return 2 * Math.asin(radiusKm / distanceKm) * RAD;
}

/**
 * The Sun's apparent width from the Moon at mean distance, degrees (about 0.53). A site's place on
 * the Moon moves it by less than a hundred-thousandth of a degree, so one value serves every site.
 */
export function sunWidthDeg(): number {
  return apparentWidthDeg(SUN_RADIUS_KM, SUN_DISTANCE_KM);
}

/**
 * Distance from a site on the Moon to Earth's centre, km, when Earth stands `earthElDeg` above the
 * site's level plane. The site is one Moon radius from the Moon's centre and Earth's centre is at
 * the mean distance along the direction to Earth, so the two make a triangle whose angle at the
 * Moon's centre is 90 degrees minus that elevation.
 */
export function earthDistanceFromSiteKm(earthElDeg: number): number {
  const D = EARTH_MOON_DISTANCE_KM;
  const R = MOON_RADIUS_KM;
  return Math.sqrt(D * D + R * R - 2 * D * R * Math.sin(earthElDeg * DEG));
}

/**
 * Earth's apparent width from a site where it stands `earthElDeg` above level, at mean distance,
 * degrees: about 1.91 with Earth overhead (the site is a Moon radius closer) and 1.90 with Earth
 * on the horizon.
 */
export function earthWidthDeg(earthElDeg: number): number {
  if (!Number.isFinite(earthElDeg)) return Number.NaN;
  return apparentWidthDeg(EARTH_RADIUS_KM, earthDistanceFromSiteKm(earthElDeg));
}
