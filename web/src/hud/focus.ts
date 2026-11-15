// Keyboard focus for layers that open over the HUD: the landing card, sheets and drawers.
// While a modal layer is open, Tab stays inside it and Escape closes it; when it closes, focus
// goes back to whatever opened it. When several layers are open, only the top one answers the
// keyboard. (A press outside a modal layer lands on its scrim, which closes it: see Sheet, Drawer.)

import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE = 'a[href], button, input, select, textarea, summary, [contenteditable="true"], [tabindex]';

function shown(el: HTMLElement): boolean {
  if (el.closest('[inert]')) return false;
  if (typeof el.checkVisibility === 'function') return el.checkVisibility({ visibilityProperty: true });
  return el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
}

/** The controls Tab really reaches inside `root`, in order. */
export function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.tabIndex >= 0 && !(el as HTMLButtonElement).disabled && shown(el),
  );
}

export interface LayerOptions {
  /** Keep Tab inside the layer (a modal). Without it, Escape still closes while focus is inside. */
  trap?: boolean;
  /** Which element takes focus on open: a selector inside the layer. Default: the layer itself. */
  initialFocus?: string;
}

/** Open layers, bottom to top. */
const stack: HTMLElement[] = [];

export function useLayer(ref: RefObject<HTMLElement | null>, open: boolean, onClose: () => void, options: LayerOptions = {}): void {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const optionsRef = useRef(options);
  optionsRef.current = options;

  // Opening and closing: take focus in, and give it back.
  useEffect(() => {
    if (!open) return;
    const layer = ref.current;
    if (!layer) return;
    // Remember what opened the layer and give focus back to it when the layer closes.
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    stack.push(layer);
    const { initialFocus } = optionsRef.current;
    const target = (initialFocus ? layer.querySelector<HTMLElement>(initialFocus) : null) ?? layer;
    target.focus({ preventScroll: true });
    return () => {
      const at = stack.lastIndexOf(layer);
      if (at >= 0) stack.splice(at, 1);
      const active = document.activeElement;
      if (opener?.isConnected && (layer.contains(active) || active === document.body || active === null)) opener.focus({ preventScroll: true });
    };
  }, [open, ref]);

  // The keyboard, while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const layer = ref.current;
      if (!layer || stack[stack.length - 1] !== layer) return;
      const { trap = false } = optionsRef.current;
      const inside = layer.contains(document.activeElement);
      if (e.key === 'Escape') {
        if (!trap && !inside) return;
        e.stopPropagation();
        closeRef.current();
        return;
      }
      if (e.key !== 'Tab' || !trap) return;
      const items = focusables(layer);
      if (items.length === 0) {
        e.preventDefault();
        layer.focus({ preventScroll: true });
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (!inside) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && (active === first || active === layer)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open, ref]);
}
