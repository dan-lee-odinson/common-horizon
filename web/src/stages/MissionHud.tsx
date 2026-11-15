// Stage 2, MISSION SELECT.
//
// One site owns the screen (the spotlight), with a short ranked strip under it. Across the top:
// the mission in one line and the launch-delay scrubber. The Moon is large and off-centre, with a
// pulsing reticle on the spotlight site. A glass drawer at the right holds the preset list and the
// coordinate entry and slides in and out. The Mission Assistant runs along the bottom, beside the
// spotlight column, so its history rises over the scene and never over a control.
//
// The panels are measured here, and the scene keeps the spotlight site's marker and its name tag
// in the part of the window they leave free (see scene/missionView.ts).

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { ComparePanel } from '../components/ComparePanel';
import { Icon } from '../components/Icon';
import { layoutBox } from '../hud/layoutBox';
import { MISSION_VIEW, missionFrame, placeInFrame } from '../scene/missionView';
import { actions, appStore } from '../state/app';
import { useData } from '../state/data';
import { useStore } from '../state/store';
import { useIsPhone } from '../state/useMedia';
import { AnchorTag } from './AnchorTag';
import { AssistantDock } from './Assistant';
import { MissionBar } from './MissionBar';
import { MissionSheet } from './MissionSheet';
import { RankStrip, STRIP_ROWS } from './RankStrip';
import { SiteDrawer } from './SiteDrawer';
import { Spotlight } from './Spotlight';
import { useEntrance } from './useEntrance';

export function MissionHud() {
  const { focus } = useData();
  const drawerOpen = useStore(appStore, (s) => s.drawerOpen);
  const flight = useStore(appStore, (s) => s.flight);
  const isPhone = useIsPhone();
  const rootRef = useRef<HTMLDivElement>(null);
  const wingRef = useRef<HTMLDivElement>(null);
  const stripRows = useStripRows(wingRef);
  const tagName = focus ? (focus.name.length > 28 ? `${focus.name.slice(0, 27)}…` : focus.name) : null;
  useMissionFrame(rootRef, wingRef, !isPhone, drawerOpen, tagName);
  const frame = useStore(missionFrame, (s) => s);
  const placement = placeInFrame(frame, frame.width, frame.height, focus?.lat ?? null);
  useEntrance(rootRef, true, 0.3);
  // While the camera dives to the site, the HUD steps back.
  const leaving = flight === 'in';

  return (
    <div
      ref={rootRef}
      className="absolute inset-0 transition-opacity duration-200"
      style={{ opacity: leaving ? 0 : 1, pointerEvents: leaving ? 'none' : undefined, ...(frame.measured ? ({ '--scene-top': `${frame.top}px` } as CSSProperties) : null) }}
      inert={leaving}
      data-testid="mission-hud"
    >
      <h2 className="sr-only">Mission select</h2>
      {tagName && !isPhone ? <AnchorTag anchor="site" label={tagName} tone="cyan" toward={placement.toward} gap={MISSION_VIEW.tagGap} /> : null}

      {/* Left wing: the spotlight, and the short ranked strip under it. */}
      <div className="hud-layer" data-depth="0.9">
        <div ref={wingRef} className="wing-l absolute left-5 top-[4.75rem] flex w-[25rem] flex-col gap-3.5 short:gap-2.5 max-md:hidden" data-enter="left">
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
          className="btn btn-glass absolute right-5 top-[4.75rem] max-lg:top-[13.5rem] max-md:hidden"
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

/** The left column ends level with the assistant: this far above the bottom of the window. */
const COLUMN_BOTTOM_PX = 20;

/**
 * How many rows the ranked strip shows: five, or as many as fit under the spotlight in a shorter
 * window (never fewer than two). Measured from the real panels, so it holds whatever the fonts,
 * the zoom level or the spotlight's content do to their heights.
 */
function useStripRows(wingRef: RefObject<HTMLDivElement | null>): number {
  const [rows, setRows] = useState(STRIP_ROWS);
  useLayoutEffect(() => {
    const wing = wingRef.current;
    if (!wing) return;
    const measure = () => {
      const strip = wing.querySelector<HTMLElement>('[data-testid="rank-strip"]');
      const list = strip?.querySelector<HTMLElement>('[role="listbox"]');
      const row = list?.querySelector<HTMLElement>('[role="option"]');
      // Nothing to measure while the column is not laid out (it is hidden at phone widths).
      if (!strip || !list || !row || row.offsetHeight === 0) return;
      // Layout sizes (offset*), so the entrance and the parallax, which only transform, do not count.
      const chrome = strip.offsetHeight - list.offsetHeight;
      const gap = parseFloat(getComputedStyle(list).rowGap) || 0;
      const room = window.innerHeight - COLUMN_BOTTOM_PX - (wing.offsetTop + strip.offsetTop) - chrome;
      setRows(Math.min(STRIP_ROWS, Math.max(2, Math.floor((room + gap) / (row.offsetHeight + gap)))));
    };
    measure();
    // The wing changes size when the strip arrives and when the spotlight changes height.
    const observer = new ResizeObserver(measure);
    observer.observe(wing);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [wingRef]);
  return rows;
}

/**
 * Measures what the panels leave of the window and writes it to `missionFrame` for the scene:
 * right of the spotlight column, below the mission bar, above the assistant and left of the drawer
 * when it is open. With the assistant's history open, the most it can grow to is set aside at
 * once, so the picture moves when the history opens and not again with every answer.
 */
function useMissionFrame(rootRef: RefObject<HTMLDivElement | null>, wingRef: RefObject<HTMLDivElement | null>, enabled: boolean, drawerOpen: boolean, tagName: string | null): void {
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || !enabled) {
      missionFrame.set({ measured: false });
      return;
    }
    const part = (testId: string) => root.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
    const measure = () => {
      const width = root.offsetWidth;
      const height = root.offsetHeight;
      const wing = wingRef.current;
      const bar = part('mission-bar');
      const dock = part('assistant');
      const drawer = part('site-drawer');
      const tag = root.querySelector<HTMLElement>('[data-marker="site"] [data-marker-tag]');
      let bottom = height;
      if (dock) {
        const box = layoutBox(dock, root);
        bottom = box.top;
        const history = dock.querySelector<HTMLElement>('[data-testid="chat-panel"]');
        if (history && !history.hidden) {
          const most = parseFloat(getComputedStyle(history).maxHeight);
          if (Number.isFinite(most)) bottom = Math.min(bottom, box.bottom - (dock.offsetHeight - history.offsetHeight) - most);
        }
      }
      missionFrame.set({
        measured: true,
        width,
        height,
        left: wing ? layoutBox(wing, root).right : 0,
        top: bar ? layoutBox(bar, root).bottom : 0,
        right: drawerOpen && drawer ? layoutBox(drawer, root).left : width,
        bottom,
        tagWidth: tag ? tag.offsetWidth : 0,
      });
    };
    measure();
    // Sizes change when the window does, when the bar's lines wrap, when the history opens and when the tag's font arrives.
    const observer = new ResizeObserver(measure);
    for (const el of [root, wingRef.current, part('mission-bar'), part('assistant'), root.querySelector('[data-marker="site"] [data-marker-tag]')]) if (el) observer.observe(el);
    return () => observer.disconnect();
  }, [rootRef, wingRef, enabled, drawerOpen, tagName]);
  // Leaving mission select: the scene goes back to its usual picture.
  useEffect(() => () => missionFrame.set({ measured: false }), []);
}
