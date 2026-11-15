// A glass sheet: a second layer of glass that opens over the HUD for a focused task (the mission
// planner, the comparison). It is modal: a scrim dims the scene, Tab stays inside, and Escape or a
// press outside closes it. On phones it rises from the bottom edge.

import { useRef, type ReactNode } from 'react';
import { Icon } from '../components/Icon';
import { useLayer } from './focus';

export function Sheet({
  open,
  onClose,
  title,
  note,
  children,
  testId,
  wide = false,
  phone = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  /** One line under the title. */
  note?: string;
  children: ReactNode;
  testId?: string;
  wide?: boolean;
  phone?: boolean;
}) {
  const ref = useRef<HTMLElement>(null);
  useLayer(ref, open, onClose, { trap: true, closeOnOutside: true });
  const placement = phone
    ? 'inset-x-0 bottom-0 max-h-[90%] rounded-b-none border-x-0 border-b-0'
    : `left-1/2 top-[4.75rem] max-h-[calc(100%-6.5rem)] ${wide ? 'w-[min(72rem,calc(100vw-3rem))]' : 'w-[min(34rem,calc(100vw-3rem))]'}`;
  const closed = phone ? 'translateY(calc(100% + 24px))' : 'translate(-50%, 14px) scale(0.985)';
  const shown = phone ? 'none' : 'translate(-50%, 0)';
  return (
    <>
      <div className="scrim z-40" style={{ opacity: open ? 1 : 0, pointerEvents: open ? 'auto' : 'none' }} aria-hidden />
      <section
        ref={ref}
        role="dialog"
        aria-modal={open}
        aria-label={title}
        aria-hidden={!open}
        inert={!open}
        tabIndex={-1}
        data-testid={testId}
        data-open={open}
        className={`drawer glass glass-strong brackets absolute z-50 flex flex-col outline-none ${placement}`}
        style={{ transform: open ? shown : closed, opacity: open ? 1 : 0, visibility: open ? 'visible' : 'hidden' }}
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-line px-5 py-3">
          <div className="min-w-0">
            <h2 className="panel-title m-0">{title}</h2>
            {note ? <p className="m-0 mt-1 text-[13px] text-ink-2">{note}</p> : null}
          </div>
          <button type="button" className="btn btn-quiet btn-icon -mr-2 -mt-1" aria-label={`Close ${title.toLowerCase()}`} onClick={onClose}>
            <Icon name="close" />
          </button>
        </header>
        {children}
      </section>
    </>
  );
}
