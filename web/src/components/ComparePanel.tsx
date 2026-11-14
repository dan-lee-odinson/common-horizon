// Side-by-side comparison of the saved (starred) sites. Opens over whatever view is showing.

import { useId } from 'react';
import type { SiteRef } from '../api/types';
import { actions, appStore, simClock } from '../state/app';
import { useData, useHorizonFor } from '../state/data';
import { useStore } from '../state/store';
import { formatLatLon } from '../util/geo';
import { formatKwh, formatPercent, powerColorVar, powerLevel } from '../util/power';
import { formatHours } from '../util/time';
import { AsyncView } from './AsyncView';
import { EARTH_LINK_COLOR, EARTH_LINK_WORD, HorizonPlot } from './HorizonPlot';
import { Icon } from './Icon';

export function ComparePanel() {
  const saved = useStore(appStore, (s) => s.saved);
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className="glass enter absolute inset-2 z-40 flex flex-col overflow-hidden rounded-xl md:inset-4"
      data-testid="compare-panel"
    >
      <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        <Icon name="compare" />
        <h2 id={headingId} className="m-0 text-[14px] font-semibold">
          Compare saved sites
        </h2>
        <span className="text-[12px] text-muted">{saved.length} saved</span>
        <button type="button" className="btn ml-auto" onClick={() => actions.setCompareOpen(false)}>
          <Icon name="close" size={14} /> Close
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {saved.length === 0 ? (
          <p className="text-[13px] text-muted">Star a site in the ranked list to save it, then compare here.</p>
        ) : (
          <ul className="m-0 flex list-none gap-3 p-0" style={{ minWidth: saved.length * 280 }}>
            {saved.map((site) => (
              <CompareColumn key={site.id} site={site} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function CompareColumn({ site }: { site: SiteRef }) {
  const { evaluation, landingMs, plannedLandingMs, windowStartMs, windowEndMs } = useData();
  const timeScale = useStore(appStore, (s) => s.timeScale);
  const nowMs = useStore(simClock, (s) => s.nowMs);
  const horizon = useHorizonFor(site, windowStartMs, windowEndMs);
  const row = evaluation.data?.rows.find((r) => r.siteId === site.id);
  const e = row?.evaluation;
  return (
    <li className="panel flex w-[280px] shrink-0 flex-col gap-2 rounded-lg p-3" data-testid="compare-column">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="m-0 truncate text-[14px] font-semibold">{site.name}</h3>
          <p className="m-0 text-[11px] text-muted num">{formatLatLon(site.lat, site.lon_east, 3)}</p>
        </div>
        <button type="button" className="btn btn-icon text-sun" aria-label={`Remove ${site.name} from saved sites`} onClick={() => actions.toggleSaved(site)}>
          <Icon name="star-filled" size={15} />
        </button>
      </div>
      {e && row ? (
        <dl className="m-0 grid grid-cols-2 gap-x-3 gap-y-1 text-[12px] num">
          <dt className="text-muted">Rank</dt>
          <dd className="m-0 text-right">
            {row.rank}
            {row.planned ? <span className="text-muted"> (planned {row.planned.rank})</span> : null}
          </dd>
          <dt className="text-muted">Score</dt>
          <dd className="m-0 text-right font-semibold">
            {row.planned ? <span className="font-normal text-muted">{row.planned.score} → </span> : null}
            {e.score}
          </dd>
          <dt className="text-muted">Sunlight</dt>
          <dd className="m-0 text-right">
            {formatHours(e.sunlight_hours)} · {formatPercent(e.sunlight_percent)}
          </dd>
          <dt className="text-muted">Clear sky</dt>
          <dd className="m-0 text-right">{formatPercent(e.clear_sky_percent)}</dd>
          <dt className="text-muted">Earth link</dt>
          <dd className="m-0 flex items-center justify-end gap-1.5">
            <span className="inline-block size-2 rounded-full" style={{ background: EARTH_LINK_COLOR[e.earth_link] }} aria-hidden />
            {EARTH_LINK_WORD[e.earth_link]}
          </dd>
          <dt className="text-muted">Hardware</dt>
          <dd className="m-0 text-right" style={{ color: e.hardware_fits ? undefined : 'var(--ch-bad)' }}>
            {e.hardware_fits ? 'fits' : 'does not fit'}
          </dd>
          <dt className="text-muted">Added energy</dt>
          <dd className="m-0 text-right" style={{ color: powerColorVar(powerLevel(e.power_margin_percent)) }}>
            {formatKwh(e.energy_added_kwh)}
          </dd>
          <dt className="text-muted">Result</dt>
          <dd className={`m-0 text-right ${e.verdict.result === 'fail' ? 'text-bad' : 'text-good'}`}>
            {e.verdict.result === 'fail' ? `fail: ${e.verdict.requirement}` : 'pass'}
          </dd>
        </dl>
      ) : (
        <p className="m-0 text-[12px] text-muted">{evaluation.status === 'waiting' ? 'Evaluating…' : 'Tick hardware to rank this site.'}</p>
      )}
      <AsyncView result={horizon} what="the horizon" waiting={<div className="skeleton h-24 w-full" />}>
        {(h) =>
          landingMs !== null && windowStartMs !== null && windowEndMs !== null ? (
            <HorizonPlot
              data={h}
              compact
              siteName={site.name}
              nowMs={nowMs ?? landingMs}
              windowStartMs={windowStartMs}
              windowEndMs={windowEndMs}
              landingMs={landingMs}
              plannedLandingMs={plannedLandingMs}
              readouts={null}
              timeScale={timeScale}
            />
          ) : null
        }
      </AsyncView>
    </li>
  );
}
