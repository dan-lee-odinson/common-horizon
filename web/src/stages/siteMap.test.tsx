// The Site map panel as first drawn (before any tile is in): the stored picture at once, the
// layer buttons the site has, the caption, the link out, and no text under 12 px.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SiteRef } from '../api/types';
import { siteFrame } from '../scene/siteView';
import { SiteMap, siteMapUi } from './SiteMap';

const SHACKLETON: SiteRef = { id: 'shackleton-ridge', name: 'Shackleton Connecting Ridge', lat: -89.684, lon_east: 196.739 };
const APOLLO_15: SiteRef = { id: 'apollo-15', name: 'Apollo 15', lat: 26.13239, lon_east: 3.6333 };
const CUSTOM: SiteRef = { id: 'custom:10.0000:20.0000', name: 'Custom point', lat: 10, lon_east: 20 };

function draw(site: SiteRef | null, phone = false): string {
  return renderToStaticMarkup(<SiteMap site={site} phone={phone} />);
}

describe('the Site map panel', () => {
  beforeEach(() => siteFrame.set({ measured: true, width: 1440, height: 900, left: 340, top: 112, right: 1100, bottom: 600 }));
  afterEach(() => {
    siteFrame.set({ measured: false });
    siteMapUi.set({ open: false });
  });

  it('is a button until it is opened, and nothing before the stage is measured', () => {
    expect(draw(APOLLO_15)).toContain('data-testid="site-map-toggle"');
    expect(draw(APOLLO_15)).toContain('Site map · NASA Moon Trek</button>');
    expect(draw(APOLLO_15)).not.toContain('data-testid="site-map"');
    siteFrame.set({ measured: false });
    expect(draw(APOLLO_15)).toBe('');
    expect(draw(null)).toBe('');
  });

  it('shows the stored picture at once, with the site’s own layers', () => {
    siteMapUi.set({ open: true });
    const html = draw(APOLLO_15);
    expect(html).toContain('src="/site-context/apollo-15.jpg"');
    expect(html).toContain('data-state="loading"');
    expect((html.match(/data-tile="/g) ?? []).length).toBe(15);
    expect(html).toMatch(/aria-pressed="true"[^>]*data-kind="photo"/);
    expect(html).not.toContain('data-kind="slope10"');
    expect(html).toContain('LRO WAC Mosaic v2</span> · NASA Moon Trek · 167 m per pixel');
    expect(html).not.toContain('0° longitude is up');
    expect(html).toContain('href="https://trek.nasa.gov/moon/#v=0.1&amp;x=3.6333&amp;y=26.13239&amp;z=8&amp;p=urn%3Aogc%3Adef%3Acrs%3AEPSG%3A%3A104903&amp;d=&amp;locale=&amp;b=moon"');
    expect(html).toContain(
      'href="https://quickmap.lroc.im-ldi.com/?prjExtent=-39826%2C719422%2C260174%2C865422&amp;proj=16" target="_blank" rel="noopener noreferrer" data-testid="site-map-quickmap">Open in QuickMap (LROC)</a>',
    );
  });

  it('says which way is up on the polar grid, and starts on the stored picture’s layer', () => {
    siteMapUi.set({ open: true });
    const html = draw(SHACKLETON);
    expect(html).toContain('src="/site-context/shackleton-ridge.jpg"');
    expect(html).toMatch(/aria-pressed="true"[^>]*data-kind="terrain"/);
    expect(html).toContain('data-kind="slope10"');
    expect(html).toContain('· 0° longitude is up');
    // No east-west squeeze on the polar grid.
    expect(html).not.toContain('scaleX(');
  });

  it('has a plain placeholder and no stored picture for a custom point', () => {
    siteMapUi.set({ open: true });
    const html = draw(CUSTOM);
    expect(html).not.toContain('site-context/');
    expect(html).toContain('data-testid="site-map-placeholder"');
  });

  it('stays inside the free part of the window', () => {
    siteMapUi.set({ open: true });
    const html = draw(APOLLO_15);
    // The map's column, within the free width less the panel's padding and border.
    const width = Number(/style="width:([\d.]+)px" data-testid="site-map-body"/.exec(html)?.[1]);
    expect(width).toBeGreaterThanOrEqual(248);
    expect(width).toBeLessThanOrEqual(1100 - 340 - 24 - 26);
    // The room less the glass border, on the box that scrolls (never the glass: its brackets stand outside it).
    expect(html).toContain(`max-height:${900 - 112 - 6 - (900 - 600 + 6) - 2}px" data-testid="site-map-scroll"`);
  });
});

describe('nothing in the Site map is set under 12 px', () => {
  it('SiteMap.tsx', () => {
    const source = readFileSync(fileURLToPath(new URL('./SiteMap.tsx', import.meta.url)), 'utf8');
    const sizes = [...source.matchAll(/text-\[(\d+(?:\.\d+)?)px\]/g)].map((m) => Number(m[1]));
    expect(sizes.length).toBeGreaterThan(0);
    for (const px of sizes) expect(px).toBeGreaterThanOrEqual(12);
    expect(source).not.toMatch(/text-(?:xs|\[0?\.\d+rem\])/);
  });
});
