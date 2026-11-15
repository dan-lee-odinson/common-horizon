// Keyboard focus for layers that open over the HUD: the landing card, sheets and phone drawers.
// While a modal layer is open, Tab stays inside it and Escape closes it; when it closes, focus
// goes back to whatever opened it.

import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => !el.hasAttribute('inert') && el.getClientRects().length > 0);
}

export interface LayerOptions {
  /** Keep Tab inside the layer (a modal). Without it, Escape still closes when focus is inside. */
  trap?: boolean;
  /** Close when a press lands outside the layer. */
  closeOnOutside?: boolean;
  /** Which element takes focus on open: a selector inside the layer. Default: the layer itself. */
  initialFocus?: string;
}

export function useLayer(ref: RefObject<HTMLElement | null>, open: boolean, onClose: () => void, options: LayerOptions = {}): void {
  const { trap = false, closeOnOutside = false, initialFocus } = options;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const layer = ref.current;
    if (!layer) return;
    // Remember what opened the layer and give focus back to it when the layer closes.
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const target = (initialFocus ? layer.querySelector<HTMLElement>(initialFocus) : null) ?? layer;
    target.focus({ preventScroll: true });

    const onKey = (e: KeyboardEvent) => {
      const inside = layer.contains(document.activeElement);
      if (e.key === 'Escape' && (trap || inside)) {
        e.stopPropagation();
        closeRef.current();
        return;
      }
      if (e.key !== 'Tab' || !trap) return;
      const items = focusables(layer);
      if (items.length === 0) {
        e.preventDefault();
        layer.focus();
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
    const onDown = (e: PointerEvent) => {
      if (closeOnOutside && e.target instanceof Node && !layer.contains(e.target)) closeRef.current();
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onDown, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onDown, true);
      if (opener?.isConnected && (layer.contains(document.activeElement) || document.activeElement === document.body)) opener.focus({ preventScroll: true });
    };
  }, [open, ref, trap, closeOnOutside, initialFocus]);
}
