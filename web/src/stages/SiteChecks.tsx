// The Site stage's notes on the data behind the sky, in this order:
//   1. the checks of the engine's directions: "Checked against NASA JPL Horizons" (Sun and Earth,
//      data/horizons-check.json) and "Checked against NASA Moon Trek" (Sun, data/moon-trek-sun-check.json),
//      each with the stored largest angle for this site, read at run time; a line whose file or site is
//      missing is not shown. In live mode "Compare now" asks the backend (GET /api/v1/horizons/compare)
//      once, for this site and the instant on the site clock, and shows both directions and the angle
//      between them; it is asked only when pressed, never per frame, and any failure falls back to the
//      stored figure and says so;
//   2. the site's slope with what it is (the answer's slope_source), why it was not checked, or else
//      the backend's sentence for it; whether the terrain is included;
//   3. the horizon answer's own warnings, listed on request ("Warnings (n)").
// On a wide screen it is a band between the wings, above the console, with the checks and the notes
// side by side (SiteHud keeps the 3D picture above it); on a phone it sits in the sheet.

import { useEffect, useId, useRef, useState } from 'react';
import { api, isMockMode } from '../api/client';
import { isAbortError } from '../api/errors';
import type { HorizonResponse, HorizonsCheckFile, HorizonsCompareResponse, MoonTrekCheckFile, SiteEvaluation, SiteRef } from '../api/types';
import { Glass } from '../hud/Glass';
import { simClock } from '../state/app';
import type { Quantity } from '../util/quantities';
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

/** What a stored check covers, for the line's hover title: "largest angle, every 60 min, 2027-01-01 to 2028-01-01, 8,761 samples; retrieved ...". */
function coverage(c: { period?: { start_utc: string; stop_utc: string; step_minutes: number }; samples?: number | { sun: number }; retrieved_utc?: string }): string {
  const parts = ['largest angle'];
  if (c.period) parts.push(`every ${c.period.step_minutes} min, ${c.period.start_utc.slice(0, 10)} to ${c.period.stop_utc.slice(0, 10)}`);
  const n = typeof c.samples === 'number' ? c.samples : c.samples?.sun;
  if (typeof n === 'number' && Number.isFinite(n)) parts.push(`${n.toLocaleString('en-US')} samples`);
  return `${parts.join(', ')}${c.retrieved_utc ? `; retrieved ${c.retrieved_utc.replace('T', ' ').replace('Z', ' UTC')}` : ''}`;
}

type Compare = { state: 'idle' } | { state: 'waiting' } | { state: 'answer'; data: HorizonsCompareResponse } | { state: 'failed'; message: string };

export function SiteChecks({
  site,
  evaluation,
  horizon,
  check,
  moonTrek = null,
  landingMs,
  slope = null,
  slopeNote = null,
  slopeDetail = null,
  layout = 'bare',
  onHide,
}: {
  site: SiteRef | null;
  evaluation: SiteEvaluation | null;
  horizon: HorizonResponse | null;
  check: HorizonsCheckFile | null;
  moonTrek?: MoonTrekCheckFile | null;
  landingMs: number | null;
  /** The site's slope readout (a dash when the answer has none), its "Slope not checked" note and the backend's sentence for it. */
  slope?: Quantity | null;
  slopeNote?: string | null;
  slopeDetail?: string | null;
  /** "band": its own glass panel, the checks and the notes side by side; "bare": a plain column (inside another panel or a sheet). */
  layout?: 'band' | 'bare';
  /** In a short window the band is shown on request: this puts it away again. */
  onHide?: () => void;
}) {
  const live = !isMockMode();
  const smooth = terrainNotIncluded(evaluation, horizon);
  const stored = site && check?.sites && Object.hasOwn(check.sites, site.id) ? check.sites[site.id] : null;
  const trek = site && moonTrek?.sites && Object.hasOwn(moonTrek.sites, site.id) ? moonTrek.sites[site.id] : null;
  const trekAngle = trek && typeof trek.sun_max_angle_deg === 'number' && Number.isFinite(trek.sun_max_angle_deg) ? trek.sun_max_angle_deg : null;
  const warnings = [...new Set(horizon?.warnings ?? [])];
  const [compare, setCompare] = useState<Compare>({ state: 'idle' });
  const [showWarnings, setShowWarnings] = useState(false);
  // The question on its way, if any: a new site or a new press drops it.
  const pending = useRef<AbortController | null>(null);
  const ids = { result: useId(), warnings: useId() };

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

  const hasSlope = slope !== null && slope.value !== null;
  if (!site || (!smooth && warnings.length === 0 && !stored && trekAngle === null && !live && !hasSlope && !slopeNote)) return null;

  const compareButton = live ? (
    <button type="button" className="btn min-h-8 w-fit shrink-0 px-2.5 text-[12px]" onClick={compareNow} disabled={compare.state === 'waiting'} aria-controls={ids.result} data-testid="horizons-compare">
      {compare.state === 'waiting' ? 'Asking JPL Horizons…' : 'Compare now'}
    </button>
  ) : null;
  const warningsButton =
    warnings.length > 0 ? (
      <button
        type="button"
        className="btn btn-quiet min-h-8 w-fit shrink-0 px-2 text-[12px]"
        aria-expanded={showWarnings}
        aria-controls={ids.warnings}
        onClick={() => setShowWarnings((v) => !v)}
        data-testid="horizon-warnings-toggle"
      >
        {showWarnings ? 'Hide warnings' : `Warnings (${warnings.length})`}
      </button>
    ) : null;

  // 1. The checks of the engine's directions, and the live comparison.
  const checks = (
    <div className="flex min-w-0 flex-col gap-1.5">
      {stored ? (
        <p className="m-0 break-words text-ink" title={coverage(stored)} data-testid="horizons-check">
          Checked against NASA JPL Horizons: Sun within <span className="num">{angle(stored.sun_max_angle_deg)}</span>, Earth within{' '}
          <span className="num">{angle(stored.earth_max_angle_deg)}</span>
        </p>
      ) : null}
      {trek && trekAngle !== null ? (
        <p className="m-0 break-words text-ink" title={coverage(trek)} data-testid="moon-trek-check">
          Checked against NASA Moon Trek: Sun within <span className="num">{angle(trekAngle)}</span>
        </p>
      ) : null}
      {layout === 'bare' ? compareButton : null}
      <div id={ids.result} aria-live="polite" className="empty:hidden">
        {compare.state === 'answer' ? <CompareResult data={compare.data} /> : null}
        {compare.state === 'failed' ? (
          <p className="m-0 break-words text-ink-2" role="status" data-testid="horizons-compare-failed">
            <span data-tone="warn">The live comparison did not work.</span> {compare.message}{' '}
            {stored ? 'Showing the stored figure above instead.' : 'There is no stored figure for this site.'}
          </p>
        ) : null}
      </div>
    </div>
  );

  // 2. The slope and what it is, why it was not checked (else the backend's sentence), and the terrain.
  const notes = (
    <div className="flex min-w-0 flex-col gap-1.5">
      {hasSlope ? (
        <p className="m-0 break-words text-ink-2" data-q={slope.key} data-testid="site-slope">
          <span className="num text-ink" data-q-text>
            {slope.text}
          </span>
          <span className="num text-ink" data-q-unit>
            {slope.unit}
          </span>{' '}
          <span data-q-label>{slope.label}</span>
        </p>
      ) : null}
      {slopeNote ? (
        <p className="m-0 break-words text-ink-2" title={slopeDetail ?? undefined} data-testid="site-slope-note">
          {slopeNote}
        </p>
      ) : slopeDetail ? (
        <p className="m-0 break-words text-[12px] text-ink-2" data-testid="site-slope-detail">
          {slopeDetail}
        </p>
      ) : null}
      {smooth ? (
        <p className="m-0" data-tone="warn" data-testid="site-terrain-note">
          {TERRAIN_NOT_INCLUDED}
        </p>
      ) : null}
    </div>
  );

  // 3. The horizon answer's warnings, on request.
  const warningList =
    warnings.length > 0 ? (
      <ul id={ids.warnings} hidden={!showWarnings} className="m-0 flex list-none flex-col gap-1 p-0 text-[12px] text-ink-2" aria-label="Warnings from the horizon answer" data-testid="horizon-warnings">
        {warnings.map((w) => (
          <li key={w} className="break-words">
            {w}
          </li>
        ))}
      </ul>
    ) : null;

  if (layout === 'bare') {
    return (
      <div className="flex flex-col gap-2 text-[13px] leading-snug" data-testid="site-checks">
        {checks}
        {notes}
        {warningsButton}
        {warningList}
      </div>
    );
  }
  return (
    // Never taller than the room above the console. The panel itself never scrolls (its corner
    // brackets sit outside it); only its body would, in a window too short for it.
    <Glass
      as="section"
      className="flex flex-col gap-1.5 px-3.5 py-2.5"
      style={{ maxHeight: 'calc(var(--site-console-top, 100vh) - 9.5rem)' }}
      aria-label="Data checks"
      data-panel
      data-testid="site-checks-panel"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h3 className="panel-title m-0 mr-auto">Data checks</h3>
        {compareButton}
        {warningsButton}
        {onHide ? (
          <button type="button" className="btn btn-quiet min-h-8 w-fit shrink-0 px-2 text-[12px]" onClick={onHide} data-testid="site-checks-hide">
            Hide
          </button>
        ) : null}
      </div>
      <div className="flex min-h-0 flex-col gap-1.5 overflow-y-auto overscroll-contain" data-testid="site-checks-body">
        <div className="grid grid-cols-2 gap-x-5 gap-y-1.5 text-[13px] leading-snug max-lg:grid-cols-1" data-testid="site-checks">
          {checks}
          {notes}
        </div>
        {warningList}
      </div>
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
