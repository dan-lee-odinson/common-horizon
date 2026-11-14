// Power balance colours. The same rule colours the planner's power number and the
// "added energy" figure in every ranked row.
//
//   margin >= 25 %        -> good   (green)
//   0 % <= margin < 25 %  -> thin   (yellow)  — exactly 0 counts as thin: no deficit, no reserve
//   margin < 0 %          -> short  (red)
//   no number             -> unknown (grey)

export const GOOD_MARGIN_PERCENT = 25;

export type PowerLevel = 'good' | 'thin' | 'short' | 'unknown';

export function powerLevel(marginPercent: number | null | undefined): PowerLevel {
  if (marginPercent === null || marginPercent === undefined || Number.isNaN(marginPercent)) {
    return 'unknown';
  }
  if (marginPercent >= GOOD_MARGIN_PERCENT) return 'good';
  if (marginPercent >= 0) return 'thin';
  return 'short';
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

export function formatPercent(value: number | null | undefined, signed = false): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const rounded = Math.round(value);
  if (!signed) return `${rounded}%`;
  return `${rounded > 0 ? '+' : rounded < 0 ? '−' : '±'}${Math.abs(rounded)}%`;
}

export function formatKwh(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  const abs = Math.abs(value);
  const text = abs >= 10_000 ? `${(abs / 1000).toFixed(1)} MWh` : `${Math.round(abs).toLocaleString('en-US')} kWh`;
  return `${sign}${text}`;
}
