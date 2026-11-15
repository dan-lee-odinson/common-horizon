// The short ranked strip under the spotlight: a few rows of the ranking around the spotlight site,
// not the whole list. Each row shows rank, name, score, a small lit/dark bar and the pass or fail
// word. Click a row, or use the arrow keys, to move the spotlight through the whole ranking.
//
// When the launch delay reorders the ranking, rows that stay in view slide to their new places
// (GSAP, from wherever they are on screen, so a second change mid-slide stays smooth). Moving the
// spotlight through an unchanged ranking (a click, the arrow keys) does not animate: the rows are
// simply the next ones, at once, however fast the keys come.
//
// While a newer ranking is on its way the strip stays as it is: the same rows, a little dimmed and
// marked busy, still taking clicks and keys. It is never taken away and put back, so the keyboard
// focus stays where the visitor left it.

import { useLayoutEffect, useRef, type KeyboardEvent } from 'react';
import gsap from 'gsap';
import { Icon } from '../components/Icon';
import { Glass } from '../hud/Glass';
import { actions, appStore } from '../state/app';
import { slopeContext, useData } from '../state/data';
import { useStore } from '../state/store';
import { prefersReducedMotion } from '../state/useMedia';
import { siteQuantities } from '../util/quantities';
import { movedText, rankWindow, type RankedRow } from '../util/ranking';

/** Rows shown at once. */
export const STRIP_ROWS = 5;

export function RankStrip({ rows = STRIP_ROWS }: { rows?: number }) {
  const { rows: ranked, siteById, focus, updating, landerSlopeLimitDeg } = useData();
  const slipDays = useStore(appStore, (s) => s.slipDays);
  const saved = useStore(appStore, (s) => s.saved);
  const listRef = useRef<HTMLDivElement>(null);
  const lastTops = useRef(new Map<string, number>());
  const lastSaid = useRef('');
  const lastShown = useRef<string | null>(null);
  const at = focus ? ranked.findIndex((r) => r.siteId === focus.id) : -1;
  // The rows shown are those around the spotlight site. A site with no row yet (a point typed in a
  // moment ago, still being ranked) leaves the strip where it was, around the site shown before.
  if (focus && at >= 0) lastShown.current = focus.id;
  const strip = rankWindow(ranked, at >= 0 ? focus!.id : lastShown.current, rows);

  const order = ranked.map((r) => r.siteId).join('|');
  const lastOrder = useRef(order);
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const reranked = lastOrder.current !== order;
    lastOrder.current = order;
    const reduce = prefersReducedMotion();
    const next = new Map<string, number>();
    list.querySelectorAll<HTMLElement>('[data-site-id]').forEach((el) => {
      const id = el.dataset.siteId!;
      const top = el.offsetTop;
      next.set(id, top);
      const prev = lastTops.current.get(id);
      if (reduce || !reranked || prev === undefined) return;
      const shown = Number(gsap.getProperty(el, 'y')) || 0;
      const from = prev + shown - top;
      if (Math.abs(from) > 0.5) gsap.fromTo(el, { y: from }, { y: 0, duration: 0.3, ease: 'power3.inOut', overwrite: true });
    });
    lastTops.current = next;
  }, [strip.map((r) => r.siteId).join('|'), order]);

  function select(row: RankedRow | undefined) {
    const site = row ? siteById.get(row.siteId) : undefined;
    if (site) actions.highlight(site.id, site);
  }
  function step(delta: number) {
    if (ranked.length === 0) return;
    select(ranked[Math.min(ranked.length - 1, Math.max(0, (at < 0 ? 0 : at) + delta))]);
  }
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') step(1);
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') step(-1);
    else if (e.key === 'Home') select(ranked[0]);
    else if (e.key === 'End') select(ranked[ranked.length - 1]);
    else return;
    e.preventDefault();
  }

  if (ranked.length === 0) return null;
  const first = ranked[0];
  // Said once the ranking for the new delay has arrived, never from the previous ranking.
  if (!updating) {
    lastSaid.current =
      slipDays > 0
        ? `Delay ${slipDays} ${slipDays === 1 ? 'day' : 'days'}: ${siteById.get(first.siteId)?.name ?? first.siteId} is now first${first.moved > 0 ? `, ${movedText(first.moved)}` : ''}.`
        : '';
  }
  const announcement = lastSaid.current;
  // "01 to 05 of 17": the ranks of the first and last row shown, and of the last site ranked.
  const last = ranked[ranked.length - 1];
  const range = {
    from: siteQuantities(strip[0].rank, strip[0].evaluation).rank,
    to: siteQuantities(strip[strip.length - 1].rank, strip[strip.length - 1].evaluation).rank,
    of: siteQuantities(last.rank, last.evaluation).rank,
  };

  return (
    <Glass as="section" brackets={false} className="flex flex-col gap-1.5 p-2.5" aria-label="Ranked sites" aria-busy={updating} data-testid="rank-strip" data-panel>
      <div className="flex items-center justify-between gap-2 pl-1.5">
        <h3 className="panel-title m-0">Ranking</h3>
        <div className="flex items-center gap-1">
          <span className="num mr-1 text-[12px] text-muted" data-testid="strip-range">
            {range.from.text} to {range.to.text} of {range.of.text}
          </span>
          <button type="button" className="btn btn-quiet btn-icon" aria-label="Spotlight the site ranked above" disabled={at <= 0} onClick={() => step(-1)} data-testid="strip-up">
            <Icon name="chevron-up" />
          </button>
          <button type="button" className="btn btn-quiet btn-icon" aria-label="Spotlight the site ranked below" disabled={at >= ranked.length - 1} onClick={() => step(1)} data-testid="strip-down">
            <Icon name="chevron-down" />
          </button>
        </div>
      </div>
      <p className="sr-only" aria-live="polite" data-testid="rank-announcement">
        {announcement}
      </p>
      <div
        ref={listRef}
        role="listbox"
        aria-label={`Ranked sites, ${strip[0].rank} to ${strip[strip.length - 1].rank} of ${ranked.length}. Arrow keys move the spotlight.`}
        aria-activedescendant={focus && at >= 0 ? `strip-${focus.id}` : undefined}
        tabIndex={0}
        className="relative flex flex-col gap-0.5 rounded-[3px] outline-offset-2"
        onKeyDown={onKeyDown}
        data-testid="ranked-strip"
      >
        {strip.map((row) => {
          const site = siteById.get(row.siteId);
          if (!site) return null;
          const e = row.evaluation;
          const q = siteQuantities(row.rank, e, null, slopeContext(site, landerSlopeLimitDeg));
          const active = site.id === focus?.id;
          const lit = Math.max(0, Math.min(100, e.sunlight_percent));
          return (
            <div
              key={row.siteId}
              id={`strip-${site.id}`}
              role="option"
              aria-selected={active}
              data-site-id={row.siteId}
              data-testid="ranked-row"
              className={`settling grid min-h-11 cursor-pointer grid-cols-[1.75rem_minmax(0,1fr)_auto_4.25rem] items-center gap-x-2.5 rounded-[3px] border px-2 py-1 short:min-h-10 ${active ? 'border-line-strong bg-accent-soft' : 'border-transparent hover:bg-accent-soft'}`}
              onClick={() => select(row)}
            >
              <span className="num text-[14px] text-ink-2" data-testid="row-rank">
                {q.rank.text}
              </span>
              <span className="flex min-w-0 flex-col gap-1">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate text-[14px] leading-tight text-ink" data-testid="row-name" title={site.name}>
                    {site.name}
                  </span>
                  {saved.some((s) => s.id === site.id) ? (
                    <span className="shrink-0 text-sun" title="Saved">
                      <Icon name="star-filled" size={12} />
                      <span className="sr-only">saved</span>
                    </span>
                  ) : null}
                  {row.planned && row.moved !== 0 ? (
                    <span className="num flex shrink-0 items-center text-[12px]" data-tone={row.moved > 0 ? 'good' : 'muted'} title={`Rank ${row.planned.rank} with no delay`} data-testid="moved">
                      <Icon name={row.moved > 0 ? 'up' : 'down'} size={12} />
                      {Math.abs(row.moved)}
                      <span className="sr-only">: {movedText(row.moved)} since the plan</span>
                    </span>
                  ) : null}
                </span>
                {/* The small lit/dark bar: the lit share of the stay in amber, the dark share beside it. */}
                <span className="flex h-1 w-full overflow-hidden rounded-[1px]" title={`Sunlit for ${q.sunlightPercent.text} % of the stay`} aria-hidden>
                  <span style={{ width: `${lit}%`, background: 'var(--ch-sun)' }} />
                  <span className="flex-1" style={{ background: 'var(--ch-line)' }} />
                </span>
                <span className="sr-only">sunlit {q.sunlightPercent.text} % of the stay</span>
              </span>
              <span className="num text-right text-[15px] font-medium text-ink">
                <span className="sr-only">score </span>
                {q.score.text}
              </span>
              <span
                className="text-right font-display text-[12px] font-semibold uppercase tracking-[0.1em]"
                data-tone={q.verdict.tone}
                data-testid="verdict"
                data-result={q.result ?? ''}
                data-answer-result={q.answerResult ?? ''}
                title={q.slopeNote ? `pass. ${q.slopeNote}` : q.verdict.text}
              >
                {q.verdictWord}
                {/* The requirement behind a fail or an unknown, or why the slope was not checked, for screen readers (the title carries it on hover). */}
                {q.slopeNote ? <span className="sr-only">. {q.slopeNote}</span> : q.result !== 'pass' && e.verdict.requirement ? <span className="sr-only">: {e.verdict.requirement}</span> : null}
              </span>
            </div>
          );
        })}
      </div>
    </Glass>
  );
}
