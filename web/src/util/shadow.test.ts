// Shadow lengths and directions on level ground, and how finely they may be shown.

import { describe, expect, it } from 'vitest';
import { sunWidthDeg } from './bodies';
import { azElToLocal } from './geo';
import {
  compassWord,
  projectToGround,
  roundSig,
  SHADOW_FINE_EL_DEG,
  SHADOW_MIN_EL_DEG,
  shadowBearingDeg,
  shadowFactor,
  shadowFigures,
  shadowOffsetPerMetre,
} from './shadow';

describe('shadow length on level ground', () => {
  it('is the height at 45 degrees, and h / tan(elevation) everywhere', () => {
    expect(shadowFactor(45)).toBeCloseTo(1, 12);
    expect(shadowFactor(30)).toBeCloseTo(Math.sqrt(3), 12);
    expect(shadowFactor(90)).toBe(0);
    for (const el of [0.3, 1, 5, 12.5, 60, 89]) expect(shadowFactor(el)).toBeCloseTo(1 / Math.tan((el * Math.PI) / 180), 10);
  });

  it('a 52 m pole at 1 degree casts 2,979 m, pointing straight away from the Sun', () => {
    expect(Math.round(52 * shadowFactor(1)!)).toBe(2979);
    expect(shadowBearingDeg(100)).toBe(280);
    expect(shadowBearingDeg(270)).toBe(90);
    expect(shadowBearingDeg(180)).toBe(0);
    expect(shadowBearingDeg(359.5)).toBeCloseTo(179.5, 10);
  });

  it('has no length while the Sun’s disc touches the level plane', () => {
    expect(shadowFactor(SHADOW_MIN_EL_DEG)).not.toBeNull();
    expect(shadowFactor(0.26)).toBeNull();
    expect(shadowFactor(0)).toBeNull();
    expect(shadowFactor(-3)).toBeNull();
    expect(shadowFactor(Number.NaN)).toBeNull();
  });

  it('takes its two limits from the width of the Sun’s disc', () => {
    // Half the disc, rounded up to two decimals; ten discs, to one decimal.
    expect(SHADOW_MIN_EL_DEG - sunWidthDeg() / 2).toBeGreaterThanOrEqual(0);
    expect(SHADOW_MIN_EL_DEG - sunWidthDeg() / 2).toBeLessThan(0.01);
    expect(Math.abs(SHADOW_FINE_EL_DEG - sunWidthDeg() * 10)).toBeLessThan(0.05);
  });
});

describe('what may be said about a shadow', () => {
  it('nothing without a Sun direction or without the lit / dark word', () => {
    expect(shadowFigures(null, true)).toEqual({ kind: 'unknown' });
    expect(shadowFigures({ az: 10, el: 20 }, null)).toEqual({ kind: 'unknown' });
    expect(shadowFigures({ az: Number.NaN, el: 20 }, true)).toEqual({ kind: 'unknown' });
  });

  it('no shadow in darkness, even with the Sun above level', () => {
    expect(shadowFigures({ az: 10, el: 2 }, false)).toEqual({ kind: 'dark' });
    expect(shadowFigures({ az: 10, el: -4 }, false)).toEqual({ kind: 'dark' });
  });

  it('lit with the disc on the level plane: a direction but no length', () => {
    expect(shadowFigures({ az: 90, el: 0.1 }, true)).toEqual({ kind: 'grazing', bearingDeg: 270 });
    // The terrain can dip below level: lit with the Sun's centre under it.
    expect(shadowFigures({ az: 90, el: -0.4 }, true)).toEqual({ kind: 'grazing', bearingDeg: 270 });
  });

  it('one figure below 5.3 degrees, two from there', () => {
    const low = shadowFigures({ az: 0, el: 1.1 }, true);
    const edge = shadowFigures({ az: 0, el: 5.29 }, true);
    const high = shadowFigures({ az: 0, el: 5.3 }, true);
    const higher = shadowFigures({ az: 0, el: 40 }, true);
    expect(low).toMatchObject({ kind: 'length', figures: 1, bearingDeg: 180 });
    expect(edge).toMatchObject({ kind: 'length', figures: 1 });
    expect(high).toMatchObject({ kind: 'length', figures: 2 });
    expect(higher).toMatchObject({ kind: 'length', figures: 2 });
    if (low.kind === 'length') expect(low.perMetre).toBeCloseTo(52.08, 2);
  });
});

describe('rounding to significant figures', () => {
  it('keeps the leading figures and nothing else', () => {
    expect(roundSig(2979, 1)).toBe(3000);
    expect(roundSig(2979, 2)).toBe(3000);
    expect(roundSig(2940, 2)).toBe(2900);
    expect(roundSig(52.08, 1)).toBe(50);
    expect(roundSig(52.08, 2)).toBe(52);
    expect(roundSig(9.51, 1)).toBe(10);
    expect(roundSig(1.732, 2)).toBe(1.7);
    expect(roundSig(0.1763, 2)).toBe(0.18);
    expect(roundSig(0.0875, 1)).toBe(0.09);
    expect(roundSig(0, 2)).toBe(0);
    expect(roundSig(-447, 2)).toBe(-450);
    expect(String(roundSig(0.3, 1))).toBe('0.3');
  });
});

describe('compass words', () => {
  it('names the nearest of the eight points', () => {
    expect(compassWord(0)).toBe('north');
    expect(compassWord(22.4)).toBe('north');
    expect(compassWord(22.6)).toBe('north-east');
    expect(compassWord(90)).toBe('east');
    expect(compassWord(180)).toBe('south');
    expect(compassWord(225)).toBe('south-west');
    expect(compassWord(270)).toBe('west');
    expect(compassWord(337.6)).toBe('north');
    expect(compassWord(-45)).toBe('north-west');
    expect(compassWord(360)).toBe('north');
  });
});

describe('dropping a point onto the ground along the sunlight', () => {
  it('leaves points on the ground where they are', () => {
    const offset = shadowOffsetPerMetre(133, 7)!;
    expect(projectToGround({ x: 3, y: 0, z: -8 }, offset)).toEqual({ x: 3, y: 0, z: -8 });
  });

  it('puts the top of a pole h / tan(elevation) from its foot, on the far side from the Sun', () => {
    for (const [az, el] of [
      [0, 10],
      [90, 1],
      [201.5, 33],
      [315, 0.4],
    ]) {
      const offset = shadowOffsetPerMetre(az, el)!;
      const tip = projectToGround({ x: 0, y: 52, z: 0 }, offset);
      expect(tip.y).toBe(0);
      expect(Math.hypot(tip.x, tip.z)).toBeCloseTo(52 * shadowFactor(el)!, 6);
      // The tip lies along the shadow bearing: the direction opposite the Sun, on the ground.
      const away = azElToLocal(shadowBearingDeg(az), 0);
      const len = Math.hypot(tip.x, tip.z);
      expect(tip.x / len).toBeCloseTo(away.x, 9);
      expect(tip.z / len).toBeCloseTo(away.z, 9);
    }
  });

  it('gives no projection while the disc touches the level plane', () => {
    expect(shadowOffsetPerMetre(40, 0.2)).toBeNull();
    expect(shadowOffsetPerMetre(40, -1)).toBeNull();
    expect(shadowOffsetPerMetre(Number.NaN, 10)).toBeNull();
  });
});
