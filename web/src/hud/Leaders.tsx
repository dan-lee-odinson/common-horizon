// Leader lines: thin lines from a point in the 3D scene to the glass panel that describes it, with
// a small ring at the scene end. A line hides whenever its point is out of view (for example while
// the Sun is behind the Moon). Lines are redrawn once per frame by writing the path's geometry.

import { useRef } from 'react';
import { anchors, type AnchorName } from '../scene/anchors';
import { useTicker } from './useTicker';

export interface LeaderSpec {
  anchor: AnchorName;
  /** CSS selector of the element the line runs to (inside the HUD). */
  to: string;
  color: string;
  /** Which edge of the target the line meets. */
  edge?: 'left' | 'right' | 'top' | 'bottom';
}

export function Leaders({ items, active = true }: { items: readonly LeaderSpec[]; active?: boolean }) {
  const svgRef = useRef<SVGSVGElement>(null);
  useTicker(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const box = svg.getBoundingClientRect();
    items.forEach((item, i) => {
      const group = svg.children[i] as SVGGElement | undefined;
      if (!group) return;
      const a = anchors[item.anchor];
      const target = active && a.visible ? document.querySelector<HTMLElement>(item.to) : null;
      const rect = target?.getBoundingClientRect();
      if (!rect || rect.width === 0) {
        group.style.opacity = '0';
        return;
      }
      const ax = a.x;
      const ay = a.y;
      const edge = item.edge ?? (rect.left + rect.width / 2 < ax + box.left ? 'right' : 'left');
      let tx: number;
      let ty: number;
      if (edge === 'top' || edge === 'bottom') {
        tx = Math.min(rect.right - 16, Math.max(rect.left + 16, ax + box.left)) - box.left;
        ty = (edge === 'top' ? rect.top : rect.bottom) - box.top;
      } else {
        tx = (edge === 'right' ? rect.right : rect.left) - box.left;
        ty = Math.min(rect.bottom - 14, Math.max(rect.top + 14, ay + box.top)) - box.top;
      }
      // Leave the scene point on a 45 degree diagonal, then run straight into the panel.
      const dx = tx - ax;
      const dy = ty - ay;
      let d: string;
      if (edge === 'top' || edge === 'bottom') {
        const run = Math.min(Math.abs(dx), Math.abs(dy));
        d = `M${ax.toFixed(1)},${ay.toFixed(1)}L${(ax + Math.sign(dx) * run).toFixed(1)},${(ay + Math.sign(dy) * run).toFixed(1)}L${tx.toFixed(1)},${ty.toFixed(1)}`;
      } else {
        const run = Math.min(Math.abs(dx) * 0.6, Math.abs(dy));
        d = `M${ax.toFixed(1)},${ay.toFixed(1)}L${(ax + Math.sign(dx) * run).toFixed(1)},${ty.toFixed(1)}L${tx.toFixed(1)},${ty.toFixed(1)}`;
      }
      group.style.opacity = '1';
      (group.children[0] as SVGPathElement).setAttribute('d', d);
      const ring = group.children[1] as SVGCircleElement;
      ring.setAttribute('cx', ax.toFixed(1));
      ring.setAttribute('cy', ay.toFixed(1));
      const end = group.children[2] as SVGCircleElement;
      end.setAttribute('cx', tx.toFixed(1));
      end.setAttribute('cy', ty.toFixed(1));
    });
  });
  return (
    <svg ref={svgRef} className="pointer-events-none absolute inset-0 z-[5] h-full w-full" aria-hidden data-testid="leaders">
      {items.map((item) => (
        <g key={`${item.anchor}:${item.to}`} style={{ opacity: 0, transition: 'opacity 220ms ease' }} data-leader={item.anchor}>
          <path fill="none" stroke={item.color} strokeWidth={1} strokeOpacity={0.7} />
          <circle r={5} fill="none" stroke={item.color} strokeWidth={1} />
          <circle r={2} fill={item.color} />
        </g>
      ))}
    </svg>
  );
}
