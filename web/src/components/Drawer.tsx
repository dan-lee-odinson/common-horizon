// Phone widths: panels slide in as drawers. A plain CSS transition does the motion.

import { useEffect, useRef, type ReactNode } from 'react';

export function Drawer({ open, side, label, onClose, children, testId }: { open: boolean; side: 'right' | 'bottom' | 'left'; label: string; onClose: () => void; children: ReactNode; testId?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    // Remember what opened the drawer and give focus back to it when the drawer closes.
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    window.addEventListener('keydown', onKey);
    ref.current?.focus();
    return () => {
      window.removeEventListener('keydown', onKey);
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [open]);

  const closedTransform = side === 'right' ? 'translateX(100%)' : side === 'left' ? 'translateX(-100%)' : 'translateY(100%)';
  const placement =
    side === 'right'
      ? 'right-0 top-0 h-full w-[min(360px,92vw)] border-l'
      : side === 'left'
        ? 'left-0 top-0 h-full w-[min(380px,94vw)] border-r'
        : 'bottom-0 left-0 max-h-[92%] w-full rounded-t-2xl border-t';

  return (
    <>
      <div
        className={`absolute inset-0 z-30 bg-scrim transition-opacity duration-200 ${open ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
        onClick={onClose}
        aria-hidden
      />
      <div
        ref={ref}
        role="dialog"
        aria-modal={open}
        aria-label={label}
        aria-hidden={!open}
        inert={!open}
        tabIndex={-1}
        data-testid={testId}
        data-open={open}
        data-motion="slide"
        className={`absolute z-40 flex flex-col border-line bg-surface shadow-2xl outline-none ${placement}`}
        style={{
          transform: open ? 'none' : closedTransform,
          transition: 'transform 300ms var(--ease-drawer), visibility 300ms',
          visibility: open ? 'visible' : 'hidden',
        }}
      >
        {children}
      </div>
    </>
  );
}
