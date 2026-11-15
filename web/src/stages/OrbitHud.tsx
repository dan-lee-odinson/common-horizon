// Stage 1, ORBIT: the HUD around the Moon and its ring system.
//
// Four glass panels float on two wings, tilted toward the viewer: the Sun, the mission clock and
// the launch on the right, Earth's panel at the lower left, under the corner of sky that Earth's
// limb fills. The middle of the screen is kept for the scene: the Sun's tick on its ring, Earth's
// limb, their tags, the lines of sunlight and the glow at the frame's edge never pass behind a panel. Every readout is a Quantity from the data layer, rewritten once per
// frame as the previewed time runs: the calculations are seen running.

import { useId, useMemo, useRef, useState } from 'react';
import { actions, appStore, orbitClock } from '../state/app';
import { useData } from '../state/data';
import { useStore } from '../state/store';
import { useIsPhone } from '../state/useMedia';
import { Glass } from '../hud/Glass';
import { Leaders, type LeaderSpec } from '../hud/Leaders';
import { LineGraph } from '../hud/LineGraph';
import { Readout, ReadoutRow, useLiveQuantities } from '../hud/Readout';
import { Icon } from '../components/Icon';
import { EARTH_LINK_TONE, EARTH_LINK_WORD, fixed, missionDates, skyQuantities, swingQuantities } from '../util/quantities';
import { SOUTH_POLE_SEASON_NOTE } from '../util/season';
import { HOUR_MS, LTC_MICROSECONDS_PER_DAY, SYNODIC_MONTH_DAYS } from '../util/time';
import { AnchorTag } from './AnchorTag';
import { earthSurface } from '../scene/orbitEarth';
import { isTurned, orbitSun, orbitTurn } from '../scene/orbitTurn';
import { orbitEarthSide } from '../scene/orbitView';
import { PREVIEW_HOURS_PER_SECOND } from './Playback';
import { SunlightField } from './SunlightField';
import { useEntrance } from './useEntrance';
/** The line under the controls: what the picture shows, and what it does not. (Phones get the same facts in fewer words.) */
export const ORBIT_CAPTION = 'The Sun is at its true direction and true apparent size. Earth is at true size but drawn much nearer than it is. Drag, or use the arrow keys, to turn the view.';
export const ORBIT_CAPTION_PHONE = 'Sun: true direction and true apparent size. Earth: true size, drawn much nearer than it is. Drag to turn the view.';
export const EARTH_MAP_NOTE = 'Earth’s surface is NASA’s Blue Marble map (R. Stöckli, NASA Earth Observatory); it turns once a day, and which face points at the Moon is not computed.';
export const EARTH_MAP_NOTE_PHONE = 'Earth: NASA Blue Marble map (R. Stöckli, NASA); it turns once a day; which face points at the Moon is not computed.';
export const EARTH_DRAWN_NOTE = 'Earth’s surface pattern is an illustration, not a map; it turns once a day, and which face points at the Moon is not computed.';

export function OrbitHud({ revealed, webgl = true }: { revealed: boolean; webgl?: boolean }) {
  const { track, orbitHorizon, reference, landingMs, orbitEndMs, windowEndMs, landingGeometry, rows } = useData();
  const launchUtcMs = useStore(appStore, (s) => s.launchUtcMs);
  const slipDays = useStore(appStore, (s) => s.slipDays);
  const playing = useStore(appStore, (s) => s.previewPlaying);
  const zoomedOut = useStore(appStore, (s) => s.orbitZoom > 0.5);
  const moonSurface = useStore(appStore, (s) => s.moonSurface);
  const earthMap = useStore(earthSurface, (s) => s.surface);
  // The view the visitor has turned by hand, and what hides the Sun's disc there (see scene/orbitTurn.ts).
  const turned = useStore(orbitTurn, isTurned);
  const sunHiddenBy = useStore(orbitSun, (s) => s.hiddenBy);
  const isPhone = useIsPhone();
  // Earth stands on one side of the Moon (see scene/orbitView.ts); the panels arrange around it.
  const earthSide = orbitEarthSide(landingGeometry);
  const leaders = useMemo<LeaderSpec[]>(
    () => [
      { anchor: 'sun', to: '[data-leader-target="sun"]', color: 'var(--ch-sun)', side: earthSide === 'right' ? 'left' : 'right' },
      // Earth's line runs to its panel only while Earth is on the panel's side of the Moon (with the view turned it may not be).
      { anchor: 'earthLimb', to: '[data-leader-target="earth"]', color: 'var(--ch-earth)', edge: 'top', side: earthSide },
    ],
    [earthSide],
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const scrubRef = useRef<HTMLInputElement>(null);
  const [seasonOpen, setSeasonOpen] = useState(false);
  const seasonId = useId();
  const scrubId = useId();

  const site = reference ? { id: reference.id, name: reference.name, lat: reference.lat, lon_east: reference.lon_east } : null;
  const now = () => orbitClock.get().nowMs ?? landingMs ?? Number.NaN;
  const compute = () => skyQuantities({ track: track.data, tMs: now(), landingMs, site, horizon: orbitHorizon.data });
  const sky = compute();
  const windowHours = landingMs !== null && orbitEndMs !== null ? Math.floor((orbitEndMs - landingMs) / HOUR_MS) : 0;
  useLiveQuantities(
    rootRef,
    () => {
      // The scrubber follows the running clock (unless the visitor is holding it).
      const scrub = scrubRef.current;
      if (scrub && landingMs !== null && document.activeElement !== scrub) {
        const hours = String(Math.round((now() - landingMs) / HOUR_MS));
        if (scrub.value !== hours) scrub.value = hours;
      }
      return compute();
    },
    revealed,
  );
  useEntrance(rootRef, revealed);

  const dates = missionDates(launchUtcMs, slipDays, landingMs, landingGeometry);
  const swing = swingQuantities(track.data, landingMs, windowEndMs);
  const row = reference ? rows.find((r) => r.siteId === reference.id) : undefined;

  // The Sun's elevation at the reference site across the window: a real series from the horizon answer.
  const elevation = useMemo(() => (orbitHorizon.data ? orbitHorizon.data.sun_path.map((p) => ({ x: Date.parse(p.t), y: p.el })) : []), [orbitHorizon.data]);
  const waiting = track.status === 'waiting' && !track.data;
  const failed = track.status === 'error';

  return (
    <div ref={rootRef} className="absolute inset-0" data-testid="orbit-hud" style={{ visibility: revealed ? 'visible' : 'hidden' }}>
      {/* The Sun's light: under everything else in the HUD, and cut clear of the panels and the controls. */}
      {webgl ? <SunlightField root={rootRef} active={revealed} isPhone={isPhone} /> : null}
      <Leaders items={leaders} active={revealed && !isPhone} />
      <AnchorTag anchor="sun" label="Sun overhead" tone="sun" q={sky.subsolarLon} />
      {/* The Sun's own disc, when the view is turned far enough to bring it into the picture. */}
      <AnchorTag anchor="sunDisc" label={sunHiddenBy === 'moon' ? 'Sun (behind the Moon)' : sunHiddenBy === 'earth' ? 'Sun (behind the Earth)' : 'Sun'} tone="sun" gap={10} />
      <AnchorTag anchor="earthLimb" label="Earth" tone="earth" toward="moon" gap={12} q={sky.subearthLon} />
      <AnchorTag anchor="lon0" label="0°" tone="muted" plain />
      <AnchorTag anchor="lon90" label="90° E" tone="muted" plain />
      <AnchorTag anchor="lon180" label="180°" tone="muted" plain />
      <AnchorTag anchor="lon270" label="270° E" tone="muted" plain />

      <h2 className="sr-only">Orbit: the Moon with the Sun and Earth</h2>

      {/* The tall wing, on the side away from Earth: the Sun, the mission clock and the launch. */}
      <div className="hud-layer" data-depth="0.9">
        <div
          className={`absolute top-[4.75rem] flex w-[18rem] flex-col gap-3.5 max-md:left-3 max-md:right-auto max-md:top-[4.25rem] max-md:w-[calc(50%-1.125rem)] ${earthSide === 'right' ? 'wing-l left-5' : 'wing-r right-5'}`}
          data-enter={earthSide === 'right' ? 'left' : 'right'}
          data-wing="sun"
        >
          <Glass as="section" tone="sun" className="flex flex-col gap-3 p-4 max-md:gap-2 max-md:p-3" aria-label="Sun" data-leader-target="sun" data-panel>
            <header className="flex items-center gap-2">
              <span className="size-2 rounded-full bg-sun" style={{ boxShadow: '0 0 12px var(--ch-sun-glow)' }} aria-hidden />
              <h3 className="panel-title m-0">Sun</h3>
            </header>
            <div className="grid grid-cols-2 gap-x-3 gap-y-3 max-md:grid-cols-1 max-md:gap-y-2">
              <Readout q={sky.subsolarLat} size={isPhone ? 'sm' : 'md'} />
              <Readout q={sky.subsolarLon} size={isPhone ? 'sm' : 'md'} />
            </div>
            <div className="hairline max-md:hidden" />
            <p className="m-0 truncate text-[13px] text-ink-2 max-md:hidden" title={reference?.name}>
              Seen from {reference?.name ?? 'the site'}
            </p>
            <div className="grid grid-cols-2 gap-x-3 gap-y-3 max-md:hidden">
              <Readout q={sky.sunAz} />
              <Readout q={sky.sunEl} />
              <Readout q={sky.sunState} />
              <Readout q={sky.nextChange} />
            </div>
            {/* The graph gives way first when the window is short. */}
            <div className="max-md:hidden [@media(max-height:859px)]:hidden">
              <p className="label m-0 mb-1.5">Sun elevation here, lunar day</p>
              <LineGraph
                label={`Sun elevation at ${reference?.name ?? 'the site'} over one lunar day`}
                points={elevation}
                xDomain={landingMs !== null && orbitEndMs !== null ? [landingMs, orbitEndMs] : undefined}
                level={0}
                formatY={(y) => `${y > 0 ? '+' : ''}${fixed(y, 1)}°`}
                xLabels={['landing', `+${SYNODIC_MONTH_DAYS.toFixed(1)} d`]}
                getCursor={now}
                color="var(--ch-sun)"
                height={48}
              />
            </div>
          </Glass>

          <Glass as="section" className="flex flex-col gap-2 p-4 max-md:hidden" aria-label="Mission clock" data-panel>
            <h3 className="panel-title m-0">Mission clock</h3>
            <Readout q={sky.utcClock} />
            <div className="grid grid-cols-[auto_1fr] gap-x-4">
              <Readout q={sky.ltcClock} size="sm" />
              <Readout q={sky.ltcOffset} size="sm" />
            </div>
            <ReadoutRow q={sky.sinceLanding} />
            <p className="m-0 text-[13px] leading-snug text-ink-2 [@media(max-height:859px)]:hidden">
              LTC is a model value: UTC plus {LTC_MICROSECONDS_PER_DAY} µs a day, counted from the landing.
            </p>
          </Glass>

          <Glass as="section" className="flex flex-col gap-2 p-4 max-md:hidden" aria-label="Launch" data-panel>
            <h3 className="panel-title m-0">Launch</h3>
            <div className="flex flex-col gap-1.5">
              <ReadoutRow q={dates.plannedLaunch} />
              <ReadoutRow q={dates.delay} />
              <ReadoutRow q={dates.landing} />
            </div>
            <div className="relative">
              <button
                type="button"
                className="flex min-h-9 w-full items-center justify-between gap-3 rounded-[3px] border-t border-line pt-1 text-left"
                aria-expanded={seasonOpen}
                aria-controls={seasonId}
                onClick={() => setSeasonOpen((o) => !o)}
                onMouseEnter={() => setSeasonOpen(true)}
                onMouseLeave={() => setSeasonOpen(false)}
                onBlur={() => setSeasonOpen(false)}
                data-testid="season"
                data-season={dates.season ?? ''}
              >
                <span className="font-display text-[14px] font-semibold tracking-[0.04em]">
                  Lunar south pole: <span data-tone={dates.seasonLine.tone}>{dates.seasonLine.text}</span>
                </span>
                <span className="text-muted">
                  <Icon name="info" size={16} />
                </span>
              </button>
              {/* The note opens upward, over the rows above it. */}
              <p
                id={seasonId}
                role="note"
                hidden={!seasonOpen}
                className="glass glass-strong absolute inset-x-0 bottom-full z-10 m-0 mb-1 px-3 py-2 text-[13px] leading-snug text-ink"
                data-testid="season-note"
              >
                {SOUTH_POLE_SEASON_NOTE}
              </p>
            </div>
          </Glass>
        </div>
      </div>

      {/* Earth's wing, low on Earth's side: the sky above it is where Earth stands. */}
      <div className="hud-layer" data-depth="0.9">
        <div
          className={`absolute bottom-5 flex w-[18rem] flex-col max-md:bottom-auto max-md:left-auto max-md:right-3 max-md:top-[4.25rem] max-md:w-[calc(50%-1.125rem)] ${earthSide === 'right' ? 'wing-r right-5' : 'wing-l left-5'}`}
          data-enter={earthSide === 'right' ? 'right' : 'left'}
          data-wing="earth"
        >
          <Glass as="section" tone="earth" className="flex flex-col gap-2.5 p-4 max-md:gap-2 max-md:p-3" aria-label="Earth" data-leader-target="earth" data-panel>
            <header className="flex items-center gap-2">
              <span className="size-2 rounded-full bg-earth" style={{ boxShadow: '0 0 12px var(--ch-earth-glow)' }} aria-hidden />
              <h3 className="panel-title m-0">Earth</h3>
            </header>
            <div className="grid grid-cols-2 gap-x-3 gap-y-3 max-md:grid-cols-1 max-md:gap-y-2">
              <Readout q={sky.subearthLat} size={isPhone ? 'sm' : 'md'} />
              <Readout q={sky.subearthLon} size={isPhone ? 'sm' : 'md'} />
            </div>
            <div className="flex flex-col gap-1.5 max-md:hidden [@media(max-height:799px)]:hidden">
              <ReadoutRow q={swing.lon} />
              <ReadoutRow q={swing.lat} />
            </div>
            <p className="m-0 truncate border-t border-line pt-2 text-[13px] text-ink-2 max-md:hidden" title={reference?.name}>
              Seen from {reference?.name ?? 'the site'}
            </p>
            <div className="flex flex-col gap-1.5 max-md:hidden">
              <ReadoutRow q={sky.earthAz} />
              <ReadoutRow q={sky.earthEl} />
              {row ? (
                <div className="flex items-baseline justify-between gap-4">
                  <span className="label">Earth link, stay</span>
                  <span className="readout-value" data-size="sm" data-tone={EARTH_LINK_TONE[row.evaluation.earth_link]}>
                    {EARTH_LINK_WORD[row.evaluation.earth_link]}
                  </span>
                </div>
              ) : null}
              <ReadoutRow q={sky.discLit} />
            </div>
          </Glass>
        </div>
      </div>

      {/* The one clear action, with the preview controls beside it. */}
      <div className="hud-layer" data-depth="0.5">
        {/* The row spans the screen only to centre its content: presses beside it go to what is behind. */}
        <div className="pointer-events-none absolute inset-x-0 bottom-5 flex justify-center px-4 max-md:bottom-4">
        <div className="pointer-events-auto relative flex w-fit max-w-full flex-col items-center gap-2.5" data-enter="lead" data-keep-clear>
          {/* Shown only while the view is turned. It floats above the controls, so nothing below it moves when it comes and goes. */}
          {webgl ? (
            <div
              className="absolute bottom-full left-1/2 mb-3"
              style={{
                visibility: turned ? 'visible' : 'hidden',
                opacity: turned ? 1 : 0,
                transform: `translateX(-50%) scale(${turned ? 1 : 0.96})`,
                // In a little slower than out; "visibility" waits for the fade so the button is never pressable while unseen.
                transition: turned ? 'opacity 160ms var(--ease-out), transform 160ms var(--ease-out)' : 'opacity 120ms var(--ease-out), transform 120ms var(--ease-out), visibility 0s linear 120ms',
              }}
              data-keep-clear
            >
              <button
                type="button"
                className="btn"
                style={{ background: 'var(--ch-glass-strong)' }}
                onClick={() => orbitTurn.set({ lon: 0, lat: 0, via: 'reset' })}
                title="Return to the standard view. Drag the picture, or use the arrow keys, to turn it."
                data-testid="orbit-reset-view"
              >
                <Icon name="reset" size={14} />
                Reset view
              </button>
            </div>
          ) : null}
          {waiting ? (
            <p className="m-0 text-[13px] text-ink-2" role="status">
              Working out where the Sun and Earth are…
            </p>
          ) : null}
          {failed ? (
            <p className="glass m-0 flex items-center gap-3 px-3 py-2 text-[13px] text-ink-2" role="alert">
              <span>
                <span className="font-semibold" data-tone="bad">
                  Could not load the Sun and Earth positions.
                </span>{' '}
                {track.error}
              </span>
              <button type="button" className="btn" onClick={track.retry}>
                Try again
              </button>
            </p>
          ) : null}
          <div className="flex w-[min(26rem,100%)] items-center gap-3">
            <label htmlFor={scrubId} className="label shrink-0">
              Preview
            </label>
            <input
              ref={scrubRef}
              id={scrubId}
              type="range"
              className="scrub min-w-0 flex-1"
              min={0}
              max={Math.max(1, windowHours)}
              step={1}
              defaultValue={0}
              disabled={landingMs === null}
              aria-valuetext={sky.sinceLanding.text === '—' ? 'no data yet' : `${sky.sinceLanding.text} after landing`}
              onChange={(e) => {
                if (landingMs === null) return;
                actions.setPreviewPlaying(false);
                orbitClock.set({ nowMs: landingMs + Number(e.target.value) * HOUR_MS });
              }}
              data-testid="preview-scrub"
            />
            <span className="num shrink-0 text-[12px] text-muted">+{SYNODIC_MONTH_DAYS.toFixed(1)} d</span>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              className="btn"
              onClick={() => actions.setPreviewPlaying(!playing)}
              aria-pressed={playing}
              title={`Time runs ${PREVIEW_HOURS_PER_SECOND} hours each second, from the landing through one lunar day. It does not change the launch date.`}
              data-testid="preview-toggle"
            >
              <Icon name={playing ? 'pause' : 'play'} size={14} />
              {playing ? 'Pause preview' : 'Play preview'}
            </button>
            {/* The zoom belongs to the 3D picture; the flat stand-in has no Earth to zoom out to. */}
            <button
              type="button"
              className="btn"
              hidden={!webgl}
              onClick={() => actions.setOrbitZoom(zoomedOut ? 0 : 1)}
              aria-pressed={zoomedOut}
              title="Zoom out until the whole Earth is in view, or back to the Moon. The mouse wheel zooms too."
              data-testid="orbit-zoom"
            >
              <Icon name="target" size={14} />
              {zoomedOut ? 'Back to the Moon' : 'Show whole Earth'}
            </button>
            <button type="button" className="btn btn-primary btn-lg" onClick={actions.enterMission} data-testid="enter-mission">
              Enter mission select
              <Icon name="right" size={16} />
            </button>
          </div>
          <p className="m-0 max-w-[40rem] text-balance text-center text-[13px] leading-snug text-ink-2 max-md:text-[12px] max-md:leading-[1.3]" data-testid="not-to-scale">
            {!webgl ? 'This flat picture stands in where 3D is not available: Earth is not drawn, and the Sun’s mark shows a direction only.' : isPhone ? ORBIT_CAPTION_PHONE : ORBIT_CAPTION}{' '}
            <span data-testid="moon-surface-note" data-surface={moonSurface}>
              {moonSurface === 'map' ? 'The Moon’s surface is NASA’s CGI Moon Kit color map, made for visual use.' : 'The Moon’s surface pattern is an illustration, not a map.'}
            </span>
            {webgl ? (
              <>
                {' '}
                <span data-testid="earth-surface-note" data-surface={earthMap}>
                  {earthMap !== 'map' ? EARTH_DRAWN_NOTE : isPhone ? EARTH_MAP_NOTE_PHONE : EARTH_MAP_NOTE}
                </span>
              </>
            ) : null}
          </p>
        </div>
        </div>
      </div>
    </div>
  );
}
