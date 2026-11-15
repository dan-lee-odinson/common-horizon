// Across the top of mission select: the mission in one line (it opens the mission planner sheet),
// and the launch-delay scrubber. Dragging the delay moves the landing along the lunar day, so the
// ranking reorders and the spotlight updates. The planned launch is shown beside the landing and
// never moves: the delay is added to it, it does not replace it.

import { useId } from 'react';
import { Icon } from '../components/Icon';
import { Glass } from '../hud/Glass';
import { TickScale } from '../hud/TickScale';
import { actions, appStore, MAX_SLIP_DAYS } from '../state/app';
import { useData } from '../state/data';
import { useStore } from '../state/store';
import { missionSummary } from '../util/mission';
import { missionDates, transitQuantity } from '../util/quantities';
import { SeasonLine } from './SeasonLine';

export function MissionBar() {
  const { catalog, hardwareChosen, storageKwh, landingMs, landingGeometry, updating, transitDays, evaluation } = useData();
  const launchUtcMs = useStore(appStore, (s) => s.launchUtcMs);
  const slipDays = useStore(appStore, (s) => s.slipDays);
  const stayDays = useStore(appStore, (s) => s.stayDays);
  const missionOpen = useStore(appStore, (s) => s.missionOpen);
  const slipId = useId();
  const summary = missionSummary(catalog.data?.items ?? [], hardwareChosen, storageKwh, stayDays);
  const dates = missionDates(launchUtcMs, slipDays, landingMs, landingGeometry);
  const transit = transitQuantity(transitDays, evaluation.data !== null);

  return (
    <Glass as="section" brackets={false} className="flex flex-col gap-2 px-4 pb-2 pt-2.5" aria-label="Mission and launch delay" data-testid="mission-bar" data-panel>
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

      {/* The landing and the season belong to the ranking on screen: they dim with it while a newer one is on its way. */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-0.5" aria-busy={updating}>
        <dl className="num m-0 flex flex-wrap items-baseline gap-x-4 gap-y-0.5 text-[13px] text-ink-2">
          <div className="flex items-baseline gap-1.5" data-q={dates.plannedLaunch.key} title="The planned launch. The delay is added to it and never changes it.">
            <dt className="label">
              Planned<span className="sr-only"> launch</span>
            </dt>
            <dd className="m-0 text-ink" data-testid="planned-launch">
              <span data-q-text>{dates.plannedLaunch.text}</span> <span data-q-unit>{dates.plannedLaunch.unit}</span>
            </dd>
          </div>
          <div className="flex items-baseline gap-1.5" data-q={dates.landing.key}>
            <dt className="label">Landing</dt>
            <dd className="settling m-0 text-ink" data-testid="landing">
              <span data-q-text>{dates.landing.text}</span> <span data-q-unit>{dates.landing.unit}</span>
            </dd>
          </div>
          <div className="flex items-baseline gap-1.5" data-q={transit.key} title="Launch to landing. The team has not fixed a transit time: this is our estimate, sent with every evaluation. The landing above is the answer's own.">
            <dt className="label">{transit.label}</dt>
            <dd className="settling m-0 text-ink" data-testid="transit" data-tone={transit.tone}>
              <span data-q-text>{transit.text}</span> <span data-q-unit>{transit.unit}</span>
            </dd>
          </div>
        </dl>
        <SeasonLine line={dates.seasonLine} season={dates.season} className="settling" />
      </div>
    </Glass>
  );
}
