// A reticle that stays on a point of the 3D scene (the landing site, the lander): one DOM element
// moved by transform once per frame, so it keeps its place while the camera moves. It fades when
// the point leaves the view, and when there is no point to follow. The name under it is plain
// words; it carries no number. With no name to show, the reticle stands alone.

import { useRef } from 'react';
import { anchors, type AnchorName } from '../scene/anchors';
import { Reticle } from './Reticle';
import { useTicker } from './useTicker';

export function AnchorReticle({
  anchor,
  getLabel,
  size = 72,
  testId = 'lander-reticle',
}: {
  /** The point followed; null for none (the reticle fades out). */
  anchor: AnchorName | null;
  /** The name under the reticle, read each frame; an empty string for no name. */
  getLabel: () => string;
  size?: number;
  testId?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLSpanElement>(null);
  const written = useRef({ transform: '', label: '\u0000' });
  useTicker(() => {
    const el = ref.current;
    if (!el) return;
    const a = anchor === null ? null : anchors[anchor];
    const visible = a !== null && a.visible;
    if (el.dataset.visible !== String(visible)) {
      el.dataset.visible = String(visible);
      el.style.opacity = visible ? '1' : '0';
    }
    if (!a || !visible) return;
    const transform = `translate3d(${a.x.toFixed(1)}px, ${a.y.toFixed(1)}px, 0)`;
    if (transform !== written.current.transform) {
      written.current.transform = transform;
      el.style.transform = transform;
    }
    const tag = labelRef.current;
    const label = getLabel();
    if (tag && label !== written.current.label) {
      written.current.label = label;
      // An empty name fades the tag out with its last words still in it.
      if (label !== '') tag.textContent = label;
      tag.style.opacity = label === '' ? '0' : '1';
    }
  });
  return (
    <div
      ref={ref}
      className="pointer-events-none absolute left-0 top-0"
      style={{ opacity: 0, transition: 'opacity 200ms ease', willChange: 'transform' }}
      data-testid={testId}
      data-follows={anchor ?? undefined}
      data-visible="false"
      aria-hidden
    >
      <div className="absolute" style={{ left: -size / 2, top: -size / 2 }}>
        <Reticle size={size} pulsing />
      </div>
      <span
        ref={labelRef}
        className="absolute left-0 -translate-x-1/2 whitespace-nowrap rounded-[3px] border border-accent bg-glass-strong px-1.5 py-1 font-display text-[12px] font-semibold uppercase leading-none tracking-[0.14em] text-accent"
        style={{ top: size / 2 + 6, opacity: 0, transition: 'opacity 200ms ease' }}
        data-marker-tag
      />
    </div>
  );
}
