// A glass drawer that slides in from an edge and out again. On wide screens it is a side panel that
// leaves the rest of the HUD usable; on phones it becomes a bottom sheet over a scrim.
// The slide is a CSS transition on transform (it can be reversed mid-way); it leaves faster than
// it arrives.

import { useRef, type ReactNode } from 'react';
import { Icon } from '../components/Icon';
import { useLayer } from './focus';

export function Drawer({
  open,
  onClose,
  title,
  side = 'right',
  modal = false,
  children,
  testId,
  className = '',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Which edge it comes from. "bottom" is the phone form. */
  side?: 'right' | 'left' | 'bottom';
  /** A modal drawer has a scrim, keeps Tab inside and closes on a press outside. */
  modal?: boolean;
  children: ReactNode;
  testId?: string;
  className?: string;
}) {
  const ref = useRef<HTMLElement>(null);
  useLayer(ref, open, onClose, { trap: modal, closeOnOutside: modal });
  const closed = side === 'right' ? 'translateX(calc(100% + 24px))' : side === 'left' ? 'translateX(calc(-100% - 24px))' : 'translateY(calc(100% + 24px))';
  const placement =
    side === 'bottom'
      ? 'inset-x-0 bottom-0 max-h-[86%] rounded-b-none border-x-0 border-b-0'
      : `${side === 'right' ? 'right-4' : 'left-4'} top-[4.75rem] bottom-[5.5rem] w-[min(23rem,calc(100vw-2rem))]`;
  return (
    <>
      {modal ? <div className="scrim z-30" style={{ opacity: open ? 1 : 0, pointerEvents: open ? 'auto' : 'none' }} aria-hidden /> : null}
      <aside
        ref={ref}
        role={modal ? 'dialog' : 'region'}
        aria-modal={modal ? open : undefined}
        aria-label={title}
        aria-hidden={!open}
        inert={!open}
        tabIndex={-1}
        data-testid={testId}
        data-open={open}
        className={`drawer glass glass-strong absolute z-40 flex flex-col outline-none ${placement} ${className}`}
        style={{ transform: open ? 'none' : closed, opacity: open ? 1 : 0, visibility: open ? 'visible' : 'hidden' }}
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-4 py-2.5">
          <h2 className="panel-title m-0">{title}</h2>
          <button type="button" className="btn btn-quiet btn-icon" aria-label={`Close ${title.toLowerCase()}`} onClick={onClose}>
            <Icon name="close" />
          </button>
        </header>
        {children}
      </aside>
    </>
  );
}
