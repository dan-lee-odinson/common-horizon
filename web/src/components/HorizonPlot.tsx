// Horizon plot: what the sky looks like from one site.
//   x axis: compass direction;  y axis: height above level (degrees)
//   grey shape: terrain skyline;  yellow line: the Sun's path (solid above the skyline, dashed hidden)
//   yellow dot: the Sun now;  blue box: where Earth moves in the sky
// Under it: a timeline of lit and dark periods, a marker for "now" and, when the launch slipped,
// a ghost marker at the planned landing.

import { useMemo, useRef, type KeyboardEvent, type PointerEvent } from 'react';
import type { EarthLink, HorizonResponse } from '../api/types';
import { normalizeLon360, sampleProfile, wrap180 } from '../util/geo';
import { formatHours, formatTime, formatTimeShort, HOUR_MS, type TimeScale } from '../util/time';
import { formatPercent } from '../util/power';

export interface HorizonReadouts {
  sunlight_hours: number;
  sunlight_percent: number;
  clear_sky_percent: number;
  earth_link: EarthLink;
}

export interface HorizonPlotProps {
  data: HorizonResponse;
  siteName: string;
  nowMs: number;
  windowStartMs: number;
  windowEndMs: number;
  landingMs: number;
  /** Planned landing when the launch slipped; null or equal to landingMs hides the ghost marker. */
  plannedLandingMs: number | null;
  readouts: HorizonReadouts | null;
  timeScale: TimeScale;
  compact?: boolean;
  onScrub?: (ms: number) => void;
}

const COMPASS: Record<number, string> = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };

export const EARTH_LINK_WORD: Record<EarthLink, string> = {
  clear: 'in contact',
  intermittent: 'intermittent',
  none: 'out of contact',
};

export const EARTH_LINK_COLOR: Record<EarthLink, string> = {
  clear: 'var(--ch-good)',
  intermittent: 'var(--ch-warn)',
  none: 'var(--ch-bad)',
};

function niceStep(range: number): number {
  for (const s of [1, 2, 5, 10, 15, 30]) if (range / s <= 6) return s;
  return 30;
}

/** Centre the compass axis on Earth when it is in the sky, so its box does not split at the edges. */
function axisCenter(data: HorizonResponse): number {
  const box = data.earth_box;
  if (!box) return 180;
  const span = normalizeLon360(box.az_max - box.az_min);
  const mid = normalizeLon360(box.az_min + span / 2);
  return normalizeLon360(Math.round(mid / 45) * 45);
}

interface Geometry {
  W: number;
  H: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
  center: number;
  elMin: number;
  elMax: number;
  x: (az: number) => number;
  y: (el: number) => number;
}

function buildGeometry(data: HorizonResponse, compact: boolean): Geometry {
  const W = compact ? 320 : 640;
  const H = compact ? 118 : 230;
  const left = compact ? 26 : 40;
  const right = compact ? 6 : 12;
  const top = compact ? 6 : 12;
  const bottom = compact ? 16 : 26;
  const center = axisCenter(data);
  const skyMin = Math.min(...data.skyline.map((p) => p.el));
  const skyMax = Math.max(...data.skyline.map((p) => p.el));
  const sunMax = data.sun_path.length ? Math.max(...data.sun_path.map((p) => p.el)) : 0;
  const earthTop = data.earth_box ? data.earth_box.el_max : -90;
  const elMin = Math.floor(Math.min(-2, skyMin - 0.5));
  const rawMax = Math.max(skyMax + 2, earthTop + 1, Math.min(sunMax + 1, 90), 6);
  const step = niceStep(rawMax - elMin);
  const elMax = Math.min(90, Math.ceil(rawMax / step) * step);
  const plotW = W - left - right;
  const plotH = H - top - bottom;
  return {
    W,
    H,
    left,
    right,
    top,
    bottom,
    center,
    elMin,
    elMax,
    x: (az) => left + ((wrap180(az - center) + 180) / 360) * plotW,
    y: (el) => top + ((elMax - el) / (elMax - elMin)) * plotH,
  };
}

interface Segment {
  state: 'above' | 'hidden';
  points: string;
}

function sunSegments(data: HorizonResponse, g: Geometry): Segment[] {
  const out: Segment[] = [];
  const plotW = g.W - g.left - g.right;
  let current: { state: 'above' | 'hidden'; pts: string[] } | null = null;
  let prevX: number | null = null;
  for (const p of data.sun_path) {
    const x = g.x(p.az);
    const y = g.y(p.el);
    const jump = prevX !== null && Math.abs(x - prevX) > plotW / 2;
    const pt = `${x.toFixed(1)},${y.toFixed(1)}`;
    if (!current || jump) {
      if (current && current.pts.length > 1) out.push({ state: current.state, points: current.pts.join(' ') });
      current = { state: p.state, pts: [pt] };
    } else if (p.state !== current.state) {
      current.pts.push(pt); // share the boundary point so solid and dashed parts touch
      if (current.pts.length > 1) out.push({ state: current.state, points: current.pts.join(' ') });
      current = { state: p.state, pts: [pt] };
    } else {
      current.pts.push(pt);
    }
    prevX = x;
  }
  if (current && current.pts.length > 1) out.push({ state: current.state, points: current.pts.join(' ') });
  return out;
}

function skylinePath(data: HorizonResponse, g: Geometry): string {
  const pts = data.skyline.map((p) => ({ x: g.x(p.az), y: g.y(p.el) }));
  const startAz = g.center - 180;
  const edgeEl = sampleProfile(data.skyline, startAz);
  pts.push({ x: g.left, y: g.y(edgeEl) }, { x: g.W - g.right, y: g.y(edgeEl) });
  pts.sort((a, b) => a.x - b.x);
  const base = g.H - g.bottom;
  return `M${g.left},${base} ` + pts.map((p) => `L${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ') + ` L${g.W - g.right},${base} Z`;
}

interface Period {
  start: number;
  end: number;
  lit: boolean;
}

export function litPeriods(data: HorizonResponse): Period[] {
  const out: Period[] = [];
  const pts = data.sun_path;
  for (let i = 0; i < pts.length; i++) {
    const t = Date.parse(pts[i].t);
    const lit = pts[i].state === 'above';
    const last = out[out.length - 1];
    if (last && last.lit === lit) last.end = t;
    else {
      if (last) last.end = t;
      out.push({ start: t, end: t, lit });
    }
  }
  return out;
}

/** Sun position at a time, interpolated between samples. */
export function sunAt(data: HorizonResponse, times: number[], tMs: number): { az: number; el: number; above: boolean } | null {
  const n = times.length;
  if (n === 0) return null;
  let i = 0;
  let j = n - 1;
  if (tMs <= times[0]) j = 0;
  else if (tMs >= times[n - 1]) i = n - 1;
  else {
    while (j - i > 1) {
      const m = (i + j) >> 1;
      if (times[m] <= tMs) i = m;
      else j = m;
    }
  }
  const a = data.sun_path[i];
  const b = data.sun_path[Math.max(i, j)];
  const span = times[Math.max(i, j)] - times[i];
  const f = span > 0 ? (tMs - times[i]) / span : 0;
  const az = normalizeLon360(a.az + wrap180(b.az - a.az) * f);
  const el = a.el + (b.el - a.el) * f;
  return { az, el, above: el > sampleProfile(data.skyline, az) };
}

export function HorizonPlot(props: HorizonPlotProps) {
  const { data, siteName, nowMs, windowStartMs, windowEndMs, landingMs, plannedLandingMs, readouts, timeScale, compact = false, onScrub } = props;
  const g = useMemo(() => buildGeometry(data, compact), [data, compact]);
  const times = useMemo(() => data.sun_path.map((p) => Date.parse(p.t)), [data]);
  const segments = useMemo(() => sunSegments(data, g), [data, g]);
  const sky = useMemo(() => skylinePath(data, g), [data, g]);
  const periods = useMemo(() => litPeriods(data), [data]);
  const sun = sunAt(data, times, nowMs);
  const plotW = g.W - g.left - g.right;
  const clipId = `hz-clip-${compact ? 'c' : 'f'}-${data.site_id.replace(/[^a-z0-9-]/gi, '')}`;

  const elStep = niceStep(g.elMax - g.elMin);
  const elTicks: number[] = [];
  for (let e = Math.ceil(g.elMin / elStep) * elStep; e <= g.elMax; e += elStep) elTicks.push(e);
  const azTicks: number[] = [];
  for (let a = g.center - 180; a <= g.center + 180; a += 45) azTicks.push(a);

  const box = data.earth_box;
  const boxRects: { x: number; w: number }[] = [];
  if (box) {
    const x1 = g.x(box.az_min);
    const x2 = g.x(box.az_max);
    if (x2 >= x1) boxRects.push({ x: x1, w: Math.max(2, x2 - x1) });
    else boxRects.push({ x: x1, w: g.W - g.right - x1 }, { x: g.left, w: x2 - g.left });
  }

  // Timeline
  const TL_H = compact ? 26 : 58;
  const tlTop = compact ? 4 : 18;
  const barH = compact ? 10 : 14;
  const span = Math.max(1, windowEndMs - windowStartMs);
  const tx = (ms: number) => g.left + ((Math.min(windowEndMs, Math.max(windowStartMs, ms)) - windowStartMs) / span) * plotW;
  const ghost = plannedLandingMs !== null && Math.abs(plannedLandingMs - landingMs) > HOUR_MS ? plannedLandingMs : null;
  const timelineRef = useRef<SVGSVGElement>(null);

  function scrubTo(clientX: number) {
    const svg = timelineRef.current;
    if (!svg || !onScrub) return;
    const rect = svg.getBoundingClientRect();
    const scale = g.W / rect.width;
    const xSvg = (clientX - rect.left) * scale;
    const f = Math.min(1, Math.max(0, (xSvg - g.left) / plotW));
    onScrub(windowStartMs + f * span);
  }
  function onPointerDown(e: PointerEvent<SVGSVGElement>) {
    if (!onScrub) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    scrubTo(e.clientX);
  }
  function onPointerMove(e: PointerEvent<SVGSVGElement>) {
    if (onScrub && e.currentTarget.hasPointerCapture(e.pointerId)) scrubTo(e.clientX);
  }
  function onKeyDown(e: KeyboardEvent<SVGSVGElement>) {
    if (!onScrub) return;
    const stepMs = e.shiftKey ? 24 * HOUR_MS : 6 * HOUR_MS;
    if (e.key === 'ArrowRight') onScrub(Math.min(windowEndMs, nowMs + stepMs));
    else if (e.key === 'ArrowLeft') onScrub(Math.max(windowStartMs, nowMs - stepMs));
    else if (e.key === 'Home') onScrub(windowStartMs);
    else if (e.key === 'End') onScrub(windowEndMs);
    else return;
    e.preventDefault();
  }

  const earthWord = readouts ? EARTH_LINK_WORD[readouts.earth_link] : null;
  const summary =
    `Horizon at ${siteName}. Terrain skyline from ${g.elMin}° to ${Math.max(...data.skyline.map((p) => p.el)).toFixed(1)}°. ` +
    (sun ? `Sun now at ${Math.round(sun.az)}° azimuth, ${sun.el.toFixed(1)}° high, ${sun.above ? 'above' : 'hidden behind'} the skyline. ` : '') +
    (box ? `Earth moves between ${Math.round(box.az_min)}° and ${Math.round(box.az_max)}° azimuth, ${box.el_min.toFixed(1)}° to ${box.el_max.toFixed(1)}° high.` : 'Earth stays below the horizon.');

  return (
    <figure className={`m-0 flex flex-col ${compact ? 'gap-1' : 'gap-2'}`} data-testid={compact ? 'horizon-compact' : 'horizon-full'}>
      {readouts ? (
        <dl className={`m-0 grid grid-cols-3 ${compact ? 'gap-1 text-[11px]' : 'gap-3 text-[13px]'}`}>
          <div className="min-w-0">
            <dt className="label">Sunlight</dt>
            <dd className="m-0 num">
              <span className="text-sun">{formatHours(readouts.sunlight_hours)}</span> · {formatPercent(readouts.sunlight_percent)}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="label">Clear view of sky</dt>
            <dd className="m-0 num">{formatPercent(readouts.clear_sky_percent)}</dd>
          </div>
          <div className="min-w-0">
            <dt className="label">Earth link</dt>
            <dd className="m-0 flex items-center gap-1.5">
              <span className="inline-block size-2 shrink-0 rounded-full" style={{ background: EARTH_LINK_COLOR[readouts.earth_link] }} aria-hidden />
              {earthWord}
            </dd>
          </div>
        </dl>
      ) : null}

      <svg viewBox={`0 0 ${g.W} ${g.H}`} className="block h-auto w-full" role="img" aria-label={summary}>
        <defs>
          <clipPath id={clipId}>
            <rect x={g.left} y={g.top} width={plotW} height={g.H - g.top - g.bottom} />
          </clipPath>
        </defs>
        <rect x={g.left} y={g.top} width={plotW} height={g.H - g.top - g.bottom} fill="var(--ch-space)" />
        {elTicks.map((e) => (
          <g key={`e${e}`}>
            <line x1={g.left} x2={g.W - g.right} y1={g.y(e)} y2={g.y(e)} stroke={e === 0 ? 'var(--ch-line-strong)' : 'var(--ch-line)'} strokeDasharray={e === 0 ? undefined : '2 4'} />
            <text x={g.left - 4} y={g.y(e)} dy="0.32em" textAnchor="end" fontSize={compact ? 8 : 10} fill="var(--ch-muted)" className="num">
              {e}°
            </text>
          </g>
        ))}
        {azTicks.map((a) => (
          <g key={`a${a}`}>
            <line x1={g.x(a) - (a === g.center + 180 ? 0.01 : 0)} x2={g.x(a)} y1={g.H - g.bottom} y2={g.H - g.bottom + 3} stroke="var(--ch-line-strong)" />
            <text
              x={a === g.center + 180 ? g.W - g.right : g.x(a)}
              y={g.H - g.bottom + (compact ? 11 : 14)}
              textAnchor={a === g.center - 180 ? 'start' : a === g.center + 180 ? 'end' : 'middle'}
              fontSize={compact ? 8 : 10}
              fill="var(--ch-ink-2)"
            >
              {COMPASS[normalizeLon360(a)] ?? `${normalizeLon360(a)}°`}
            </text>
          </g>
        ))}
        <g clipPath={`url(#${clipId})`}>
          {boxRects.map((r, i) => (
            <rect
              key={i}
              x={r.x}
              y={g.y(box!.el_max)}
              width={r.w}
              height={Math.max(2, g.y(box!.el_min) - g.y(box!.el_max))}
              fill="var(--ch-earth-soft)"
              stroke="var(--ch-earth)"
              strokeWidth={1.2}
              rx={2}
            />
          ))}
          <path d={sky} fill="var(--ch-terrain)" stroke="var(--ch-terrain-edge)" strokeWidth={1} />
          {segments.map((s, i) => (
            <polyline
              key={i}
              points={s.points}
              fill="none"
              stroke="var(--ch-sun)"
              strokeWidth={compact ? 1.2 : 1.6}
              strokeDasharray={s.state === 'hidden' ? (compact ? '2 3' : '3 4') : undefined}
              strokeOpacity={s.state === 'hidden' ? 0.75 : 1}
              strokeLinejoin="round"
            />
          ))}
          {sun ? (
            sun.above ? (
              <circle cx={g.x(sun.az)} cy={g.y(sun.el)} r={compact ? 3.5 : 5.5} fill="var(--ch-sun)" stroke="var(--ch-space)" strokeWidth={1.5} data-testid="sun-dot" />
            ) : (
              <circle cx={g.x(sun.az)} cy={g.y(sun.el)} r={compact ? 3.5 : 5.5} fill="var(--ch-space)" stroke="var(--ch-sun)" strokeWidth={1.5} strokeDasharray="2 2" data-testid="sun-dot" />
            )
          ) : null}
        </g>
        {box && boxRects.length ? (
          <text x={boxRects[0].x + 2} y={Math.max(g.top + 9, g.y(box.el_max) - 4)} fontSize={compact ? 8 : 10} fill="var(--ch-earth)">
            Earth
          </text>
        ) : null}
        {!compact ? (
          <text x={12} y={g.top + (g.H - g.top - g.bottom) / 2} transform={`rotate(-90 12 ${g.top + (g.H - g.top - g.bottom) / 2})`} textAnchor="middle" fontSize={10} fill="var(--ch-muted)">
            Height above level
          </text>
        ) : null}
      </svg>

      <svg
        ref={timelineRef}
        viewBox={`0 0 ${g.W} ${TL_H}`}
        className={`block h-auto w-full touch-none select-none ${onScrub ? 'cursor-ew-resize' : ''}`}
        role={onScrub ? 'slider' : 'img'}
        tabIndex={onScrub ? 0 : undefined}
        aria-label={onScrub ? 'Time in the stay' : `Lit and dark periods at ${siteName}`}
        aria-valuemin={onScrub ? windowStartMs : undefined}
        aria-valuemax={onScrub ? windowEndMs : undefined}
        aria-valuenow={onScrub ? Math.round(nowMs) : undefined}
        aria-valuetext={onScrub ? formatTime(nowMs, timeScale, landingMs) : undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onKeyDown={onKeyDown}
        data-testid="timeline"
      >
        {periods.map((p, i) => (
          <rect
            key={i}
            x={tx(p.start)}
            y={tlTop}
            width={Math.max(0.5, tx(p.end) - tx(p.start))}
            height={barH}
            fill={p.lit ? 'var(--ch-sun)' : 'var(--ch-dark-period)'}
            fillOpacity={p.lit ? 0.85 : 1}
          />
        ))}
        <rect x={g.left} y={tlTop} width={plotW} height={barH} fill="none" stroke="var(--ch-line-strong)" />
        {/* stay bracket: from the (slipped) landing to the end of the stay */}
        <line x1={tx(landingMs)} x2={g.W - g.right} y1={tlTop + barH + (compact ? 3 : 5)} y2={tlTop + barH + (compact ? 3 : 5)} stroke="var(--ch-accent)" strokeWidth={1.5} />
        {!compact ? (
          <text x={g.W - g.right} y={tlTop - 7} textAnchor="end" fontSize={10} fill="var(--ch-accent)">
            stay
          </text>
        ) : null}
        {ghost !== null ? (
          <g data-testid="ghost-marker">
            <line x1={tx(ghost)} x2={tx(ghost)} y1={tlTop - 3} y2={tlTop + barH + 3} stroke="var(--ch-ink-2)" strokeDasharray="2 2" strokeWidth={1.5} />
            {!compact ? (
              <text x={tx(ghost) + 4} y={tlTop - 7} fontSize={10} fill="var(--ch-muted)">
                planned landing
              </text>
            ) : null}
          </g>
        ) : null}
        <g data-testid="now-marker">
          <line x1={tx(nowMs)} x2={tx(nowMs)} y1={tlTop - 4} y2={tlTop + barH + 4} stroke="var(--ch-ink)" strokeWidth={2} />
          <path d={`M${tx(nowMs) - 4},${tlTop - 6} L${tx(nowMs) + 4},${tlTop - 6} L${tx(nowMs)},${tlTop - 1} Z`} fill="var(--ch-ink)" />
        </g>
        {!compact ? (
          <>
            <text x={g.left} y={TL_H - 3} fontSize={10} fill="var(--ch-muted)" className="num">
              {formatTimeShort(windowStartMs, timeScale, landingMs)}
            </text>
            <text x={g.W - g.right} y={TL_H - 3} textAnchor="end" fontSize={10} fill="var(--ch-muted)" className="num">
              {formatTimeShort(windowEndMs, timeScale, landingMs)}
            </text>
          </>
        ) : null}
      </svg>
      {!compact ? (
        <figcaption className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted">
          <span className="flex items-center gap-1.5">
            <svg width="22" height="6" aria-hidden>
              <line x1="0" x2="22" y1="3" y2="3" stroke="var(--ch-sun)" strokeWidth="2" />
            </svg>
            Sun above skyline
          </span>
          <span className="flex items-center gap-1.5">
            <svg width="22" height="6" aria-hidden>
              <line x1="0" x2="22" y1="3" y2="3" stroke="var(--ch-sun)" strokeWidth="2" strokeDasharray="3 3" />
            </svg>
            Sun hidden
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-4 rounded-[2px] border border-earth bg-earth-soft" aria-hidden />
            Earth's box
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-4 rounded-[2px] bg-sun" aria-hidden />
            lit
            <span className="ml-1 inline-block h-2.5 w-4 rounded-[2px] border border-line-strong" style={{ background: 'var(--ch-dark-period)' }} aria-hidden />
            dark
          </span>
        </figcaption>
      ) : null}
    </figure>
  );
}
