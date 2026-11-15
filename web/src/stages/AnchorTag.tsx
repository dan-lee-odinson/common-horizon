// A floating data point: a small tag that follows a point in the 3D scene (the Sun, Earth, a mark
// on a ring), set a short way off it. It hides whenever the point is out of view, for example while
// the body is behind the Moon. A tag sits on the side of its point that faces the Moon (or in a
// fixed direction), so it never reaches toward the panels at the sides of the screen.

import { useRef } from 'react';
import { anchors, type AnchorName } from '../scene/anchors';
import { useTicker } from '../hud/useTicker';
import type { Quantity } from '../util/quantities';

const COLOR = { sun: 'var(--ch-sun)', earth: 'var(--ch-earth-text)', cyan: 'var(--ch-accent)', muted: 'var(--ch-muted)' } as const;

export function AnchorTag({
  anchor,
  label,
  tone,
  toward = 'moon',
  gap = 12,
  q,
  plain = false,
}: {
  anchor: AnchorName;
  label: string;
  tone: keyof typeof COLOR;
  /** Which way the tag sits from its point: toward the Moon's centre, or a fixed screen direction (degrees clockwise from up). */
  toward?: 'moon' | number;
  /** Pixels between the point's edge and the tag. */
  gap?: number;
  /** A quantity shown after the name; it is kept running like any readout. */
  q?: Quantity;
  /** Text only, centred on the point: no box (scale marks). */
  plain?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const box = useRef({ w: 0, h: 0, age: 99 });
  useTicker(() => {
    const el = ref.current;
    if (!el) return;
    const a = anchors[anchor];
    const visible = a.visible;
    if (el.dataset.visible !== String(visible)) {
      el.dataset.visible = String(visible);
      el.style.opacity = visible ? '1' : '0';
    }
    if (!visible) return;
    el.style.transform = `translate3d(${a.x.toFixed(1)}px, ${a.y.toFixed(1)}px, 0)`;
    el.dataset.ax = a.x.toFixed(0);
    el.dataset.ay = a.y.toFixed(0);
    el.dataset.ar = a.r.toFixed(0);
    const tag = boxRef.current;
    if (!tag) return;
    // The tag's size changes rarely (a digit more or less); measure it now and then, not every frame.
    if (++box.current.age > 20) box.current = { w: tag.offsetWidth, h: tag.offsetHeight, age: 0 };
    let ux: number;
    let uy: number;
    if (toward === 'moon') {
      const dx = anchors.moon.x - a.x;
      const dy = anchors.moon.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      ux = dx / len;
      uy = dy / len;
    } else {
      ux = Math.sin((toward * Math.PI) / 180);
      uy = -Math.cos((toward * Math.PI) / 180);
    }
    const reach = a.r + gap + (Math.abs(ux) * box.current.w) / 2 + (Math.abs(uy) * box.current.h) / 2;
    tag.style.transform = `translate(${(ux * reach - box.current.w / 2).toFixed(1)}px, ${(uy * reach - box.current.h / 2).toFixed(1)}px)`;
  });
  const color = COLOR[tone];
  if (plain) {
    return (
      <div ref={ref} className="pointer-events-none absolute left-0 top-0" style={{ opacity: 0, transition: 'opacity 200ms ease', willChange: 'transform' }} data-visible="false" aria-hidden>
        <span className="num absolute block -translate-x-1/2 -translate-y-1/2 whitespace-nowrap text-[12px] leading-none" style={{ color }}>
          {label}
        </span>
      </div>
    );
  }
  return (
    <div
      ref={ref}
      className="pointer-events-none absolute left-0 top-0"
      style={{ opacity: 0, transition: 'opacity 200ms ease', willChange: 'transform' }}
      data-testid={`body-label-${anchor}`}
      data-marker={anchor}
      data-visible="false"
      aria-hidden
    >
      <div
        ref={boxRef}
        className="absolute left-0 top-0 flex items-center gap-2 whitespace-nowrap rounded-[3px] border bg-glass-strong px-1.5 py-1 font-display text-[12px] font-semibold uppercase leading-none tracking-[0.14em]"
        style={{ color, borderColor: color, willChange: 'transform' }}
        data-marker-tag
      >
        {label}
        {q ? (
          <span className="num text-[12px] font-medium normal-case tracking-normal text-ink" data-q={q.key}>
            <span data-q-text>{q.text}</span>
            <span data-q-unit>{q.unit}</span>
          </span>
        ) : null}
      </div>
    </div>
  );
}
