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
  /** A modal drawer has a scrim (a press on it closes the drawer) and keeps Tab inside. */
  modal?: boolean;
  children: ReactNode;
  testId?: string;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayer(ref, open, onClose, { trap: modal });
  const closed = side === 'right' ? 'translateX(calc(100% + 24px))' : side === 'left' ? 'translateX(calc(-100% - 24px))' : 'translateY(calc(100% + 24px))';
  const placement =
    side === 'bottom'
      ? 'inset-x-0 bottom-0 max-h-[86%] rounded-b-none border-x-0 border-b-0'
      : `${side === 'right' ? 'right-5' : 'left-5'} top-[4.75rem] bottom-[5.25rem] w-[min(23rem,calc(100vw-2rem))]`;
  return (
    <>
      {modal ? <div className="scrim z-30" style={{ opacity: open ? 1 : 0, pointerEvents: open ? 'auto' : 'none' }} onClick={onClose} aria-hidden /> : null}
      <div
        ref={ref}
        role={modal ? 'dialog' : 'region'}
        aria-modal={modal ? open : undefined}
        aria-label={title}
        aria-hidden={!open}
        inert={!open}
        tabIndex={-1}
        id={testId}
        data-testid={testId}
        data-open={open}
        data-panel={open ? '' : undefined}
        className={`drawer glass glass-strong absolute z-40 flex flex-col outline-none ${placement} ${className}`}
        style={{ transform: open ? 'none' : closed, opacity: open ? 1 : 0, visibility: open ? 'visible' : 'hidden' }}
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-4 py-2">
          <h2 className="panel-title m-0">{title}</h2>
          <button type="button" className="btn btn-quiet btn-icon -mr-2" aria-label={`Close ${title.toLowerCase()}`} onClick={onClose} data-testid={testId ? `${testId}-close` : undefined}>
            <Icon name="close" />
          </button>
        </header>
        {children}
      </div>
    </>
  );
}
