// A readout: a label, a value in the mono face and its unit. It shows a Quantity and nothing else
// (see util/quantities.ts), so every number on screen has a source in the app's data.
//
// Readouts that run (clocks, angles while time plays) are rewritten in place once per frame by
// `useLiveQuantities`, without re-rendering React.

import { type RefObject } from 'react';
import type { Quantity } from '../util/quantities';
import { useTicker } from './useTicker';

export type ReadoutSize = 'sm' | 'md' | 'lg' | 'xl';

/** `wrap`: the unit may go to the next line when the value is too wide for its cell (a score range, say). */
export function Readout({ q, size = 'md', className = '', hideLabel = false, wrap = false }: { q: Quantity; size?: ReadoutSize; className?: string; hideLabel?: boolean; wrap?: boolean }) {
  return (
    <div className={`readout ${className}`} data-q={q.key}>
      <span className={hideLabel ? 'sr-only' : 'label'} data-q-label>
        {q.label}
      </span>
      <span className={`readout-value${wrap ? ' whitespace-normal' : ''}`} data-size={size} data-tone={q.tone ?? 'ink'}>
        <span data-q-text>{q.text}</span>
        <span className="readout-unit" data-q-unit>
          {q.unit}
        </span>
      </span>
    </div>
  );
}

/** One line: label left, value right. For dense panels. */
export function ReadoutRow({ q, className = '' }: { q: Quantity; className?: string }) {
  return (
    <div className={`flex items-baseline justify-between gap-4 ${className}`} data-q={q.key}>
      <span className="label" data-q-label>
        {q.label}
      </span>
      <span className="readout-value" data-size="sm" data-tone={q.tone ?? 'ink'}>
        <span data-q-text>{q.text}</span>
        <span className="readout-unit" data-q-unit>
          {q.unit}
        </span>
      </span>
    </div>
  );
}

function isQuantity(x: unknown): x is Quantity {
  return typeof x === 'object' && x !== null && typeof (x as Quantity).key === 'string' && typeof (x as Quantity).text === 'string' && 'unit' in x;
}

/** Write quantities into every readout under `root` whose data-q matches. Only changed text is touched. */
export function patchQuantities(root: ParentNode, quantities: object): void {
  const byKey = new Map<string, Quantity>();
  for (const v of Object.values(quantities)) if (isQuantity(v)) byKey.set(v.key, v);
  root.querySelectorAll<HTMLElement>('[data-q]').forEach((el) => {
    const q = byKey.get(el.dataset.q!);
    if (!q) return;
    const text = el.querySelector<HTMLElement>('[data-q-text]');
    if (text && text.textContent !== q.text) text.textContent = q.text;
    const unit = el.querySelector<HTMLElement>('[data-q-unit]');
    if (unit && unit.textContent !== q.unit) unit.textContent = q.unit;
    const label = el.querySelector<HTMLElement>('[data-q-label]');
    if (label && label.textContent !== q.label) label.textContent = q.label;
    const value = el.querySelector<HTMLElement>('[data-tone]');
    const tone = q.tone ?? 'ink';
    if (value && value.dataset.tone !== tone) value.dataset.tone = tone;
  });
}

/** Keep the readouts under `rootRef` in step with `compute()`, once per frame while `active`. */
export function useLiveQuantities(rootRef: RefObject<HTMLElement | null>, compute: () => object, active = true): void {
  useTicker(() => {
    if (rootRef.current) patchQuantities(rootRef.current, compute());
  }, active);
}
