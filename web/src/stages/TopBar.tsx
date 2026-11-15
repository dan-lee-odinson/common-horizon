// The bar across the top of every stage: the app's name, where you are among the three stages,
// the data source label and "About" (which reopens the landing card).
//
// The data source label says where every number on screen comes from:
//   EXAMPLE DATA            example mode (no backend address): the website's own example model
//   TEST DATA               the backend answers with provenance.is_synthetic true (its synthetic fixture)
//   LIVE: PHYSICS ENGINE    the backend answers from the real physics engine

import { Icon } from '../components/Icon';
import { actions, appStore, type Stage } from '../state/app';
import { useData, type DataSourceKind } from '../state/data';
import { useStore } from '../state/store';

const STAGES: { id: Stage; label: string }[] = [
  { id: 'orbit', label: 'Orbit' },
  { id: 'mission', label: 'Mission select' },
  { id: 'site', label: 'Site' },
];

/** The dark wash behind the bar: it fades out downward, into the scene. */
const BACKING = 'linear-gradient(to bottom, rgb(2 5 11 / 0.82), rgb(2 5 11 / 0))';
/**
 * In Orbit the bar sits over Earth's sunlit limb, and in mission select the sunlit Moon can pass
 * behind it (the picture moves up when the assistant's history opens). There the wash holds to the
 * foot of the bar's text before it fades, so the words keep their contrast: over pure white, 80 %
 * of this wash leaves the dimmest text of the bar above 4.5 to 1.
 */
const BACKING_UNDER_MOON = 'linear-gradient(to bottom, rgb(2 5 11 / 0.92), rgb(2 5 11 / 0.8) 72%, rgb(2 5 11 / 0))';

/** The label's words (shown in capitals) and what it means, by data source. */
export const DATA_SOURCE_LABEL: Record<DataSourceKind, { text: string; title: string; tone?: 'warn' | 'good' }> = {
  example: { text: 'Example data', title: "No backend address is set (VITE_API_BASE), so every number comes from the website's built-in example model." },
  test: { text: 'Test data', title: "The backend answers from its synthetic test fixture (provenance.is_synthetic), not from the physics engine. Not for planning.", tone: 'warn' },
  physics: { text: 'Live: physics engine', title: "The backend answers from the physics engine (NASA NAIF SPICE ephemerides).", tone: 'good' },
  unknown: { text: 'Live: waiting for the backend', title: 'The backend has not said yet where its numbers come from.' },
};

export function TopBar() {
  const stage = useStore(appStore, (s) => s.stage);
  const flight = useStore(appStore, (s) => s.flight);
  const cardOpen = useStore(appStore, (s) => s.cardOpen);
  const assistantOpen = useStore(appStore, (s) => s.assistantOpen);
  const { focus, dataSource } = useData();
  const source = DATA_SOURCE_LABEL[dataSource];

  function go(to: Stage) {
    if (to === stage || flight !== null) return;
    if (to === 'orbit') actions.backToOrbit();
    else if (to === 'mission') {
      if (stage === 'site') actions.backToMission();
      else actions.enterMission();
    } else actions.zoomToSite(focus);
  }

  return (
    <header className="pointer-events-none absolute inset-x-0 top-0 z-20 flex h-14 items-center gap-x-5 px-5 max-md:gap-x-2 max-md:px-3" style={{ background: stage === 'site' ? BACKING : BACKING_UNDER_MOON }}>
      <h1 className="pointer-events-auto m-0 shrink-0 font-display text-[15px] font-semibold uppercase tracking-[0.24em] text-ink max-md:text-[13px] max-md:tracking-[0.14em]">Common Horizon</h1>

      <nav aria-label="Stages" className="pointer-events-auto max-md:hidden">
        <ol className="m-0 flex list-none items-center gap-1 p-0">
          {STAGES.map((s, i) => {
            const current = s.id === stage;
            const disabled = flight !== null || (s.id === 'site' && !focus && !current);
            return (
              <li key={s.id} className="flex items-center gap-1">
                {i > 0 ? <span className="h-px w-5 bg-line-strong" aria-hidden /> : null}
                <button
                  type="button"
                  className={`min-h-9 rounded-[3px] px-2 font-display text-[12px] font-semibold uppercase tracking-[0.14em] transition-colors duration-150 ${current ? 'text-accent' : 'text-ink-2 hover:text-ink'} disabled:text-muted`}
                  aria-current={current ? 'step' : undefined}
                  disabled={disabled && !current}
                  onClick={() => go(s.id)}
                  data-testid={`stage-${s.id}`}
                >
                  {s.label}
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <span
        className={`tag pointer-events-auto shrink-0 max-md:max-w-[9rem] max-md:truncate ${source.tone === 'warn' ? 'tag-warn' : source.tone === 'good' ? 'tag-good' : ''}`}
        title={source.title}
        data-testid={dataSource === 'example' ? 'example-badge' : 'data-source'}
        data-source={dataSource}
      >
        {source.text}
      </span>

      {/* About sits with the title: the upper right is left clear for the scene and the panels. */}
      <button type="button" className="btn btn-quiet pointer-events-auto shrink-0 max-md:ml-auto max-md:w-11 max-md:px-0" onClick={actions.openCard} aria-haspopup="dialog" aria-expanded={cardOpen} aria-label="About Common Horizon" data-testid="about">
        <Icon name="info" size={16} />
        <span className="max-md:hidden">About</span>
      </button>
      {/* In mission select the assistant is always along the bottom; elsewhere it opens from here. */}
      {stage !== 'mission' ? (
        <button
          type="button"
          className="btn btn-quiet pointer-events-auto shrink-0 max-md:-ml-1.5 max-md:w-11 max-md:px-0"
          onClick={() => actions.setAssistantOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={assistantOpen}
          aria-label="Mission Assistant"
          data-testid="assistant-open"
        >
          <Icon name="chat" size={16} />
          <span className="max-md:hidden">Assistant</span>
        </button>
      ) : null}
    </header>
  );
}
