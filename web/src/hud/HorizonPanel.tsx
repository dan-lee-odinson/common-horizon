// The horizon plot: the sky from one site, unrolled into a strip.
//   across: compass direction, centred on Earth's part of the sky
//   upward: height above level, in degrees (two bands when the Sun climbs high: see util/horizonPlot.ts)
//   the terrain skyline; the Sun's path over a span of time, solid where the horizon answer says the
//   Sun is above the skyline and dashed where the terrain hides it; the box Earth moves through
// A Sun dot and an Earth ring follow the running clock. They are moved by transform once per frame
// (no React render); everything else is drawn once per answer and width. The markers show where
// each body is, not how large it looks.
//
// The plot is a pure function of its props and draws one unit per CSS pixel at its measured width,
// so its labels keep their size (12 px) at every width.

import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { HorizonResponse } from '../api/types';
import { naturalElRange } from '../util/horizon';
import { axisCenter, azFraction, azTickValues, boxRects, compassLetters, elScale, elTickValues, skylinePaths, sunRuns, type ElScale, type PlotBox } from '../util/horizonPlot';
import { horizonAxisQuantities } from '../util/quantities';
import { useTicker } from './useTicker';

export interface SunMark {
  az: number;
  el: number;
  /** The horizon answer's word: lit, dark, or null when there is none. */
  lit: boolean | null;
  /** The readouts' own texts, written to the dot as data-az / data-el so the two can be compared. */
  azText?: string;
  elText?: string;
}

export type HorizonVariant = 'console' | 'hero' | 'compact';

export interface HorizonPanelProps {
  data: HorizonResponse;
  /** The span of time whose Sun path is drawn. */
  fromMs: number;
  toMs: number;
  /** A fixed height range, so several plots side by side share one scale (the comparison). */
  elRange?: { min: number; max: number } | null;
  /** What the plot shows, for screen readers. Words only: the running figures are in the readouts. */
  label: string;
  /** Where the Sun is now; read once per frame. Null hides the dot. */
  getSun?: () => SunMark | null;
  /** Where Earth is now; read once per frame. Null hides the ring. */
  getEarth?: () => { az: number; el: number } | null;
  variant?: HorizonVariant;
  /** Height of the plot in pixels. Each variant has its own default. */
  height?: number;
  /** Degrees between compass marks: 45, or 90 where there is little room. */
  compassStep?: 45 | 90;
  testId?: string;
}

const HEIGHT: Record<HorizonVariant, number> = { console: 112, hero: 240, compact: 124 };
const PAD = { left: 40, right: 10, top: 8, bottom: 22 };

export interface HorizonLayout {
  box: PlotBox;
  center: number;
  scale: ElScale;
  elTicks: number[];
  azTicks: number[];
}

/** Where everything sits for a given answer and size. Pure, so tests can ask what the plot will label. */
export function horizonLayout(data: HorizonResponse, width: number, height: number, elRange: { min: number; max: number } | null, compassStep: 45 | 90): HorizonLayout {
  const box: PlotBox = { left: PAD.left, right: Math.max(PAD.left + 40, width - PAD.right), top: PAD.top, bottom: Math.max(PAD.top + 24, height - PAD.bottom) };
  const center = axisCenter(data.earth_box);
  const scale = elScale(elRange ?? naturalElRange(data), box.top, box.bottom - box.top);
  return { box, center, scale, elTicks: elTickValues(scale), azTicks: azTickValues(center, compassStep) };
}

export function HorizonPanel({ data, fromMs, toMs, elRange = null, label, getSun, getEarth, variant = 'console', height, compassStep = 45, testId }: HorizonPanelProps) {
  const H = height ?? HEIGHT[variant];
  const wrapRef = useRef<HTMLDivElement>(null);
  const sunRef = useRef<HTMLSpanElement>(null);
  const earthRef = useRef<HTMLSpanElement>(null);
  const [width, setWidth] = useState(variant === 'compact' ? 300 : 640);
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const w = Math.round(entries[0]?.contentRect.width ?? 0);
      if (w > 0) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const rangeMin = elRange?.min;
  const rangeMax = elRange?.max;
  const layout = useMemo(
    () => horizonLayout(data, width, H, rangeMin !== undefined && rangeMax !== undefined ? { min: rangeMin, max: rangeMax } : null, compassStep),
    [data, width, H, rangeMin, rangeMax, compassStep],
  );
  const { box, center, scale } = layout;
  const shapes = useMemo(
    () => ({
      sky: skylinePaths(data.skyline, center, box, scale.y),
      runs: sunRuns(data, fromMs, toMs, center, box, scale.y),
      earth: boxRects(data.earth_box, center, box),
    }),
    [data, fromMs, toMs, center, box, scale],
  );
  const elLabels = useMemo(() => horizonAxisQuantities(layout.elTicks), [layout.elTicks]);
  const clipId = `hz-clip-${useId().replace(/[^a-z0-9-]/gi, '')}`;
  const plotW = box.right - box.left;
  const earthBox = data.earth_box;

  // The markers: placed by transform, and only written when something changed.
  const written = useRef({ sun: '', earth: '' });
  useTicker(
    () => {
      const place = (az: number, el: number) => {
        const x = box.left + azFraction(az, center) * plotW;
        const y = scale.y(el);
        // Below the plotted range the marker rests on the bottom edge and says so.
        const below = y > box.bottom + 0.5;
        return { x, y: Math.max(box.top, Math.min(box.bottom, y)), below };
      };
      const sunEl = sunRef.current;
      if (sunEl) {
        const sun = getSun?.() ?? null;
        const ok = sun !== null && Number.isFinite(sun.az) && Number.isFinite(sun.el);
        const p = ok ? place(sun.az, sun.el) : null;
        const state = !ok ? 'none' : sun.lit === null ? 'unknown' : sun.lit ? 'lit' : 'dark';
        const key = p ? `${p.x.toFixed(1)},${p.y.toFixed(1)},${p.below},${state},${sun?.azText ?? ''},${sun?.elText ?? ''}` : 'none';
        if (key !== written.current.sun) {
          written.current.sun = key;
          sunEl.dataset.state = state;
          sunEl.style.opacity = p ? '1' : '0';
          if (p && sun) {
            sunEl.style.transform = `translate3d(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px, 0)`;
            sunEl.dataset.below = String(p.below);
            sunEl.dataset.az = sun.azText ?? '';
            sunEl.dataset.el = sun.elText ?? '';
          }
        }
      }
      const earthEl = earthRef.current;
      if (earthEl) {
        const earth = getEarth?.() ?? null;
        const ok = earth !== null && Number.isFinite(earth.az) && Number.isFinite(earth.el);
        const p = ok ? place(earth.az, earth.el) : null;
        // An Earth below the plotted range is not parked on the edge: its box is not drawn either.
        const key = p && !p.below ? `${p.x.toFixed(1)},${p.y.toFixed(1)}` : 'none';
        if (key !== written.current.earth) {
          written.current.earth = key;
          earthEl.dataset.state = key === 'none' ? 'none' : 'shown';
          earthEl.style.opacity = key === 'none' ? '0' : '1';
          if (p && key !== 'none') earthEl.style.transform = `translate3d(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px, 0)`;
        }
      }
    },
    Boolean(getSun || getEarth),
  );
  // A new layout moves everything: the next frame writes the markers again.
  useLayoutEffect(() => {
    written.current = { sun: '', earth: '' };
  }, [layout]);

  // "Earth" stands above its box, or beside it when the box reaches the top of the plot.
  const earthLabel = useMemo(() => {
    if (!earthBox || shapes.earth.length === 0) return null;
    const first = shapes.earth[0];
    const topY = scale.y(earthBox.el_max);
    if (topY - 5 >= box.top + 12) return { x: Math.min(first.x + 1, box.right - 36), y: topY - 5, anchor: 'start' as const };
    const midY = Math.min(box.bottom - 4, Math.max(box.top + 12, (topY + scale.y(earthBox.el_min)) / 2 + 4));
    const last = shapes.earth[shapes.earth.length - 1];
    const roomRight = box.right - (last.x + last.w) >= 44;
    return roomRight ? { x: last.x + last.w + 6, y: midY, anchor: 'start' as const } : { x: first.x - 6, y: midY, anchor: 'end' as const };
  }, [earthBox, shapes.earth, scale, box]);

  const breakY = scale.breakEl === null ? null : scale.y(scale.breakEl);
  const levelY = scale.min <= 0 && scale.max >= 0 ? scale.y(0) : null;

  return (
    <figure className="m-0 min-w-0" data-testid={testId} data-variant={variant} data-horizon>
      <div ref={wrapRef} className="relative" style={{ height: H }}>
        <svg width={width} height={H} viewBox={`0 0 ${width} ${H}`} className="absolute inset-0 block" role="img" aria-label={label}>
          <defs>
            <clipPath id={clipId}>
              <rect x={box.left} y={box.top} width={plotW} height={box.bottom - box.top} />
            </clipPath>
          </defs>
          <rect x={box.left} y={box.top} width={plotW} height={box.bottom - box.top} fill="var(--ch-well)" />
          {layout.elTicks.map((e, i) => (
            <g key={e}>
              {e === 0 ? null : <line x1={box.left} x2={box.right} y1={scale.y(e)} y2={scale.y(e)} stroke="var(--ch-line)" strokeDasharray="2 4" />}
              <text x={box.left - 6} y={scale.y(e)} dy="0.34em" textAnchor="end" fontSize={12} fill="var(--ch-muted)" className="num" data-q={elLabels[i].key}>
                {elLabels[i].text}
                {elLabels[i].unit}
              </text>
            </g>
          ))}
          {/* Level with the site: the line every height is measured from. */}
          {levelY !== null ? <line x1={box.left} x2={box.right} y1={levelY} y2={levelY} stroke="var(--ch-line-strong)" strokeDasharray="6 3" /> : null}
          {/* Where the height scale changes: a double line across the plot. */}
          {breakY !== null ? (
            <g data-scale-break>
              <line x1={box.left} x2={box.right} y1={breakY - 1.5} y2={breakY - 1.5} stroke="var(--ch-line-strong)" />
              <line x1={box.left} x2={box.right} y1={breakY + 1.5} y2={breakY + 1.5} stroke="var(--ch-line-strong)" />
            </g>
          ) : null}
          <g clipPath={`url(#${clipId})`}>
            {earthBox
              ? shapes.earth.map((r, i) => (
                  <rect
                    key={i}
                    x={r.x}
                    y={scale.y(earthBox.el_max)}
                    width={r.w}
                    height={Math.max(2, scale.y(earthBox.el_min) - scale.y(earthBox.el_max))}
                    fill="var(--ch-earth-soft)"
                    stroke="var(--ch-earth)"
                    strokeWidth={1.25}
                    rx={2}
                  />
                ))
              : null}
            {shapes.sky.area ? <path d={shapes.sky.area} fill="var(--ch-terrain)" /> : null}
            {shapes.sky.line ? <path d={shapes.sky.line} fill="none" stroke="var(--ch-cyan)" strokeWidth={1.5} strokeLinejoin="round" data-skyline /> : null}
            {shapes.runs.map((run, i) => (
              <polyline
                key={i}
                points={run.points}
                fill="none"
                stroke="var(--ch-sun)"
                strokeWidth={1.5}
                strokeDasharray={run.state === 'hidden' ? '3 4' : undefined}
                strokeLinejoin="round"
                data-sun-run={run.state}
              />
            ))}
          </g>
          {earthLabel ? (
            <text x={earthLabel.x} y={earthLabel.y} textAnchor={earthLabel.anchor} fontSize={12} fill="var(--ch-earth-text)" className="font-display">
              Earth
            </text>
          ) : null}
          {layout.azTicks.map((a, i) => {
            const first = i === 0;
            const last = i === layout.azTicks.length - 1;
            const x = box.left + (i / (layout.azTicks.length - 1)) * plotW;
            return (
              <g key={a}>
                <line x1={x} x2={x} y1={box.bottom} y2={box.bottom + 4} stroke="var(--ch-line-strong)" />
                <text x={x} y={box.bottom + 17} textAnchor={first ? 'start' : last ? 'end' : 'middle'} fontSize={12} fill="var(--ch-ink-2)" className="font-display">
                  {compassLetters(a)}
                </text>
              </g>
            );
          })}
        </svg>
        <div className="pointer-events-none absolute inset-0" aria-hidden>
          <span ref={earthRef} className="hz-mark hz-earth" data-testid="horizon-earth" data-state="none" />
          <span ref={sunRef} className="hz-mark hz-sun" data-testid="horizon-sun" data-state="none" />
        </div>
      </div>
    </figure>
  );
}

/**
 * What the lines and marks of the horizon plot and of the stay timeline mean. `scaleBreak` is the
 * axis label of the height where the plot's scale changes, when it has two bands.
 */
export function SkyLegend({
  scaleBreak = null,
  delayed = false,
  className = '',
}: {
  scaleBreak?: { key: string; text: string; unit: string } | null;
  /** True with a launch delay: the plot then covers the delay as well as the stay. */
  delayed?: boolean;
  className?: string;
}) {
  return (
    <ul className={`m-0 flex list-none flex-wrap items-center gap-x-4 gap-y-1 p-0 text-[12px] leading-tight text-ink-2 ${className}`} data-testid="sky-legend">
      <li className="flex items-center gap-1.5">
        <svg width="20" height="6" aria-hidden>
          <line x1="0" x2="20" y1="3" y2="3" stroke="var(--ch-sun)" strokeWidth="1.5" />
        </svg>
        Sun above the skyline
      </li>
      <li className="flex items-center gap-1.5">
        <svg width="20" height="6" aria-hidden>
          <line x1="0" x2="20" y1="3" y2="3" stroke="var(--ch-sun)" strokeWidth="1.5" strokeDasharray="3 4" />
        </svg>
        Sun hidden
      </li>
      <li className="flex items-center gap-1.5">
        <span className="inline-block h-2.5 w-4 rounded-[2px] border border-earth bg-earth-soft" aria-hidden />
        {delayed ? 'Earth’s range over the delay and the stay' : 'Earth’s range over the stay'}
      </li>
      <li className="flex items-center gap-1.5">
        <span className="inline-block h-2.5 w-4 bg-sun" aria-hidden />
        lit
      </li>
      <li className="flex items-center gap-1.5">
        <span className="stay-swatch-dark inline-block h-1.5 w-4" aria-hidden />
        dark
      </li>
      {scaleBreak ? (
        <li>
          Double line: scale changes at{' '}
          <span className="num" data-q={scaleBreak.key}>
            {scaleBreak.text}
            {scaleBreak.unit}
          </span>
        </li>
      ) : null}
      <li className="text-muted">Markers show position, not size.</li>
    </ul>
  );
}
