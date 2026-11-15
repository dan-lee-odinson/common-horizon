// Shadows on level ground, from the Sun's direction alone.
//
// An object of height h casts a shadow of length h / tan(elevation), pointing away from the Sun.
// That is exact for a point Sun over a level plane. The real Sun is a disc 0.53 degrees wide, so
// the tip of a real shadow is a blur between the lengths its upper and lower edges would give: at a
// low Sun the blur is a large share of the length, and with the disc touching the level plane the
// shadow has no far end at all. How a length is shown therefore depends on how high the Sun is:
//
//   Sun's lower edge at or below level (elevation under half the disc)   no length: "past the horizon"
//   up to ten disc widths high (about 5.3 degrees)                       one figure, labelled "about"
//   higher                                                               two figures
//
// The site's real ground is not in the data, so every length here is for level ground.

import { azElToLocal, DEG, normalizeLon360 } from './geo';

/**
 * Below this elevation of the Sun's centre its disc touches the level plane: half the disc's width
 * (0.266 degrees), rounded up to the two decimals an elevation is ever quoted to.
 */
export const SHADOW_MIN_EL_DEG = 0.27;
/** From this elevation a length is good for two figures: ten disc widths (5.33 degrees), to one decimal. */
export const SHADOW_FINE_EL_DEG = 5.3;

/**
 * Shadow length per metre of height on level ground, for the Sun's centre: 1 / tan(elevation).
 * Null when the whole disc is not above the level plane, and when the elevation is not a number.
 */
export function shadowFactor(sunElDeg: number): number | null {
  if (!Number.isFinite(sunElDeg) || sunElDeg < SHADOW_MIN_EL_DEG) return null;
  if (sunElDeg >= 90) return 0;
  return 1 / Math.tan(sunElDeg * DEG);
}

/** The compass bearing shadows point along: straight away from the Sun. */
export function shadowBearingDeg(sunAzDeg: number): number {
  return normalizeLon360(sunAzDeg + 180);
}

/** A value rounded to a number of significant figures (1,234 to 2 figures is 1,200). */
export function roundSig(value: number, figures: number): number {
  if (!Number.isFinite(value) || value === 0) return value;
  const magnitude = Math.floor(Math.log10(Math.abs(value)));
  const unit = 10 ** (magnitude - figures + 1);
  // Divide by the inverse for small units so 0.1 + 0.2 style noise does not show ("0.30000000000000004").
  return unit >= 1 ? Math.round(value / unit) * unit : Math.round(value / unit) / Math.round(1 / unit);
}

const COMPASS_WORDS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'] as const;

/** The nearest of the eight compass points to a bearing, as a word. */
export function compassWord(bearingDeg: number): string {
  return COMPASS_WORDS[Math.round(normalizeLon360(bearingDeg) / 45) % 8];
}

export type ShadowFigures =
  /** No Sun direction, or no word on whether the site is lit. */
  | { kind: 'unknown' }
  /** The terrain hides the Sun: nothing casts a shadow. */
  | { kind: 'dark' }
  /** Lit, with the Sun's disc touching the level plane: the shadow runs off past the horizon. */
  | { kind: 'grazing'; bearingDeg: number }
  /** A length per metre of height, and how many figures of it are worth showing. */
  | { kind: 'length'; perMetre: number; figures: 1 | 2; bearingDeg: number };

/**
 * What can honestly be said about shadows at one instant. `lit` is the horizon answer's word
 * (null when there is none); the Sun's direction is the readouts' own.
 */
export function shadowFigures(sun: { az: number; el: number } | null, lit: boolean | null): ShadowFigures {
  if (!sun || lit === null || !Number.isFinite(sun.az) || !Number.isFinite(sun.el)) return { kind: 'unknown' };
  if (!lit) return { kind: 'dark' };
  const bearingDeg = shadowBearingDeg(sun.az);
  const perMetre = shadowFactor(sun.el);
  if (perMetre === null) return { kind: 'grazing', bearingDeg };
  return { kind: 'length', perMetre, figures: sun.el < SHADOW_FINE_EL_DEG ? 1 : 2, bearingDeg };
}

/**
 * How far along the ground (east, south) the shadow of a point one metre up falls from the point
 * straight under it, in the local frame of `azElToLocal` (x east, y up, z south). The scene drops
 * every vertex of a model onto the ground along the sunlight with it:
 *   x' = x - y * offset.x,  z' = z - y * offset.z,  y' = 0.
 * Null when the Sun's disc is not wholly above the level plane.
 */
export function shadowOffsetPerMetre(sunAzDeg: number, sunElDeg: number): { x: number; z: number } | null {
  if (shadowFactor(sunElDeg) === null || !Number.isFinite(sunAzDeg)) return null;
  const s = azElToLocal(sunAzDeg, sunElDeg);
  return { x: s.x / s.y, z: s.z / s.y };
}

/** Drop a point onto the level ground along the sunlight (see `shadowOffsetPerMetre`). */
export function projectToGround(p: { x: number; y: number; z: number }, offset: { x: number; z: number }): { x: number; y: number; z: number } {
  return { x: p.x - p.y * offset.x, y: 0, z: p.z - p.y * offset.z };
}
