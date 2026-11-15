// The bar across the top of every stage: the app's name, where you are among the three stages,
// the "Example data" badge and "About" (which reopens the landing card).

import { isMockMode } from '../api/client';
import { Icon } from '../components/Icon';
import { actions, appStore, type Stage } from '../state/app';
import { useData } from '../state/data';
import { useStore } from '../state/store';

const STAGES: { id: Stage; label: string }[] = [
  { id: 'orbit', label: 'Orbit' },
  { id: 'mission', label: 'Mission select' },
  { id: 'site', label: 'Site' },
];

/** The dark wash behind the bar: it fades out downward, into the scene. */
const BACKING = 'linear-gradient(to bottom, rgb(2 5 11 / 0.82), rgb(2 5 11 / 0))';
/**
 * In mission select the sunlit Moon can pass behind the bar (the picture moves up when the
 * assistant's history opens). There the wash holds to the foot of the bar's text before it fades,
 * so the words keep their contrast.
 */
const BACKING_UNDER_MOON = 'linear-gradient(to bottom, rgb(2 5 11 / 0.9), rgb(2 5 11 / 0.72) 70%, rgb(2 5 11 / 0))';

export function TopBar() {
  const stage = useStore(appStore, (s) => s.stage);
  const flight = useStore(appStore, (s) => s.flight);
  const cardOpen = useStore(appStore, (s) => s.cardOpen);
  const assistantOpen = useStore(appStore, (s) => s.assistantOpen);
  const { focus } = useData();

  function go(to: Stage) {
    if (to === stage || flight !== null) return;
    if (to === 'orbit') actions.backToOrbit();
    else if (to === 'mission') {
      if (stage === 'site') actions.backToMission();
      else actions.enterMission();
    } else actions.zoomToSite(focus);
  }

  return (
    <header className="pointer-events-none absolute inset-x-0 top-0 z-20 flex h-14 items-center gap-x-5 px-5 max-md:gap-x-2 max-md:px-3" style={{ background: stage === 'mission' ? BACKING_UNDER_MOON : BACKING }}>
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

      {isMockMode() ? (
        <span className="tag pointer-events-auto shrink-0" title="No backend address is set (VITE_API_BASE), so every number comes from built-in example answers." data-testid="example-badge">
          Example data
        </span>
      ) : null}

      {/* About sits with the title: the upper right is left clear for the scene (Earth stands there in Orbit). */}
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
