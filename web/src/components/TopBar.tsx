// Always on screen: launch date and time, the slip control, the UTC / LTC switch and,
// in the site scene, the play control. On phones a second row opens the drawers.

import { useId, useState } from 'react';
import { isMockMode } from '../api/client';
import { actions, appStore, MAX_SLIP_DAYS, simClock } from '../state/app';
import { useData } from '../state/data';
import { useStore } from '../state/store';
import { formatLtcOffset, formatTime, parseDatetimeLocalUtc, toDatetimeLocalUtc } from '../util/time';
import { Icon } from './Icon';

export function TopBar() {
  const launchUtcMs = useStore(appStore, (s) => s.launchUtcMs);
  const slipDays = useStore(appStore, (s) => s.slipDays);
  const timeScale = useStore(appStore, (s) => s.timeScale);
  const view = useStore(appStore, (s) => s.view);
  const playing = useStore(appStore, (s) => s.playing);
  const drawer = useStore(appStore, (s) => s.drawer);
  const nowMs = useStore(simClock, (s) => s.nowMs);
  const { landingMs } = useData();
  const ids = { launch: useId(), slip: useId(), note: useId() };
  const [draft, setDraft] = useState<string | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);

  const launchValue = draft ?? toDatetimeLocalUtc(launchUtcMs);
  const shownTime = view === 'scene' && nowMs !== null ? nowMs : landingMs;

  return (
    <header className="relative z-30 flex flex-col border-b border-line bg-surface">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-3 py-2 md:px-4">
        <div className="mr-auto flex min-w-0 items-baseline gap-2">
          <h1 className="m-0 truncate text-[15px] font-semibold tracking-[-0.01em]">Lunar Landing Site Navigator</h1>
          <span className="hidden text-[12px] text-muted lg:inline">Common Horizon</span>
          {isMockMode() ? (
            <span
              className="rounded-full border border-line-strong px-2 py-px text-[11px] text-ink-2"
              title="No backend address is set (VITE_API_BASE), so every number comes from built-in example answers."
            >
              Example data
            </span>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          <label htmlFor={ids.launch} className="label">
            Launch (UTC)
          </label>
          <input
            id={ids.launch}
            type="datetime-local"
            className="field num w-[12.5rem] text-[13px]"
            value={launchValue}
            onChange={(e) => {
              const ms = parseDatetimeLocalUtc(e.target.value);
              if (Number.isFinite(ms)) {
                setDraft(null);
                actions.setLaunch(ms);
              } else setDraft(e.target.value);
            }}
            onBlur={() => setDraft(null)}
          />
        </div>

        <div className="flex items-center gap-2">
          <label htmlFor={ids.slip} className="label">
            Slip
          </label>
          <input
            id={ids.slip}
            type="range"
            min={0}
            max={MAX_SLIP_DAYS}
            step={1}
            value={slipDays}
            onChange={(e) => actions.setSlip(Number(e.target.value))}
            className="w-28 md:w-36"
            aria-valuetext={`${slipDays} days late`}
            data-testid="slip"
          />
          <output htmlFor={ids.slip} className="num w-12 text-[13px] font-semibold" data-testid="slip-value">
            +{slipDays} d
          </output>
        </div>

        <div className="flex items-center gap-2">
          <div role="radiogroup" aria-label="Time scale" className="flex rounded-lg border border-line-strong p-0.5">
            {(['UTC', 'LTC'] as const).map((scale) => (
              <button
                key={scale}
                type="button"
                role="radio"
                aria-checked={timeScale === scale}
                onClick={() => actions.setTimeScale(scale)}
                className={`rounded-md px-2.5 py-0.5 text-[12px] font-medium transition-colors ${timeScale === scale ? 'bg-accent text-accent-ink' : 'text-ink-2 hover:text-ink'}`}
              >
                {scale}
              </button>
            ))}
          </div>
          <div className="relative">
            <button
              type="button"
              className="btn btn-icon"
              aria-expanded={noteOpen}
              aria-controls={ids.note}
              aria-label="About the time scales"
              onClick={() => setNoteOpen((o) => !o)}
            >
              <Icon name="info" />
            </button>
            {noteOpen ? (
              <div id={ids.note} role="note" className="glass absolute right-0 top-10 z-40 w-72 rounded-xl p-3 text-[12px] text-ink-2">
                <p className="m-0 mb-1 font-semibold text-ink">LTC (model value)</p>
                <p className="m-0">
                  Lunar time here is UTC plus 56.02 microseconds for every day counted from the landing time. The official lunar time standard is still
                  being defined, so treat this as a model value.
                </p>
              </div>
            ) : null}
          </div>
        </div>

        {view === 'scene' ? (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => actions.setPlaying(!playing)}
            aria-pressed={playing}
            data-testid="play"
          >
            <Icon name={playing ? 'pause' : 'play'} size={14} />
            {playing ? 'Pause' : 'Play'}
          </button>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line px-3 py-1.5 text-[12px] text-ink-2 md:px-4">
        <span className="num" data-testid="time-readout">
          <span className="text-muted">{view === 'scene' && nowMs !== null ? 'Now' : 'Landing'}: </span>
          {shownTime === null ? '—' : formatTime(shownTime, timeScale, landingMs ?? shownTime)}
          {timeScale === 'LTC' ? <span className="ml-1 text-muted">(model value)</span> : null}
        </span>
        {timeScale === 'LTC' && shownTime !== null && landingMs !== null ? (
          <span className="num text-muted">LTC − UTC: {formatLtcOffset(shownTime, landingMs)}</span>
        ) : null}
        <nav aria-label="Panels" className="ml-auto flex gap-1.5 md:hidden">
          <DrawerButton label="Planner" icon="planner" active={drawer === 'planner'} onClick={() => actions.setDrawer(drawer === 'planner' ? 'none' : 'planner')} />
          {view !== 'globe' ? (
            <DrawerButton label="Sites" icon="sites" active={drawer === 'sites'} onClick={() => actions.setDrawer(drawer === 'sites' ? 'none' : 'sites')} />
          ) : null}
          {view === 'scene' ? (
            <DrawerButton label="Horizon" icon="horizon" active={drawer === 'horizon'} onClick={() => actions.setDrawer(drawer === 'horizon' ? 'none' : 'horizon')} />
          ) : null}
        </nav>
      </div>
    </header>
  );
}

function DrawerButton({ label, icon, active, onClick }: { label: string; icon: 'planner' | 'sites' | 'horizon'; active: boolean; onClick: () => void }) {
  return (
    <button type="button" className={`btn h-7 min-h-7 px-2 text-[12px] ${active ? 'border-accent text-accent' : ''}`} aria-pressed={active} onClick={onClick}>
      <Icon name={icon} size={14} />
      {label}
    </button>
  );
}
