// The Sun's light across the Orbit picture: faint lines of light along the Sun's direction, and a
// soft glow where that direction leaves the frame (shown only while the Sun itself is outside it).
//
// The scene works out, once per frame, where each line of light runs on screen (sunlightView in
// scene/sunlight.ts). This draws them: each line is cut to the frame, stopped at the Moon (the gap
// behind it is its shadow), left out across Earth's face, and kept clear of the glass panels and
// the controls, which are measured from the page itself. The arithmetic is in scene/sunlight.ts and is tested there.

import { useId, useRef, type RefObject } from 'react';
import { clipLine, edgeGlow, lineLevel, sunExit, sunlightView, SUNLIGHT, type Box } from '../scene/sunlight';
import { useTicker } from '../hud/useTicker';

/** Frames between two measurements of the panels (they move a little as the HUD leans with the pointer). */
const MEASURE_EVERY = 6;

export function SunlightField({ root, active, isPhone }: { root: RefObject<HTMLDivElement | null>; active: boolean; isPhone: boolean }) {
  const svg = useRef<SVGSVGElement>(null);
  const paths = [useRef<SVGPathElement>(null), useRef<SVGPathElement>(null), useRef<SVGPathElement>(null)];
  const gradient = useRef<SVGLinearGradientElement>(null);
  const glow = useRef<HTMLDivElement>(null);
  const gradientId = useId();
  const state = useRef({ age: MEASURE_EVERY, keep: [] as Box[], frame: { left: 0, top: 0, right: 0, bottom: 0 } as Box, written: ['', '', ''], glow: '' });

  useTicker(() => {
    const el = svg.current;
    const host = root.current;
    if (!el || !host) return;
    const s = state.current;
    const light = sunlightView;
    const on = active && light.shown && light.opacity > 0.01;

    // The glass panels and the controls, as boxes on screen. Measured now and then, not every frame.
    if (on && ++s.age >= MEASURE_EVERY) {
      s.age = 0;
      const base = host.getBoundingClientRect();
      s.frame = { left: 0, top: 0, right: base.width, bottom: base.height };
      s.keep = Array.from(host.querySelectorAll<HTMLElement>('[data-panel], [data-keep-clear]')).flatMap((node) => {
        const r = node.getBoundingClientRect();
        return r.width > 0 && r.height > 0 ? [{ left: r.left - base.left, top: r.top - base.top, right: r.right - base.left, bottom: r.bottom - base.top }] : [];
      });
    }

    // ---- the lines of light ----
    const d = ['', '', ''];
    let drawn = 0;
    if (on && light.strength > 0.01) {
      for (const line of light.lines) {
        const level = lineLevel(line.k, light.gapPx);
        if (level <= 0.01) continue;
        const bucket = Math.abs(line.k) % 4 === 0 ? 0 : Math.abs(line.k) % 2 === 0 ? 1 : 2;
        for (const piece of clipLine(line, s.frame, light.bodies, s.keep)) {
          d[bucket] += `M${piece.x1.toFixed(1)} ${piece.y1.toFixed(1)}L${piece.x2.toFixed(1)} ${piece.y2.toFixed(1)}`;
          drawn++;
        }
      }
    }
    const whole = on ? light.opacity * light.strength : 0;
    paths.forEach((ref, i) => {
      const path = ref.current;
      if (!path) return;
      if (d[i] !== s.written[i]) {
        s.written[i] = d[i];
        path.setAttribute('d', d[i]);
      }
      const level = i === 0 ? 1 : lineLevel(i === 1 ? 2 : 1, light.gapPx);
      path.style.opacity = (whole * level).toFixed(3);
    });
    if (el.dataset.lines !== String(drawn)) el.dataset.lines = String(drawn);

    // ---- where the Sun's direction leaves the frame ----
    const exit = on ? sunExit(light.origin, light.heading, s.frame, s.keep) : null;
    // The lines are brightest on the Sun's side and fade across the picture.
    const g = gradient.current;
    if (g && on) {
      const reach = Math.hypot(s.frame.right, s.frame.bottom);
      const from = exit ?? light.origin;
      g.setAttribute('x1', from.x.toFixed(0));
      g.setAttribute('y1', from.y.toFixed(0));
      g.setAttribute('x2', (from.x - light.heading.ux * reach).toFixed(0));
      g.setAttribute('y2', (from.y - light.heading.uy * reach).toFixed(0));
    }

    // ---- the glow at the frame's edge: only while the Sun itself is outside the frame ----
    const node = glow.current;
    if (!node) return;
    const lit = on ? edgeGlow(light.origin, light.heading, light.sun, light.sunRadius, s.frame, s.keep, isPhone ? SUNLIGHT.glowRadiusPhone : SUNLIGHT.glowRadius) : null;
    // The glow is light from beyond the Moon and Earth: it is not drawn over either of them.
    const holes = lit
      ? light.bodies
          .map((b) => {
            const r = (b.r + (b.long?.r ?? b.r)) / 2;
            return `radial-gradient(circle at ${(b.x - lit.box.left).toFixed(0)}px ${(b.y - lit.box.top).toFixed(0)}px, transparent ${r.toFixed(0)}px, #000 ${(r + 36).toFixed(0)}px)`;
          })
          .join(', ')
      : '';
    const key = lit ? `${lit.box.left.toFixed(0)},${lit.box.top.toFixed(0)},${lit.box.right.toFixed(0)},${lit.box.bottom.toFixed(0)},${lit.x.toFixed(0)},${lit.y.toFixed(0)},${lit.radius.toFixed(0)},${light.opacity.toFixed(2)},${holes}` : '';
    if (key === s.glow) return;
    s.glow = key;
    node.dataset.visible = String(Boolean(lit));
    if (!lit) {
      node.style.opacity = '0';
      return;
    }
    const { box } = lit;
    node.dataset.x = lit.x.toFixed(0);
    node.dataset.y = lit.y.toFixed(0);
    node.dataset.at = lit.at;
    node.style.opacity = light.opacity.toFixed(2);
    node.style.transform = `translate3d(${box.left.toFixed(1)}px, ${box.top.toFixed(1)}px, 0)`;
    node.style.width = `${(box.right - box.left).toFixed(1)}px`;
    node.style.height = `${(box.bottom - box.top).toFixed(1)}px`;
    node.style.background = `radial-gradient(circle ${lit.radius.toFixed(0)}px at ${(lit.x - box.left).toFixed(1)}px ${(lit.y - box.top).toFixed(1)}px, var(--ch-sun-glow) 0%, var(--ch-sun-soft) 42%, transparent 100%)`;
    node.style.maskImage = holes || 'none';
    node.style.setProperty('-webkit-mask-image', holes || 'none');
    node.style.maskComposite = 'intersect';
    node.style.setProperty('-webkit-mask-composite', 'source-in');
  }, active);

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden data-testid="sunlight">
      <svg ref={svg} className="absolute inset-0 h-full w-full" data-testid="sunlight-lines" data-lines="0">
        <defs>
          <linearGradient ref={gradient} id={gradientId} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="var(--ch-sun)" stopOpacity="0.4" />
            <stop offset="0.5" stopColor="var(--ch-sun)" stopOpacity="0.2" />
            <stop offset="1" stopColor="var(--ch-sun)" stopOpacity="0.09" />
          </linearGradient>
        </defs>
        {paths.map((ref, i) => (
          <path key={i} ref={ref} d="" fill="none" stroke={`url(#${gradientId})`} strokeWidth={i === 0 ? 1.2 : 1} strokeLinecap="round" data-sunlight-level={i} style={{ opacity: 0 }} />
        ))}
      </svg>
      <div
        ref={glow}
        className="absolute left-0 top-0"
        style={{ opacity: 0, transition: 'opacity 220ms cubic-bezier(0.23, 1, 0.32, 1)', mixBlendMode: 'screen', willChange: 'transform, opacity' }}
        data-testid="sun-edge-glow"
        data-visible="false"
      />
    </div>
  );
}
