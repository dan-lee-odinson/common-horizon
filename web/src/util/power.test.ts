import { describe, expect, it } from 'vitest';
import { formatKwh, formatPercent, powerColorVar, powerLevel } from './power';

describe('power colour thresholds', () => {
  it('is green at a margin of 25 % or more', () => {
    expect(powerLevel(25)).toBe('good');
    expect(powerLevel(80)).toBe('good');
    expect(powerColorVar(powerLevel(25))).toBe('var(--ch-good)');
  });
  it('is yellow when positive but under 25 %', () => {
    expect(powerLevel(24.999)).toBe('thin');
    expect(powerLevel(0.01)).toBe('thin');
    expect(powerColorVar(powerLevel(10))).toBe('var(--ch-warn)');
  });
  it('treats exactly 0 % as yellow (no deficit, no reserve)', () => {
    expect(powerLevel(0)).toBe('thin');
  });
  it('is red when negative', () => {
    expect(powerLevel(-0.01)).toBe('short');
    expect(powerLevel(-100)).toBe('short');
    expect(powerColorVar(powerLevel(-5))).toBe('var(--ch-bad)');
  });
  it('is grey when there is no number', () => {
    expect(powerLevel(null)).toBe('unknown');
    expect(powerLevel(undefined)).toBe('unknown');
    expect(powerLevel(Number.NaN)).toBe('unknown');
  });
});

describe('number formats', () => {
  it('signs percentages', () => {
    expect(formatPercent(32.4, true)).toBe('+32%');
    expect(formatPercent(-100, true)).toBe('−100%');
    expect(formatPercent(null)).toBe('—');
  });
  it('signs energy', () => {
    expect(formatKwh(672)).toBe('+672 kWh');
    expect(formatKwh(-56)).toBe('−56 kWh');
    expect(formatKwh(25_000)).toBe('+25,000 kWh');
  });
});
