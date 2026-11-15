// Stage 2, MISSION SELECT. This first cut puts one site in the spotlight with a short ranked strip
// under it; the delay scrubber, the site drawer (presets and coordinates), the mission sheet and
// the assistant arrive with the full stage.

import { useRef } from 'react';
import { Icon } from '../components/Icon';
import { Glass } from '../hud/Glass';
import { Readout } from '../hud/Readout';
import { actions } from '../state/app';
import { useData } from '../state/data';
import { siteQuantities } from '../util/quantities';
import { rankWindow } from '../util/ranking';
import { useEntrance } from './useEntrance';

export function MissionHud() {
  const { rows, siteById, focus, focusRow, check } = useData();
  const rootRef = useRef<HTMLDivElement>(null);
  useEntrance(rootRef, true, 0.35);
  const q = siteQuantities(focusRow?.rank ?? null, focusRow?.evaluation ?? null, check.data);
  const strip = rankWindow(rows, focus?.id ?? null, 5);
  return (
    <div ref={rootRef} className="absolute inset-0" data-testid="mission-hud">
      <h2 className="sr-only">Mission select</h2>
      <div className="hud-layer" data-depth="0.9">
        <div className="wing-l absolute left-5 top-[4.75rem] flex w-[24rem] flex-col gap-4 max-md:left-3 max-md:right-3 max-md:w-auto" data-enter="left">
          <Glass as="section" className="flex flex-col gap-4 p-5" aria-label="Spotlight site">
            <div className="flex items-start gap-4">
              <span className="num text-[4.5rem] font-medium leading-[0.85] tracking-[-0.04em] text-accent" data-q="rank">
                <span data-q-text>{q.rank.text}</span>
              </span>
              <div className="min-w-0 pt-1">
                <h3 className="title m-0 text-[1.6rem] text-ink" data-testid="spotlight-name">
                  {focus?.name ?? 'No site yet'}
                </h3>
                <p className="m-0 mt-2 font-display text-[13px] font-semibold uppercase tracking-[0.12em]" data-tone={q.verdict.tone} data-testid="spotlight-verdict">
                  {q.verdict.text}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
              <Readout q={q.sunlightPercent} size="lg" />
              <Readout q={q.score} size="lg" />
              <Readout q={q.earthLink} />
              <Readout q={q.powerMargin} />
            </div>
          </Glass>

          <Glass as="section" className="flex flex-col gap-2 p-3" aria-label="Ranked sites">
            <div className="flex items-center justify-between gap-3 px-1">
              <h3 className="panel-title m-0">Ranking</h3>
              <span className="num text-[12px] text-muted">
                {strip.length ? `${strip[0].rank} to ${strip[strip.length - 1].rank} of ${rows.length}` : 'no sites ranked'}
              </span>
            </div>
            <ol className="m-0 flex list-none flex-col gap-0.5 p-0" data-testid="ranked-strip">
              {strip.map((row) => {
                const site = siteById.get(row.siteId);
                if (!site) return null;
                const rq = siteQuantities(row.rank, row.evaluation);
                const active = site.id === focus?.id;
                return (
                  <li key={row.siteId}>
                    <button
                      type="button"
                      className={`flex min-h-11 w-full items-center gap-3 rounded-[3px] px-2 text-left ${active ? 'bg-accent-soft' : 'hover:bg-accent-soft'}`}
                      aria-pressed={active}
                      onClick={() => actions.highlight(site.id, site)}
                      data-testid="ranked-row"
                    >
                      <span className="num w-6 shrink-0 text-[13px] text-muted">{rq.rank.text}</span>
                      <span className="min-w-0 flex-1 truncate text-[14px]" data-testid="row-name">
                        {site.name}
                      </span>
                      <span className="num text-[14px]">{rq.score.text}</span>
                      <span className="w-10 text-right font-display text-[12px] font-semibold uppercase tracking-[0.1em]" data-tone={rq.verdict.tone}>
                        {rq.passes ? 'pass' : 'fail'}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </Glass>

          <button type="button" className="btn self-start" onClick={actions.backToOrbit} data-testid="back-to-orbit">
            <Icon name="back" size={14} />
            Back to orbit
          </button>
        </div>
      </div>
    </div>
  );
}
