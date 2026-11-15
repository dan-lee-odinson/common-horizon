// The spotlight: one site owns the screen. Its rank as a very large numeral, its name, then
// sunlight, Earth link, power margin and score as big readouts, the pass or fail word, and the
// action that flies down to it.
//
// The panel keeps one height whatever site it shows (a long name, a note or none, a site the
// visitor picked or the best one), so the ranked strip under it never jumps as the spotlight moves.
// While a newer ranking is on its way the panel keeps the previous figures, a little dimmed.

import { Icon } from '../components/Icon';
import { Glass } from '../hud/Glass';
import { Readout } from '../hud/Readout';
import { actions, appStore } from '../state/app';
import { useData, type DataValue } from '../state/data';
import { useStore } from '../state/store';
import { formatLatLon } from '../util/geo';
import { balanceWords, levelFromStatus } from '../util/power';
import { siteQuantities } from '../util/quantities';
import { movedText } from '../util/ranking';

export function Spotlight() {
  const data = useData();
  const { focus, focusRow, focusCheck, highlighted, updating } = data;
  const flight = useStore(appStore, (s) => s.flight);
  const saved = useStore(appStore, (s) => s.saved);

  // A site picked a moment ago (a typed coordinate, say) has no row until the ranking that
  // includes it arrives. Its name and place show at once; its figures are dashes until then.
  const pending = focus !== null && focusRow === null && updating;
  if (!focus || (!focusRow && !pending)) return <NoSpotlight data={data} />;

  // The planner's own check wins for power, once it is the check of this site and this ranking;
  // until then the row's own figure is shown.
  const q = siteQuantities(focusRow?.rank ?? null, focusRow?.evaluation ?? null, focusCheck);
  const words = focusCheck ? balanceWords(levelFromStatus(focusCheck.balance.status), focusCheck.balance.limiting) : null;
  const isSaved = saved.some((s) => s.id === focus.id);
  const fail = q.passes === false;
  // Where the site stood with no delay, as a rank readout of its own ("10", "03").
  const moved = focusRow?.planned && focusRow.moved !== 0 ? { places: focusRow.moved, from: siteQuantities(focusRow.planned.rank, focusRow.evaluation).rank.text } : null;

  return (
    <Glass
      as="section"
      tone={fail ? 'bad' : 'cyan'}
      className="flex flex-col gap-3.5 p-5 short:gap-2.5 short:p-4 max-md:gap-3 max-md:p-4"
      aria-label="Spotlight site"
      aria-busy={updating}
      data-testid="spotlight"
      data-leader-target="site"
      data-panel
    >
      <div className="settling flex flex-col gap-3.5 short:gap-2.5 max-md:gap-3">
        <div className="flex min-h-[7.75rem] items-start gap-4 short:min-h-[6.5rem] max-md:min-h-0">
          <div className="flex shrink-0 flex-col" data-q="rank">
            <p className="m-0 flex items-baseline gap-2">
              <span className="label" data-q-label>
                Rank
              </span>
              {/* How the delay moved this site: the same mark the rows of the strip carry. */}
              {moved ? (
                <span
                  className="num flex items-center gap-0.5 whitespace-nowrap text-[12px]"
                  data-tone={moved.places > 0 ? 'good' : 'muted'}
                  title={`Rank ${moved.from} with no delay: ${movedText(moved.places)}`}
                  data-testid="spotlight-moved"
                >
                  <Icon name={moved.places > 0 ? 'up' : 'down'} size={12} />
                  {Math.abs(moved.places)}
                  <span className="sr-only">: {movedText(moved.places)} since the plan,</span> from {moved.from}
                  <span className="sr-only"> with no delay</span>
                </span>
              ) : null}
            </p>
            <span
              className="font-display text-[7rem] font-semibold leading-[0.82] tracking-[-0.03em] text-accent short:text-[5.5rem] max-md:text-[4.5rem]"
              style={{ textShadow: '0 0 34px var(--ch-glow)' }}
              data-q-text
              data-testid="spotlight-rank"
            >
              {q.rank.text}
            </span>
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1.5 pt-5 short:gap-1 short:pt-2 max-md:pt-4">
            <h3 className={`title m-0 line-clamp-2 break-words text-ink ${focus.name.length > 18 ? 'text-[1.3rem]' : 'text-[1.75rem] max-md:text-[1.35rem]'}`} data-testid="spotlight-name" title={focus.name}>
              {focus.name}
            </h3>
            <p className="num m-0 text-[13px] text-ink-2">{formatLatLon(focus.lat, focus.lon_east, 3)}</p>
            {/* One line that says why this site is in the spotlight, or hands the spotlight back to the ranking. */}
            <div className="flex min-h-7 items-center short:min-h-6">
              {pending ? (
                <p className="m-0 text-[13px] leading-snug text-ink-2" role="status" data-testid="spotlight-pending">
                  Working out this site…
                </p>
              ) : highlighted ? (
                <button type="button" className="btn btn-quiet -ml-2 min-h-7 px-2 text-[12px] short:min-h-6" onClick={() => actions.highlight(null)} data-testid="follow-best">
                  <Icon name="target" size={13} />
                  Follow the best site
                </button>
              ) : (
                <p className="m-0 truncate text-[13px] leading-snug text-ink-2">Best site for this mission and date.</p>
              )}
            </div>
          </div>
        </div>

        <div className="flex min-h-9 items-center gap-2 max-md:flex-wrap">
          {q.passes === null ? null : (
            <span className={`tag ${fail ? 'tag-bad' : 'tag-good'} min-h-8 shrink-0 px-3 text-[13px]`} data-testid="spotlight-verdict">
              {q.verdict.text}
            </span>
          )}
          {focus.note ? (
            <span className="line-clamp-2 min-w-0 flex-1 text-[13px] leading-snug text-ink-2 max-md:basis-40" title={focus.note}>
              {focus.note}
            </span>
          ) : null}
        </div>

        <div className="grid grid-cols-2 gap-x-5 gap-y-3.5 border-t border-line pt-3.5 short:gap-y-2.5 short:pt-3 max-md:gap-y-3 max-md:pt-3">
          <div className="flex flex-col gap-0.5">
            <Readout q={q.sunlightPercent} size="xl" />
            <span className="num text-[13px] text-ink-2" data-q="sunlight_hours">
              <span data-q-text>{q.sunlightHours.text}</span>
              <span data-q-unit> {q.sunlightHours.unit}</span>
              {q.sunlightHours.value === null ? null : ' lit'}
            </span>
          </div>
          <Readout q={q.score} size="xl" />
          <Readout q={q.earthLink} />
          <div className="flex flex-col gap-0.5">
            <Readout q={q.powerMargin} />
            {/* The words arrive with the planner's check; their line is kept so nothing shifts. */}
            <span className="min-h-[1.125rem] text-[13px] leading-[1.125rem] text-ink-2" data-testid="spotlight-power-words">
              {words}
            </span>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3.5 short:pt-3 max-md:pt-3">
        <button type="button" className="btn btn-primary btn-lg flex-1 whitespace-nowrap short:min-h-11" onClick={() => actions.zoomToSite(focus)} disabled={flight !== null} data-testid="zoom-to-site">
          <Icon name="zoom-in" size={16} />
          Zoom in to this site
        </button>
        <button
          type="button"
          className="btn btn-lg btn-icon w-12 short:min-h-11 short:w-11"
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

/** Nothing to put in the spotlight yet: say why, and offer the way forward. */
function NoSpotlight({ data }: { data: DataValue }) {
  const { catalog, evaluation, hardwareChosen } = data;
  const noHardware = hardwareChosen.length === 0;
  const loadingCatalog = noHardware && catalog.status === 'waiting';
  const noCatalog = noHardware && (catalog.status === 'error' || catalog.status === 'empty');
  const failed = !noHardware && evaluation.status === 'error';
  const title = loadingCatalog ? 'Loading the hardware list…' : noHardware ? 'No mission yet' : failed ? 'The ranking did not load' : 'Ranking the sites…';
  const body = loadingCatalog
    ? 'The example mission is set as soon as the list arrives.'
    : noCatalog
      ? 'The hardware list did not load, so the sites cannot be ranked yet.'
      : noHardware
        ? 'Choose a lander and hardware to rank the landing sites.'
        : failed
          ? evaluation.error
          : evaluation.status === 'empty' || evaluation.status === 'idle'
            ? 'There are no sites to rank yet. Open the site drawer and enter a coordinate.'
            : 'Sunlight, Earth contact and power are being worked out for each site.';
  const waiting = loadingCatalog || (!noHardware && !failed && evaluation.status !== 'empty' && evaluation.status !== 'idle');
  return (
    <Glass as="section" className="flex flex-col gap-3 p-5" aria-label="Spotlight site" aria-busy={waiting} data-testid="spotlight" data-state="empty" data-panel>
      <h3 className="title m-0 text-[1.5rem] text-ink">{title}</h3>
      <p className="m-0 text-[14px] leading-normal text-ink-2" role={failed || noCatalog ? 'alert' : 'status'}>
        {body}
      </p>
      <div className="flex flex-wrap gap-2 empty:hidden">
        {noHardware && !loadingCatalog && !noCatalog ? (
          <button type="button" className="btn btn-primary" onClick={() => actions.setMissionOpen(true)}>
            <Icon name="edit" size={14} />
            Set the mission
          </button>
        ) : null}
        {noCatalog && catalog.status === 'error' ? (
          <button type="button" className="btn" onClick={catalog.retry}>
            Try again
          </button>
        ) : null}
        {failed ? (
          <button type="button" className="btn" onClick={evaluation.retry}>
            Try again
          </button>
        ) : null}
      </div>
    </Glass>
  );
}
