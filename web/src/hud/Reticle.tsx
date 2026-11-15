// A targeting reticle: nested rings, four ticks and corner brackets. `pulsing` adds one slow
// expanding ring (switched off for visitors who prefer reduced motion, in CSS).

export function Reticle({ size = 72, color = 'var(--ch-cyan)', pulsing = false, className = '' }: { size?: number; color?: string; pulsing?: boolean; className?: string }) {
  const c = size / 2;
  const r = size * 0.3;
  const b = size * 0.46;
  const k = size * 0.14;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={`reticle ${className}`} aria-hidden style={{ overflow: 'visible' }}>
      {pulsing ? <circle className="reticle-pulse" cx={c} cy={c} r={r} fill="none" stroke={color} strokeWidth={1.5} /> : null}
      <circle cx={c} cy={c} r={r} fill="none" stroke={color} strokeWidth={1.25} />
      <circle cx={c} cy={c} r={r * 0.42} fill="none" stroke={color} strokeWidth={1} opacity={0.7} strokeDasharray="2 3" />
      <circle cx={c} cy={c} r={1.6} fill={color} />
      <path
        d={`M${c},${c - r - 7}V${c - r + 5}M${c},${c + r - 5}V${c + r + 7}M${c - r - 7},${c}H${c - r + 5}M${c + r - 5},${c}H${c + r + 7}`}
        stroke={color}
        strokeWidth={1.25}
        fill="none"
      />
      <path
        d={`M${c - b},${c - b + k}V${c - b}H${c - b + k}M${c + b - k},${c - b}H${c + b}V${c - b + k}M${c + b},${c + b - k}V${c + b}H${c + b - k}M${c - b + k},${c + b}H${c - b}V${c + b - k}`}
        stroke={color}
        strokeWidth={1}
        fill="none"
        opacity={0.75}
      />
    </svg>
  );
}
