import { describe, expect, it } from 'vitest';
import { SOUTH_POLE_SEASON_NOTE, southPoleSeason, southPoleSeasonLine } from './season';

describe('lunar south pole season', () => {
  it('is summer when the Sun is overhead south of the lunar equator', () => {
    expect(southPoleSeason(-1.54)).toBe('summer');
    expect(southPoleSeason(-0.0001)).toBe('summer');
    expect(southPoleSeasonLine(-0.8)).toBe('Lunar south pole: summer');
  });

  it('is winter when the Sun is overhead north of the lunar equator (or on it)', () => {
    expect(southPoleSeason(1.54)).toBe('winter');
    expect(southPoleSeason(0)).toBe('winter');
    expect(southPoleSeasonLine(0.8)).toBe('Lunar south pole: winter');
  });

  it('keeps the one-line explanation as written', () => {
    expect(SOUTH_POLE_SEASON_NOTE).toBe('The Moon’s south pole has seasons. In its summer, sunlit periods there run longer.');
  });
});
