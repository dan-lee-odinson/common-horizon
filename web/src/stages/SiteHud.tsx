// Stage 3, SITE. A bridge for now: the site scene and horizon plot as they were, behind the new
// way in and out. The terrain, the Sun's path with its light and shadows, the hardware models and
// the full HUD arrive with the rebuilt stage.

import { lazy, Suspense, useEffect } from 'react';
import gsap from 'gsap';
import { AsyncView } from '../components/AsyncView';
import { HorizonPlot } from '../components/HorizonPlot';
import { Icon } from '../components/Icon';
import { Glass } from '../hud/Glass';
import { actions, appStore, simClock } from '../state/app';
import { useData } from '../state/data';
import { useStore } from '../state/store';
import { DAY_MS } from '../util/time';

const SiteScene = lazy(() => import('../scene/SiteScene').then((m) => ({ default: m.SiteScene })));

export function SiteHud({ webgl }: { webgl: boolean }) {
  const { focus, horizon, focusRow, landingMs, plannedLandingMs, windowStartMs, windowEndMs } = useData();
  const playing = useStore(appStore, (s) => s.playing);
  const timeScale = useStore(appStore, (s) => s.timeScale);
  const nowMs = useStore(simClock, (s) => s.nowMs);

  // Play: the simulated clock runs through the stay, half a second per simulated day.
  useEffect(() => {
    if (!playing || windowStartMs === null || windowEndMs === null || landingMs === null) return;
    let from = simClock.get().nowMs ?? landingMs;
    if (from >= windowEndMs - 1000) from = windowStartMs;
    const proxy = { t: from };
    const tween = gsap.to(proxy, {
      t: windowEndMs,
      duration: Math.max(1.5, ((windowEndMs - from) / DAY_MS) * 0.5),
      ease: 'none',
      onUpdate: () => simClock.set({ nowMs: proxy.t }),
      onComplete: () => actions.setPlaying(false),
    });
    return () => {
      tween.kill();
    };
  }, [playing, windowStartMs, windowEndMs, landingMs]);

  return (
    <div className="absolute inset-0" data-testid="site-hud">
      <h2 className="sr-only">Site: {focus?.name ?? 'no site'}</h2>
      {webgl && focus && landingMs !== null ? (
        <div className="hud-layer">
          <div className="absolute inset-0">
            <Suspense fallback={null}>
              <SiteScene site={focus} horizon={horizon.data} landingMs={landingMs} />
            </Suspense>
          </div>
        </div>
      ) : null}
      <div className="hud-layer">
        <div className="absolute left-5 top-[4.75rem] flex max-w-[calc(100%-2.5rem)] flex-wrap items-center gap-2">
          <button type="button" className="btn btn-primary" onClick={actions.backToMission} data-testid="back-to-mission">
            <Icon name="back" size={14} />
            Back to mission select
          </button>
          <span className="tag min-h-9 bg-glass-strong px-3 text-[13px]" data-testid="scene-title">
            {focus?.name ?? 'No site'}
          </span>
          <button type="button" className="btn" onClick={() => actions.setPlaying(!playing)} aria-pressed={playing} data-testid="play">
            <Icon name={playing ? 'pause' : 'play'} size={14} />
            {playing ? 'Pause' : 'Play'}
          </button>
        </div>
      </div>
      <div className="hud-layer">
        <Glass as="section" className="absolute bottom-5 left-5 w-[min(40rem,calc(100%-2.5rem))] p-4" aria-label="Horizon plot" data-testid="horizon-panel">
          <AsyncView result={horizon} what="the horizon" waiting={<div className="skeleton h-40 w-full" />} empty="No horizon data for this point.">
            {(h) =>
              focus && landingMs !== null && windowStartMs !== null && windowEndMs !== null ? (
                <HorizonPlot
                  data={h}
                  siteName={focus.name}
                  nowMs={nowMs ?? landingMs}
                  windowStartMs={windowStartMs}
                  windowEndMs={windowEndMs}
                  landingMs={landingMs}
                  plannedLandingMs={plannedLandingMs}
                  readouts={focusRow?.evaluation ?? null}
                  timeScale={timeScale}
                  onScrub={(ms) => {
                    actions.setPlaying(false);
                    simClock.set({ nowMs: ms });
                  }}
                />
              ) : null
            }
          </AsyncView>
        </Glass>
      </div>
    </div>
  );
}
