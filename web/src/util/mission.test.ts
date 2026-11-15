import { describe, expect, it } from 'vitest';
import catalogJson from '../api/examples/catalog.json';
import type { CatalogItem } from '../api/types';
import { missionSummary } from './mission';

const catalog = catalogJson.items as unknown as CatalogItem[];

describe('mission summary line', () => {
  it('names the hardware in catalog order, then storage, then the stay', () => {
    const s = missionSummary(
      catalog,
      [
        { id: 'vsat', count: 4 },
        { id: 'starship_hls', count: 1 },
        { id: 'hab_crewed', count: 1 },
        { id: 'surface_habitat', count: 1 },
      ],
      2000,
      14,
    );
    expect(s.text).toBe('Starship HLS, Surface Habitat, Solar array mast (VSAT) × 4, Habitat, crewed, 2,000 kWh, 14 days.');
    expect(s.empty).toBe(false);
  });

  it('leaves storage out when there is none and says "day" for one day', () => {
    expect(missionSummary(catalog, [{ id: 'griffin', count: 1 }], 0, 1).text).toBe('Griffin, 1 day.');
    expect(missionSummary(catalog, [{ id: 'griffin', count: 1 }], 0, 7.25).text).toBe('Griffin, 7.25 days.');
  });

  it('says so when no hardware is chosen', () => {
    const s = missionSummary(catalog, [], 0, 14);
    expect(s.text).toBe('No hardware yet, 14 days.');
    expect(s.empty).toBe(true);
  });

  it('ignores ids the catalog does not have', () => {
    expect(missionSummary(catalog, [{ id: 'unknown', count: 3 }], 60, 30).text).toBe('No hardware yet, 60 kWh, 30 days.');
  });
});
