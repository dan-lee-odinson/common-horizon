// Side-by-side comparison of the saved sites, on a wide glass sheet over whatever stage is showing.

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SiteRef } from '../api/types';
import { Sheet } from '../hud/Sheet';
import { actions, appStore, simClock } from '../state/app';
import { useData, useHorizonFor } from '../state/data';
import { useStore } from '../state/store';
import { formatLatLon } from '../util/geo';
import { naturalElRange } from '../util/horizon';
import { siteQuantities } from '../util/quantities';
import { formatHours } from '../util/time';
import { AsyncView } from './AsyncView';
import { HorizonPlot } from './HorizonPlot';
import { Icon } from './Icon';

export function ComparePanel({ phone }: { phone: boolean }) {
  const open = useStore(appStore, (s) => s.compareOpen);
  const saved = useStore(appStore, (s) => s.saved);
  // Every plot in the comparison uses one shared height scale, so the skylines compare fairly.
  const [ranges, setRanges] = useState<Record<string, { min: number; max: number }>>({});
  const report = useCallback((id: string, r: { min: number; max: number }) => {
    setRanges((prev) => (prev[id]?.min === r.min && prev[id]?.max === r.max ? prev : { ...prev, [id]: r }));
  }, []);
  const shared = useMemo(() => {
    const list = saved.map((s) => ranges[s.id]).filter((r): r is { min: number; max: number } => Boolean(r));
    if (!list.length) return null;
    return { min: Math.min(...list.map((r) => r.min)), max: Math.max(...list.map((r) => r.max)) };
  }, [ranges, saved]);
  return (
    <Sheet
      open={open}
      onClose={() => actions.setCompareOpen(false)}
      title="Compare saved sites"
      note={`${saved.length} saved. The horizon plots share one height scale.`}
      testId="compare-panel"
      wide
      fit
      phone={phone}
    >
      {open ? (
        <div className="min-h-0 flex-1 overflow-auto p-4">
          {saved.length === 0 ? (
            <p className="m-0 text-[14px] text-ink-2">Save a site with the star beside “Zoom in to this site”, then compare here.</p>
          ) : (
            <ul className="m-0 flex list-none gap-3 p-0" style={{ minWidth: saved.length * 300 }}>
              {saved.map((site) => (
                <CompareColumn key={site.id} site={site} elRange={shared} onRange={report} />
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </Sheet>
  );
}

function CompareColumn({ site, elRange, onRange }: { site: SiteRef; elRange: { min: number; max: number } | null; onRange: (id: string, r: { min: number; max: number }) => void }) {
  const { evaluation, rows, landingMs, plannedLandingMs, windowStartMs, windowEndMs } = useData();
  const timeScale = useStore(appStore, (s) => s.timeScale);
  const nowMs = useStore(simClock, (s) => s.nowMs);
  const horizon = useHorizonFor(site, windowStartMs, windowEndMs);
  const row = rows.find((r) => r.siteId === site.id);
  useEffect(() => {
    if (horizon.data && horizon.data.skyline.length) onRange(site.id, naturalElRange(horizon.data));
  }, [horizon.data, onRange, site.id]);
  const q = siteQuantities(row?.rank ?? null, row?.evaluation ?? null);
  return (
    <li className="flex w-[300px] shrink-0 flex-col gap-3 rounded-[4px] border border-line p-3" data-testid="compare-column">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="title m-0 break-words text-[16px] text-ink">{site.name}</h3>
          <p className="num m-0 mt-0.5 text-[12px] text-ink-2">{formatLatLon(site.lat, site.lon_east, 3)}</p>
        </div>
        <button type="button" className="btn btn-quiet btn-icon shrink-0 text-sun" aria-label={`Remove ${site.name} from saved sites`} onClick={() => actions.toggleSaved(site)}>
          <Icon name="star-filled" size={15} />
        </button>
      </div>
      {row ? (
        <dl className="num m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13px]">
          <dt className="text-ink-2">Rank</dt>
          <dd className="m-0 text-right text-ink">
            {row.rank}
            {row.planned ? <span className="text-ink-2"> (planned {row.planned.rank})</span> : null}
          </dd>
          <dt className="text-ink-2">Score</dt>
          <dd className="m-0 text-right font-semibold text-ink">
            {row.planned ? <span className="font-normal text-ink-2">{row.planned.score} to </span> : null}
            {q.score.text}
          </dd>
          <dt className="text-ink-2">Sunlight</dt>
          <dd className="m-0 text-right" data-tone="sun">
            {formatHours(row.evaluation.sunlight_hours)}, {q.sunlightPercent.text} %
          </dd>
          <dt className="text-ink-2">Clear sky</dt>
          <dd className="m-0 text-right text-ink">{q.clearSky.text} %</dd>
          <dt className="text-ink-2">Earth link</dt>
          <dd className="m-0 text-right" data-tone={q.earthLink.tone}>
            {q.earthLink.text}
          </dd>
          <dt className="text-ink-2">Hardware</dt>
          <dd className="m-0 text-right" data-tone={row.evaluation.hardware_fits ? undefined : 'bad'}>
            {row.evaluation.hardware_fits ? 'fits' : 'does not fit'}
          </dd>
          <dt className="text-ink-2">Energy, stay</dt>
          <dd className="m-0 text-right" data-tone={q.energy.tone}>
            {q.energy.text} {q.energy.unit}
          </dd>
          <dt className="text-ink-2">Result</dt>
          <dd className="m-0 text-right font-sans" data-tone={q.verdict.tone}>
            {q.verdict.text}
          </dd>
        </dl>
      ) : (
        <p className="m-0 text-[13px] text-ink-2">{evaluation.status === 'waiting' ? 'Evaluating…' : 'Choose hardware in the mission planner to rank this site.'}</p>
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
              elRange={elRange}
            />
          ) : null
        }
      </AsyncView>
    </li>
  );
}
