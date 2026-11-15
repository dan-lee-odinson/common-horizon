// Reading the planner's catalog for the mission planner: each figure as published, with its status
// labels and source, and "not published" where the catalog has no figure. Nothing here works a
// figure out: it only words what the catalog answer holds.

import type { CapacityOption, CatalogFigure, CatalogItem, HardwareKind } from '../api/types';

export const NOT_PUBLISHED = 'not published';

/** Headings for the planner's rows, by kind. */
export const KIND_HEADING: Record<HardwareKind, string> = {
  lander: 'Landers',
  cargo: 'Payload (mass)',
  power: 'Power sources',
  load: 'Power loads',
};

/** The line under the Payload heading: what its rows count for. */
export const PAYLOAD_HEADING_NOTE = 'Mass for the fit check only. Power is set under Power sources and Loads.';

/** Names for the catalog's figure keys; an unknown key is shown with its underscores as spaces. */
const FIGURE_NAME: Record<string, string> = {
  mass: 'Mass',
  power: 'Power',
  power_peak: 'Power, peak',
  power_average: 'Power, average',
  energy_per_night: 'Energy per night',
  max_slope: 'Steepest ground',
  capacity_published: 'Payload to the surface',
};

export function figureName(key: string): string {
  if (Object.hasOwn(FIGURE_NAME, key)) return FIGURE_NAME[key];
  const words = key.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function amount(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 3 });
}

/** A figure's value as published: "6,000 kg", "under 6,000 kg", "12,000 to 15,000 kg", or "not published". */
export function figureValue(f: CatalogFigure | null | undefined): { text: string; published: boolean } {
  const v = f?.value;
  const unit = f?.unit ? ` ${f.unit === 'deg' ? '°' : f.unit}` : '';
  const qualifier = f?.qualifier ? `${f.qualifier} ` : '';
  if (typeof v === 'number' && Number.isFinite(v)) return { text: `${qualifier}${amount(v)}${unit}`.replace(' °', '°'), published: true };
  if (Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === 'number' && Number.isFinite(x))) {
    const text = v.length === 1 ? amount(v[0]) : `${amount(v[0])} to ${amount(v[v.length - 1])}`;
    return { text: `${qualifier}${text}${unit}`.replace(' °', '°'), published: true };
  }
  return { text: NOT_PUBLISHED, published: false };
}

export interface FigureRow {
  key: string;
  label: string;
  value: string;
  published: boolean;
  status: string[];
  source: string;
}

/**
 * The figures to show on an item's row. A lander's payload figures are shown with its capacity
 * options (the visitor picks one there), so they are left out here. An item whose catalog entry
 * carries no figures shows the one its kind needs, as "not published" when it is null.
 */
export function catalogFigureRows(item: CatalogItem): FigureRow[] {
  const figures = item.figures ?? {};
  const hasOptions = (item.capacity_options ?? []).length > 1;
  const rows: FigureRow[] = Object.entries(figures)
    .filter(([key]) => !(hasOptions && key.startsWith('capacity_')))
    .map(([key, f]) => {
      const v = figureValue(f);
      return { key, label: figureName(key), value: v.text, published: v.published, status: f.status ?? [], source: f.source ?? '' };
    });
  if (rows.length > 0 || hasOptions) return rows;
  const plain = (key: string, label: string, value: number | null | undefined, unit: string): FigureRow => {
    const v = figureValue({ value: value ?? null, unit, status: [], source: '' });
    return { key, label, value: v.text, published: v.published, status: [], source: '' };
  };
  switch (item.kind) {
    case 'lander':
      return [plain('capacity', 'Payload to the surface', item.capacity_kg, 'kg')];
    case 'cargo':
      return [plain('mass', 'Mass', item.mass_kg, 'kg')];
    case 'power':
      return [plain('power', 'Power', item.gen_kw, 'kW')];
    case 'load':
      return [plain('day', 'Power in sunlight', item.load_day_kw, 'kW'), plain('night', 'Power in darkness', item.load_night_kw, 'kW')];
    default:
      return [];
  }
}

/** The payload figure in use for a lander: the visitor's pick, else the first published. null with none. */
export function chosenCapacity(item: CatalogItem, picks: Readonly<Record<string, string>>): CapacityOption | null {
  const options = item.capacity_options ?? [];
  if (options.length === 0) return null;
  const picked = Object.hasOwn(picks, item.id) ? options.find((o) => o.option === picks[item.id]) : undefined;
  return picked ?? options[0];
}
