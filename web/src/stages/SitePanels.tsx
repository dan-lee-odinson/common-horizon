// The reading panels of the site stage. Each one is given quantities and shows them: no panel
// works anything out, so every figure on them comes from the data layer (util/quantities.ts).
// The running figures are rewritten in place by the stage's ticker (see SiteHud).

import type { ReactNode } from 'react';
import { Glass } from '../hud/Glass';
import { Readout, ReadoutRow } from '../hud/Readout';
import type { HardwareRow, Quantity } from '../util/quantities';

/** Units that sit tight against their number: a degree sign, a percent sign. Every other unit takes a space. */
function tightUnit(unit: string): boolean {
  return unit === '' || unit.startsWith('°') || unit === '%';
}

/** A quantity inside a sentence or a row: its text and unit, kept running like any readout. */
export function Inline({ q, className = '' }: { q: Quantity; className?: string }) {
  return (
    <span className={`num whitespace-nowrap ${className}`} data-q={q.key} data-tone={q.tone && q.tone !== 'ink' ? q.tone : undefined}>
      <span data-q-text>{q.text}</span>
      <span className={tightUnit(q.unit) ? undefined : 'ml-[0.3em]'} data-q-unit>
        {q.unit}
      </span>
    </span>
  );
}

type ShellTone = 'cyan' | 'sun' | 'earth';

/**
 * A panel's surface: a glass panel floating over the scene, or (`bare`) a plain section for use
 * inside a sheet that is already glass, where a second layer of glass would only add weight.
 */
function Shell({
  bare,
  tone = 'cyan',
  label,
  testId,
  leaderTarget,
  className = '',
  children,
}: {
  bare: boolean;
  tone?: ShellTone;
  label: string;
  testId: string;
  leaderTarget?: string;
  className?: string;
  children: ReactNode;
}) {
  if (bare) {
    return (
      <section className={`site-section flex flex-col gap-2.5 ${className}`} aria-label={label} data-testid={testId}>
        {children}
      </section>
    );
  }
  return (
    <Glass as="section" tone={tone} className={`flex flex-col gap-2.5 p-4 short:p-3.5 ${className}`} aria-label={label} data-leader-target={leaderTarget} data-panel data-testid={testId}>
      {children}
    </Glass>
  );
}

export interface SunPanelProps {
  sunState: Quantity;
  nextChange: Quantity;
  sunAz: Quantity;
  sunEl: Quantity;
  /** The Sun's apparent width, where the panel is the place to show it (it is also in the line about true size). */
  sunWidth?: Quantity;
  shadowPerMetre: Quantity;
  shadowLander: Quantity;
  shadowBearing: Quantity;
  sunlightPercent: Quantity;
  sunlightHours: Quantity;
  longestDark: Quantity;
  /** Fewer rows, whatever the window's height. */
  dense?: boolean;
  /** No glass of its own: inside a sheet. */
  bare?: boolean;
  className?: string;
}

/** The Sun at the site now: lit or dark, the next change, its direction, and the shadows it casts. */
export function SunPanel({
  sunState,
  nextChange,
  sunAz,
  sunEl,
  sunWidth,
  shadowPerMetre,
  shadowLander,
  shadowBearing,
  sunlightPercent,
  sunlightHours,
  longestDark,
  dense = false,
  bare = false,
  className = '',
}: SunPanelProps) {
  const extra = dense ? 'hidden' : 'short:hidden';
  return (
    <Shell bare={bare} tone="sun" label="Sun" testId="sun-panel" leaderTarget="sun" className={className}>
      <header className="flex items-center gap-2">
        <span className="size-2 rounded-full bg-sun" style={{ boxShadow: '0 0 12px var(--ch-sun-glow)' }} aria-hidden />
        <h3 className="panel-title m-0">Sun</h3>
      </header>
      <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
        <Readout q={sunState} size="lg" className="short:[&_.readout-value]:text-[22px]" />
        <Readout q={nextChange} />
        <Readout q={sunAz} size="sm" />
        <Readout q={sunEl} size="sm" />
      </div>
      <div className="flex flex-col gap-1.5 border-t border-line pt-2.5">
        <p className="label m-0 text-ink-2">Shadows, level ground</p>
        <ReadoutRow q={shadowPerMetre} />
        <ReadoutRow q={shadowLander} />
        <ReadoutRow q={shadowBearing} className={extra} />
      </div>
      <div className={`flex flex-col gap-1.5 border-t border-line pt-2.5 ${extra}`}>
        <p className="label m-0 text-ink-2">Over the stay</p>
        <div className="flex items-baseline justify-between gap-4">
          <span className="label">{sunlightPercent.label}</span>
          <span className="readout-value" data-size="sm">
            <Inline q={sunlightPercent} />
            <Inline q={sunlightHours} className="ml-2 text-[13px] text-ink-2" />
          </span>
        </div>
        <ReadoutRow q={longestDark} />
        {sunWidth ? <ReadoutRow q={sunWidth} /> : null}
      </div>
    </Shell>
  );
}

export interface ClockPanelProps {
  utc: Quantity;
  ltc: Quantity;
  ltcOffset: Quantity;
  sinceLanding: Quantity;
  stayEnd: Quantity;
  dense?: boolean;
  bare?: boolean;
  className?: string;
}

/**
 * The mission clock: UTC, the LTC model value beside it, and where the instant sits in the stay.
 * `dense` is the form that sits beside the play controls: the two clocks and nothing else.
 */
export function ClockPanel({ utc, ltc, ltcOffset, sinceLanding, stayEnd, dense = false, bare = false, className = '' }: ClockPanelProps) {
  return (
    <Shell bare={bare} label="Mission clock" testId="clock-panel" className={className}>
      {dense ? null : <h3 className="panel-title m-0">Mission clock</h3>}
      <Readout q={utc} />
      <div className="grid grid-cols-[auto_1fr] gap-x-4">
        <Readout q={ltc} size="sm" />
        <Readout q={ltcOffset} size="sm" />
      </div>
      {dense ? null : (
        <div className="flex flex-col gap-1.5">
          <ReadoutRow q={sinceLanding} />
          <ReadoutRow q={stayEnd} />
        </div>
      )}
    </Shell>
  );
}

export interface EarthPanelProps {
  earthAz: Quantity;
  earthEl: Quantity;
  earthWidth: Quantity;
  earthLink: Quantity;
  clearSky: Quantity;
  dense?: boolean;
  bare?: boolean;
  className?: string;
}

/** Earth in the site's sky now, and the Earth link over the stay. */
export function EarthPanel({ earthAz, earthEl, earthWidth, earthLink, clearSky, dense = false, bare = false, className = '' }: EarthPanelProps) {
  return (
    <Shell bare={bare} tone="earth" label="Earth" testId="earth-panel" leaderTarget="earth" className={className}>
      <header className="flex items-center gap-2">
        <span className="size-2 rounded-full bg-earth" style={{ boxShadow: '0 0 12px var(--ch-earth-glow)' }} aria-hidden />
        <h3 className="panel-title m-0">Earth</h3>
      </header>
      <div className="grid grid-cols-2 gap-x-3">
        <Readout q={earthAz} size="sm" />
        <Readout q={earthEl} size="sm" />
      </div>
      <div className="flex flex-col gap-1.5">
        <ReadoutRow q={earthWidth} />
        <ReadoutRow q={earthLink} />
        <ReadoutRow q={clearSky} className={dense ? 'hidden' : 'short:hidden'} />
      </div>
    </Shell>
  );
}

export interface HardwarePanelProps {
  rows: readonly HardwareRow[];
  /** What in the picture is an illustration, in a sentence. */
  note: string;
  bare?: boolean;
  className?: string;
}

/** The mission's hardware: how many of each, how tall each model is and how well founded that size is. */
export function HardwarePanel({ rows, note, bare = false, className = '' }: HardwarePanelProps) {
  return (
    <Shell bare={bare} label="Hardware" testId="hardware-panel" className={`min-h-0 ${className}`}>
      <h3 className="panel-title m-0">Hardware</h3>
      {rows.length === 0 ? (
        <p className="m-0 text-[13px] leading-snug text-ink-2">No hardware in this mission.</p>
      ) : (
        // In the Tab order, so a long list can be scrolled from the keyboard.
        <ul className={`m-0 flex list-none flex-col gap-2 p-0 ${bare ? '' : 'min-h-0 overflow-y-auto overscroll-contain'}`} aria-label="Items in the mission" tabIndex={bare ? undefined : 0}>
          {rows.map((row) => (
            <li key={row.id} className="flex flex-col gap-0.5" data-testid="hardware-row" data-item={row.id}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate text-[14px] text-ink" title={row.name}>
                  {row.name}
                  <Inline q={row.count} className="ml-1.5 text-[13px] text-ink-2" />
                </span>
                <span className="readout-value shrink-0" data-size="sm">
                  <Inline q={row.height} />
                </span>
              </div>
              {/* In a short window the list keeps to one line an item, so the whole mission stays in view. */}
              {row.status ? <span className={`text-[12px] leading-tight text-muted ${bare ? '' : 'short:hidden'}`}>{row.status}</span> : null}
            </li>
          ))}
        </ul>
      )}
      <p className="m-0 shrink-0 border-t border-line pt-2.5 text-[13px] leading-snug text-ink-2" data-testid="site-illustration">
        {note}
      </p>
    </Shell>
  );
}
