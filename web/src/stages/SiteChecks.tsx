// The Site stage's notes on the data behind the sky: whether the terrain is included, the horizon
// answer's own warnings, and the check against NASA's JPL Horizons System.
//
// "Checked against NASA JPL Horizons" gives the stored figures for this site, read at run time from
// data/horizons-check.json (written by backend/scripts/validate_against_horizons.py). When the file
// or this site is not in it, the line is not shown. In live mode "Compare now" asks the backend
// (GET /api/v1/horizons/compare) once, for this site and the instant on the site clock, and shows
// both directions and the angle between them. It is asked only when pressed, never per frame. Any
// failure falls back to the stored figure and says so.

import { useEffect, useId, useRef, useState } from 'react';
import { api, isMockMode } from '../api/client';
import { isAbortError } from '../api/errors';
import type { HorizonResponse, HorizonsCheckFile, HorizonsCompareResponse, SiteEvaluation, SiteRef } from '../api/types';
import { Glass } from '../hud/Glass';
import { simClock } from '../state/app';
import { formatUtcMinute, toIsoUtc } from '../util/time';
import { TERRAIN_NOT_INCLUDED, terrainNotIncluded } from '../util/terrain';

/** An angle in degrees, to the figure the check stores (a millionth of a degree), without trailing zeros. */
function angle(deg: number | null | undefined): string {
  if (typeof deg !== 'number' || !Number.isFinite(deg)) return '—';
  return `${Number(deg.toFixed(6))}°`;
}

function direction(d: { azimuth_deg: number; elevation_deg: number } | null): string {
  if (!d || !Number.isFinite(d.azimuth_deg) || !Number.isFinite(d.elevation_deg)) return '—';
  return `az ${d.azimuth_deg.toFixed(4)}°, el ${d.elevation_deg >= 0 ? '+' : '−'}${Math.abs(d.elevation_deg).toFixed(4)}°`;
}

type Compare = { state: 'idle' } | { state: 'waiting' } | { state: 'answer'; data: HorizonsCompareResponse } | { state: 'failed'; message: string };

export function SiteChecks({
  site,
  evaluation,
  horizon,
  check,
  landingMs,
  bare = false,
}: {
  site: SiteRef | null;
  evaluation: SiteEvaluation | null;
  horizon: HorizonResponse | null;
  check: HorizonsCheckFile | null;
  landingMs: number | null;
  bare?: boolean;
}) {
  const live = !isMockMode();
  const smooth = terrainNotIncluded(evaluation, horizon);
  const stored = site && check?.sites && Object.hasOwn(check.sites, site.id) ? check.sites[site.id] : null;
  const warnings = [...new Set(horizon?.warnings ?? [])];
  const [compare, setCompare] = useState<Compare>({ state: 'idle' });
  // The question on its way, if any: a new site or a new press drops it.
  const pending = useRef<AbortController | null>(null);
  const resultId = useId();

  // A new site starts afresh, and a question still on its way is dropped.
  const siteKey = site ? `${site.id}:${site.lat}:${site.lon_east}` : '';
  useEffect(() => {
    setCompare({ state: 'idle' });
    return () => {
      pending.current?.abort();
      pending.current = null;
    };
  }, [siteKey]);

  function compareNow() {
    if (!site) return;
    pending.current?.abort();
    const c = new AbortController();
    pending.current = c;
    setCompare({ state: 'waiting' });
    // The instant on the site clock, read once, when pressed.
    const tMs = simClock.get().nowMs ?? landingMs;
    if (tMs === null || !Number.isFinite(tMs)) {
      setCompare({ state: 'failed', message: 'There is no time on the clock to compare yet.' });
      return;
    }
    api
      .horizonsCompare({ latitude_deg: site.lat, longitude_deg: site.lon_east, time_utc: toIsoUtc(tMs), site_height_m: evaluation?.elevation_m }, c.signal)
      .then((data) => {
        if (!c.signal.aborted) setCompare({ state: 'answer', data });
      })
      .catch((err: unknown) => {
        if (c.signal.aborted || isAbortError(err)) return;
        setCompare({ state: 'failed', message: err instanceof Error ? err.message : 'The comparison did not come back.' });
      });
  }

  if (!site || (!smooth && warnings.length === 0 && !stored && !live)) return null;

  const body = (
    <div className="flex flex-col gap-2 text-[13px] leading-snug" data-testid="site-checks">
      {smooth ? (
        <p className="m-0" data-tone="warn" data-testid="site-terrain-note">
          {TERRAIN_NOT_INCLUDED}
        </p>
      ) : null}
      {stored ? (
        <p className="m-0 text-ink" data-testid="horizons-check">
          Checked against NASA JPL Horizons: Sun within <span className="num">{angle(stored.sun_max_angle_deg)}</span>, Earth within{' '}
          <span className="num">{angle(stored.earth_max_angle_deg)}</span>
          <span className="text-ink-2">
            {' '}
            (largest angle, hourly, {stored.period.start_utc.slice(0, 10)} to {stored.period.stop_utc.slice(0, 10)}, {stored.samples.sun.toLocaleString('en-US')} samples; retrieved {stored.retrieved_utc.replace('T', ' ').replace('Z', ' UTC')})
          </span>
        </p>
      ) : null}
      {live ? (
        <div className="flex flex-col gap-1.5">
          <button type="button" className="btn w-fit" onClick={compareNow} disabled={compare.state === 'waiting'} aria-controls={resultId} data-testid="horizons-compare">
            {compare.state === 'waiting' ? 'Asking JPL Horizons…' : 'Compare now'}
          </button>
          <div id={resultId} aria-live="polite">
            {compare.state === 'answer' ? <CompareResult data={compare.data} /> : null}
            {compare.state === 'failed' ? (
              <p className="m-0 text-ink-2" role="status" data-testid="horizons-compare-failed">
                <span data-tone="warn">The live comparison did not work.</span> {compare.message}{' '}
                {stored ? 'Showing the stored figure above instead.' : 'There is no stored figure for this site.'}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
      {warnings.length > 0 ? (
        <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[12px] text-ink-2" aria-label="Warnings from the horizon answer" data-testid="horizon-warnings">
          {warnings.map((w) => (
            <li key={w} className="break-words">
              {w}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
  if (bare) return body;
  return (
    // In the wing it takes the room left above the console, and scrolls inside it.
    <Glass as="section" className="flex min-h-0 flex-col gap-2 overflow-y-auto overscroll-contain p-3" aria-label="Data checks" data-panel data-testid="site-checks-panel">
      <h3 className="panel-title m-0">Data checks</h3>
      {body}
    </Glass>
  );
}

function CompareResult({ data }: { data: HorizonsCompareResponse }) {
  const t = Date.parse(data.time_utc);
  const rows = [
    { name: 'Sun', b: data.sun },
    { name: 'Earth', b: data.earth },
  ];
  return (
    <div className="flex flex-col gap-1" data-testid="horizons-compare-result">
      <p className="m-0 text-ink-2">At {Number.isFinite(t) ? `${formatUtcMinute(t)} UTC` : data.time_utc}:</p>
      <dl className="num m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-[12px]">
        {rows.map(({ name, b }) => (
          <div key={name} className="contents">
            <dt className="text-ink-2">{name}, Horizons</dt>
            <dd className="m-0 text-ink">{direction(b.horizons)}</dd>
            <dt className="text-ink-2">{name}, engine</dt>
            <dd className="m-0 text-ink">{b.engine ? direction(b.engine) : 'not run'}</dd>
            <dt className="text-ink-2">{name}, angle between</dt>
            <dd className="m-0 text-ink" data-testid={`horizons-angle-${name.toLowerCase()}`}>
              {angle(b.angle_between_deg)}
            </dd>
          </div>
        ))}
      </dl>
      {data.engine_unavailable_reason ? <p className="m-0 text-ink-2">The engine could not run: {data.engine_unavailable_reason}</p> : null}
    </div>
  );
}
