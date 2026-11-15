import { Component, lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useParallax } from './hud/parallax';
import { MoonFallback } from './scene/MoonFallback';
import { hasWebGL } from './scene/webgl';
import { LandingCard } from './stages/LandingCard';
import { MissionHud } from './stages/MissionHud';
import { OrbitHud } from './stages/OrbitHud';
import { OrbitPreview } from './stages/Playback';
import { TopBar } from './stages/TopBar';
import { actions, appStore } from './state/app';
import { DataProvider, useData } from './state/data';
import { useStore } from './state/store';

// The 3D code is loaded on demand so the first paint (and the landing card) is quick.
const World = lazy(() => import('./scene/World').then((m) => ({ default: m.World })));

class SceneBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export function App() {
  return (
    <DataProvider>
      <Shell />
      <OrbitPreview />
    </DataProvider>
  );
}

function Shell() {
  const stage = useStore(appStore, (s) => s.stage);
  const cardOpen = useStore(appStore, (s) => s.cardOpen);
  const webgl = useMemo(() => hasWebGL(), []);
  const hudRef = useRef<HTMLDivElement>(null);
  // The HUD arrives once the landing card has been closed for the first time.
  const [revealed, setRevealed] = useState(!cardOpen);
  useEffect(() => {
    if (!cardOpen) setRevealed(true);
  }, [cardOpen]);
  useParallax(hudRef, [stage, revealed]);

  const noScene = <FlatWorld />;

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-space" data-testid="app" data-stage={stage}>
      {webgl ? (
        <SceneBoundary fallback={noScene}>
          <Suspense fallback={null}>
            <World />
          </Suspense>
        </SceneBoundary>
      ) : (
        noScene
      )}
      <div ref={hudRef} className="hud" inert={cardOpen}>
        <TopBar />
        {stage === 'orbit' ? <OrbitHud revealed={revealed} /> : null}
        {stage === 'mission' ? <MissionHud /> : null}
      </div>
      <LandingCard />
    </div>
  );
}

/** Shown instead of the 3D space when the browser has no WebGL (or the address has ?webgl=off). */
function FlatWorld() {
  const stage = useStore(appStore, (s) => s.stage);
  const saved = useStore(appStore, (s) => s.saved);
  const { allSites, focus, landingGeometry } = useData();
  const savedIds = useMemo(() => new Set(saved.map((s) => s.id)), [saved]);
  if (stage === 'site') {
    return (
      <div className="absolute inset-0 grid place-items-center p-6 text-center text-[14px] text-ink-2" data-testid="site-scene-fallback">
        3D is not available in this browser. The horizon plot shows this site’s sky.
      </div>
    );
  }
  return (
    <MoonFallback
      view={stage}
      sites={allSites}
      highlightedId={focus?.id ?? null}
      savedIds={savedIds}
      geometry={landingGeometry}
      onMoonClick={actions.enterMission}
      onPickPoint={(lat, lon) => actions.setCustomSite(lat, lon)}
      onSiteClick={(site) => actions.highlight(site.id, site)}
    />
  );
}
