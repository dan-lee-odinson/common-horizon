// Reading what the visitor types into the Battery storage box.
//
// The box and the power checks must always agree. So every entry settles on one number at once:
// an empty box is none, a bad entry (letters, a negative number) counts as none and says so, and a
// figure above the cap is replaced by the cap and says so.

/** Upper limit for typed battery storage, kWh (far above anything a lander carries). */
export const MAX_STORAGE_KWH = 1_000_000;

export type StorageEntryStatus = 'empty' | 'ok' | 'invalid' | 'capped';

export interface StorageEntry {
  /** The storage the checks use, kWh. */
  kwh: number;
  status: StorageEntryStatus;
  /** The line shown under the box. */
  note: string;
  /** What the box itself should show once the entry settles. */
  display: string;
}

export function readStorageEntry(raw: string, max = MAX_STORAGE_KWH): StorageEntry {
  const text = raw.trim().replace(/,/g, '');
  if (text === '') return { kwh: 0, status: 'empty', note: 'Empty or 0 means none.', display: '' };
  const kwh = Number(text);
  if (Number.isNaN(kwh) || kwh < 0) {
    return { kwh: 0, status: 'invalid', note: 'Not a valid amount, so storage counts as 0 kWh. Type 0 or more.', display: raw };
  }
  if (kwh > max) {
    return { kwh: max, status: 'capped', note: `Capped at ${max.toLocaleString('en-US')} kWh, the most this planner accepts.`, display: String(max) };
  }
  return { kwh, status: kwh === 0 ? 'empty' : 'ok', note: kwh === 0 ? 'Empty or 0 means none.' : 'Counts once a site gives the length of its darkness.', display: text };
}
