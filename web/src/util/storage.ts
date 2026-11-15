// Reading what the visitor types into the Battery storage box.
//
// The box and the power checks must always agree. So every entry settles on one number at once:
// an empty box is none, a bad entry (letters, a negative number, a misplaced comma) counts as none
// and says so, and a figure above the cap is replaced by the cap and says so.
//
// Only a plain decimal figure is read as a number: digits with an optional decimal part ("600",
// "1500.5", ".5"), optionally with thousands commas in their proper places ("1,500", "12,345.5"),
// an optional sign in front, and the short form with an exponent ("1e3"). Anything else that
// JavaScript itself would accept as a number ("0x10", "0b11", "Infinity") is a bad entry here, and
// so is a comma anywhere else ("5,5" is not read as 55).

/** Upper limit for typed battery storage, kWh (far above anything a lander carries). */
export const MAX_STORAGE_KWH = 1_000_000;

export type StorageEntryStatus = 'empty' | 'ok' | 'invalid' | 'capped';

export interface StorageEntry {
  /** The storage the checks use, kWh. Never negative, and never a negative zero. */
  kwh: number;
  status: StorageEntryStatus;
  /** The line shown under the box. */
  note: string;
  /** What the box itself should show once the entry settles. */
  display: string;
}

/** Digits with an optional decimal part and an optional exponent: "600", "1500.5", ".5", "1e3". */
const PLAIN = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;
/** The same figure written with thousands commas, each followed by exactly three digits: "1,500", "12,345.5". */
const GROUPED = /^\d{1,3}(,\d{3})+(\.\d*)?$/;

const NONE_NOTE = 'Empty or 0 means none.';

export function readStorageEntry(raw: string, max = MAX_STORAGE_KWH): StorageEntry {
  const typed = raw.trim();
  if (typed === '') return { kwh: 0, status: 'empty', note: NONE_NOTE, display: '' };
  const invalid: StorageEntry = { kwh: 0, status: 'invalid', note: 'Not a valid amount, so storage counts as 0 kWh. Type 0 or more.', display: raw };

  const sign = typed[0] === '+' || typed[0] === '-' ? typed[0] : '';
  const body = typed.slice(sign.length);
  // Commas are dropped only where they group thousands; any other comma makes the entry bad.
  const digits = GROUPED.test(body) ? body.replace(/,/g, '') : body;
  if (!PLAIN.test(digits)) return invalid;
  const kwh = Number(digits);
  if (Number.isNaN(kwh)) return invalid;

  // Zero is none however it is written: "0", "+0", "-0", "0.00". It settles as a plain zero.
  if (kwh === 0) return { kwh: 0, status: 'empty', note: NONE_NOTE, display: sign === '-' ? digits : `${sign}${digits}` };
  if (sign === '-') return invalid;
  if (kwh > max) {
    return { kwh: max, status: 'capped', note: `Capped at ${max.toLocaleString('en-US')} kWh, the most this planner accepts.`, display: String(max) };
  }
  return { kwh, status: 'ok', note: 'Counts once a site gives the length of its darkness.', display: `${sign}${digits}` };
}
