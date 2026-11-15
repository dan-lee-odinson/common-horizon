// Leader lines: thin lines from a point in the 3D scene to the glass panel that describes it. A
// line hides whenever its point is out of view (for example while the Sun is behind the Moon).
// Lines are redrawn once per frame by writing the path's geometry.

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
  /**
   * Draw the line only while the point is on this side of the Moon's centre, so a line never
   * crosses the Moon to reach a panel on the far side.
   */
  side?: 'left' | 'right';
}

/** Pixels the point must be clear of the Moon's centre line before its leader shows. */
const SIDE_MARGIN = 60;

export function Leaders({ items, active = true }: { items: readonly LeaderSpec[]; active?: boolean }) {
  const svgRef = useRef<SVGSVGElement>(null);
  /** The panel each line runs to, looked up once and again only if it leaves the page. */
  const targets = useRef<(HTMLElement | null)[]>([]);
  /** What was last written for each line, so an unchanged line costs no writes. */
  const written = useRef<string[]>([]);
  useTicker(() => {
    const svg = svgRef.current;
    if (!svg) return;

    // Read pass: every measurement first, so the frame pays for one layout at most.
    const plans: (string | null)[] = [];
    let box: DOMRect | null = null;
    items.forEach((item, i) => {
      const a = anchors[item.anchor];
      const onSide = !item.side || (item.side === 'left' ? a.x < anchors.moon.x - SIDE_MARGIN : a.x > anchors.moon.x + SIDE_MARGIN);
      if (!active || !a.visible || !onSide) return void plans.push(null);
      let target = targets.current[i] ?? null;
      if (!target || !target.isConnected) target = targets.current[i] = document.querySelector<HTMLElement>(item.to);
      // A panel that is closed or hidden gets no line.
      if (!target || target.closest('[inert], [aria-hidden="true"]')) return void plans.push(null);
      const rect = target.getBoundingClientRect();
      if (rect.width === 0) return void plans.push(null);
      box ??= svg.getBoundingClientRect();
      const ax = a.x;
      const ay = a.y;
      const edge = item.edge ?? (rect.left + rect.width / 2 < ax + box.left ? 'right' : 'left');
      const vertical = edge === 'top' || edge === 'bottom';
      let tx: number;
      let ty: number;
      if (vertical) {
        tx = Math.min(rect.right - 16, Math.max(rect.left + 16, ax + box.left)) - box.left;
        ty = (edge === 'top' ? rect.top : rect.bottom) - box.top;
      } else {
        tx = (edge === 'right' ? rect.right : rect.left) - box.left;
        ty = Math.min(rect.bottom - 14, Math.max(rect.top + 14, ay + box.top)) - box.top;
      }
      const dx = tx - ax;
      const dy = ty - ay;
      // A side line that would run mostly up or down the screen to reach its panel is left out.
      if (item.side && Math.abs(dy) > Math.abs(dx) * 1.3) return void plans.push(null);
      // Leave the scene point on a 45 degree diagonal, then run straight into the panel.
      // A body with a size (Earth) is left from its edge, not from its centre.
      const sgx = Math.sign(dx);
      const sgy = Math.sign(dy);
      let sx: number;
      let sy: number;
      let mid: string;
      if (vertical) {
        const run = Math.min(Math.abs(dx), Math.abs(dy));
        const k = run > 1 ? Math.SQRT1_2 * a.r : 0;
        sx = ax + sgx * k;
        sy = run > 1 ? ay + sgy * k : ay + sgy * a.r;
        mid = `${(ax + sgx * run).toFixed(1)},${(ay + sgy * run).toFixed(1)}`;
      } else {
        const run = Math.max(a.r, Math.min(Math.abs(dx) * 0.6, Math.abs(dy)));
        sx = ax + sgx * a.r;
        sy = ay;
        mid = `${(ax + sgx * run).toFixed(1)},${ty.toFixed(1)}`;
      }
      plans.push(`${sx.toFixed(1)},${sy.toFixed(1)} ${mid} ${tx.toFixed(1)},${ty.toFixed(1)}`);
    });

    // Write pass.
    plans.forEach((plan, i) => {
      const key = plan ?? '';
      if (written.current[i] === key) return;
      written.current[i] = key;
      const group = svg.children[i] as SVGGElement | undefined;
      if (!group) return;
      if (plan === null) {
        group.style.opacity = '0';
        return;
      }
      const [start, mid, end] = plan.split(' ');
      group.style.opacity = '1';
      (group.children[0] as SVGPathElement).setAttribute('d', `M${start}L${mid}L${end}`);
      const [sx, sy] = start.split(',');
      const [tx, ty] = end.split(',');
      (group.children[1] as SVGCircleElement).setAttribute('cx', sx);
      (group.children[1] as SVGCircleElement).setAttribute('cy', sy);
      (group.children[2] as SVGCircleElement).setAttribute('cx', tx);
      (group.children[2] as SVGCircleElement).setAttribute('cy', ty);
    });
  });
  return (
    <svg ref={svgRef} className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden data-testid="leaders">
      {items.map((item) => (
        <g key={`${item.anchor}:${item.to}`} style={{ opacity: 0, transition: 'opacity 220ms ease' }} data-leader={item.anchor}>
          <path fill="none" stroke={item.color} strokeWidth={1} strokeOpacity={0.7} />
          <circle r={2.5} fill={item.color} />
          <circle r={2} fill={item.color} />
        </g>
      ))}
    </svg>
  );
}
