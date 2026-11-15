// DATA HONESTY in the site stage: the horizon plot, the stay timeline, the play controls and the
// reading panels, rendered with data made the way the app makes it from the example (mock) model,
// show no number that their quantities do not account for. Missing data is a dash with no unit.
// And nothing in these parts is set smaller than 12 px.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it } from 'vitest';
import sitesJson from '../api/examples/sites.json';
import { configureMock } from '../api/mock';
import { evaluateSite, horizonFor, MOCK_CATALOG, TRANSIT_DAYS } from '../api/mock/model';
import type { HardwareChoice, SiteRef } from '../api/types';
import { SITE_VIEW } from '../scene/siteView';
import { SPEEDS } from '../state/app';
import { clearGeometryCache, loadTrack } from '../state/geometry';
import { ClockPanel, EarthPanel, HardwarePanel, Inline, SunPanel } from '../stages/SitePanels';
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
} from '../util/quantities';
import { clipPeriods, dayTicks } from '../util/stay';
import { DAY_MS, HOUR_MS } from '../util/time';
import type { GeometryTrack } from '../util/track';
import { HorizonPanel, horizonLayout, SkyLegend } from './HorizonPanel';
import { numbersIn, unaccountedNumbers, visibleText } from './honesty';
import { StayTimeline } from './StayTimeline';
import { Transport } from './Transport';

const LAUNCH = Date.UTC(2027, 1, 10, 15, 0, 0);
const STAY = 14;
const HARDWARE: HardwareChoice[] = [
  { id: 'hab', count: 1 },
  { id: 'rover', count: 1 },
  { id: 'solar', count: 4 },
  { id: 'starship', count: 1 },
];
/** The models' descriptions as the app reads them (name, status words, size). */
const MODELS = {
  hab: { status: 'NASA study', dimensions: { height: 7.8 } },
  rover: null,
  solar: { status: 'our estimate, to be replaced by a published figure', dimensions: { height: 10 } },
  starship: { status: 'NASA figure, secondary source', dimensions: { height: 52 } },
};
const site = (id: string) => (sitesJson.sites as SiteRef[]).find((s) => s.id === id)!;

let track: GeometryTrack;
beforeAll(async () => {
  configureMock({ latencyMs: 0, scenario: { mode: 'normal', assistant: 'on' } });
  clearGeometryCache();
  track = await loadTrack(LAUNCH, 30 + STAY);
});

/** Everything the stage shows for one site, a delay and an instant, made the way SiteHud makes it. */
function stage(id: string, slipDays: number, hoursIn: number) {
  const s = site(id);
  const planned = LAUNCH + TRANSIT_DAYS * DAY_MS;
  const landing = planned + slipDays * DAY_MS;
  const end = landing + STAY * DAY_MS;
  const horizon = horizonFor(s, planned, end, 0.25);
  const { evaluation, check } = evaluateSite(s, landing, STAY, HARDWARE, 2000);
  const live = liveSiteQuantities({ track, tMs: landing + hoursIn * HOUR_MS, landingMs: landing, site: s, horizon, lander: { name: 'Starship lander', heightM: 52 } });
  const fixed = siteStageQuantities({ site: s, landingMs: landing, plannedLandingMs: planned, stayEndMs: end, stayDays: STAY, evaluation, check });
  const result = siteQuantities(3, evaluation, check);
  const dates = missionDates(LAUNCH, slipDays, landing, null);
  const periods = clipPeriods(litPeriods(horizon), planned, end);
  return { s, planned, landing, end, horizon, live, fixed, result, dates, periods };
}

const CASES = [
  ['shackleton-ridge', 0, 0],
  ['shackleton-ridge', 14, -100.25],
  ['shackleton-ridge', 14, 200],
  ['apollo-11', 0, 300],
  ['apollo-11', 7, 12.5],
  ['nobile', 30, 301.75],
] as const;

describe('the horizon plot shows only its data', () => {
  it.each(CASES)('%s, delay %s d', (id, slip) => {
    const { planned, end, horizon } = stage(id, slip, 0);
    for (const [variant, height, step] of [
      ['console', 112, 45],
      ['console', 84, 45],
      ['hero', 260, 45],
      ['compact', 124, 90],
    ] as const) {
      const html = renderToStaticMarkup(<HorizonPanel data={horizon} fromMs={planned} toMs={end} label="Horizon plot" variant={variant} height={height} compassStep={step} />);
      const width = variant === 'compact' ? 300 : 640;
      const labels = horizonAxisQuantities(horizonLayout(horizon, width, height, null, step).elTicks);
      expect(labels.length).toBeGreaterThanOrEqual(2);
      // Every height label is there, and no other number.
      for (const q of labels) expect(html).toContain(`data-q="${q.key}"`);
      expect(unaccountedNumbers(html, labels)).toEqual([]);
      // Words on the plot: compass letters and Earth's name.
      expect(visibleText(html)).toMatch(/\b(N|NE|E|SE|S|SW|W|NW)\b/);
    }
  });

  it('the legend names the height where the scale changes with that height’s own label', () => {
    const [ten] = horizonAxisQuantities([10]);
    const html = renderToStaticMarkup(<SkyLegend scaleBreak={ten} />);
    expect(visibleText(html)).toContain('+10°');
    expect(unaccountedNumbers(html, ten)).toEqual([]);
    expect(numbersIn(visibleText(renderToStaticMarkup(<SkyLegend />)))).toEqual([]);
  });
});

describe('the stay timeline shows only its data', () => {
  it.each(CASES)('%s, delay %s d, %s h after the landing', (id, slip, hoursIn) => {
    const { planned, landing, end, live, fixed, dates, periods } = stage(id, slip, hoursIn);
    const ticks = stayTickQuantities(dayTicks(planned, end, landing));
    const periodList = stayPeriodQuantities(periods, landing);
    const html = renderToStaticMarkup(
      <StayTimeline
        periods={periods}
        startMs={planned}
        endMs={end}
        landingMs={landing}
        getNow={() => landing + hoursIn * HOUR_MS}
        onScrub={() => undefined}
        ticks={ticks}
        periodList={periodList}
        stayLength={fixed.stayLength}
        flag={live.sinceLanding}
        delay={slip > 0 ? dates.delay : undefined}
        label="Time in the stay"
      />,
    );
    expect(unaccountedNumbers(html, ticks, periodList, fixed.stayLength, live.sinceLanding, dates.delay)).toEqual([]);
    // The periods are all listed, in words, and each is drawn.
    expect(periodList.length).toBe(periods.length);
    for (const q of periodList) expect(visibleText(html)).toContain(`${q.label}: ${q.text}`);
    expect(html.match(/class="stay-period"/g)).toHaveLength(periods.length);
    // With a delay: the planned landing, the hatched lead-in and the delay's own readout.
    expect(html.includes('data-testid="ghost-marker"')).toBe(slip > 0);
    expect(html.includes('data-testid="stay-lead"')).toBe(slip > 0);
    if (slip > 0) expect(visibleText(html)).toContain(`delay ${dates.delay.text} ${dates.delay.unit}`);
    // A native slider, in hours since the landing.
    expect(html).toContain('type="range"');
    expect(html).toContain(`min="${-slip * 24}"`);
    expect(html).toContain(`max="${STAY * 24}"`);
    expect(html).toContain('aria-label="Time in the stay"');
  });

  it('the compact form is a picture with a name, and no slider', () => {
    const { planned, landing, end, periods } = stage('shackleton-ridge', 7, 0);
    const periodList = stayPeriodQuantities(periods, landing);
    const html = renderToStaticMarkup(<StayTimeline periods={periods} startMs={planned} endMs={end} landingMs={landing} getNow={() => landing} periodList={periodList} compact label="Lit and dark periods at the site" />);
    expect(html).not.toContain('type="range"');
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Lit and dark periods at the site"');
    expect(unaccountedNumbers(html, periodList)).toEqual([]);
  });

  it('with no answer yet it is disabled and shows no number of its own', () => {
    const html = renderToStaticMarkup(<StayTimeline periods={[]} startMs={0} endMs={0} landingMs={0} getNow={() => Number.NaN} onScrub={() => undefined} label="Time in the stay" disabled />);
    expect(html).toContain('disabled=""');
    expect(numbersIn(visibleText(html))).toEqual([]);
  });
});

describe('the play controls show only the speeds', () => {
  it('Play, back to the landing and one radio for each speed', () => {
    const speeds = speedQuantities(SPEEDS);
    const html = renderToStaticMarkup(<Transport playing={false} speed={2} speeds={speeds} onTogglePlay={() => undefined} onRestart={() => undefined} onSpeed={() => undefined} />);
    expect(unaccountedNumbers(html, speeds)).toEqual([]);
    for (const q of speeds) expect(html).toContain(`data-testid="speed-${q.text}"`);
    expect(html.match(/role="radio"/g)).toHaveLength(SPEEDS.length);
    expect(html.match(/aria-checked="true"/g)).toHaveLength(1);
    expect(visibleText(html)).toContain('Play');
    expect(visibleText(renderToStaticMarkup(<Transport playing speed={2} speeds={speeds} onTogglePlay={() => undefined} onRestart={() => undefined} onSpeed={() => undefined} />))).toContain('Pause');
  });
});

describe('the reading panels show only their quantities', () => {
  it.each(CASES)('%s, delay %s d, %s h after the landing', (id, slip, hoursIn) => {
    const { live, fixed, result } = stage(id, slip, hoursIn);
    const hardware = hardwareQuantities(HARDWARE, MOCK_CATALOG, MODELS);
    const sun = renderToStaticMarkup(
      <SunPanel
        sunState={live.sunState}
        nextChange={live.nextChange}
        sunAz={live.sunAz}
        sunEl={live.sunEl}
        sunWidth={fixed.sunWidth}
        shadowPerMetre={live.shadowPerMetre}
        shadowLander={live.shadowLander}
        shadowBearing={live.shadowBearing}
        sunlightPercent={result.sunlightPercent}
        sunlightHours={result.sunlightHours}
        longestDark={fixed.longestDark}
      />,
    );
    expect(unaccountedNumbers(sun, live, fixed, result)).toEqual([]);
    expect(visibleText(sun)).toContain(live.sunState.text);
    const clock = renderToStaticMarkup(<ClockPanel utc={live.utcClock} ltc={live.ltcClock} ltcOffset={live.ltcOffset} sinceLanding={live.sinceLanding} stayEnd={fixed.stayEnd} />);
    expect(unaccountedNumbers(clock, live, fixed)).toEqual([]);
    expect(visibleText(clock)).toContain(live.utcClock.text);
    expect(visibleText(clock)).toContain(live.ltcClock.text);
    const earth = renderToStaticMarkup(<EarthPanel earthAz={live.earthAz} earthEl={live.earthEl} earthWidth={live.earthWidth} earthLink={fixed.earthLink} clearSky={result.clearSky} />);
    expect(unaccountedNumbers(earth, live, fixed, result)).toEqual([]);
    expect(visibleText(earth)).toMatch(/1\.9[01]/);
    const note = 'Heights are those of the hardware models.';
    const list = renderToStaticMarkup(<HardwarePanel rows={hardware} note={note} />);
    // The status words are the model descriptions' own; they may carry a figure of theirs.
    expect(unaccountedNumbers(list, hardware.map((r) => [r.count, r.height, r.name, r.status ?? '']))).toEqual([]);
    expect(visibleText(list)).toContain('no model');
    expect(visibleText(list)).toContain(note);
    // An item whose shape is not in the picture says so on its row, in words; one that is drawn says nothing more.
    const shapes = { starship: 'failed', hab: 'loading', solar: 'ready' } as const;
    const withShapes = renderToStaticMarkup(<HardwarePanel rows={hardware} note={note} shapes={shapes} />);
    expect(unaccountedNumbers(withShapes, hardware.map((r) => [r.count, r.height, r.name, r.status ?? '']))).toEqual([]);
    expect(visibleText(withShapes)).toContain('Not drawn: its shape could not be loaded.');
    expect(visibleText(withShapes)).toContain('Loading its shape…');
    expect(withShapes.match(/data-testid="hardware-shape"/g)).toHaveLength(2);
    expect(list).not.toContain('hardware-shape');
    // The range rings on the ground say what they measure, as readouts.
    const rings = groundRingQuantities(SITE_VIEW.ringMinor, SITE_VIEW.ringMajor);
    const ringLine = renderToStaticMarkup(
      <span>
        Range rings every <Inline q={rings.minor} /> and <Inline q={rings.major} />.
      </span>,
    );
    expect(visibleText(ringLine)).toMatch(/Range rings every 10 ?m and 100 ?m/);
    expect(unaccountedNumbers(ringLine, rings.minor, rings.major)).toEqual([]);
    // Before the landing no lander stands there.
    if (hoursIn < 0) {
      expect(live.beforeLanding).toBe(true);
      expect(visibleText(sun)).toContain('not landed');
    }
    // The statement about true size carries the two widths as readouts.
    const widths = renderToStaticMarkup(
      <p>
        Sun <Inline q={fixed.sunWidth} /> and Earth <Inline q={live.earthWidth} /> wide
      </p>,
    );
    expect(visibleText(widths)).toMatch(/Sun 0\.53 ?° and Earth 1\.9[01] ?° wide/);
    expect(unaccountedNumbers(widths, fixed.sunWidth, live.earthWidth)).toEqual([]);
  });

  it('with no data every running readout is a dash with no unit, and the panels show no number', () => {
    const live = liveSiteQuantities({ track: null, tMs: Number.NaN, landingMs: null, site: null, horizon: null, lander: null });
    const fixed = siteStageQuantities({ site: null, landingMs: null, plannedLandingMs: null, stayEndMs: null, stayDays: Number.NaN, evaluation: null, check: null });
    const result = siteQuantities(null, null);
    for (const q of [live.sunState, live.nextChange, live.sunAz, live.sunEl, live.earthAz, live.earthEl, live.earthWidth, live.shadowPerMetre, live.shadowLander, live.shadowBearing, live.utcClock, live.ltcClock, live.sinceLanding, live.phase, live.toLanding]) {
      expect(q.text, q.key).toBe(DASH);
      expect(q.unit, q.key).toBe('');
    }
    const html =
      renderToStaticMarkup(
        <SunPanel
          sunState={live.sunState}
          nextChange={live.nextChange}
          sunAz={live.sunAz}
          sunEl={live.sunEl}
          shadowPerMetre={live.shadowPerMetre}
          shadowLander={live.shadowLander}
          shadowBearing={live.shadowBearing}
          sunlightPercent={result.sunlightPercent}
          sunlightHours={result.sunlightHours}
          longestDark={fixed.longestDark}
        />,
      ) +
      renderToStaticMarkup(<ClockPanel utc={live.utcClock} ltc={live.ltcClock} ltcOffset={live.ltcOffset} sinceLanding={live.sinceLanding} stayEnd={fixed.stayEnd} />) +
      renderToStaticMarkup(<EarthPanel earthAz={live.earthAz} earthEl={live.earthEl} earthWidth={live.earthWidth} earthLink={fixed.earthLink} clearSky={result.clearSky} />) +
      renderToStaticMarkup(<HardwarePanel rows={[]} note="No heights to show." />);
    expect(numbersIn(visibleText(html))).toEqual([]);
    expect(visibleText(html)).toContain(DASH);
  });
});

describe('nothing in the site stage is set under 12 px', () => {
  const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
  const FILES = [
    './HorizonPanel.tsx',
    './StayTimeline.tsx',
    './Transport.tsx',
    './AnchorReticle.tsx',
    '../stages/SitePanels.tsx',
    '../stages/SiteHud.tsx',
    '../stages/LanderReticle.tsx',
    '../stages/SiteVeil.tsx',
    '../components/ComparePanel.tsx',
  ];

  it.each(FILES)('%s', (file) => {
    const source = read(file);
    const sizes = [
      ...[...source.matchAll(/text-\[(\d+(?:\.\d+)?)px\]/g)].map((m) => Number(m[1])),
      ...[...source.matchAll(/fontSize[=:]\s*\{?\s*(\d+(?:\.\d+)?)/g)].map((m) => Number(m[1])),
      ...[...source.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1])),
    ];
    for (const px of sizes) expect(px).toBeGreaterThanOrEqual(12);
    // Tailwind's own small steps (text-xs is 12 px; nothing below it exists) are not used for less.
    expect(source).not.toMatch(/text-\[(?:0?\.\d+|0\.[0-6]\d*)rem\]/);
  });

  it('the stage’s own styles', () => {
    const css = read('../styles/index.css');
    const from = css.indexOf('/* ---------- the site stage ---------- */');
    const to = css.indexOf('/* ---------- reticle ---------- */');
    expect(from).toBeGreaterThan(0);
    expect(to).toBeGreaterThan(from);
    const sizes = [...css.slice(from, to).matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1]));
    expect(sizes.length).toBeGreaterThan(0);
    for (const px of sizes) expect(px).toBeGreaterThanOrEqual(12);
  });
});
