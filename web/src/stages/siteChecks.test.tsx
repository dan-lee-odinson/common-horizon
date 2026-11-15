// The Site stage's Data checks: the stored checks first (JPL Horizons, then NASA Moon Trek), then the
// slope and terrain notes; a check whose file or site is missing shows nothing.

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { HorizonsCheckFile, MoonTrekCheckFile, SiteEvaluation, SiteRef } from '../api/types';
import { SiteChecks } from './SiteChecks';
import { visibleText } from '../hud/honesty';

const SITE: SiteRef = { id: 'shackleton-ridge', name: 'Shackleton Connecting Ridge', lat: -89.684, lon_east: 196.739 };
const PERIOD = { start_utc: '2027-01-01T00:00Z', stop_utc: '2028-01-01T00:00Z', step_minutes: 60 };
const HORIZONS: HorizonsCheckFile = {
  format: 'common-horizon/horizons-check-summary',
  format_version: 1,
  sites: { 'shackleton-ridge': { sun_max_angle_deg: 0.005991, earth_max_angle_deg: 0.000211, samples: { sun: 8761, earth: 8761 }, period: PERIOD, retrieved_utc: '2026-11-15T14:01Z', horizons_url: 'x' } },
};
const TREK: MoonTrekCheckFile = {
  format: 'common-horizon/moon-trek-sun-check-summary',
  format_version: 1,
  sites: { 'shackleton-ridge': { sun_max_angle_deg: 0.006048, samples: 8761, period: PERIOD, retrieved_utc: '2026-11-15T16:34:39Z', moon_trek_url: 'x' } },
};
function readable(html: string): string {
  return visibleText(html).replace(/ ([,°])/g, '$1').trim();
}

const SOURCE = 'slope of the best-fit plane to LOLA heights within 500 m (NASA Moon Trek)';
const EVALUATION = { warnings: ['Terrain is not modelled: smooth horizon, slope reported as 0.'], elevation_m: 0 } as unknown as SiteEvaluation;
const SLOPE = { key: 'slope', label: SOURCE, value: 6.58, text: '6.6', unit: '°' };

/** The panel's text as read: the spaces the tags leave before a comma or a degree sign are closed up. */
function render(over: Partial<Parameters<typeof SiteChecks>[0]> = {}): string {
  return readable(
    renderToStaticMarkup(
      <SiteChecks
        site={SITE}
        evaluation={EVALUATION}
        horizon={null}
        check={HORIZONS}
        moonTrek={TREK}
        landingMs={Date.UTC(2027, 1, 15, 15)}
        slope={SLOPE}
        slopeNote="Slope not checked: no published slope limit for this lander"
        slopeDetail={`Slope 6.58 deg (${SOURCE}); no published slope limit for Starship HLS, so no pass or fail.`}
        layout="band"
        {...over}
      />,
    ),
  );
}

describe('Data checks', () => {
  it('puts the JPL Horizons line first, then NASA Moon Trek, then the slope and terrain notes', () => {
    const text = render();
    const at = (s: string) => text.indexOf(s);
    expect(at('Checked against NASA JPL Horizons: Sun within 0.005991°, Earth within 0.000211°')).toBeGreaterThan(-1);
    expect(at('Checked against NASA Moon Trek: Sun within 0.006048°')).toBeGreaterThan(at('Checked against NASA JPL Horizons'));
    expect(at(`6.6° ${SOURCE}`)).toBeGreaterThan(at('Checked against NASA Moon Trek'));
    expect(at('Slope not checked: no published slope limit for this lander')).toBeGreaterThan(at(`6.6° ${SOURCE}`));
    expect(at('smooth Moon, terrain not included')).toBeGreaterThan(at('Slope not checked'));
  });

  it('shows nothing for NASA Moon Trek when its file, or this site in it, is missing', () => {
    expect(render({ moonTrek: null })).not.toContain('Moon Trek: Sun');
    expect(render({ moonTrek: { ...TREK, sites: {} } })).not.toContain('Moon Trek: Sun');
    expect(render({ moonTrek: { ...TREK, sites: { 'shackleton-ridge': { sun_max_angle_deg: Number.NaN } } } })).not.toContain('Moon Trek: Sun');
    // The JPL Horizons line does not depend on it.
    expect(render({ moonTrek: null })).toContain('Checked against NASA JPL Horizons');
  });

  it('gives the backend’s sentence for the slope when there is no "not checked" note', () => {
    const text = render({ slopeNote: null, slopeDetail: 'Slope 6.58 deg (x); Griffin accepts up to 10 deg.' });
    expect(text).toContain('Slope 6.58 deg (x); Griffin accepts up to 10 deg.');
  });
});
