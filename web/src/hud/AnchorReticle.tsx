// A reticle that stays on a point of the 3D scene (the landing point, the lander): one DOM element
// moved by transform once per frame, so it keeps its place while the camera turns. It fades when
// the point leaves the view. The name under it is plain words; it carries no number.

import { useRef } from 'react';
import { anchors, type AnchorName } from '../scene/anchors';
import { Reticle } from './Reticle';
import { useTicker } from './useTicker';

export function AnchorReticle({ anchor, label, size = 72, testId = 'lander-reticle' }: { anchor: AnchorName; label: string; size?: number; testId?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const written = useRef('');
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
    const transform = `translate3d(${a.x.toFixed(1)}px, ${a.y.toFixed(1)}px, 0)`;
    if (transform === written.current) return;
    written.current = transform;
    el.style.transform = transform;
  });
  return (
    <div
      ref={ref}
      className="pointer-events-none absolute left-0 top-0"
      style={{ opacity: 0, transition: 'opacity 200ms ease', willChange: 'transform' }}
      data-testid={testId}
      data-marker={anchor}
      data-visible="false"
      aria-hidden
    >
      <div className="absolute" style={{ left: -size / 2, top: -size / 2 }}>
        <Reticle size={size} pulsing />
      </div>
      <span
        className="absolute left-0 -translate-x-1/2 whitespace-nowrap rounded-[3px] border border-accent bg-glass-strong px-1.5 py-1 font-display text-[12px] font-semibold uppercase leading-none tracking-[0.14em] text-accent"
        style={{ top: size / 2 + 6 }}
        data-marker-tag
      >
        {label}
      </span>
    </div>
  );
}
