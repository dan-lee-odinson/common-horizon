// Side-by-side comparison of the saved sites, on a wide glass sheet over whatever stage is showing.

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { HorizonResponse, SiteRef } from '../api/types';
import { HorizonPanel, type SunMark } from '../hud/HorizonPanel';
import { Sheet } from '../hud/Sheet';
import { StayTimeline, type StayState } from '../hud/StayTimeline';
import { actions, appStore, simClock } from '../state/app';
import { useData, useHorizonFor } from '../state/data';
import { useStore } from '../state/store';
import { formatLatLon } from '../util/geo';
import { litPeriods, naturalElRange } from '../util/horizon';
import { siteQuantities, skyAt, stayPeriodQuantities, type SkyNow } from '../util/quantities';
import { clipPeriods } from '../util/stay';
import { AsyncView } from './AsyncView';
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
  const { evaluation, rows, landingMs, windowStartMs, windowEndMs } = useData();
  const horizon = useHorizonFor(site, windowStartMs, windowEndMs);
  const row = rows.find((r) => r.siteId === site.id);
  useEffect(() => {
    if (horizon.data && horizon.data.skyline.length) onRange(site.id, naturalElRange(horizon.data));
  }, [horizon.data, onRange, site.id]);
  const q = siteQuantities(row?.rank ?? null, row?.evaluation ?? null);
  // Where the site stood with no delay, as the same kind of readout.
  const planned = row?.planned ? siteQuantities(row.planned.rank, { ...row.evaluation, score: row.planned.score }) : null;
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
            {q.rank.text}
            {planned ? <span className="text-ink-2"> (planned {planned.rank.text})</span> : null}
          </dd>
          <dt className="text-ink-2">Score</dt>
          <dd className="m-0 text-right font-semibold text-ink">
            {planned ? <span className="font-normal text-ink-2">{planned.score.text} to </span> : null}
            {q.score.text}
          </dd>
          <dt className="text-ink-2">Sunlight</dt>
          <dd className="m-0 text-right" data-tone="sun">
            {q.sunlightHours.text} {q.sunlightHours.unit}, {q.sunlightPercent.text} {q.sunlightPercent.unit}
          </dd>
          <dt className="text-ink-2">Clear sky</dt>
          <dd className="m-0 text-right text-ink">
            {q.clearSky.text} {q.clearSky.unit}
          </dd>
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
          landingMs !== null && windowStartMs !== null && windowEndMs !== null && h.site_id === site.id ? (
            <CompareSky site={site} horizon={h} elRange={elRange} landingMs={landingMs} startMs={Math.min(windowStartMs, landingMs)} endMs={windowEndMs} />
          ) : null
        }
      </AsyncView>
    </li>
  );
}

/** One site's sky in the comparison: the compact horizon plot over its lit and dark periods. */
function CompareSky({ site, horizon, elRange, landingMs, startMs, endMs }: { site: SiteRef; horizon: HorizonResponse; elRange: { min: number; max: number } | null; landingMs: number; startMs: number; endMs: number }) {
  const { track } = useData();
  const trackData = track.data;
  const now = () => simClock.get().nowMs ?? landingMs;
  // The sky at the instant shown, worked out once for each instant and read by both markers.
  const read = useMemo(() => {
    let at = Number.NaN;
    let sky: SkyNow | null = null;
    let sun: SunMark | null = null;
    const look = (): SkyNow => {
      const tMs = simClock.get().nowMs ?? landingMs;
      if (sky === null || !Object.is(tMs, at)) {
        at = tMs;
        sky = skyAt({ track: trackData, tMs, landingMs, site, horizon });
        sun = sky.sun ? { az: sky.sun.az, el: sky.sun.el, lit: sky.lit } : null;
      }
      return sky;
    };
    return {
      sun: (): SunMark | null => {
        look();
        return sun;
      },
      earth: () => look().earth,
      state: (): StayState => {
        const lit = look().lit;
        return lit === null ? 'unknown' : lit ? 'lit' : 'dark';
      },
    };
  }, [trackData, landingMs, site, horizon]);
  const periods = useMemo(() => clipPeriods(litPeriods(horizon), startMs, endMs), [horizon, startMs, endMs]);
  const periodList = useMemo(() => stayPeriodQuantities(periods, landingMs), [periods, landingMs]);
  const delayed = landingMs > startMs;
  return (
    <div className="flex flex-col gap-1.5">
      <HorizonPanel
        data={horizon}
        fromMs={startMs}
        toMs={endMs}
        elRange={elRange}
        label={`Horizon plot for ${site.name}: the terrain skyline, the Sun’s path over the stay (solid above the skyline, dashed where the terrain hides it) and the part of the sky Earth moves through.`}
        getSun={read.sun}
        getEarth={read.earth}
        variant="compact"
        compassStep={90}
        testId="horizon-compact"
      />
      <StayTimeline
        periods={periods}
        startMs={startMs}
        endMs={endMs}
        landingMs={landingMs}
        getNow={now}
        getState={read.state}
        periodList={periodList}
        compact
        label={`Lit and dark periods at ${site.name}, from ${delayed ? 'the planned landing' : 'the landing'} to the end of the stay.`}
        testId="stay-compact"
      />
    </div>
  );
}
