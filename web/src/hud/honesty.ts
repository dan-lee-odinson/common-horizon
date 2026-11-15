// Helpers for the data-honesty checks: find every number a piece of rendered HUD shows, and the
// numbers its quantities allow. A number on screen that no quantity accounts for fails the check.

import type { Quantity } from '../util/quantities';

const NUMBER = /\d[\d,]*(?:\.\d+)?/g;

/** Text content of rendered markup: tags and attributes removed, entities for the few signs used decoded. */
export function visibleText(html: string): string {
  return html
    .replace(/<(title|desc)[^>]*>[\s\S]*?<\/\1>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ');
}

/** Every number written in a text, as written ("1,234.5", "07"). */
export function numbersIn(text: string): string[] {
  return text.match(NUMBER) ?? [];
}

function isQuantity(x: unknown): x is Quantity {
  return typeof x === 'object' && x !== null && typeof (x as Quantity).key === 'string' && typeof (x as Quantity).text === 'string' && 'unit' in x;
}

/** The numbers that appear in the given quantities' text, unit and label. Nested objects are searched. */
export function allowedNumbers(...sources: unknown[]): Set<string> {
  const out = new Set<string>();
  const visit = (x: unknown, depth: number) => {
    if (isQuantity(x)) {
      for (const n of numbersIn(`${x.text} ${x.unit} ${x.label}`)) out.add(n);
    } else if (typeof x === 'string') {
      for (const n of numbersIn(x)) out.add(n);
    } else if (typeof x === 'object' && x !== null && depth < 3) {
      for (const v of Object.values(x)) visit(v, depth + 1);
    }
  };
  for (const s of sources) visit(s, 0);
  return out;
}

/** Numbers shown in `html` that none of the sources account for. Empty means the markup is honest. */
export function unaccountedNumbers(html: string, ...sources: unknown[]): string[] {
  const allowed = allowedNumbers(...sources);
  return numbersIn(visibleText(html)).filter((n) => !allowed.has(n));
}
