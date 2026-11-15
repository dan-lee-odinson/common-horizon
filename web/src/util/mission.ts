// The mission in one line, for the summary that opens the mission planner:
// "Starship lander, Hab unit, Rover 1, Solar panels x 4, 2,000 kWh, 14 days."

import type { CatalogItem, HardwareChoice } from '../api/types';
import { formatDays } from './time';

export interface MissionSummary {
  /** Each part of the line, in order: hardware first, then storage, then the stay. */
  parts: string[];
  /** The parts joined: what is shown and read out. */
  text: string;
  /** True when no hardware is chosen: there is no mission to rank yet. */
  empty: boolean;
}

export function missionSummary(catalog: readonly CatalogItem[], hardware: readonly HardwareChoice[], storageKwh: number, stayDays: number): MissionSummary {
  const chosen = new Map(hardware.map((h) => [h.id, h.count]));
  const parts: string[] = [];
  // Catalog order, so the line does not reshuffle as items are ticked.
  for (const item of catalog) {
    const count = chosen.get(item.id);
    if (count === undefined || count <= 0) continue;
    parts.push(item.countable && count > 1 ? `${item.name} × ${count}` : item.name);
  }
  const empty = parts.length === 0;
  if (empty) parts.push('No hardware yet');
  if (storageKwh > 0) parts.push(`${storageKwh.toLocaleString('en-US', { maximumFractionDigits: 1 })} kWh`);
  parts.push(`${formatDays(stayDays)} ${stayDays === 1 ? 'day' : 'days'}`);
  return { parts, text: `${parts.join(', ')}.`, empty };
}
