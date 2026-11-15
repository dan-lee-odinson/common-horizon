// Ring instruments drawn in SVG: nested concentric rings with tick scales, segmented arcs and
// pointers. Angles are compass angles: 0 at the top, clockwise (north, east, south, west).
// Every arc, tick position and pointer is driven by a value passed in; nothing spins for show.

import type { ReactNode } from 'react';

const RAD = Math.PI / 180;

export function polar(cx: number, cy: number, r: number, deg: number): { x: number; y: number } {
  return { x: cx + r * Math.sin(deg * RAD), y: cy - r * Math.cos(deg * RAD) };
}

/** SVG path of an arc from a0 to a1 degrees, clockwise. */
export function arcPath(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const sweep = Math.max(0, Math.min(359.999, a1 - a0));
  const p0 = polar(cx, cy, r, a0);
  const p1 = polar(cx, cy, r, a0 + sweep);
  return `M${p0.x.toFixed(2)},${p0.y.toFixed(2)} A${r},${r} 0 ${sweep > 180 ? 1 : 0} 1 ${p1.x.toFixed(2)},${p1.y.toFixed(2)}`;
}

/** A ring of ticks: one every `every` degrees, longer every `major` degrees. */
export function TickRing({
  cx,
  cy,
  r,
  every = 10,
  major = 30,
  length = 4,
  majorLength = 8,
  from = 0,
  to = 360,
  color = 'var(--ch-line-strong)',
  inward = true,
}: {
  cx: number;
  cy: number;
  r: number;
  every?: number;
  major?: number;
  length?: number;
  majorLength?: number;
  from?: number;
  to?: number;
  color?: string;
  inward?: boolean;
}) {
  let d = '';
  for (let a = from; a < to + 1e-6 && a < from + 360; a += every) {
    const isMajor = Math.abs(a / major - Math.round(a / major)) < 1e-6;
    const len = (isMajor ? majorLength : length) * (inward ? -1 : 1);
    const p0 = polar(cx, cy, r, a);
    const p1 = polar(cx, cy, r + len, a);
    d += `M${p0.x.toFixed(2)},${p0.y.toFixed(2)}L${p1.x.toFixed(2)},${p1.y.toFixed(2)}`;
  }
  return <path d={d} stroke={color} strokeWidth={1} fill="none" />;
}

/**
 * An arc split into equal segments, lit up to `value` of `max`. With `from` and `to` it covers
 * part of the circle (a gauge). A null value lights nothing.
 */
export function SegmentedArc({
  cx,
  cy,
  r,
  value,
  max,
  segments = 24,
  from = 0,
  to = 360,
  gap = 2.4,
  width = 4,
  color = 'var(--ch-cyan)',
  track = 'var(--ch-line)',
}: {
  cx: number;
  cy: number;
  r: number;
  value: number | null;
  max: number;
  segments?: number;
  from?: number;
  to?: number;
  gap?: number;
  width?: number;
  color?: string;
  track?: string;
}) {
  const span = (to - from) / segments;
  const lit = value === null || max <= 0 ? 0 : Math.max(0, Math.min(1, value / max)) * segments;
  const out: ReactNode[] = [];
  for (let i = 0; i < segments; i++) {
    const a0 = from + i * span + gap / 2;
    const a1 = from + (i + 1) * span - gap / 2;
    const on = i + 1 <= lit + 1e-9;
    const part = !on && i < lit ? lit - i : 0;
    out.push(<path key={i} d={arcPath(cx, cy, r, a0, a1)} stroke={on ? color : track} strokeWidth={width} fill="none" />);
    if (part > 0) out.push(<path key={`${i}p`} d={arcPath(cx, cy, r, a0, a0 + (a1 - a0) * part)} stroke={color} strokeWidth={width} fill="none" />);
  }
  return <g>{out}</g>;
}

/** A marker on a ring at a compass angle: a short radial stroke and a dot. */
export function RingPointer({ cx, cy, r, angle, color, length = 10, id }: { cx: number; cy: number; r: number; angle: number; color: string; length?: number; id?: string }) {
  const p0 = polar(cx, cy, r - length, angle);
  const p1 = polar(cx, cy, r + length * 0.4, angle);
  const dot = polar(cx, cy, r, angle);
  return (
    <g data-pointer={id}>
      <line x1={p0.x} y1={p0.y} x2={p1.x} y2={p1.y} stroke={color} strokeWidth={1.5} />
      <circle cx={dot.x} cy={dot.y} r={3} fill={color} />
      <circle cx={dot.x} cy={dot.y} r={7} fill={color} opacity={0.18} />
    </g>
  );
}
