import { Component, lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useParallax } from './hud/parallax';
import { MoonFallback } from './scene/MoonFallback';
import { hasWebGL } from './scene/webgl';
import { AssistantSheet } from './stages/Assistant';
import { LanderReticle } from './stages/LanderReticle';
import { LandingCard } from './stages/LandingCard';
import { MissionHud } from './stages/MissionHud';
import { OrbitHud } from './stages/OrbitHud';
import { OrbitPreview, SitePlayback } from './stages/Playback';
import { SiteHud } from './stages/SiteHud';
import { SiteVeil } from './stages/SiteVeil';
import { TopBar } from './stages/TopBar';
import { actions, appStore } from './state/app';
import { DataProvider, useData } from './state/data';
import { useStore } from './state/store';
import { useIsPhone } from './state/useMedia';

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
      <SitePlayback />
    </DataProvider>
  );
}

function Shell() {
  const stage = useStore(appStore, (s) => s.stage);
  const cardOpen = useStore(appStore, (s) => s.cardOpen);
  const webgl = useMemo(() => hasWebGL(), []);
  const isPhone = useIsPhone();
  const hudRef = useRef<HTMLDivElement>(null);
  // The HUD arrives once the landing card has been closed for the first time.
  const [revealed, setRevealed] = useState(!cardOpen);
  useEffect(() => {
    if (!cardOpen) setRevealed(true);
  }, [cardOpen]);
  useParallax(hudRef, [stage, revealed]);

  const noScene = <FlatWorld />;

  return (
    // `overflow-clip`, not `overflow-hidden`: a drawer that is sliding in from beyond the edge must
    // never let the whole stage be scrolled sideways (a Tab into it would do that otherwise).
    <div className="relative h-dvh w-full overflow-clip bg-space" data-testid="app" data-stage={stage}>
      {webgl ? (
        <SceneBoundary fallback={noScene}>
          <Suspense fallback={null}>
            <World />
          </Suspense>
        </SceneBoundary>
      ) : (
        noScene
      )}
      {webgl ? <SiteVeil /> : null}
      <div ref={hudRef} className="hud" inert={cardOpen}>
        {/* Under every panel: the reticle that rides the landing point from the Moon down to the site. */}
        {webgl ? <LanderReticle /> : null}
        <TopBar />
        {stage === 'orbit' ? <OrbitHud revealed={revealed} /> : null}
        {stage === 'mission' ? <MissionHud /> : null}
        {stage === 'site' ? <SiteHud webgl={webgl} /> : null}
        {stage !== 'mission' ? <AssistantSheet phone={isPhone} /> : null}
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
      // Above the horizon plot, which takes the scene's place in the middle of the stage.
      <p className="absolute left-[23rem] right-[23rem] top-[8.5rem] m-0 text-center text-[14px] leading-snug text-ink-2 max-lg:left-[19rem] max-lg:right-[19rem] max-md:left-6 max-md:right-6 max-md:top-[15.5rem]" data-testid="site-scene-fallback">
        3D is not available in this browser. The horizon plot shows this site’s sky.
      </p>
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
