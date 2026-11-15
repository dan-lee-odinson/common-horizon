// A small line graph on glass. It plots a real series (for example the Sun's elevation at a site
// over time) against a level line, with the lowest and highest values named, and a cursor that
// follows the running clock. The cursor moves by transform once per frame; the curve is drawn once.

import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTicker } from './useTicker';

export interface GraphPoint {
  x: number;
  y: number;
}

export interface LineGraphProps {
  /** What the graph shows, for screen readers: "Sun elevation at Apollo 11 over 29.5 days". */
  label: string;
  points: readonly GraphPoint[];
  /** Horizontal range. Defaults to the first and last point. */
  xDomain?: readonly [number, number];
  /** A value drawn as a dashed level line (0 for "level with the horizon"). */
  level?: number;
  /** Formats a y value for the two scale labels: (12.3) => "+12°". */
  formatY: (y: number) => string;
  /** Labels under the left and right ends of the x axis. */
  xLabels?: readonly [string, string];
  /** Where the cursor is, as an x value; read once per frame. Omit for no cursor. */
  getCursor?: () => number | null;
  color?: string;
  height?: number;
  className?: string;
}

const PAD = { left: 4, right: 4, top: 8, bottom: 6 };

export function LineGraph({ label, points, xDomain, level, formatY, xLabels, getCursor, color = 'var(--ch-cyan)', height = 64, className = '' }: LineGraphProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(280);
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

  const shape = useMemo(() => {
    if (points.length < 2) return null;
    const x0 = xDomain ? xDomain[0] : points[0].x;
    const x1 = xDomain ? xDomain[1] : points[points.length - 1].x;
    let yMin = Infinity;
    let yMax = -Infinity;
    for (const p of points) {
      if (p.y < yMin) yMin = p.y;
      if (p.y > yMax) yMax = p.y;
    }
    const lo = Math.min(yMin, level ?? yMin);
    const hi = Math.max(yMax, level ?? yMax);
    const span = hi - lo || 1;
    const plotW = width - PAD.left - PAD.right;
    const plotH = height - PAD.top - PAD.bottom;
    const sx = (x: number) => PAD.left + ((x - x0) / (x1 - x0 || 1)) * plotW;
    const sy = (y: number) => PAD.top + ((hi - y) / span) * plotH;
    // Thin the series to about one point per pixel; the shape stays the same.
    const stride = Math.max(1, Math.floor(points.length / Math.max(1, plotW)));
    let d = '';
    for (let i = 0; i < points.length; i += stride) d += `${i === 0 ? 'M' : 'L'}${sx(points[i].x).toFixed(1)},${sy(points[i].y).toFixed(1)}`;
    const last = points[points.length - 1];
    d += `L${sx(last.x).toFixed(1)},${sy(last.y).toFixed(1)}`;
    const base = sy(level ?? lo);
    const area = `${d}L${sx(last.x).toFixed(1)},${base.toFixed(1)}L${sx(points[0].x).toFixed(1)},${base.toFixed(1)}Z`;
    return { d, area, levelY: level === undefined ? null : sy(level), yMin, yMax, x0, x1, plotW };
  }, [points, xDomain, level, width, height]);

  useTicker(() => {
    const el = cursorRef.current;
    if (!el || !shape || !getCursor) return;
    const x = getCursor();
    if (x === null || !Number.isFinite(x)) {
      el.style.opacity = '0';
      return;
    }
    const f = (x - shape.x0) / (shape.x1 - shape.x0 || 1);
    // Outside the plotted range there is nothing to point at: the cursor hides rather than park at an edge.
    if (f < -0.002 || f > 1.002) {
      el.style.opacity = '0';
      return;
    }
    el.style.opacity = '1';
    el.style.transform = `translateX(${(PAD.left + Math.max(0, Math.min(1, f)) * shape.plotW).toFixed(1)}px)`;
  }, Boolean(getCursor));

  return (
    <figure className={`m-0 flex min-w-0 flex-col gap-1 ${className}`} aria-label={label} data-graph>
      <div ref={wrapRef} className="relative" style={{ height }}>
        {shape ? (
          <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="absolute inset-0 block" role="img" aria-label={`${label}. Lowest ${formatY(shape.yMin)}, highest ${formatY(shape.yMax)}.`}>
            <path d={shape.area} fill={color} opacity={0.1} />
            {shape.levelY !== null ? <line x1={PAD.left} x2={width - PAD.right} y1={shape.levelY} y2={shape.levelY} stroke="var(--ch-line-strong)" strokeDasharray="2 4" /> : null}
            <path d={shape.d} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" />
          </svg>
        ) : (
          <div className="skeleton absolute inset-0" role="status">
            <span className="sr-only">No data yet</span>
          </div>
        )}
        {getCursor ? (
          <div ref={cursorRef} className="pointer-events-none absolute left-0 top-0 h-full w-px" style={{ background: 'var(--ch-ink)', opacity: 0, willChange: 'transform' }} aria-hidden />
        ) : null}
      </div>
      <figcaption className="num flex items-baseline justify-between gap-2 text-[12px] leading-tight text-muted">
        <span>{xLabels?.[0] ?? ''}</span>
        <span className="text-ink-2">{shape ? `${formatY(shape.yMin)} to ${formatY(shape.yMax)}` : '—'}</span>
        <span>{xLabels?.[1] ?? ''}</span>
      </figcaption>
    </figure>
  );
}
