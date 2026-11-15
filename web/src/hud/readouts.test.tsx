// DATA HONESTY, at the component level: a readout shows its Quantity and nothing else.
// The quantities here are made the way the app makes them, from the example (mock) data; the
// rendered markup may not contain a single number that those quantities do not account for.

import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it } from 'vitest';
import sitesJson from '../api/examples/sites.json';
import { configureMock } from '../api/mock';
import { evaluateSite, horizonFor, TRANSIT_DAYS } from '../api/mock/model';
import type { SiteRef } from '../api/types';
import { clearGeometryCache, loadTrack } from '../state/geometry';
import { missionDates, siteQuantities, skyQuantities, type Quantity } from '../util/quantities';
import { DAY_MS, HOUR_MS, SYNODIC_MONTH_DAYS } from '../util/time';
import type { GeometryTrack } from '../util/track';
import { numbersIn, unaccountedNumbers, visibleText } from './honesty';
import { Readout, ReadoutRow } from './Readout';

const LAUNCH = Date.UTC(2027, 1, 10, 15, 0, 0);
const LANDING = LAUNCH + TRANSIT_DAYS * DAY_MS;
const site = (sitesJson.sites as SiteRef[]).find((s) => s.id === 'shackleton-ridge')!;

let track: GeometryTrack;
beforeAll(async () => {
  configureMock({ latencyMs: 0, scenario: { mode: 'normal', assistant: 'on' } });
  clearGeometryCache();
  track = await loadTrack(LAUNCH, SYNODIC_MONTH_DAYS);
});

function quantitiesOf(x: object): Quantity[] {
  return Object.values(x).filter((v): v is Quantity => typeof v === 'object' && v !== null && 'key' in v && 'text' in v && 'unit' in v);
}

describe('readout components show only their quantity', () => {
  it('renders the text and unit of each sky quantity, at several instants', () => {
    const horizon = horizonFor(site, LANDING, LANDING + SYNODIC_MONTH_DAYS * DAY_MS, 1);
    for (const hours of [0, 3.7, 99, 512.25]) {
      const sky = skyQuantities({ track, tMs: LANDING + hours * HOUR_MS, landingMs: LANDING, site, horizon });
      for (const q of quantitiesOf(sky)) {
        for (const html of [renderToStaticMarkup(<Readout q={q} />), renderToStaticMarkup(<ReadoutRow q={q} />)]) {
          expect(visibleText(html)).toContain(q.text);
          expect(html).toContain(`data-q="${q.key}"`);
          expect(unaccountedNumbers(html, q)).toEqual([]);
        }
      }
    }
  });

  it('renders site and date quantities without adding a number of its own', () => {
    const hardware = [
      { id: 'starship', count: 1 },
      { id: 'hab', count: 1 },
      { id: 'solar', count: 4 },
    ];
    const { evaluation, check } = evaluateSite(site, LANDING, 14, hardware, 2000);
    const all = [...quantitiesOf(siteQuantities(3, evaluation, check)), ...quantitiesOf(missionDates(LAUNCH, 7, LANDING + 7 * DAY_MS, track.at(LANDING + 7 * DAY_MS)))];
    expect(all.length).toBeGreaterThan(10);
    for (const q of all) {
      const html = renderToStaticMarkup(<Readout q={q} size="lg" />);
      expect(unaccountedNumbers(html, q)).toEqual([]);
    }
  });

  it('shows a dash and no unit when the data is missing', () => {
    const sky = skyQuantities({ track: null, tMs: LANDING, landingMs: null, site, horizon: null });
    const html = renderToStaticMarkup(<Readout q={sky.subsolarLon} />);
    expect(visibleText(html)).toContain('—');
    expect(numbersIn(visibleText(html))).toEqual([]);
  });

  it('the check itself notices a number that no quantity accounts for', () => {
    const sky = skyQuantities({ track, tMs: LANDING, landingMs: LANDING, site, horizon: null });
    const html = renderToStaticMarkup(
      <div>
        <Readout q={sky.subsolarLon} />
        <span>SIGNAL 87%</span>
      </div>,
    );
    expect(unaccountedNumbers(html, sky.subsolarLon)).toEqual(['87']);
  });
});
