// Text contrast on glass: at least 4.5 to 1, on the worst case.
//
// A glass panel blurs and dims whatever is behind it, then lays its tint on top. The worst case
// for light text is the brightest thing that can be behind a panel; this check assumes pure white
// there, which is brighter than anything the scenes draw. Every colour used for text must still
// reach 4.5 to 1 against the glass in that case.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { contrast, dim, over, parseColor, type Rgba } from '../util/contrast';

const css = readFileSync(fileURLToPath(new URL('./theme.css', import.meta.url)), 'utf8');

function token(name: string): string {
  const m = new RegExp(`${name}:\\s*([^;]+);`).exec(css);
  if (!m) throw new Error(`theme.css has no ${name}`);
  return m[1].trim();
}

const WHITE: Rgba = { r: 255, g: 255, b: 255, a: 1 };
const glassDim = Number(token('--ch-glass-dim'));

/** The colour of a glass panel with pure white behind it. */
function worstGlass(tint: string): Rgba {
  return over(parseColor(token(tint)), dim(WHITE, glassDim));
}

/** Every colour the interface uses for text. */
const TEXT_TOKENS = ['--ch-ink', '--ch-ink-2', '--ch-muted', '--ch-accent', '--ch-accent-strong', '--ch-sun', '--ch-earth-text', '--ch-good', '--ch-warn', '--ch-bad-text', '--ch-focus'];
/** Colours used for lines, marks and fills that carry meaning (not text): 3 to 1 is the floor. */
const GRAPHIC_TOKENS = ['--ch-cyan', '--ch-teal', '--ch-sun', '--ch-earth', '--ch-bad', '--ch-good'];

describe('text contrast on glass', () => {
  it('dims what is behind the glass', () => {
    expect(glassDim).toBeGreaterThan(0);
    expect(glassDim).toBeLessThanOrEqual(0.6);
  });

  for (const tint of ['--ch-glass', '--ch-glass-strong']) {
    for (const name of TEXT_TOKENS) {
      it(`${name} on ${tint} is at least 4.5 to 1 over a white backdrop`, () => {
        const ratio = contrast(parseColor(token(name)), worstGlass(tint));
        expect(ratio).toBeGreaterThanOrEqual(4.5);
      });
    }
  }

  for (const name of GRAPHIC_TOKENS) {
    it(`${name} as a line or mark on glass is at least 3 to 1 over a white backdrop`, () => {
      expect(contrast(parseColor(token(name)), worstGlass('--ch-glass'))).toBeGreaterThanOrEqual(3);
    });
  }

  it('button text on the accent colour is at least 4.5 to 1', () => {
    expect(contrast(parseColor(token('--ch-accent-ink')), parseColor(token('--ch-accent')))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(parseColor(token('--ch-accent-ink')), parseColor(token('--ch-accent-strong')))).toBeGreaterThanOrEqual(4.5);
  });

  it('text straight on space is at least 4.5 to 1', () => {
    for (const name of TEXT_TOKENS) {
      expect(contrast(parseColor(token(name)), parseColor(token('--ch-space')))).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('contrast arithmetic', () => {
  it('matches the known black on white and grey values', () => {
    expect(contrast(parseColor('#000'), parseColor('#fff'))).toBeCloseTo(21, 5);
    expect(contrast(parseColor('#777777'), parseColor('#ffffff'))).toBeCloseTo(4.48, 2);
    expect(parseColor('rgb(7 18 30 / 0.58)')).toEqual({ r: 7, g: 18, b: 30, a: 0.58 });
    expect(parseColor('rgba(1, 2, 3, 0.5)')).toEqual({ r: 1, g: 2, b: 3, a: 0.5 });
  });
});
