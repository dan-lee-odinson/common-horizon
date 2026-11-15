// Across the top of mission select: the mission in one line (it opens the mission planner sheet),
// and the launch-delay scrubber. Dragging the delay moves the landing along the lunar day, so the
// ranking reorders and the spotlight updates.

import { useId } from 'react';
import { Icon } from '../components/Icon';
import { Glass } from '../hud/Glass';
import { TickScale } from '../hud/TickScale';
import { actions, appStore, MAX_SLIP_DAYS } from '../state/app';
import { useData } from '../state/data';
import { useStore } from '../state/store';
import { missionSummary } from '../util/mission';
import { missionDates } from '../util/quantities';

export function MissionBar() {
  const { catalog, hardwareChosen, storageKwh, landingMs, landingGeometry, evaluation } = useData();
  const launchUtcMs = useStore(appStore, (s) => s.launchUtcMs);
  const slipDays = useStore(appStore, (s) => s.slipDays);
  const stayDays = useStore(appStore, (s) => s.stayDays);
  const missionOpen = useStore(appStore, (s) => s.missionOpen);
  const slipId = useId();
  const summary = missionSummary(catalog.data?.items ?? [], hardwareChosen, storageKwh, stayDays);
  const dates = missionDates(launchUtcMs, slipDays, landingMs, landingGeometry);

  return (
    <Glass as="section" brackets={false} className="flex flex-col gap-2 px-4 pb-2 pt-2.5" aria-label="Mission and launch delay" data-testid="mission-bar">
      <div className="flex min-w-0 items-center gap-3">
        <p className="m-0 line-clamp-2 min-w-0 flex-1 break-words text-[14px] leading-snug text-ink" title={summary.text} data-testid="mission-summary">
          <span className="label mr-2 align-baseline">Mission</span>
          {summary.text}
        </p>
        <button type="button" className="btn shrink-0" onClick={() => actions.setMissionOpen(true)} aria-haspopup="dialog" aria-expanded={missionOpen} data-testid="edit-mission">
          <Icon name="edit" size={14} />
          Edit mission
        </button>
      </div>

      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-5 border-t border-line pt-2">
        <div className="flex flex-col">
          <label htmlFor={slipId} className="label">
            Launch delay
          </label>
          <output htmlFor={slipId} className="readout-value" data-size="lg" data-tone={slipDays > 0 ? 'warn' : 'ink'} data-testid="slip-value" data-q="delay">
            <span data-q-text>{dates.delay.text}</span>
            <span className="readout-unit" data-q-unit>
              {dates.delay.unit}
            </span>
          </output>
        </div>
        <div className="flex min-w-0 flex-col">
          <input
            id={slipId}
            type="range"
            className="scrub"
            min={0}
            max={MAX_SLIP_DAYS}
            step={1}
            value={slipDays}
            onChange={(e) => actions.setSlip(Number(e.target.value))}
            aria-valuetext={slipDays === 0 ? 'on time' : `${slipDays} ${slipDays === 1 ? 'day' : 'days'} late`}
            data-testid="slip"
          />
          {/* The scale sits under the track, inset by half the caret so 0 and 30 line up with it. */}
          <TickScale min={0} max={MAX_SLIP_DAYS} step={1} major={5} className="mx-[7px] -mt-2" />
        </div>
      </div>

      <dl className="num m-0 flex flex-wrap items-baseline gap-x-5 gap-y-0.5 text-[13px] text-ink-2" aria-busy={evaluation.refreshing || undefined}>
        <div className="flex items-baseline gap-1.5" data-q="launch">
          <dt className="label">Launch</dt>
          <dd className="m-0 text-ink">
            <span data-q-text>{dates.launch.text}</span> <span data-q-unit>{dates.launch.unit}</span>
          </dd>
        </div>
        <div className="flex items-baseline gap-1.5" data-q="landing">
          <dt className="label">Landing</dt>
          <dd className="m-0 text-ink">
            <span data-q-text>{dates.landing.text}</span> <span data-q-unit>{dates.landing.unit}</span>
          </dd>
        </div>
        <div className="flex items-baseline gap-1.5">
          <dt className="label">South pole</dt>
          <dd className="m-0 font-sans" data-tone={dates.seasonLine.tone} data-testid="mission-season">
            {dates.seasonLine.text}
          </dd>
        </div>
      </dl>
    </Glass>
  );
}
