// Power balance colours. The same rule colours the planner's power number and the
// "added energy" figure in every ranked row.
//
//   margin >= 25 %        -> good   (green)
//   0 % <= margin < 25 %  -> thin   (yellow)  — exactly 0 counts as thin: no deficit, no reserve
//   margin < 0 %          -> short  (red)
//   no number             -> unknown (grey)

export const GOOD_MARGIN_PERCENT = 25;

export type PowerLevel = 'good' | 'thin' | 'short' | 'unknown';

/** The planner module's colour names. */
export type PowerStatusName = 'green' | 'yellow' | 'red' | 'none';

/** The check that sets the balance, as the planner module names it. */
export type Limiting = 'day' | 'night' | 'day and night' | null;

export function powerLevel(marginPercent: number | null | undefined): PowerLevel {
  if (marginPercent === null || marginPercent === undefined || Number.isNaN(marginPercent)) {
    return 'unknown';
  }
  if (marginPercent >= GOOD_MARGIN_PERCENT) return 'good';
  if (marginPercent >= 0) return 'thin';
  return 'short';
}

/**
 * Level from a status the backend (planner module) gives. Prefer this over powerLevel(margin): when a
 * load has nothing at all to power it the margin is null but the status is still red.
 */
export function levelFromStatus(status: PowerStatusName | null | undefined): PowerLevel {
  switch (status) {
    case 'green':
      return 'good';
    case 'yellow':
      return 'thin';
    case 'red':
      return 'short';
    default:
      return 'unknown';
  }
}

/** CSS variable holding the colour for a level (all colours live in styles/theme.css). */
export function powerColorVar(level: PowerLevel): string {
  switch (level) {
    case 'good':
      return 'var(--ch-good)';
    case 'thin':
      return 'var(--ch-warn)';
    case 'short':
      return 'var(--ch-bad)';
    default:
      return 'var(--ch-muted)';
  }
}

/** Short word shown next to the number so the meaning never depends on colour alone. */
export function powerWord(level: PowerLevel): string {
  switch (level) {
    case 'good':
      return 'healthy margin';
    case 'thin':
      return 'thin margin';
    case 'short':
      return 'power short';
    default:
      return 'no load yet';
  }
}

/** Where the limiting check bites, in words: "at night", "in daylight" or "day and night". */
export function limitingWhere(limiting: Limiting): string {
  if (limiting === 'night') return 'at night';
  if (limiting === 'day') return 'in daylight';
  if (limiting === 'day and night') return 'day and night';
  return '';
}

/**
 * Words beside the balance number. A thin or short balance names the check that sets it,
 * for example "power short at night" or "power short in daylight".
 */
export function balanceWords(level: PowerLevel, limiting: Limiting): string {
  const where = limitingWhere(limiting);
  if (level === 'short') return where ? `power short ${where}` : 'power short';
  if (level === 'thin') return where ? `thin margin ${where}` : 'thin margin';
  return powerWord(level);
}

/** A margin for display. A load with nothing to power it has no margin to show: "no supply". */
export function formatMargin(margin: number | null | undefined, level: PowerLevel): string {
  if ((margin === null || margin === undefined) && level === 'short') return 'no supply';
  return formatPercent(margin, true);
}

/** A plain amount with its unit: "21.3 kW", "0.34 kW", "1,546 kWh", "72 h". */
export function formatAmount(value: number | null | undefined, unit: string): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  return `${value.toLocaleString('en-US', { maximumFractionDigits: digits })} ${unit}`;
}

/** Storage that covers a need, rounded up to a whole kWh so typing it always passes. */
export function storageToCover(neededKwh: number): number {
  return Math.ceil(neededKwh - 1e-9);
}

export function formatPercent(value: number | null | undefined, signed = false): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const rounded = Math.round(value);
  if (!signed) return `${rounded}%`;
  return `${rounded > 0 ? '+' : rounded < 0 ? '−' : '±'}${Math.abs(rounded)}%`;
}

export function formatKwh(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  return `${sign}${Math.round(Math.abs(value)).toLocaleString('en-US')} kWh`;
}
