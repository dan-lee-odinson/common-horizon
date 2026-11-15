// Turns evaluation answers into ranked rows, and compares the slipped ranking with the plan.

import type { SiteEvaluation } from '../api/types';

export interface RankedRow {
  siteId: string;
  /** The backend's rank (1 = best): the order of the answer, never re-sorted here. */
  rank: number;
  evaluation: SiteEvaluation;
  /** Present when a slip is set: where the site stood with no slip, and its result then. */
  planned: { rank: number; score: number | null; evaluation: SiteEvaluation } | null;
  /** Places moved since the plan: positive = moved up the list, negative = moved down. */
  moved: number;
}

/**
 * The answer's own order. The backend ranks (passing sites, then unknown, then failing, each by
 * score) and gives every result its `rank`: the website keeps that order and never sorts by score.
 * Results are put in rank order only in case an answer lists them otherwise; equal ranks keep the
 * answer's order.
 */
export function inRankOrder(results: readonly SiteEvaluation[]): SiteEvaluation[] {
  return results
    .map((e, i) => ({ e, i }))
    .sort((a, b) => (Number.isFinite(a.e.rank) ? a.e.rank : Infinity) - (Number.isFinite(b.e.rank) ? b.e.rank : Infinity) || a.i - b.i)
    .map((x) => x.e);
}

export function rankRows(current: readonly SiteEvaluation[], planned: readonly SiteEvaluation[] | null): RankedRow[] {
  const now = inRankOrder(current);
  const plannedRank = new Map<string, NonNullable<RankedRow['planned']>>();
  if (planned) inRankOrder(planned).forEach((e, i) => plannedRank.set(e.site_id, { rank: Number.isFinite(e.rank) ? e.rank : i + 1, score: e.score, evaluation: e }));
  return now.map((evaluation, i) => {
    const rank = Number.isFinite(evaluation.rank) ? evaluation.rank : i + 1;
    const p = plannedRank.get(evaluation.site_id) ?? null;
    return {
      siteId: evaluation.site_id,
      rank,
      evaluation,
      planned: p,
      moved: p ? p.rank - rank : 0,
    };
  });
}

export function movedText(moved: number): string {
  if (moved === 0) return 'no change';
  const n = Math.abs(moved);
  return `${moved > 0 ? 'up' : 'down'} ${n} place${n === 1 ? '' : 's'}`;
}

/**
 * A short window of the ranking around one site: `size` rows that include the site, kept inside the
 * list. With no site (or one that is not ranked) it is the top of the list.
 */
export function rankWindow<T extends { siteId: string }>(rows: readonly T[], siteId: string | null, size: number): T[] {
  const n = Math.max(1, Math.floor(size));
  if (rows.length <= n) return [...rows];
  const at = Math.max(0, siteId === null ? 0 : rows.findIndex((r) => r.siteId === siteId));
  const start = Math.min(rows.length - n, Math.max(0, at - Math.floor(n / 2)));
  return rows.slice(start, start + n);
}
