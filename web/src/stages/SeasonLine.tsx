// "Lunar south pole: summer" (or winter) on the landing date, with a one-line note that says what
// the season means for sunlight. The note opens on hover, on keyboard focus or on a tap, stays
// open while the pointer is on it, and Escape puts it away.

import { useId, useRef, useState, type MouseEvent } from 'react';
import { Icon } from '../components/Icon';
import type { Quantity } from '../util/quantities';
import { SOUTH_POLE_SEASON_NOTE, type PoleSeason } from '../util/season';

export function SeasonLine({ line, season, className = '' }: { line: Quantity; season: PoleSeason | null; className?: string }) {
  const [open, setOpen] = useState(false);
  const openAtPress = useRef(false);
  const noteId = useId();
  function onClick(e: MouseEvent<HTMLButtonElement>) {
    // Enter or Space: open, or put away again.
    if (e.detail === 0) setOpen((o) => !o);
    // A mouse is already resting on the line, which opened the note: a click keeps it open.
    else if ((e.nativeEvent as PointerEvent).pointerType === 'mouse') setOpen(true);
    // A tap opens the note; a second tap puts it away.
    else setOpen(!openAtPress.current);
  }
  return (
    <div className={`relative ${className}`} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        className="flex min-h-7 items-center gap-1.5 rounded-[3px] text-left font-display text-[13px] font-semibold tracking-[0.02em] text-ink"
        aria-expanded={open}
        aria-controls={noteId}
        onPointerDown={() => {
          openAtPress.current = open;
        }}
        onClick={onClick}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key !== 'Escape' || !open) return;
          // The note is the top layer while it is open: Escape closes it and nothing else.
          e.stopPropagation();
          setOpen(false);
        }}
        data-testid="season"
        data-season={season ?? ''}
      >
        <span className="whitespace-nowrap">
          {line.label}: <span data-tone={line.tone}>{line.text}</span>
        </span>
        <span className="text-muted">
          <Icon name="info" size={14} />
        </span>
      </button>
      {/* The note hangs under the line. Its top padding bridges the gap, so the pointer can move onto it. */}
      <div className="absolute left-0 top-full z-10 w-[19rem] max-w-[80vw] pt-1" hidden={!open}>
        <p id={noteId} role="note" className="glass glass-strong m-0 px-3 py-2 font-sans text-[13px] font-normal leading-snug tracking-normal text-ink" data-testid="season-note">
          {SOUTH_POLE_SEASON_NOTE}
        </p>
      </div>
    </div>
  );
}
