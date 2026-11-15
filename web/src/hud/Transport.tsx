// Play, pause, back to the landing, a jump to the next sunrise or sunset, and the play speed: the
// controls that run the clock through the stay. Speeds are simulated days for each second of play.

import { type KeyboardEvent, type ReactNode } from 'react';
import { Icon } from '../components/Icon';
import type { Quantity } from '../util/quantities';

export interface TransportProps {
  playing: boolean;
  /** The speed in use: the value of one of `speeds`. */
  speed: number;
  /** One `speed:<v>` quantity for each speed on offer. */
  speeds: readonly Quantity[];
  onTogglePlay: () => void;
  /** Back to the landing, paused. */
  onRestart: () => void;
  onSpeed: (speed: number) => void;
  /**
   * Jump to just after the next sunrise or sunset. `nextChange` says which of the two lies ahead
   * (null: none before the end of the stay, and the control is switched off).
   */
  onJump?: () => void;
  nextChange?: 'sunrise' | 'sunset' | null;
  /**
   * A control that shares the first row, set at its far end (the phone dock's "Horizon" button).
   * The speeds then take a row of their own.
   */
  trailing?: ReactNode;
  disabled?: boolean;
  className?: string;
}

export function Transport({ playing, speed, speeds, onTogglePlay, onRestart, onSpeed, onJump, nextChange = null, trailing, disabled = false, className = '' }: TransportProps) {
  // One stop in the Tab order; the arrow keys move between the speeds and choose as they go.
  function onSpeedKey(e: KeyboardEvent<HTMLDivElement>) {
    const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (dir === 0 || speeds.length === 0) return;
    e.preventDefault();
    const at = Math.max(0, speeds.findIndex((q) => q.value === speed));
    const next = speeds[(at + dir + speeds.length) % speeds.length];
    if (next.value === null) return;
    onSpeed(next.value);
    (e.currentTarget.querySelector(`[data-speed="${next.value}"]`) as HTMLButtonElement | null)?.focus();
  }
  const chosen = speeds.some((q) => q.value === speed) ? speed : (speeds[0]?.value ?? speed);

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`} data-testid="transport">
      <button type="button" className="btn btn-primary min-w-[6.25rem]" onClick={onTogglePlay} aria-pressed={playing} disabled={disabled} data-testid="site-play">
        <Icon name={playing ? 'pause' : 'play'} size={14} />
        {playing ? 'Pause' : 'Play'}
      </button>
      <button type="button" className="btn btn-icon" onClick={onRestart} aria-label="Back to the landing" title="Back to the landing" disabled={disabled} data-testid="site-restart">
        <Icon name="reset" size={15} />
      </button>
      {onJump ? (
        <button
          type="button"
          className="btn btn-icon"
          onClick={onJump}
          aria-label={nextChange ? `Jump to the next ${nextChange}` : 'No sunrise or sunset ahead in the stay'}
          title={nextChange ? `Jump to the next ${nextChange}` : 'No sunrise or sunset ahead in the stay'}
          disabled={disabled || nextChange === null}
          data-testid="site-jump"
        >
          <Icon name="skip" size={15} />
        </button>
      ) : null}
      {trailing ? <div className="ml-auto flex shrink-0">{trailing}</div> : null}
      <div className={`flex items-center gap-1.5 ${trailing ? 'basis-full' : ''}`}>
        <div role="radiogroup" aria-label="Speed, days per second" className="seg" onKeyDown={onSpeedKey} data-testid="site-speed">
          {speeds.map((q) => (
            <button
              key={q.key}
              type="button"
              role="radio"
              aria-checked={q.value === chosen}
              aria-label={`${q.text} days per second`}
              tabIndex={q.value === chosen ? 0 : -1}
              disabled={disabled}
              onClick={() => q.value !== null && onSpeed(q.value)}
              className="site-speed"
              data-speed={q.value ?? undefined}
              data-q={q.key}
              data-testid={`speed-${q.text}`}
            >
              <span className="num text-[13px] tracking-normal" data-q-text>
                {q.text}
              </span>
            </button>
          ))}
        </div>
        {/* The unit is the same for every speed: said once, beside the group. */}
        {speeds[0] ? (
          <span className="num text-[12px] text-muted" title="Simulated days for each second of play" aria-hidden>
            {speeds[0].unit}
          </span>
        ) : null}
      </div>
    </div>
  );
}
