// DATA HONESTY in mission select: the spotlight and the ranked strip, rendered with data made the
// way the app makes it from the example (mock) model, show no number that their data does not
// account for. A number may come from a readout quantity (util/quantities.ts), from a site's own
// entry in the site list (its name, note and coordinates), or from the ranking itself (how many
// places the delay moved a site, util/ranking.ts). Anything else fails the check.

import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import sitesJson from '../api/examples/sites.json';
import { evaluateSite, geometryAt, TRANSIT_DAYS } from '../api/mock/model';
import type { CheckResponse, HardwareChoice, Site } from '../api/types';
import { numbersIn, unaccountedNumbers, visibleText } from '../hud/honesty';
import { appStore } from '../state/app';
import { DataContext, type DataValue, type KnownSite } from '../state/data';
import type { AsyncResult } from '../state/useAsync';
import { formatLatLon } from '../util/geo';
import { missionDates, siteQuantities, type Quantity } from '../util/quantities';
import { movedText, rankRows, rankWindow, type RankedRow } from '../util/ranking';
import { DAY_MS, toIsoUtc } from '../util/time';
import { RankStrip } from './RankStrip';
import { Spotlight } from './Spotlight';

const LAUNCH = Date.UTC(2027, 1, 10, 15, 0, 0);
const STAY = 14;
const STORAGE = 2000;
const HARDWARE: HardwareChoice[] = [
  { id: 'hab', count: 1 },
  { id: 'rover', count: 1 },
  { id: 'solar', count: 4 },
  { id: 'starship', count: 1 },
];
const SITES = sitesJson.sites as Site[];

function result<T>(data: T, refreshing = false): AsyncResult<T> {
  return { status: 'answer', data, error: null, refreshing, retry: () => undefined };
}

/** A call the two panels never read. */
function idle<T>(): AsyncResult<T> {
  return { status: 'idle', data: null, error: null, refreshing: false, retry: () => undefined };
}

interface Scene {
  value: DataValue;
  rows: RankedRow[];
  focus: KnownSite;
  check: CheckResponse;
}

/** Everything the two panels read, for a delay and (optionally) a picked site, from the mock model. */
function scene(slipDays: number, pick: string | null = null, updating = false): Scene {
  const landingMs = LAUNCH + (TRANSIT_DAYS + slipDays) * DAY_MS;
  const plannedMs = LAUNCH + TRANSIT_DAYS * DAY_MS;
  const evaluate = (atMs: number) => SITES.map((site) => evaluateSite(site, atMs, STAY, HARDWARE, STORAGE).evaluation);
  const current = evaluate(landingMs);
  const rows = rankRows(current, slipDays > 0 ? evaluate(plannedMs) : null);
  const siteById = new Map<string, KnownSite>(SITES.map((s) => [s.id, s]));
  const highlighted = pick ? siteById.get(pick)! : null;
  const focus = highlighted ?? siteById.get(rows[0].siteId)!;
  const focusRow = rows.find((r) => r.siteId === focus.id) ?? null;
  const check = evaluateSite(focus, landingMs, STAY, HARDWARE, STORAGE).check;
  const geometry = geometryAt(landingMs);
  const answer = { launch_utc: toIsoUtc(LAUNCH), landing_utc: toIsoUtc(landingMs), slip_days: slipDays, stay_days: STAY, geometry, results: current };
  const value: DataValue = {
    health: idle(),
    sites: result({ sites: SITES }),
    catalog: idle(),
    evaluation: result({ current: answer, planned: null, rows, forMission: true, mission: '' }, updating),
    check: result(check),
    focusCheck: updating ? null : check,
    horizon: idle(),
    orbitHorizon: idle(),
    track: idle(),
    allSites: SITES,
    siteById,
    highlighted,
    focus,
    focusRow,
    reference: focus,
    rows,
    updating,
    hardwareChosen: HARDWARE,
    storageKwh: STORAGE,
    landingMs,
    plannedLandingMs: plannedMs,
    landingGeometry: geometry,
    windowStartMs: plannedMs,
    windowEndMs: landingMs + STAY * DAY_MS,
    orbitEndMs: null,
  };
  return { value, rows, focus, check };
}

function render(value: DataValue, panel: 'spotlight' | 'strip'): string {
  return renderToStaticMarkup(<DataContext.Provider value={value}>{panel === 'spotlight' ? <Spotlight /> : <RankStrip />}</DataContext.Provider>);
}

function quantitiesOf(x: object): Quantity[] {
  return Object.values(x).filter((v): v is Quantity => typeof v === 'object' && v !== null && 'key' in v && 'text' in v && 'unit' in v);
}

/** What a site's own entry in the site list says: its name, its note and its coordinates as written. */
function siteText(site: KnownSite): string[] {
  return [site.name, site.note ?? '', formatLatLon(site.lat, site.lon_east, 3)];
}

/** What the ranking says about a row besides its readouts: how far the delay moved it, and from which rank. */
function movedFacts(row: RankedRow): unknown[] {
  if (!row.planned || row.moved === 0) return [];
  return [String(Math.abs(row.moved)), movedText(row.moved), siteQuantities(row.planned.rank, row.evaluation).rank];
}

afterEach(() => appStore.set({ slipDays: 0 }));

describe('the spotlight shows only its data', () => {
  for (const [slipDays, pick] of [
    [0, null],
    [7, null],
    [14, null],
    [14, 'apollo-14'],
    [14, 'nobile'],
    [30, 'blue-ghost-m3'],
  ] as const) {
    it(`delay ${slipDays} d, ${pick ?? 'the best site'}`, () => {
      appStore.set({ slipDays });
      const { value, focus, check } = scene(slipDays, pick);
      const row = value.focusRow!;
      const q = siteQuantities(row.rank, row.evaluation, check);
      const html = render(value, 'spotlight');
      const text = visibleText(html);

      // Each readout is there, as its quantity writes it.
      for (const shown of [q.rank, q.sunlightPercent, q.sunlightHours, q.score, q.earthLink, q.powerMargin, q.verdict]) {
        expect(text, shown.key).toContain(shown.text);
        if (shown.unit) expect(text, `${shown.key} unit`).toContain(shown.unit);
      }
      expect(html).toContain('data-q="sunlight_percent"');
      expect(text).toContain(focus.name);
      expect(text).toContain('Zoom in to this site');
      // The pass or fail word; a failure says why.
      expect(q.verdict.text).toMatch(/^(pass|fail: .+)$/);
      // A site the visitor picked can be handed back to the ranking; the best site needs no such button.
      expect(text.includes('Follow the best site')).toBe(pick !== null);

      // And not one number more.
      expect(unaccountedNumbers(html, quantitiesOf(q), siteText(focus), movedFacts(row))).toEqual([]);
    });
  }

  it('keeps the previous figures on screen, marked busy, while a newer ranking is on its way', () => {
    const { value, focus } = scene(7, null, true);
    const row = value.focusRow!;
    // The planner's check is being asked again too: the row's own power figure is shown meanwhile.
    const q = siteQuantities(row.rank, row.evaluation, null);
    const html = render(value, 'spotlight');
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain('data-state="empty"');
    const text = visibleText(html);
    expect(text).toContain(focus.name);
    expect(text).toContain(q.score.text);
    expect(text).toContain(q.sunlightPercent.text);
    expect(unaccountedNumbers(html, quantitiesOf(q), siteText(focus), movedFacts(row))).toEqual([]);
  });

  it('shows a site that has no row yet by name and place, with dashes for its figures', () => {
    const base = scene(0, null, true);
    const custom: KnownSite = { id: 'custom:-88.5000:315.0000', name: `Custom point ${formatLatLon(-88.5, 315, 2)}`, lat: -88.5, lon_east: 315, custom: true };
    const value: DataValue = { ...base.value, highlighted: custom, focus: custom, focusRow: null, focusCheck: null };
    const html = render(value, 'spotlight');
    const text = visibleText(html);
    expect(html).toContain('aria-busy="true"');
    expect(text).toContain(custom.name);
    expect(text).toContain('Working out this site');
    expect(text).toContain('—');
    // Only the point's own name and coordinates carry numbers.
    expect(unaccountedNumbers(html, siteText(custom))).toEqual([]);
    expect(numbersIn(text).length).toBeGreaterThan(0);
  });
});

describe('the ranked strip shows only its data', () => {
  for (const [slipDays, pick] of [
    [0, null],
    [7, null],
    [14, 'apollo-14'],
    [30, 'blue-ghost-m3'],
  ] as const) {
    it(`delay ${slipDays} d, ${pick ?? 'the best site'}`, () => {
      appStore.set({ slipDays });
      const { value, rows, focus } = scene(slipDays, pick);
      const html = render(value, 'strip');
      const text = visibleText(html);
      const shown = rankWindow(rows, focus.id, 5);

      // A handful of rows around the spotlight site, never the whole list.
      expect(html.match(/role="option"/g)?.length).toBe(5);
      expect(rows.length).toBe(17);
      expect(shown.some((r) => r.siteId === focus.id)).toBe(true);

      const sources: unknown[] = [];
      for (const row of shown) {
        const site = value.siteById.get(row.siteId)!;
        const q = siteQuantities(row.rank, row.evaluation);
        expect(text, site.name).toContain(site.name);
        expect(text).toContain(q.rank.text);
        expect(text).toContain(q.score.text);
        expect(text).toContain(`sunlit ${q.sunlightPercent.text} % of the stay`);
        sources.push(q.rank, q.score, q.sunlightPercent, site.name, movedFacts(row));
      }
      // The heading's "01 to 05 of 17" is three rank readouts: first row shown, last row shown, last site ranked.
      const last = rows[rows.length - 1];
      sources.push(siteQuantities(last.rank, last.evaluation).rank);
      // The announcement names the delay as its readout does ("+7 days") and the new first site.
      sources.push(missionDates(LAUNCH, slipDays, value.landingMs, value.landingGeometry).delay, value.siteById.get(rows[0].siteId)!.name, movedFacts(rows[0]));
      if (slipDays > 0) expect(text).toContain(`Delay ${slipDays} days: ${value.siteById.get(rows[0].siteId)!.name} is now first`);

      // Every row says pass or fail, and rows the delay moved say how far.
      expect(html.match(/data-testid="verdict"/g)?.length).toBe(5);
      const movedRows = shown.filter((r) => r.planned && r.moved !== 0);
      expect(html.match(/data-testid="moved"/g)?.length ?? 0).toBe(movedRows.length);
      for (const row of movedRows) expect(text).toContain(`${movedText(row.moved)} since the plan`);

      expect(unaccountedNumbers(html, sources)).toEqual([]);
    });
  }

  it('reorders with the delay', () => {
    const planned = scene(0).rows.map((r) => r.siteId);
    const delayed = scene(7).rows.map((r) => r.siteId);
    expect(delayed).not.toEqual(planned);
    expect([...delayed].sort()).toEqual([...planned].sort());
  });

  it('stays in place, marked busy, while a newer ranking is on its way, and says nothing new yet', () => {
    appStore.set({ slipDays: 7 });
    const settled = render(scene(7).value, 'strip');
    const busy = render(scene(7, null, true).value, 'strip');
    expect(busy).toContain('aria-busy="true"');
    expect(settled).toContain('aria-busy="false"');
    // The same rows, in the same order.
    const names = (html: string) => Array.from(html.matchAll(/data-testid="row-name"[^>]*>([^<]*)</g), (m) => m[1]);
    expect(names(busy)).toEqual(names(settled));
    expect(names(busy).length).toBe(5);
    // The new first site is announced once its ranking has arrived, not from the previous one.
    expect(visibleText(busy)).not.toContain('is now first');
    expect(visibleText(settled)).toContain('is now first');
  });

  it('shows fewer rows when asked to', () => {
    const { value } = scene(0);
    const html = renderToStaticMarkup(
      <DataContext.Provider value={value}>
        <RankStrip rows={3} />
      </DataContext.Provider>,
    );
    expect(html.match(/role="option"/g)?.length).toBe(3);
  });
});
