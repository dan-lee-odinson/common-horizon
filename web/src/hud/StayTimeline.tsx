// The stay timeline: lit and dark periods laid end to end, and the scrubber that moves the clock
// through them.
//
// The lane runs from the planned landing to the end of the stay. With no launch delay the planned
// landing is the landing, and the whole lane is the stay. With a delay, the stretch before the
// landing is drawn hatched and labelled with the delay; a dashed marker stands at the planned
// landing, and a bracket under the bar spans the stay itself. The clock can be scrubbed anywhere
// along the lane.
//
// Lit periods are full-height solid amber; dark periods are a low hollow outline, so shape as well
// as colour carries the state. Everything is placed by percentage, so the lane draws without being
// measured. The needle is moved by transform once per frame, with no React render.
//
// The scrubber is a native range input laid over the lane (in hours since the landing), so it has
// the keyboard, the screen-reader semantics and the form behaviour of any slider. The lane takes
// the pointer itself, so a press anywhere on it moves the clock there.

import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { Period } from '../util/horizon';
import type { Quantity } from '../util/quantities';
import { hoursSinceLanding, instantFromHours, keyStep, rangeFraction, rangeInstant, SCRUB_STEP_HOURS, scrubValue } from '../util/stay';
import { DAY_MS, HOUR_MS } from '../util/time';
import { useTicker } from './useTicker';

export type StayState = 'lit' | 'dark' | 'unknown';

export interface StayTimelineProps {
  /** Lit and dark periods inside the scrub range, in order. */
  periods: readonly Period[];
  /** The scrub range: the planned landing to the end of the stay. */
  startMs: number;
  endMs: number;
  /** The landing: where the stay starts. Equal to `startMs` when there is no launch delay. */
  landingMs: number;
  /** The instant shown; read once per frame. */
  getNow: () => number;
  /** Lit or dark at that instant, from the same source as the readouts; read once per frame. */
  getState?: () => StayState;
  /** The scrubber's value in words ("+3 d 06 h from landing, ..."), built from readout texts. */
  getValueText?: () => string;
  /** The next sunrise or sunset after the instant shown, or null. A notch marks it on the bar. */
  getNextChange?: () => number | null;
  /** Called with the instant the visitor scrubbed to. Without it the timeline is read-only. */
  onScrub?: (ms: number) => void;
  /** Space on the scrubber. */
  onTogglePlay?: () => void;
  /** Day marks under the lane (`tick_day:<n>` quantities; the value is the day). */
  ticks?: readonly Quantity[];
  /** Each period in words, for screen readers. */
  periodList?: readonly Quantity[];
  /** The length of the stay, shown at the stay's end of the lane. */
  stayLength?: Quantity;
  /** Time since the landing, shown beside the needle; kept running by the HUD like any readout. */
  flag?: Quantity;
  /** The launch delay, shown over the stretch before the landing. */
  delay?: Quantity;
  /** Read-only and small: the comparison sheet. */
  compact?: boolean;
  /** Name of the scrubber, or of the picture when read-only. */
  label: string;
  disabled?: boolean;
  testId?: string;
}

const pct = (fraction: number) => `${(fraction * 100).toFixed(3)}%`;

export function StayTimeline({
  periods,
  startMs,
  endMs,
  landingMs,
  getNow,
  getState,
  getValueText,
  getNextChange,
  onScrub,
  onTogglePlay,
  ticks = [],
  periodList = [],
  stayLength,
  flag,
  delay,
  compact = false,
  label,
  disabled = false,
  testId = 'stay-timeline',
}: StayTimelineProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const laneRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);
  const notchRef = useRef<HTMLDivElement>(null);
  /** The pointer that is scrubbing, while one is down. */
  const dragging = useRef<number | null>(null);
  const written = useRef({ now: Number.NaN, state: '', side: '', notch: '', value: '', textAt: 0, textDue: true });
  const interactive = Boolean(onScrub) && !compact && !disabled;
  const lead = rangeFraction(landingMs, startMs, endMs);
  const hasLead = landingMs - startMs > HOUR_MS;

  // The lane's width, for spacing the day labels (the marks themselves need no measuring).
  const [laneWidth, setLaneWidth] = useState(640);
  useLayoutEffect(() => {
    const el = laneRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const w = Math.round(entries[0]?.contentRect.width ?? 0);
      if (w > 0) setLaneWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const marks = useMemo(() => {
    let lastLabelPx = -Infinity;
    return ticks
      .filter((q) => q.value !== null)
      .map((q, i) => {
        const f = rangeFraction(landingMs + q.value! * DAY_MS, startMs, endMs);
        const px = f * laneWidth;
        // A label is shown when it is clear of the last one shown and of the lane's right end.
        const show = px - lastLabelPx >= 48 && laneWidth - px >= 20;
        // The first label starts at its mark instead of being centred on it, so it reaches further right.
        if (show) lastLabelPx = i === 0 ? px + 22 : px;
        return { q, f, show };
      });
  }, [ticks, landingMs, startMs, endMs, laneWidth]);

  useTicker(() => {
    const w = written.current;
    const now = getNow();
    const root = rootRef.current;
    const state = getState?.() ?? 'unknown';
    if (root && state !== w.state) {
      w.state = state;
      root.dataset.state = state;
    }
    if (now !== w.now) {
      w.now = now;
      w.textDue = true;
      const f = rangeFraction(now, startMs, endMs);
      if (handleRef.current) {
        handleRef.current.style.transform = `translateX(${(f * 100).toFixed(3)}%)`;
        // The flag sits on the side of the needle that has room.
        const side = f > 0.82 ? 'left' : 'right';
        if (side !== w.side) {
          w.side = side;
          handleRef.current.dataset.side = side;
        }
      }
      if (root) root.dataset.f = f.toFixed(4);
      const input = inputRef.current;
      // The input follows the clock, except while the visitor's own pointer is moving it.
      if (input && dragging.current === null) {
        const value = String(scrubValue(now, landingMs));
        if (input.value !== value) input.value = value;
      }
    }
    const next = getNextChange?.() ?? null;
    const notch = next === null || !Number.isFinite(next) || next < startMs || next > endMs ? '' : (rangeFraction(next, startMs, endMs) * 100).toFixed(3);
    if (notchRef.current && notch !== w.notch) {
      w.notch = notch;
      notchRef.current.style.opacity = notch === '' ? '0' : '1';
      if (notch !== '') notchRef.current.style.transform = `translateX(${notch}%)`;
    }
    // The value in words: at once after the visitor moves it, and at most once a second while it runs.
    const input = inputRef.current;
    if (input && getValueText && w.textDue) {
      const t = performance.now();
      if (dragging.current !== null || t - w.textAt >= 1000 || w.value === '') {
        const text = getValueText();
        w.textAt = t;
        w.textDue = false;
        if (text !== w.value) {
          w.value = text;
          input.setAttribute('aria-valuetext', text);
        }
      }
    }
  });
  // New props can change everything the ticker wrote: the next frame writes it again.
  useLayoutEffect(() => {
    written.current = { now: Number.NaN, state: '', side: '', notch: '', value: '', textAt: 0, textDue: true };
  }, [startMs, endMs, landingMs]);

  /** Move the clock at once (a key, a typed value): the words follow in the same frame. */
  function scrub(ms: number) {
    if (!onScrub) return;
    written.current.textAt = 0;
    onScrub(Math.min(endMs, Math.max(startMs, ms)));
  }

  function scrubToPointer(clientX: number) {
    const lane = laneRef.current;
    if (!lane) return;
    const rect = lane.getBoundingClientRect();
    if (rect.width <= 0) return;
    const at = rangeInstant((clientX - rect.left) / rect.width, startMs, endMs);
    // On the quarter-hour grid the input uses, so the readouts do not flicker between minutes.
    scrub(instantFromHours(scrubValue(at, landingMs), landingMs));
  }
  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (!interactive || dragging.current !== null || (e.pointerType === 'mouse' && e.button !== 0)) return;
    dragging.current = e.pointerId;
    e.currentTarget.setPointerCapture(e.pointerId);
    // The keyboard carries on from where the pointer left the needle.
    inputRef.current?.focus({ preventScroll: true });
    e.preventDefault();
    scrubToPointer(e.clientX);
  }
  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    if (dragging.current === e.pointerId) scrubToPointer(e.clientX);
  }
  function onPointerEnd(e: PointerEvent<HTMLDivElement>) {
    if (dragging.current !== e.pointerId) return;
    dragging.current = null;
    written.current.now = Number.NaN;
  }
  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!interactive) return;
    if (e.key === ' ' && onTogglePlay) {
      e.preventDefault();
      onTogglePlay();
      return;
    }
    const next = keyStep(getNow(), e.key, e.shiftKey, startMs, endMs);
    if (next === null) return;
    e.preventDefault();
    scrub(next);
  }

  const bar = (
    <div className="stay-bar" aria-hidden>
      {periods.map((p, i) => {
        const a = rangeFraction(p.start, startMs, endMs);
        const b = rangeFraction(p.end, startMs, endMs);
        return <span key={i} className="stay-period" data-lit={p.lit} data-from={a.toFixed(5)} data-to={b.toFixed(5)} style={{ left: pct(a), width: pct(b - a) }} />;
      })}
      {hasLead ? <span className="stay-lead" style={{ width: pct(lead) }} data-testid={compact ? undefined : 'stay-lead'} /> : null}
    </div>
  );

  return (
    <div ref={rootRef} className="stay" data-testid={testId} data-state="unknown" data-compact={compact || undefined} data-disabled={disabled || undefined} data-lead={hasLead || undefined}>
      {compact ? null : (
        <div className="stay-head">
          {hasLead ? (
            <span className="stay-head-start" data-testid="stay-lead-label">
              <span className="text-ink-2">Planned landing</span>
              {delay ? (
                <span className="num ml-2 text-muted" data-q={delay.key}>
                  delay <span data-q-text>{delay.text}</span>
                  <span data-q-unit> {delay.unit}</span>
                </span>
              ) : null}
            </span>
          ) : (
            <span className="stay-head-start text-ink-2">Landing</span>
          )}
          {hasLead && lead > 0.24 && lead < 0.72 ? (
            <span className="stay-head-landing text-ink-2" style={{ left: pct(lead) }}>
              Landing
            </span>
          ) : null}
          {stayLength ? (
            <span className="stay-head-end" data-q={stayLength.key}>
              stay <span className="num" data-q-text>{stayLength.text}</span>
              <span data-q-unit> {stayLength.unit}</span>
            </span>
          ) : null}
        </div>
      )}
      <div
        ref={laneRef}
        className="stay-lane"
        role={compact ? 'img' : undefined}
        aria-label={compact ? label : undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        data-testid={compact ? undefined : 'stay-lane'}
      >
        {bar}
        {/* The stay itself: a bracket from the landing to the end. */}
        <span className="stay-bracket" style={{ left: pct(lead) }} aria-hidden data-testid={compact ? undefined : 'stay-bracket'} />
        {/* The planned landing, when the launch slipped: a dashed marker at the lane's start. */}
        {hasLead ? <span className="stay-ghost" aria-hidden data-testid="ghost-marker" /> : null}
        <div ref={notchRef} className="stay-slide" style={{ opacity: 0 }} aria-hidden>
          <span className="stay-notch" />
        </div>
        {interactive || (!compact && disabled) ? (
          <input
            ref={inputRef}
            type="range"
            className="stay-input"
            min={scrubValue(startMs, landingMs)}
            max={hoursSinceLanding(endMs, landingMs)}
            step={SCRUB_STEP_HOURS}
            defaultValue={scrubValue(getNow(), landingMs)}
            aria-label={label}
            disabled={disabled}
            onChange={(e) => scrub(instantFromHours(Number(e.target.value), landingMs))}
            onKeyDown={onKeyDown}
            data-testid="site-scrub"
          />
        ) : null}
        <div ref={handleRef} className="stay-slide stay-handle" data-side="right" aria-hidden>
          <span className="stay-needle" data-testid={compact ? undefined : 'stay-needle'} />
          {compact ? null : <span className="stay-cap" />}
          {flag && !compact ? (
            <span className="stay-flag num" data-q={flag.key}>
              <span data-q-text>{flag.text}</span>
              <span data-q-unit>{flag.unit}</span>
            </span>
          ) : null}
        </div>
      </div>
      {compact ? null : (
        <div className="stay-scale" aria-hidden>
          {marks.map(({ q, f, show }) => (
            <span key={q.key} className="stay-tick" style={{ left: pct(f) }} data-landing={q.value === 0 || undefined}>
              {show ? (
                <span className="num" data-q={q.key}>
                  {q.text}
                  {' '}
                  {q.unit}
                </span>
              ) : null}
            </span>
          ))}
        </div>
      )}
      {periodList.length > 0 ? (
        <ul className="sr-only" data-testid={compact ? undefined : 'stay-periods'}>
          {periodList.map((q) => (
            <li key={q.key} data-q={q.key}>
              {q.label}: {q.text}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
