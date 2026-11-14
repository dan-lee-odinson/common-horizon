// Sites pane: coordinate entry, preset sites, the ranked list and a compact horizon plot.
// On wide screens it floats over the scene (drag it by its title bar); on phones it is a drawer.

import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from 'react';
import gsap from 'gsap';
import { actions, appStore, simClock } from '../state/app';
import { useData, type KnownSite } from '../state/data';
import { useStore } from '../state/store';
import { prefersReducedMotion, useIsPhone } from '../state/useMedia';
import { formatLatLon, isValidLatitude, toEastLongitude, type Hemisphere } from '../util/geo';
import { formatKwh, formatPercent, powerColorVar, powerLevel } from '../util/power';
import { movedText, type RankedRow } from '../util/ranking';
import { AsyncView, SkeletonLines } from './AsyncView';
import { EARTH_LINK_COLOR, EARTH_LINK_WORD, HorizonPlot } from './HorizonPlot';
import { Icon } from './Icon';

/** Suggested next step when every ranked site fails the same requirement. */
const FIX_HINT: Record<string, string> = {
  'night power': 'Nothing makes power at night: add the Nuclear generator, or shorten the stay so it has no night.',
  'day power': 'Daytime load is more than daytime generation: add Solar panels or the Nuclear generator.',
  'hardware fit': 'See the fit notes under the power balance in the mission planner.',
  'Earth contact': 'Earth is never above the horizon: pick a near-side site.',
};

/** The requirement every row fails, or null when the results differ. */
function sharedFailure(rows: RankedRow[]): string | null {
  if (rows.length < 2) return null;
  const req = rows[0].evaluation.verdict.requirement;
  if (rows[0].evaluation.verdict.result !== 'fail' || !req) return null;
  return rows.every((r) => r.evaluation.verdict.result === 'fail' && r.evaluation.verdict.requirement === req) ? req : null;
}

/** Click once to highlight a site; click the highlighted site again to open its scene. */
export function selectSite(site: KnownSite) {
  const { highlightedId } = appStore.get();
  if (highlightedId === site.id) {
    actions.setView('scene');
  } else {
    actions.highlight(site.id, site);
  }
}

/**
 * `layout="pane"`: the ranked list scrolls inside the floating pane.
 * `layout="sheet"` (phones): the whole drawer scrolls as one, so the list never gets squeezed.
 */
export function SitesContent({ onClose, layout = 'pane' }: { onClose?: () => void; layout?: 'pane' | 'sheet' }) {
  const data = useData();
  const { evaluation, sites, catalog, highlighted, hardwareChosen, horizon, landingMs, plannedLandingMs, windowStartMs, windowEndMs } = data;
  const isPhone = useIsPhone();
  const saved = useStore(appStore, (s) => s.saved);
  const compareOpen = useStore(appStore, (s) => s.compareOpen);
  const timeScale = useStore(appStore, (s) => s.timeScale);
  const slipDays = useStore(appStore, (s) => s.slipDays);
  const nowMs = useStore(simClock, (s) => s.nowMs);
  const compareId = useId();
  const rows = hardwareChosen.length > 0 ? (evaluation.data?.rows ?? []) : [];
  const shared = sharedFailure(rows);
  const first = rows[0];
  const announcement =
    slipDays > 0 && first && evaluation.status === 'answer'
      ? `Slip ${slipDays} days: ${data.siteById.get(first.siteId)?.name ?? first.siteId} is now first${first.moved > 0 ? `, ${movedText(first.moved)}` : ''}.`
      : '';

  return (
    <div className={layout === 'sheet' ? 'min-h-0 flex-1 overflow-y-auto overscroll-contain' : 'flex min-h-0 flex-1 flex-col'}>
      <div className="flex flex-col gap-3 border-b border-line px-3 py-3">
        <details className="group">
          <summary className="label flex cursor-pointer list-none items-center gap-1 select-none [&::-webkit-details-marker]:hidden">
            <span className="inline-block transition-transform group-open:rotate-90" aria-hidden>
              <Icon name="right" size={12} />
            </span>
            Go to a coordinate
          </summary>
          <div className="pt-2">
            <CoordinateEntry />
          </div>
        </details>
        <AsyncView result={sites} what="the preset sites" waiting={<div className="skeleton h-8 w-full" />} empty="No preset sites came back.">
          {(list) => <PresetPicker presets={list.sites} highlightedId={highlighted?.id ?? null} />}
        </AsyncView>
      </div>

      <div className="flex items-center justify-between px-3 pb-1 pt-2">
        <h3 className="label m-0">
          Ranked sites{slipDays > 0 ? <span className="normal-case tracking-normal text-ink-2"> · slipped +{slipDays} d</span> : null}
        </h3>
        {evaluation.refreshing ? <span className="text-[12px] text-muted">updating…</span> : null}
      </div>
      <p className="m-0 px-3 pb-1.5 text-[12px] text-muted">Score 0–100, higher is better. Select a site once to highlight it, again to open it.</p>
      <p className="sr-only" aria-live="polite" data-testid="rank-announcement">
        {announcement}
      </p>
      {shared ? (
        <p className="mx-2 mb-1.5 rounded-lg border border-line-strong bg-surface-2 px-2.5 py-1.5 text-[12px] text-ink-2" role="note" data-testid="shared-verdict">
          <span className="font-semibold text-bad">Every site fails: {shared}.</span> {FIX_HINT[shared] ?? 'Change the hardware or the stay to compare sites on a passing plan.'}
        </p>
      ) : null}
      <div className={layout === 'sheet' ? 'px-2 pb-2' : 'min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-2'} data-testid="ranked-region">
        {hardwareChosen.length === 0 ? (
          <div className="flex flex-col items-start gap-2 px-2 py-3 text-[13px] text-muted" data-state="empty" data-testid="ranked-empty">
            {catalog.status === 'error' || catalog.status === 'empty' ? (
              <p className="m-0">The hardware list did not load, so the sites cannot be ranked yet. Try again from the mission planner.</p>
            ) : (
              <p className="m-0">Tick hardware in the mission planner to rank the sites.</p>
            )}
            {isPhone ? (
              <button type="button" className="btn" onClick={() => actions.setDrawer('planner')}>
                <Icon name="planner" size={14} /> Open the planner
              </button>
            ) : null}
          </div>
        ) : (
          <AsyncView result={evaluation} what="the ranked sites" waiting={<SkeletonLines lines={6} />} empty="No sites came back from the evaluation.">
            {(bundle) => (
              <RankedList rows={bundle.rows} siteById={data.siteById} highlightedId={highlighted?.id ?? null} savedIds={new Set(saved.map((s) => s.id))} sharedVerdict={shared} />
            )}
          </AsyncView>
        )}
      </div>

      {highlighted ? (
        <div className="border-t border-line px-3 py-2">
          <div className="mb-1 flex items-center justify-between gap-2">
            <p className="m-0 truncate text-[12px] font-medium">{highlighted.name}</p>
            <button type="button" className="btn h-7 min-h-7 shrink-0 px-2 text-[12px]" onClick={() => actions.setView('scene')}>
              Open site
            </button>
          </div>
          <AsyncView result={horizon} what="the horizon" waiting={<div className="skeleton h-24 w-full" />} empty="No horizon data for this point.">
            {(h) =>
              landingMs !== null && windowStartMs !== null && windowEndMs !== null ? (
                <HorizonPlot
                  data={h}
                  compact
                  siteName={highlighted.name}
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
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-2 border-t border-line px-3 py-2">
        <label htmlFor={compareId} className={`flex items-center gap-2 text-[13px] ${saved.length === 0 ? 'text-muted' : ''}`}>
          <input
            id={compareId}
            type="checkbox"
            checked={compareOpen}
            disabled={saved.length === 0}
            onChange={(e) => {
              actions.setCompareOpen(e.target.checked);
              if (e.target.checked) onClose?.();
            }}
          />
          Compare saved sites
        </label>
        <span className="num text-[12px] text-muted">{saved.length === 0 ? 'star a site to save it' : `${saved.length} saved`}</span>
      </div>
    </div>
  );
}

function CoordinateEntry() {
  const [lat, setLat] = useState('');
  const [lon, setLon] = useState('');
  const [hemi, setHemi] = useState<Hemisphere>('E');
  const [error, setError] = useState<string | null>(null);
  const ids = { lat: useId(), lon: useId(), hemi: useId(), err: useId() };
  const customSite = useStore(appStore, (s) => s.customSite);

  useEffect(() => {
    // A click on the Moon fills the boxes, so the visitor can see and adjust the numbers.
    if (customSite) {
      setLat(customSite.lat.toFixed(3));
      setLon(customSite.lon_east.toFixed(3));
      setHemi('E');
    }
  }, [customSite]);

  function submit(e: FormEvent) {
    e.preventDefault();
    const la = Number(lat);
    const lo = Number(lon);
    if (lat.trim() === '' || !isValidLatitude(la)) return setError('Latitude must be between −90 and 90.');
    if (lon.trim() === '' || !Number.isFinite(lo) || Math.abs(lo) > 360) return setError('Longitude must be a number of degrees (0 to 360).');
    setError(null);
    actions.setCustomSite(la, toEastLongitude(lo, hemi));
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-1" aria-label="Go to a coordinate" noValidate>
      <span className="label">Coordinates</span>
      <div className="flex items-end gap-1.5">
        <label htmlFor={ids.lat} className="flex flex-col text-[11px] text-muted">
          Lat (°, S is −)
          <input id={ids.lat} inputMode="decimal" className="field num w-[5.5rem] text-[13px] text-ink" value={lat} onChange={(e) => setLat(e.target.value)} placeholder="e.g. -89.7" aria-describedby={error ? ids.err : undefined} />
        </label>
        <label htmlFor={ids.lon} className="flex flex-col text-[11px] text-muted">
          Lon (°)
          <input id={ids.lon} inputMode="decimal" className="field num w-[5.5rem] text-[13px] text-ink" value={lon} onChange={(e) => setLon(e.target.value)} placeholder="e.g. 196.7" aria-describedby={error ? ids.err : undefined} />
        </label>
        <label htmlFor={ids.hemi} className="sr-only">
          East or west
        </label>
        <select id={ids.hemi} className="field text-[13px]" value={hemi} onChange={(e) => setHemi(e.target.value as Hemisphere)}>
          <option value="E">E</option>
          <option value="W">W</option>
        </select>
        <button type="submit" className="btn">
          Go
        </button>
      </div>
      {error ? (
        <p id={ids.err} role="alert" className="m-0 text-[12px] text-bad">
          {error}
        </p>
      ) : (
        <p className="m-0 text-[12px] text-muted">West longitudes become east (0–360). You can also click a spot on the Moon.</p>
      )}
    </form>
  );
}

function PresetPicker({ presets, highlightedId }: { presets: KnownSite[]; highlightedId: string | null }) {
  const id = useId();
  return (
    <label htmlFor={id} className="flex flex-col gap-1">
      <span className="label">Preset sites</span>
      <select
        id={id}
        className="field text-[13px]"
        value={presets.some((p) => p.id === highlightedId) ? highlightedId! : ''}
        onChange={(e) => {
          const site = presets.find((p) => p.id === e.target.value);
          if (site) actions.highlight(site.id, site);
        }}
      >
        <option value="" disabled>
          {presets.length ? 'Choose a preset site…' : 'Loading presets…'}
        </option>
        {presets.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function RankedList({
  rows,
  siteById,
  highlightedId,
  savedIds,
  sharedVerdict,
}: {
  rows: RankedRow[];
  siteById: Map<string, KnownSite>;
  highlightedId: string | null;
  savedIds: Set<string>;
  sharedVerdict: string | null;
}) {
  const listRef = useRef<HTMLOListElement>(null);
  const lastTops = useRef(new Map<string, number>());

  // FLIP: when the order changes, slide each row from where it is on screen to its new place
  // (GSAP). Starting from the current on-screen offset keeps it smooth if the slip changes again
  // while rows are still moving. power3.inOut = cubic-bezier(0.77, 0, 0.175, 1).
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const reduce = prefersReducedMotion();
    const nextTops = new Map<string, number>();
    list.querySelectorAll<HTMLElement>('[data-site-id]').forEach((el) => {
      const id = el.dataset.siteId!;
      const top = el.offsetTop;
      nextTops.set(id, top);
      const prev = lastTops.current.get(id);
      if (reduce || prev === undefined) return;
      const shown = Number(gsap.getProperty(el, 'y')) || 0;
      const from = prev + shown - top;
      if (Math.abs(from) > 0.5) {
        gsap.fromTo(el, { y: from }, { y: 0, duration: 0.4, ease: 'power3.inOut', overwrite: true });
      }
    });
    lastTops.current = nextTops;
  }, [rows]);

  return (
    <ol ref={listRef} className="relative m-0 flex list-none flex-col gap-1 p-0" aria-label="Sites ranked best first" data-testid="ranked-list">
      {rows.map((row) => {
        const site = siteById.get(row.siteId);
        if (!site) return null;
        return <SiteRow key={row.siteId} row={row} site={site} highlighted={row.siteId === highlightedId} saved={savedIds.has(row.siteId)} quietVerdict={sharedVerdict !== null} />;
      })}
    </ol>
  );
}

function SiteRow({ row, site, highlighted, saved, quietVerdict }: { row: RankedRow; site: KnownSite; highlighted: boolean; saved: boolean; quietVerdict: boolean }) {
  const e = row.evaluation;
  const level = powerLevel(e.power_margin_percent);
  const fail = e.verdict.result === 'fail';
  const verdictText = fail ? `fail: ${e.verdict.requirement}` : 'pass';
  const slipText = row.planned ? ` ${movedText(row.moved)} since the plan, score was ${row.planned.score}.` : '';
  return (
    <li
      data-site-id={row.siteId}
      data-testid="ranked-row"
      className={`relative rounded-lg border transition-colors ${highlighted ? 'border-accent bg-accent-soft' : 'border-transparent hover:bg-surface-2'}`}
    >
      <button
        type="button"
        className="block w-full rounded-lg px-2 py-1.5 pr-9 text-left"
        onClick={() => selectSite(site)}
        aria-pressed={highlighted}
        aria-label={`${row.rank}. ${site.name}, score ${e.score}.${slipText} ${verdictText}. ${highlighted ? 'Highlighted. Press again to open the site scene.' : 'Press to highlight.'}`}
      >
        <span className="flex items-baseline gap-2">
          <span className="num w-5 shrink-0 text-right text-[12px] text-muted">{row.rank}</span>
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium" data-testid="row-name">
            {site.name}
          </span>
          {row.planned ? (
            <span className="num flex shrink-0 items-center gap-1 text-[11px] text-ink-2" title={`Planned rank ${row.planned.rank}, now ${row.rank}`} data-testid="moved">
              {row.moved !== 0 ? (
                <span className="flex items-center" style={{ color: row.moved > 0 ? 'var(--ch-good)' : 'var(--ch-ink-2)' }}>
                  <Icon name={row.moved > 0 ? 'up' : 'down'} size={12} />
                  {Math.abs(row.moved)}
                </span>
              ) : (
                <span className="text-muted">=</span>
              )}
              <span className="sr-only">{movedText(row.moved)}, score was {row.planned.score}, now {e.score}</span>
              <span aria-hidden>
                {row.planned.score}→{e.score}
              </span>
            </span>
          ) : null}
          <span className="num w-8 shrink-0 text-right text-[15px] font-semibold" aria-hidden={Boolean(row.planned)}>
            {e.score}
          </span>
        </span>
        <span className="num mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 pl-7 text-[11.5px] text-ink-2">
          <span className="flex items-center gap-1" title="Sunlight during the stay">
            <span className="text-sun">
              <Icon name="sun" size={12} />
            </span>
            {formatPercent(e.sunlight_percent)} · {Math.round(e.sunlight_hours)} h
          </span>
          <span title="Clear view of the sky">sky {formatPercent(e.clear_sky_percent)}</span>
          <span className="flex items-center gap-1" title="Earth link">
            <span className="inline-block size-1.5 rounded-full" style={{ background: EARTH_LINK_COLOR[e.earth_link] }} aria-hidden />
            Earth {EARTH_LINK_WORD[e.earth_link]}
          </span>
          <span style={{ color: e.hardware_fits ? undefined : 'var(--ch-bad)' }}>{e.hardware_fits ? 'fits' : 'does not fit'}</span>
          <span style={{ color: powerColorVar(level) }} title="Energy the site adds over the stay">
            {formatKwh(e.energy_added_kwh)}
          </span>
          <span className={fail ? (quietVerdict ? 'text-muted' : 'text-bad') : 'text-good'} data-testid="verdict">
            {verdictText}
          </span>
        </span>
        {site.note ? <span className="mt-0.5 block pl-7 text-[12px] text-muted">{site.note}</span> : null}
        {site.custom ? <span className="num mt-0.5 block pl-7 text-[12px] text-muted">{formatLatLon(site.lat, site.lon_east, 3)}</span> : null}
      </button>
      <button
        type="button"
        className={`absolute right-1 top-1 grid size-7 place-items-center rounded-md transition-colors hover:bg-surface-3 ${saved ? 'text-sun' : 'text-muted'}`}
        aria-pressed={saved}
        aria-label={saved ? `Remove ${site.name} from saved sites` : `Save ${site.name}`}
        onClick={() => actions.toggleSaved({ id: site.id, name: site.name, lat: site.lat, lon_east: site.lon_east })}
      >
        <Icon name={saved ? 'star-filled' : 'star'} size={15} />
      </button>
    </li>
  );
}

/** Wide screens: the pane floats over the scene and can be dragged by its title bar. */
export function FloatingSitesPane() {
  const paneRef = useRef<HTMLElement>(null);
  const [pos, setPos] = useState({ x: 12, y: 12 });
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const headingId = useId();

  function clampToParent(x: number, y: number) {
    const pane = paneRef.current;
    const parent = pane?.parentElement;
    if (!pane || !parent) return { x, y };
    const maxX = Math.max(0, parent.clientWidth - pane.offsetWidth);
    const maxY = Math.max(0, parent.clientHeight - 48);
    return { x: Math.min(maxX, Math.max(0, x)), y: Math.min(maxY, Math.max(0, y)) };
  }

  useEffect(() => {
    const onResize = () => setPos((p) => clampToParent(p.x, p.y));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement).closest('button')) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
  }
  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!drag.current) return;
    setPos(clampToParent(e.clientX - drag.current.dx, e.clientY - drag.current.dy));
  }
  function onPointerUp() {
    drag.current = null;
  }

  return (
    <section
      ref={paneRef}
      aria-labelledby={headingId}
      className="glass enter absolute z-20 flex max-h-[calc(100%-24px)] w-[min(400px,calc(100%-24px))] flex-col overflow-hidden rounded-xl"
      style={{ left: pos.x, top: pos.y }}
      data-testid="sites-pane"
    >
      <div
        className="flex cursor-grab touch-none select-none items-center gap-2 border-b border-line px-3 py-2 active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        title="Drag to move"
      >
        <span className="text-muted">
          <Icon name="grip" size={14} />
        </span>
        <h2 id={headingId} className="m-0 text-[15px] font-semibold">
          Sites
        </h2>
        <span className="ml-auto text-[12px] text-muted">drag to move</span>
      </div>
      <SitesContent />
    </section>
  );
}
