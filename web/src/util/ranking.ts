// Turns evaluation answers into ranked rows, and compares the slipped ranking with the plan.

import type { SiteEvaluation } from '../api/types';

export interface RankedRow {
  siteId: string;
  rank: number;
  evaluation: SiteEvaluation;
  /** Present when a slip is set: where the site stood with no slip. */
  planned: { rank: number; score: number } | null;
  /** Places moved since the plan: positive = moved up the list, negative = moved down. */
  moved: number;
}

/** Best score first; ties broken by site id so the order never flickers. */
export function sortByScore(results: readonly SiteEvaluation[]): SiteEvaluation[] {
  return [...results].sort((a, b) => b.score - a.score || a.site_id.localeCompare(b.site_id));
}

export function rankRows(current: readonly SiteEvaluation[], planned: readonly SiteEvaluation[] | null): RankedRow[] {
  const now = sortByScore(current);
  const before = planned ? sortByScore(planned) : null;
  const plannedRank = new Map<string, { rank: number; score: number }>();
  before?.forEach((e, i) => plannedRank.set(e.site_id, { rank: i + 1, score: e.score }));
  return now.map((evaluation, i) => {
    const p = plannedRank.get(evaluation.site_id) ?? null;
    return {
      siteId: evaluation.site_id,
      rank: i + 1,
      evaluation,
      planned: p,
      moved: p ? p.rank - (i + 1) : 0,
    };
  });
}

export function movedText(moved: number): string {
  if (moved === 0) return 'no change';
  const n = Math.abs(moved);
  return `${moved > 0 ? 'up' : 'down'} ${n} place${n === 1 ? '' : 's'}`;
}
