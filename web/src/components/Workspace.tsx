// The scene area: view 1 (whole Moon), view 2 (site markers) and view 3 (site scene),
// with the overlays that belong to each view.

import { Component, lazy, Suspense, useEffect, useMemo, useRef, type ReactNode } from 'react';
import gsap from 'gsap';
import { actions, appStore, simClock } from '../state/app';
import { useData } from '../state/data';
import { useStore } from '../state/store';
import { useIsPhone } from '../state/useMedia';
import { hasWebGL } from '../scene/webgl';
import { MoonFallback } from '../scene/MoonFallback';
import { MOON_TEXTURE } from '../scene/textures';
import type { SiteSceneHandle } from '../scene/SiteScene';
import { DAY_MS } from '../util/time';
import { AsyncView } from './AsyncView';
import { Drawer } from './Drawer';
import { HorizonPlot } from './HorizonPlot';
import { Icon } from './Icon';
import { FloatingSitesPane, SitesContent, selectSite } from './SitesPane';

// The 3D code is loaded on demand so the planner and lists appear quickly.
const MoonScene = lazy(() => import('../scene/MoonScene').then((m) => ({ default: m.MoonScene })));
const SiteScene = lazy(() => import('../scene/SiteScene').then((m) => ({ default: m.SiteScene })));

class SceneBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function SceneLoading() {
  return (
    <div className="absolute inset-0 grid place-items-center text-[13px] text-muted" role="status">
      Loading the 3D view…
    </div>
  );
}

export function Workspace() {
  const view = useStore(appStore, (s) => s.view);
  const drawer = useStore(appStore, (s) => s.drawer);
  const isPhone = useIsPhone();
  const webgl = useMemo(() => hasWebGL(), []);

  return (
    <div className="relative h-full min-h-0 overflow-hidden bg-space">
      {/* Keyed wrapper: switching between the Moon and a site scene fades in instead of cutting. */}
      <div key={view === 'scene' ? 'scene' : 'moon'} className="enter-fade absolute inset-0">
        {view === 'scene' ? <SiteView webgl={webgl} isPhone={isPhone} /> : <MoonView webgl={webgl} isPhone={isPhone} />}
      </div>

      {isPhone && view !== 'globe' ? (
        <Drawer open={drawer === 'sites'} side="bottom" label="Sites" onClose={() => actions.setDrawer('none')} testId="sites-drawer">
          <div className="flex items-center justify-between border-b border-line px-3 py-2">
            <h2 className="m-0 text-[14px] font-semibold">Sites</h2>
            <button type="button" className="btn btn-icon" aria-label="Close sites" onClick={() => actions.setDrawer('none')}>
              <Icon name="close" />
            </button>
          </div>
          <SitesContent layout="sheet" onClose={() => actions.setDrawer('none')} />
        </Drawer>
      ) : null}
    </div>
  );
}

function MoonView({ webgl, isPhone }: { webgl: boolean; isPhone: boolean }) {
  const view = useStore(appStore, (s) => s.view) as 'globe' | 'sites';
  const highlightedId = useStore(appStore, (s) => s.highlightedId);
  const saved = useStore(appStore, (s) => s.saved);
  const { allSites, evaluation } = useData();
  const savedIds = useMemo(() => new Set(saved.map((s) => s.id)), [saved]);
  const geometry = evaluation.data?.current.geometry ?? null;

  const common = {
    view,
    sites: allSites,
    highlightedId,
    savedIds,
    geometry,
    onMoonClick: () => actions.setView('sites'),
    onPickPoint: (lat: number, lon: number) => actions.setCustomSite(lat, lon),
    onSiteClick: selectSite,
  };
  const fallback = <MoonFallback {...common} />;

  return (
    <>
      {webgl ? (
        <SceneBoundary fallback={fallback}>
          <Suspense fallback={<SceneLoading />}>
            <MoonScene {...common} isPhone={isPhone} />
          </Suspense>
        </SceneBoundary>
      ) : (
        fallback
      )}

      <p className="pointer-events-none absolute bottom-2 right-3 m-0 rounded-full border border-line bg-glass px-2.5 py-0.5 text-[11px] text-ink-2" data-testid="not-to-scale">
        Sun and Earth markers: not to scale
      </p>
      {MOON_TEXTURE.enabled ? <p className="pointer-events-none absolute bottom-2 left-3 m-0 text-[10px] text-muted">{MOON_TEXTURE.credit}</p> : null}

      {view === 'globe' ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-10 flex flex-col items-center gap-2 px-4 text-center">
          <p className="m-0 text-[13px] text-ink-2">Click the Moon to see the landing sites.</p>
          <button type="button" className="btn btn-primary pointer-events-auto" onClick={() => actions.setView('sites')} data-testid="show-sites">
            <Icon name="sites" size={14} /> Show landing sites
          </button>
        </div>
      ) : (
        <>
          {!isPhone ? <FloatingSitesPane /> : null}
          <div className="absolute right-3 top-3 flex gap-2">
            <button type="button" className="btn" onClick={() => actions.setView('globe')}>
              <Icon name="back" size={14} /> Whole Moon
            </button>
          </div>
          <p className="pointer-events-none absolute right-3 top-14 m-0 max-w-[15rem] text-right text-[11px] text-muted">
            Click a marker or a row to highlight a site, then click it again to open it. Click anywhere else on the Moon to pick that point.
          </p>
        </>
      )}
    </>
  );
}

function SiteView({ webgl, isPhone }: { webgl: boolean; isPhone: boolean }) {
  const horizonOpen = useStore(appStore, (s) => s.horizonOpen);
  const drawer = useStore(appStore, (s) => s.drawer);
  const { highlighted, horizon, landingMs } = useData();
  const sceneRef = useRef<SiteSceneHandle>(null);

  if (!highlighted) {
    return (
      <div className="absolute inset-0 grid place-items-center p-6 text-center">
        <div>
          <p className="text-ink-2">No site is highlighted.</p>
          <button type="button" className="btn btn-primary" onClick={() => actions.setView('sites')}>
            <Icon name="back" size={14} /> Back to Moon
          </button>
        </div>
      </div>
    );
  }

  const noScene = (
    <div className="absolute inset-0 grid place-items-center p-6 text-center text-[13px] text-muted" data-testid="site-scene-fallback">
      3D is not available in this browser. The horizon plot shows this site's sky.
    </div>
  );

  return (
    <>
      {webgl && landingMs !== null ? (
        <SceneBoundary fallback={noScene}>
          <Suspense fallback={<SceneLoading />}>
            <SiteScene ref={sceneRef} site={highlighted} horizon={horizon.data} landingMs={landingMs} />
          </Suspense>
        </SceneBoundary>
      ) : webgl ? (
        <SceneLoading />
      ) : (
        noScene
      )}

      <div className="absolute left-3 top-3 flex max-w-[calc(100%-1.5rem)] items-center gap-2 md:max-w-[calc(100%-12rem)]">
        <button type="button" className="btn btn-primary" onClick={() => actions.setView('sites')} data-testid="back-to-moon">
          <Icon name="back" size={14} /> Back to Moon
        </button>
        <span className="glass min-w-0 truncate rounded-lg px-2.5 py-1 text-[13px] font-medium" data-testid="scene-title">
          {highlighted.name}
        </span>
      </div>
      {!isPhone ? (
        <div className="absolute right-3 top-3 flex gap-2">
          <label className="btn select-none">
            <input type="checkbox" checked={horizonOpen} onChange={(e) => actions.setHorizonOpen(e.target.checked)} />
            Horizon plot
          </label>
        </div>
      ) : null}
      {webgl ? (
        <div className="absolute bottom-3 right-3 flex flex-col gap-1" role="group" aria-label="Zoom">
          <button type="button" className="btn btn-icon" aria-label="Zoom in" onClick={() => sceneRef.current?.zoom(0.75)}>
            <Icon name="plus" />
          </button>
          <button type="button" className="btn btn-icon" aria-label="Zoom out" onClick={() => sceneRef.current?.zoom(1.33)}>
            <Icon name="minus" />
          </button>
        </div>
      ) : null}
      <p className="pointer-events-none absolute bottom-3 right-14 m-0 max-w-[14rem] text-right text-[11px] text-muted">
        Placeholder ground. Earth and Sun not to scale. Drag to look around.
      </p>

      {isPhone ? (
        <Drawer open={drawer === 'horizon'} side="bottom" label="Horizon plot" onClose={() => actions.setDrawer('none')} testId="horizon-drawer">
          <div className="flex items-center justify-between border-b border-line px-3 py-2">
            <h2 className="m-0 text-[14px] font-semibold">Horizon · {highlighted.name}</h2>
            <button type="button" className="btn btn-icon" aria-label="Close horizon plot" onClick={() => actions.setDrawer('none')}>
              <Icon name="close" />
            </button>
          </div>
          <div className="overflow-y-auto p-3">
            <FullHorizon />
          </div>
        </Drawer>
      ) : horizonOpen ? (
        <section aria-label="Horizon plot" className="glass enter absolute bottom-3 left-3 z-10 w-[min(640px,calc(100%-5.5rem))] rounded-xl p-3" data-testid="horizon-panel">
          <div className="mb-1 flex items-center justify-between">
            <h2 className="m-0 text-[13px] font-semibold">Horizon plot</h2>
            <button type="button" className="btn btn-icon size-7 min-h-7" aria-label="Hide the horizon plot" onClick={() => actions.setHorizonOpen(false)}>
              <Icon name="close" size={14} />
            </button>
          </div>
          <FullHorizon />
        </section>
      ) : null}
    </>
  );
}

function FullHorizon() {
  const { highlighted, horizon, evaluation, landingMs, plannedLandingMs, windowStartMs, windowEndMs } = useData();
  const timeScale = useStore(appStore, (s) => s.timeScale);
  const nowMs = useStore(simClock, (s) => s.nowMs);
  const row = highlighted ? evaluation.data?.rows.find((r) => r.siteId === highlighted.id) : undefined;
  if (!highlighted) return null;
  return (
    <AsyncView result={horizon} what="the horizon" waiting={<div className="skeleton h-40 w-full" />} empty="No horizon data for this point.">
      {(h) =>
        landingMs !== null && windowStartMs !== null && windowEndMs !== null ? (
          <HorizonPlot
            data={h}
            siteName={highlighted.name}
            nowMs={nowMs ?? landingMs}
            windowStartMs={windowStartMs}
            windowEndMs={windowEndMs}
            landingMs={landingMs}
            plannedLandingMs={plannedLandingMs}
            readouts={row?.evaluation ?? null}
            timeScale={timeScale}
            onScrub={(ms) => {
              actions.setPlaying(false);
              simClock.set({ nowMs: ms });
            }}
          />
        ) : null
      }
    </AsyncView>
  );
}

/** Runs the Play control: moves the simulated clock through the window with a GSAP tween. */
export function Playback() {
  const playing = useStore(appStore, (s) => s.playing);
  const view = useStore(appStore, (s) => s.view);
  const { windowStartMs, windowEndMs, landingMs } = useData();

  useEffect(() => {
    if (!playing || view !== 'scene' || windowStartMs === null || windowEndMs === null || landingMs === null) return;
    let from = simClock.get().nowMs ?? landingMs;
    if (from >= windowEndMs - 1000) from = windowStartMs;
    const proxy = { t: from };
    const days = (windowEndMs - from) / DAY_MS;
    const tween = gsap.to(proxy, {
      t: windowEndMs,
      duration: Math.max(1.5, days * 0.5), // half a second per simulated day
      ease: 'none',
      onUpdate: () => simClock.set({ nowMs: proxy.t }),
      onComplete: () => actions.setPlaying(false),
    });
    return () => {
      tween.kill();
    };
  }, [playing, view, windowStartMs, windowEndMs, landingMs]);
  return null;
}
