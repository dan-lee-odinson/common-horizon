// Stage 2, MISSION SELECT.
//
// One site owns the screen (the spotlight), with a short ranked strip under it. Across the top:
// the mission in one line and the launch-delay scrubber. The Moon is large and off-centre, with a
// pulsing reticle on the spotlight site. A glass drawer at the right holds the preset list and the
// coordinate entry and slides in and out. The Mission Assistant runs along the bottom, beside the
// spotlight column, so its history rises over the scene and never over a control.

import { useRef } from 'react';
import { ComparePanel } from '../components/ComparePanel';
import { Icon } from '../components/Icon';
import { actions, appStore } from '../state/app';
import { useData } from '../state/data';
import { useStore } from '../state/store';
import { useIsPhone, useWindowHeight } from '../state/useMedia';
import { AnchorTag } from './AnchorTag';
import { AssistantDock } from './Assistant';
import { MissionBar } from './MissionBar';
import { MissionSheet } from './MissionSheet';
import { RankStrip } from './RankStrip';
import { SiteDrawer } from './SiteDrawer';
import { Spotlight } from './Spotlight';
import { useEntrance } from './useEntrance';

export function MissionHud() {
  const { focus } = useData();
  const drawerOpen = useStore(appStore, (s) => s.drawerOpen);
  const flight = useStore(appStore, (s) => s.flight);
  const isPhone = useIsPhone();
  // The strip shows five rows, fewer in a short window, so it always fits under the spotlight.
  const height = useWindowHeight();
  const stripRows = height >= 880 ? 5 : height >= 820 ? 4 : height >= 760 ? 3 : 2;
  const rootRef = useRef<HTMLDivElement>(null);
  useEntrance(rootRef, true, 0.3);
  // While the camera dives to the site, the HUD steps back.
  const leaving = flight === 'in';

  return (
    <div
      ref={rootRef}
      className="absolute inset-0 transition-opacity duration-200"
      style={{ opacity: leaving ? 0 : 1, pointerEvents: leaving ? 'none' : undefined }}
      inert={leaving}
      data-testid="mission-hud"
    >
      <h2 className="sr-only">Mission select</h2>
      {focus && !isPhone ? <AnchorTag anchor="site" label={focus.name.length > 28 ? `${focus.name.slice(0, 27)}…` : focus.name} tone="cyan" toward={40} gap={30} /> : null}

      {/* Left wing: the spotlight, and the short ranked strip under it. */}
      <div className="hud-layer" data-depth="0.9">
        <div className="wing-l absolute left-5 top-[4.75rem] flex w-[25rem] flex-col gap-3.5 max-md:hidden" data-enter="left">
          <Spotlight />
          <RankStrip rows={stripRows} />
        </div>
      </div>

      {/* Across the top: the mission line and the launch delay. It stops short of the drawer's place. */}
      <div className="hud-layer" data-depth="0.6">
        <div className={`absolute left-[27.5rem] top-[4.75rem] max-lg:right-5 max-md:left-3 max-md:right-3 max-md:top-[4.25rem] ${drawerOpen ? 'right-[25rem]' : 'right-[18.5rem]'}`} data-enter="lead">
          <MissionBar />
        </div>
      </div>

      {/* The drawer's handle. */}
      <div className="hud-layer" data-depth="0.6">
        <button
          type="button"
          className="btn absolute right-5 top-[4.75rem] max-lg:top-[13.5rem] max-md:hidden"
          aria-expanded={drawerOpen}
          aria-controls="site-drawer"
          onClick={() => actions.setDrawerOpen(!drawerOpen)}
          style={{ visibility: drawerOpen ? 'hidden' : 'visible' }}
          data-enter="fade"
          data-testid="drawer-toggle"
        >
          <Icon name="sites" size={15} />
          Presets and coordinates
        </button>
      </div>

      {/* Along the bottom: the Mission Assistant, beside the spotlight column and clear of the drawer. */}
      <div className="hud-layer" data-depth="0.4">
        <div className={`absolute bottom-5 left-[27.5rem] max-md:bottom-3 max-md:left-3 max-md:right-3 ${drawerOpen ? 'right-[25rem] max-lg:right-5' : 'right-5'}`} data-enter="fade">
          <AssistantDock />
        </div>
      </div>

      <SiteDrawer phone={isPhone} />
      <MissionSheet phone={isPhone} />
      <ComparePanel phone={isPhone} />
    </div>
  );
}
