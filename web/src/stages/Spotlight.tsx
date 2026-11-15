// The spotlight: one site owns the screen. Its rank as a very large numeral, its name, then
// sunlight, Earth link, power margin and score as big readouts, the pass or fail word, and the
// action that flies down to it.

import { Icon } from '../components/Icon';
import { Glass } from '../hud/Glass';
import { Readout } from '../hud/Readout';
import { actions, appStore } from '../state/app';
import { useData } from '../state/data';
import { useStore } from '../state/store';
import { formatLatLon } from '../util/geo';
import { balanceWords, levelFromStatus } from '../util/power';
import { siteQuantities } from '../util/quantities';
import { movedText } from '../util/ranking';

export function Spotlight() {
  const { focus, focusRow, check, evaluation, hardwareChosen, highlighted, catalog } = useData();
  const flight = useStore(appStore, (s) => s.flight);
  const saved = useStore(appStore, (s) => s.saved);
  const q = siteQuantities(focusRow?.rank ?? null, focusRow?.evaluation ?? null, focusRow ? check.data : null);
  const isSaved = focus ? saved.some((s) => s.id === focus.id) : false;
  const balance = focusRow && check.data ? check.data.balance : null;
  const words = balance ? balanceWords(levelFromStatus(balance.status), balance.limiting) : null;

  if (!focus || !focusRow) {
    const noHardware = hardwareChosen.length === 0;
    return (
      <Glass as="section" className="flex flex-col gap-3 p-5" aria-label="Spotlight site" data-testid="spotlight" data-state="empty">
        <h3 className="title m-0 text-[1.5rem] text-ink">{noHardware ? 'No mission yet' : evaluation.status === 'error' ? 'The ranking did not load' : 'Ranking the sites…'}</h3>
        <p className="m-0 text-[14px] leading-normal text-ink-2">
          {noHardware
            ? catalog.status === 'error' || catalog.status === 'empty'
              ? 'The hardware list did not load, so the sites cannot be ranked yet.'
              : 'Choose a lander and hardware to rank the landing sites.'
            : evaluation.status === 'error'
              ? evaluation.error
              : evaluation.status === 'empty' || evaluation.status === 'idle'
                ? 'There are no sites to rank yet. Open the site drawer and enter a coordinate.'
                : 'Sunlight, Earth contact and power are being worked out for each site.'}
        </p>
        <div className="flex flex-wrap gap-2">
          {noHardware ? (
            <button type="button" className="btn btn-primary" onClick={() => actions.setMissionOpen(true)}>
              <Icon name="edit" size={14} />
              Set the mission
            </button>
          ) : null}
          {evaluation.status === 'error' ? (
            <button type="button" className="btn" onClick={evaluation.retry}>
              Try again
            </button>
          ) : null}
        </div>
      </Glass>
    );
  }

  const fail = q.passes === false;
  return (
    <Glass as="section" tone={fail ? 'bad' : 'cyan'} className="flex flex-col gap-4 p-5 max-md:gap-3 max-md:p-4" aria-label="Spotlight site" data-testid="spotlight" data-leader-target="site" aria-busy={evaluation.refreshing || undefined}>
      <div className="flex items-start gap-4">
        <p className="m-0 flex shrink-0 flex-col" data-q="rank">
          <span className="label" data-q-label>
            Rank
          </span>
          <span className="font-display text-[7rem] font-semibold leading-[0.82] tracking-[-0.03em] text-accent max-md:text-[4.5rem]" style={{ textShadow: '0 0 34px var(--ch-glow)' }} data-q-text data-testid="spotlight-rank">
            {q.rank.text}
          </span>
        </p>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5 pt-5 max-md:pt-4">
          <h3 className={`title m-0 line-clamp-3 break-words text-ink ${focus.name.length > 18 ? 'text-[1.3rem]' : 'text-[1.75rem] max-md:text-[1.35rem]'}`} data-testid="spotlight-name" title={focus.name}>
            {focus.name}
          </h3>
          <p className="num m-0 text-[13px] text-ink-2">{formatLatLon(focus.lat, focus.lon_east, 3)}</p>
          {/* One status line: how the delay moved this site, or why it is in the spotlight. */}
          {focusRow.planned && focusRow.moved !== 0 ? (
            <p className="m-0 text-[13px] leading-snug text-ink-2" data-testid="spotlight-moved">
              Rank {focusRow.planned.rank} with no delay: {movedText(focusRow.moved)}.
            </p>
          ) : !highlighted ? (
            <p className="m-0 text-[13px] leading-snug text-ink-2">Best site for this mission and date.</p>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className={`tag ${fail ? 'tag-bad' : 'tag-good'} min-h-8 px-3 text-[13px]`} data-testid="spotlight-verdict">
          {q.verdict.text}
        </span>
        {focus.note ? (
          <span className="line-clamp-2 min-w-0 flex-1 basis-40 text-[13px] leading-snug text-ink-2" title={focus.note}>
            {focus.note}
          </span>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-x-5 gap-y-4 border-t border-line pt-4 max-md:gap-y-3 max-md:pt-3">
        <div className="flex flex-col gap-0.5">
          <Readout q={q.sunlightPercent} size="xl" />
          <span className="num text-[13px] text-ink-2" data-q="sunlight_hours">
            <span data-q-text>{q.sunlightHours.text}</span>
            <span data-q-unit> {q.sunlightHours.unit}</span> lit
          </span>
        </div>
        <Readout q={q.score} size="xl" />
        <Readout q={q.earthLink} />
        <div className="flex flex-col gap-0.5">
          <Readout q={q.powerMargin} />
          {words ? (
            <span className="text-[13px] text-ink-2" data-testid="spotlight-power-words">
              {words}
            </span>
          ) : null}
        </div>
      </div>

      {highlighted ? (
        <button type="button" className="btn btn-quiet -my-1 self-start" onClick={() => actions.highlight(null)} data-testid="follow-best">
          <Icon name="target" size={14} />
          Follow the best site
        </button>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4 max-md:pt-3">
        <button type="button" className="btn btn-primary btn-lg flex-1 whitespace-nowrap" onClick={() => actions.zoomToSite(focus)} disabled={flight !== null} data-testid="zoom-to-site">
          <Icon name="zoom-in" size={16} />
          Zoom in to this site
        </button>
        <button
          type="button"
          className="btn btn-lg btn-icon w-12"
          aria-pressed={isSaved}
          aria-label={isSaved ? `Remove ${focus.name} from saved sites` : `Save ${focus.name}`}
          title={isSaved ? 'Saved. Press to remove.' : 'Save this site to compare it later'}
          onClick={() => actions.toggleSaved({ id: focus.id, name: focus.name, lat: focus.lat, lon_east: focus.lon_east })}
          data-testid="save-site"
        >
          <Icon name={isSaved ? 'star-filled' : 'star'} size={17} />
        </button>
      </div>
    </Glass>
  );
}
