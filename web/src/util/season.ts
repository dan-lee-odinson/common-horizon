// The lunar south pole's season on a given date.
//
// The Moon's axis is tilted about 1.5 degrees, so over a year the Sun's overhead point drifts a
// little north and south of the lunar equator. While it is south of the equator the south pole
// leans toward the Sun: its summer, when sunlit periods there run longer.
// Source: NASA, "Lunar Site Selection" white paper, 2023 Moon to Mars Architecture Concept Review
// (see SOURCES-web.md).

export type PoleSeason = 'summer' | 'winter';

/** Summer when the Sun's latitude on the Moon is south (negative); otherwise winter. */
export function southPoleSeason(subsolarLatDeg: number): PoleSeason {
  return subsolarLatDeg < 0 ? 'summer' : 'winter';
}

/** "Lunar south pole: summer" or "Lunar south pole: winter". */
export function southPoleSeasonLine(subsolarLatDeg: number): string {
  return `Lunar south pole: ${southPoleSeason(subsolarLatDeg)}`;
}

/** One line shown on hover or tap. */
export const SOUTH_POLE_SEASON_NOTE = 'The Moon’s south pole has seasons. In its summer, sunlit periods there run longer.';
