// Stage 3, SITE: the instrument around the site's terrain.
//
// Time runs through the stay here. A strip across the top names the site; two wings read the sky
// (the Sun and its shadows on the left, Earth and the hardware on the right); a console along the
// bottom holds the horizon plot directly above the stay timeline, which is the scrubber, with the
// mission clock, play, pause and the speed beside it. On a phone the same parts become a status card, a dock along
// the bottom and a sheet that rises above the dock.
//
// The site itself is drawn in the app's one 3D canvas, behind this HUD (src/scene/SiteWorld.tsx).
// One function gives the sky at the instant shown (util/quantities.ts: liveSiteQuantities, over
// skyAt), and every part reads it: the readouts, the plot's Sun dot, the timeline's state and the
// scene. So the picture and the numbers cannot disagree. Nothing here re-renders while time runs: the readouts
// are rewritten in place once per frame, and only when the instant has changed.

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { SiteRef } from '../api/types';
import { AsyncView } from '../components/AsyncView';
import { Icon } from '../components/Icon';
import { Drawer } from '../hud/Drawer';
import { Glass } from '../hud/Glass';
import { HorizonPanel, SkyLegend, type SunMark } from '../hud/HorizonPanel';
import { layoutBox } from '../hud/layoutBox';
import { Leaders, type LeaderSpec } from '../hud/Leaders';
import { patchQuantities, Readout } from '../hud/Readout';
import { StayTimeline, type StayState } from '../hud/StayTimeline';
import { Transport } from '../hud/Transport';
import { useTicker } from '../hud/useTicker';
import { hideAnchors } from '../scene/anchors';
import { lookAtBody, lookAtLander, siteFrame, SITE_VIEW } from '../scene/siteView';
import { actions, appStore, simClock, SPEEDS } from '../state/app';
import { slopeContext, useData } from '../state/data';
import { modelShapes, primaryLanderId, useModelMetas } from '../state/models';
import { createStore, useStore } from '../state/store';
import { useIsPhone, useShortWindow } from '../state/useMedia';
import { litPeriods } from '../util/horizon';
import {
  DASH,
  groundRingQuantities,
  hardwareQuantities,
  horizonAxisQuantities,
  liveSiteQuantities,
  missionDates,
  siteQuantities,
  siteStageQuantities,
  speedQuantities,
  stayPeriodQuantities,
  stayTickQuantities,
  type SiteLiveQuantities,
} from '../util/quantities';
import { BAND_BREAK_DEG, LINEAR_MAX_DEG } from '../util/horizonPlot';
import { naturalElRange } from '../util/horizon';
import { clipPeriods, dayTicks } from '../util/stay';
import { AnchorTag } from './AnchorTag';
import { ClockPanel, EarthPanel, HardwarePanel, Inline, SunPanel } from './SitePanels';
import { useEntrance } from './useEntrance';
import { SiteChecks } from './SiteChecks';
import { GroundNote, GroundPanel } from './GroundNote';
import { TERRAIN_NOT_INCLUDED, terrainNotIncluded } from '../util/terrain';

const LEADERS: LeaderSpec[] = [
  { anchor: 'sun', to: '[data-leader-target="sun"]', color: 'var(--ch-sun)' },
  { anchor: 'earth', to: '[data-leader-target="earth"]', color: 'var(--ch-earth)' },
];

/** Which change of light lies ahead of the instant shown. Written when it differs, so the jump control can say which. */
const nextChangeAhead = createStore<{ kind: 'sunrise' | 'sunset' | null }>({ kind: null });
/** A jump lands this far past the change, so the new state is the one showing. */
const JUMP_PAST_MS = 60_000;

/** What of the hardware in the picture is true and what is an illustration. (Without 3D there is no picture: only what the heights are.) */
const HARDWARE_NOTE = 'Drawn at true scale from its models. Where each piece stands is an illustration. An item with no model stands as a plain labelled marker.';
const HARDWARE_NOTE_FLAT = 'Heights are those of the hardware models, in their descriptions’ own words.';

export function SiteHud({ webgl }: { webgl: boolean }) {
  const d = useData();
  const { focus, focusRow, focusCheck, horizon, track, catalog, hardwareChosen, landingMs, plannedLandingMs, windowStartMs, windowEndMs, landingGeometry } = d;
  const playing = useStore(appStore, (s) => s.playing);
  const speed = useStore(appStore, (s) => s.speed);
  const stayDays = useStore(appStore, (s) => s.stayDays);
  const slipDays = useStore(appStore, (s) => s.slipDays);
  const launchUtcMs = useStore(appStore, (s) => s.launchUtcMs);
  const sheetOpen = useStore(appStore, (s) => s.horizonOpen);
  const isPhone = useIsPhone();
  const short = useShortWindow();
  const rootRef = useRef<HTMLDivElement>(null);
  // In a short window the Data checks band would take too much of the picture: it is shown on request.
  const [checksShown, setChecksShown] = useState(false);
  const checksButton = useRef<HTMLButtonElement>(null);
  const checksId = useId();
  const band = !short || checksShown;
  const hideChecks = () => {
    setChecksShown(false);
    checksButton.current?.focus();
  };

  const site = useMemo<SiteRef | null>(() => (focus ? { id: focus.id, name: focus.name, lat: focus.lat, lon_east: focus.lon_east } : null), [focus]);
  // The answer on hand can still be the previous site's while the new one loads: it is not this site's sky.
  const horizonData = horizon.data && site && horizon.data.site_id === site.id ? horizon.data : null;
  const trackData = track.data;

  // The hardware, and the lander that stands at the landing point (its height gives the shadow figure).
  const chosenIds = useMemo(() => hardwareChosen.map((h) => h.id), [hardwareChosen]);
  const models = useModelMetas(chosenIds);
  // Whether each item's shape is in the 3D picture: the hardware list says so when one is not.
  const shapes = useStore(modelShapes, (s) => s);
  const catalogItems = catalog.data?.items;
  const landerId = primaryLanderId(chosenIds);
  const landerName = landerId ? (catalogItems?.find((c) => c.id === landerId)?.name ?? landerId) : null;
  const landerHeight = landerId ? (models[landerId]?.dimensions.height ?? null) : null;

  // The sky at the instant shown. Worked out once for each instant and shared by every reader.
  const readLive = useMemo(() => {
    let at = Number.NaN;
    let last: SiteLiveQuantities | null = null;
    return (tMs: number): SiteLiveQuantities => {
      if (last === null || !Object.is(tMs, at)) {
        at = tMs;
        last = liveSiteQuantities({ track: trackData, tMs, landingMs, site, horizon: horizonData, lander: landerName === null ? null : { name: landerName, heightM: landerHeight } });
      }
      return last;
    };
  }, [trackData, landingMs, site, horizonData, landerName, landerHeight]);
  const now = () => simClock.get().nowMs ?? landingMs ?? Number.NaN;
  const live = () => readLive(now());

  // Once per frame: when the instant (or the data) has changed, rewrite the readouts in place.
  const patched = useRef<SiteLiveQuantities | null>(null);
  useTicker(() => {
    const root = rootRef.current;
    if (!root) return;
    const q = live();
    if (q === patched.current) return;
    patched.current = q;
    patchQuantities(root, q);
    const lit = litWord(q);
    if (root.dataset.lit !== lit) root.dataset.lit = lit;
    const phase = q.beforeLanding ? 'before-landing' : 'stay';
    if (root.dataset.phase !== phase) root.dataset.phase = phase;
    // Which change lies ahead (it differs only a few times in a stay): the jump control follows it.
    nextChangeAhead.set({ kind: q.sky.change?.kind ?? null });
  });
  const nextKind = useStore(nextChangeAhead, (s) => s.kind);

  useEntrance(rootRef, true, 0.35);
  useSiteFrame(rootRef, isPhone);
  // The Moon stages' markers are not part of this stage's picture.
  useEffect(() => {
    hideAnchors();
    return () => hideAnchors('sun', 'earth', 'lander');
  }, []);

  const q = live();
  const fixed = siteStageQuantities({ site, landingMs, plannedLandingMs, stayEndMs: windowEndMs, stayDays, evaluation: focusRow?.evaluation ?? null, check: focusCheck });
  const result = siteQuantities(focusRow?.rank ?? null, focusRow?.evaluation ?? null, focusCheck, slopeContext(focus, d.landerSlopeLimitDeg));
  const dates = missionDates(launchUtcMs, slipDays, landingMs, landingGeometry);
  const hardware = hardwareQuantities(hardwareChosen, catalogItems ?? [], models);
  const speeds = useMemo(() => speedQuantities(SPEEDS), []);
  const rings = useMemo(() => groundRingQuantities(SITE_VIEW.ringMinor, SITE_VIEW.ringMajor), []);

  // The scrub range: the planned landing (the landing itself with no delay) to the end of the stay.
  const ranged = landingMs !== null && windowStartMs !== null && windowEndMs !== null && windowEndMs > windowStartMs;
  const startMs = ranged ? Math.min(windowStartMs, landingMs) : 0;
  const endMs = ranged ? windowEndMs : 0;
  const periods = useMemo(() => (horizonData && ranged ? clipPeriods(litPeriods(horizonData), startMs, endMs) : []), [horizonData, ranged, startMs, endMs]);
  const ticks = useMemo(() => (ranged ? stayTickQuantities(dayTicks(startMs, endMs, landingMs)) : []), [ranged, startMs, endMs, landingMs]);
  const periodList = useMemo(() => stayPeriodQuantities(periods, landingMs), [periods, landingMs]);
  const ready = ranged && horizonData !== null;

  function scrubTo(ms: number) {
    actions.setPlaying(false);
    simClock.set({ nowMs: ms });
  }
  const togglePlay = () => actions.setPlaying(!appStore.get().playing);
  function restart() {
    actions.setPlaying(false);
    simClock.set({ nowMs: null });
  }
  /** To a minute past the next sunrise or sunset: the new state is showing, and the next press goes on to the one after. */
  function jumpToChange() {
    const at = live().sky.change?.atMs;
    if (at === undefined || !Number.isFinite(at) || !ranged) return;
    scrubTo(Math.min(endMs, at + JUMP_PAST_MS));
  }

  // What the plot's markers and the timeline read each frame. Each answer is kept for the instant.
  const marks = useMemo(() => {
    let from: SiteLiveQuantities | null = null;
    let sun: SunMark | null = null;
    return {
      sun: (): SunMark | null => {
        const l = live();
        if (l !== from) {
          from = l;
          sun = l.sky.sun ? { az: l.sky.sun.az, el: l.sky.sun.el, lit: l.sky.lit, azText: l.sunAz.text, elText: l.sunEl.text } : null;
        }
        return sun;
      },
      earth: () => live().sky.earth,
      state: (): StayState => litState(live()),
      nextChange: () => live().sky.change?.atMs ?? null,
      valueText: () => {
        const l = live();
        const state = l.sunState.text === DASH ? 'lit or dark not known' : l.sunState.text;
        return `${l.sinceLanding.text} from the landing, ${l.utcClock.text} ${l.utcClock.unit}, ${state}${l.beforeLanding ? ', before the landing' : ''}`;
      },
    };
    // `live` reads through `readLive`, which is made again whenever the data changes.
  }, [readLive]);

  const name = focus?.name ?? 'No site';
  const passTag = result.result === 'pass' ? 'tag tag-good' : result.result === 'fail' ? 'tag tag-bad' : result.result === 'unknown' ? 'tag tag-warn' : 'tag';
  const smooth = terrainNotIncluded(focusRow?.evaluation, horizonData);
  const terrainTag = smooth ? (
    <span className="tag min-h-9 shrink-0 bg-glass-strong px-2.5 normal-case tracking-[0.02em]" data-tone="warn" data-testid="site-terrain">
      {TERRAIN_NOT_INCLUDED}
    </span>
  ) : null;
  const checks = (layout: 'band' | 'bare', onHide?: () => void) => (
    <SiteChecks
      site={site}
      evaluation={focusRow?.evaluation ?? null}
      horizon={horizonData}
      check={d.horizonsCheck.data ?? null}
      moonTrek={d.moonTrekCheck.data ?? null}
      landingMs={landingMs}
      slope={result.slope}
      slopeNote={result.slopeNote}
      slopeDetail={result.slopeDetail}
      layout={layout}
      onHide={onHide}
    />
  );
  const plotLabel = `Horizon plot for ${name}: compass direction across, height above level upward. It shows the terrain skyline, the Sun’s path from ${slipDays > 0 ? 'the planned landing' : 'the landing'} to the end of the stay (solid where the Sun is above the skyline, dashed where the terrain hides it) and the part of the sky Earth moves through. The running figures are in the Sun and Earth panels.`;
  // The legend names the height where the plot's scale changes, when this site's plot has two bands.
  const scaleBreak = useMemo(() => {
    if (!horizonData || horizonData.skyline.length === 0) return null;
    const range = naturalElRange(horizonData);
    return range.max > LINEAR_MAX_DEG && range.min < BAND_BREAK_DEG ? horizonAxisQuantities([BAND_BREAK_DEG])[0] : null;
  }, [horizonData]);

  const plot = (height: number, variant: 'console' | 'hero', compassStep: 45 | 90) => (
    <AsyncView result={horizon} what="the horizon" waiting={<div className="skeleton w-full" style={{ height }} />} empty="No horizon data for this point.">
      {() =>
        ready ? (
          <HorizonPanel
            data={horizonData}
            fromMs={startMs}
            toMs={endMs}
            label={plotLabel}
            getSun={marks.sun}
            getEarth={marks.earth}
            variant={variant}
            height={height}
            compassStep={compassStep}
            testId="horizon-panel"
          />
        ) : (
          <div className="skeleton w-full" style={{ height }} role="status">
            <span className="sr-only">Loading the horizon…</span>
          </div>
        )
      }
    </AsyncView>
  );

  const timeline = (
    <StayTimeline
      periods={periods}
      startMs={startMs}
      endMs={endMs}
      landingMs={landingMs ?? 0}
      getNow={now}
      getState={marks.state}
      getValueText={marks.valueText}
      getNextChange={marks.nextChange}
      onScrub={scrubTo}
      onTogglePlay={togglePlay}
      ticks={ticks}
      periodList={periodList}
      stayLength={fixed.stayLength}
      flag={q.sinceLanding}
      delay={slipDays > 0 ? dates.delay : undefined}
      label="Time in the stay"
      disabled={!ready}
    />
  );

  const transport = (trailing?: ReactNode) => (
    <Transport
      playing={playing}
      speed={speed}
      speeds={speeds}
      onTogglePlay={togglePlay}
      onRestart={restart}
      onSpeed={actions.setSpeed}
      onJump={jumpToChange}
      nextChange={ready ? nextKind : null}
      trailing={trailing}
      disabled={!ranged}
    />
  );

  const beforeLanding = (
    <p className="tag tag-warn m-0 min-h-9 w-fit shrink-0 px-3 normal-case tracking-[0.04em]" data-testid="before-landing">
      <span className="uppercase tracking-[0.1em]" data-q={q.phase.key}>
        <span data-q-text>{q.phase.text}</span>
      </span>
      <span className="text-ink-2">
        landing in <Inline q={q.toLanding} className="text-ink" />
      </span>
    </p>
  );

  const sunPanel = (extra: { dense?: boolean; bare?: boolean } = {}) => (
    <SunPanel
      sunState={q.sunState}
      nextChange={q.nextChange}
      sunAz={q.sunAz}
      sunEl={q.sunEl}
      sunWidth={!webgl || isPhone ? fixed.sunWidth : undefined}
      shadowPerMetre={q.shadowPerMetre}
      shadowLander={q.shadowLander}
      shadowBearing={q.shadowBearing}
      sunlightPercent={result.sunlightPercent}
      sunlightHours={result.sunlightHours}
      longestDark={fixed.longestDark}
      onLook={webgl && !isPhone ? () => lookAtBody(live().sky.sun) : undefined}
      {...extra}
    />
  );
  const clockPanel = (extra: { dense?: boolean; bare?: boolean } = {}) => <ClockPanel utc={q.utcClock} ltc={q.ltcClock} ltcOffset={q.ltcOffset} sinceLanding={q.sinceLanding} stayEnd={fixed.stayEnd} {...extra} />;
  const earthPanel = (extra: { dense?: boolean; bare?: boolean } = {}) => (
    <EarthPanel
      earthAz={q.earthAz}
      earthEl={q.earthEl}
      earthWidth={q.earthWidth}
      earthLink={fixed.earthLink}
      clearSky={result.clearSky}
      onLook={webgl && !isPhone ? () => lookAtBody(live().sky.earth) : undefined}
      {...extra}
    />
  );
  const hardwarePanel = (extra: { bare?: boolean; className?: string } = {}) => <HardwarePanel rows={hardware} note={webgl ? HARDWARE_NOTE : HARDWARE_NOTE_FLAT} shapes={webgl ? shapes : undefined} {...extra} />;

  const trueSize = (
    <p className="m-0 text-[13px] leading-snug text-ink-2" data-testid="true-size">
      Sun <Inline q={fixed.sunWidth} /> and Earth <Inline q={q.earthWidth} /> wide: drawn at their true apparent size from this site, at mean distances. The skyline is from the data and has no distance. Lit means some part of the Sun's disc is above the skyline, so the disc can sit mostly behind a ridge while the site is lit. <GroundNote siteId={focus?.id ?? null} custom={Boolean(focus?.custom)} />{' '}
      <span data-testid="site-rings">
        Range rings every <Inline q={rings.minor} /> and <Inline q={rings.major} />.
      </span>
    </p>
  );

  const rootProps = {
    ref: rootRef,
    className: 'site-hud absolute inset-0',
    'data-testid': 'site-hud',
    'data-lit': litWord(q),
    'data-phase': q.beforeLanding ? 'before-landing' : 'stay',
    'data-layout': isPhone ? 'phone' : 'wide',
  } as const;

  if (isPhone) {
    return (
      <div {...rootProps}>
        <h2 className="sr-only">Site: {name}</h2>

        <div className="hud-layer">
          <div className="absolute left-3 right-3 top-[4.25rem] flex flex-col gap-2" data-enter="lead" data-site-zone="top">
            <div className="flex items-center gap-2">
              <button type="button" className="btn btn-glass btn-icon shrink-0" onClick={actions.backToMission} aria-label="Back to mission select" data-testid="back-to-mission">
                <Icon name="back" size={16} />
              </button>
              <span className="tag min-h-11 min-w-0 flex-1 bg-glass-strong px-3 text-[13px] text-ink">
                <span className="truncate" data-testid="scene-title">
                  {name}
                </span>
              </span>
              {result.verdict.text === DASH ? null : (
                <span className={`${passTag} min-h-11 shrink-0 px-2.5`} data-q={result.verdict.key} title={result.verdict.text}>
                  {result.verdictWord}
                </span>
              )}
            </div>
            {smooth ? <div className="flex">{terrainTag}</div> : null}
            <Glass as="section" tone="sun" className="grid grid-cols-2 gap-x-3 gap-y-2 p-3" aria-label="Sun, now" data-panel data-testid="site-status">
              <Readout q={q.sunState} />
              <Readout q={q.nextChange} size="sm" />
              <Readout q={q.sunAz} size="sm" />
              <Readout q={q.sunEl} size="sm" />
              <div className="site-before col-span-2">{beforeLanding}</div>
            </Glass>
          </div>
        </div>

        <Drawer open={sheetOpen} onClose={() => actions.setHorizonOpen(false)} title="Horizon and readouts" side="bottom" testId="site-sheet" className="site-sheet">
          <div className="flex min-h-0 flex-col gap-3 overflow-y-auto overscroll-contain px-4 py-3">
            {plot(180, 'console', 90)}
            <SkyLegend scaleBreak={scaleBreak} delayed={slipDays > 0} />
            {clockPanel({ bare: true })}
            {sunPanel({ bare: true })}
            {earthPanel({ bare: true })}
            {webgl ? <GroundPanel siteId={focus?.id ?? null} custom={Boolean(focus?.custom)} bare /> : null}
            {hardwarePanel({ bare: true })}
            {checks('bare')}
          </div>
        </Drawer>

        {/* Above the sheet, which stops where the dock begins. */}
        <div className="hud-layer z-[45]">
          <section className="site-dock glass glass-strong absolute inset-x-0 bottom-0 flex flex-col gap-2 rounded-b-none border-x-0 border-b-0 px-3 pt-2.5" aria-label="Time through the stay" data-enter="rise" data-site-zone="dock" data-panel data-testid="site-dock">
            {timeline}
            {transport(
              <button type="button" className="btn shrink-0 px-3" aria-expanded={sheetOpen} aria-controls="site-sheet" onClick={() => actions.setHorizonOpen(!sheetOpen)} data-testid="site-horizon-toggle">
                <Icon name="horizon" size={15} />
                Horizon
              </button>,
            )}
            {webgl ? (
              <p className="m-0 text-[12px] leading-snug text-ink-2" data-testid="true-size">
                Sun <Inline q={fixed.sunWidth} />, Earth <Inline q={q.earthWidth} />: true apparent size (mean distances). <GroundNote siteId={focus?.id ?? null} custom={Boolean(focus?.custom)} pointer />{' '}
                <span data-testid="site-rings">
                  Rings every <Inline q={rings.minor} /> and <Inline q={rings.major} />.
                </span>
              </p>
            ) : null}
          </section>
        </div>
      </div>
    );
  }

  const plotHeight = short ? 84 : 112;
  return (
    <div {...rootProps}>
      <h2 className="sr-only">Site: {name}</h2>
      {webgl ? (
        <>
          <Leaders items={LEADERS} />
          <AnchorTag anchor="sun" label="Sun" tone="sun" toward={freeCentre} gap={8} q={q.sunEl} />
          <AnchorTag anchor="earth" label="Earth" tone="earth" toward={freeCentre} gap={8} q={q.earthEl} />
        </>
      ) : null}

      {/* Across the top: the way back, and which site this is. */}
      <div className="hud-layer">
        <div className="absolute left-5 right-[22.5rem] top-[4.75rem] flex items-center gap-2 max-lg:right-[18.5rem]" data-enter="lead" data-site-zone="top">
          <button type="button" className="btn btn-glass shrink-0" onClick={actions.backToMission} aria-label="Back to mission select" data-testid="back-to-mission">
            <Icon name="back" size={14} />
            <span>
              <span className="max-[1379px]:hidden">Back to </span>mission select
            </span>
          </button>
          <span className="tag min-h-9 min-w-0 shrink bg-glass-strong px-3 text-[13px] text-ink">
            <span className="truncate" data-testid="scene-title">
              {name}
            </span>
          </span>
          {result.rank.text === DASH ? null : (
            <span className="tag min-h-9 shrink-0 bg-glass-strong px-2.5" data-q={result.rank.key} data-testid="site-rank">
              <span data-q-label>{result.rank.label}</span>
              <span className="num text-[13px] tracking-normal text-ink" data-q-text>
                {result.rank.text}
              </span>
            </span>
          )}
          {result.verdict.text === DASH ? null : (
            <span className={`${passTag} min-h-9 shrink-0 px-2.5`} data-q={result.verdict.key} title={result.slopeNote ?? undefined} data-testid="site-verdict">
              <span data-q-text>{result.verdict.text}</span>
            </span>
          )}
          <span className="num flex shrink-0 items-center gap-3 rounded-[3px] bg-glass-strong px-2.5 py-2 text-[13px] leading-none text-ink-2 max-xl:hidden" data-testid="site-coordinates">
            <Inline q={fixed.siteLat} />
            <Inline q={fixed.siteLon} />
          </span>
          {/* The way back after turning the view to the sky. */}
          {webgl ? (
            <button type="button" className="btn btn-glass shrink-0" onClick={lookAtLander} aria-label="Reset the view: back to the lander" title="Back to the view beside the lander" data-testid="reset-view">
              <Icon name="target" size={14} />
              {/* Room for the words only in a wide window: the site's name comes first. */}
              <span className="max-[1439px]:hidden">Reset view</span>
            </button>
          ) : null}
          {webgl && short ? (
            <button
              ref={checksButton}
              type="button"
              className="btn btn-glass shrink-0"
              aria-expanded={checksShown}
              aria-controls={checksShown ? checksId : undefined}
              onClick={() => setChecksShown((v) => !v)}
              data-testid="site-checks-show"
            >
              Data checks
            </button>
          ) : null}
        </div>
      </div>

      {/* Inside the launch delay, the stage says so where the scene begins: no hardware stands there yet. */}
      {webgl ? (
        <div className="hud-layer">
          {/* On its own over the scene, so it carries its own dark backing. */}
          <div className="site-before absolute left-[22.5rem] top-[8rem] rounded-[3px] bg-glass-strong max-lg:left-[18.5rem]">{beforeLanding}</div>
        </div>
      ) : null}

      {/* Left wing: the Sun now, the shadows it casts and its light over the stay. */}
      <div className="hud-layer">
        <div className="site-wing wing-l absolute left-5 top-[8rem] flex w-[20rem] flex-col gap-3 max-lg:w-[16rem]" data-enter="left" data-site-zone="left">
          {sunPanel()}
        </div>
      </div>

      {/* Right wing: Earth in this sky; the mission's hardware. */}
      <div className="hud-layer">
        <div className="site-wing site-wing-r wing-r absolute right-5 top-[4.75rem] flex w-[20rem] flex-col gap-3 max-lg:w-[16rem]" data-enter="right" data-site-zone="right">
          {earthPanel()}
          {webgl ? <GroundPanel siteId={focus?.id ?? null} custom={Boolean(focus?.custom)} className="shrink" /> : null}
          {hardwarePanel({ className: 'max-lg:hidden [@media(max-height:759px)]:hidden' })}
        </div>
      </div>

      {/* Without 3D the plot takes the scene's place, in the middle. */}
      {webgl ? null : (
        <div className="hud-layer">
          <Glass as="section" className="absolute left-[22.5rem] right-[22.5rem] top-[11.5rem] flex flex-col gap-3 p-4 max-lg:left-[18.5rem] max-lg:right-[18.5rem]" aria-label="Horizon" data-enter="fade" data-panel data-testid="site-flat">
            <div className="flex min-h-9 flex-wrap items-center justify-between gap-2">
              <h3 className="panel-title m-0">Horizon</h3>
              <div className="site-before">{beforeLanding}</div>
            </div>
            {plot(short ? 180 : 260, 'hero', 45)}
            <SkyLegend scaleBreak={scaleBreak} delayed={slipDays > 0} />
            {checks('bare')}
          </Glass>
        </div>
      )}

      {/* Data checks: a band between the wings, resting on the console. The 3D picture is framed above it. */}
      {webgl && band ? (
        <div className="hud-layer">
          <div
            id={checksId}
            className="absolute left-[22.5rem] right-[22.5rem] flex flex-col justify-end max-lg:left-[18.5rem] max-lg:right-[18.5rem]"
            style={{ bottom: 'calc(100% - var(--site-console-top, 100%) + 0.75rem)' }}
            data-enter="rise"
            data-site-zone="checks"
          >
            {checks('band', short ? hideChecks : undefined)}
          </div>
        </div>
      ) : null}

      {/* The console: sky and time. The plot sits directly above the timeline that scrubs it. */}
      <div className="hud-layer">
        <Glass as="section" strong className="absolute bottom-5 left-5 right-5 grid grid-cols-[24rem_minmax(0,1fr)] gap-x-5 px-4 py-3.5 short:py-3 max-[1439px]:grid-cols-[22.5rem_minmax(0,1fr)] max-lg:grid-cols-[17rem_minmax(0,1fr)]" aria-label="Sky and time" data-enter="rise" data-site-zone="console" data-panel data-testid="site-console">
          <div className="flex min-w-0 flex-col gap-2.5 short:gap-2">
            <h3 className="sr-only">Sky and time</h3>
            {clockPanel({ bare: true, dense: true })}
            {transport()}
            {webgl ? trueSize : null}
          </div>
          <div className="flex min-w-0 flex-col gap-1.5">
            {webgl ? (
              <>
                <SkyLegend scaleBreak={scaleBreak} delayed={slipDays > 0} />
                {plot(plotHeight, 'console', 45)}
              </>
            ) : null}
            {timeline}
          </div>
        </Glass>
      </div>
    </div>
  );
}

/** The middle of the part of the window the panels leave free: a body's tag sits on the side of the body that faces it. */
function freeCentre(): { x: number; y: number } {
  const f = siteFrame.get();
  return { x: (f.left + f.right) / 2, y: (f.top + f.bottom) / 2 };
}

/** The lit word for the stage's root attribute: "true", "false" or "unknown". */
function litWord(q: SiteLiveQuantities): 'true' | 'false' | 'unknown' {
  return q.sky.lit === null ? 'unknown' : q.sky.lit ? 'true' : 'false';
}

function litState(q: SiteLiveQuantities): StayState {
  return q.sky.lit === null ? 'unknown' : q.sky.lit ? 'lit' : 'dark';
}

/**
 * Measures what the panels leave of the window and writes it to `siteFrame` for the scene: right of
 * the left wing, left of the right wing, below the top strip and above the console (on a phone:
 * below the status card and above the dock). The console's top and the dock's height also go to
 * the page as lengths, so the wings and the phone sheet stop where the console and the dock begin.
 */
function useSiteFrame(rootRef: RefObject<HTMLDivElement | null>, isPhone: boolean): void {
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const zone = (name: string) => root.querySelector<HTMLElement>(`[data-site-zone="${name}"]`);
    const measure = () => {
      const width = root.offsetWidth;
      const height = root.offsetHeight;
      const top = zone('top');
      const left = zone('left');
      const right = zone('right');
      const base = zone(isPhone ? 'dock' : 'console');
      const baseTop = base ? layoutBox(base, root).top : height;
      // The Data checks band rests on the console between the wings: the picture is framed above it.
      const checks = isPhone ? null : zone('checks');
      const checksTop = checks && checks.offsetHeight > 0 ? layoutBox(checks, root).top : baseTop;
      siteFrame.set({
        measured: width > 0 && height > 0,
        width,
        height,
        left: left ? layoutBox(left, root).right : 0,
        right: right ? layoutBox(right, root).left : width,
        top: top ? layoutBox(top, root).bottom : 0,
        bottom: Math.min(baseTop, checksTop),
      });
      root.style.setProperty('--site-console-top', `${baseTop}px`);
      root.style.setProperty('--site-dock', `${Math.max(0, height - baseTop)}px`);
    };
    measure();
    // Sizes change with the window, when a panel's rows change and when the fonts arrive.
    const observer = new ResizeObserver(measure);
    for (const el of [root, zone('top'), zone('left'), zone('right'), zone('console'), zone('dock'), zone('checks')]) if (el) observer.observe(el);
    return () => observer.disconnect();
  }, [rootRef, isPhone]);
  // Leaving the stage: nothing is measured any more.
  useEffect(() => () => siteFrame.set({ measured: false }), []);
}
