// A straight tick scale: a ruler with a tick for every step and a longer, numbered tick at each
// major step. Used under the launch-delay scrubber and the stay timeline.

export function TickScale({
  min,
  max,
  step = 1,
  major = 5,
  format = (v: number) => String(v),
  marker,
  className = '',
}: {
  min: number;
  max: number;
  step?: number;
  major?: number;
  format?: (v: number) => string;
  /** A second mark on the scale (for example the planned value), drawn as a hollow diamond. */
  marker?: number | null;
  className?: string;
}) {
  const ticks: number[] = [];
  for (let v = min; v <= max + 1e-9; v += step) ticks.push(Math.round(v * 1000) / 1000);
  const pos = (v: number) => `${((v - min) / (max - min || 1)) * 100}%`;
  return (
    <div className={`relative h-7 select-none ${className}`} aria-hidden>
      {ticks.map((v) => {
        const isMajor = Math.abs(v / major - Math.round(v / major)) < 1e-9;
        return (
          <span key={v} className="absolute top-0" style={{ left: pos(v) }}>
            <span className="absolute left-0 top-0 block w-px -translate-x-1/2" style={{ height: isMajor ? 9 : 5, background: isMajor ? 'var(--ch-line-strong)' : 'var(--ch-line)' }} />
            {isMajor ? <span className="num absolute left-0 top-[11px] block -translate-x-1/2 text-[12px] leading-none text-muted">{format(v)}</span> : null}
          </span>
        );
      })}
      {marker !== null && marker !== undefined ? (
        <span className="absolute top-[-3px] block size-[7px] -translate-x-1/2 rotate-45 border border-ink-2" style={{ left: pos(marker) }} />
      ) : null}
    </div>
  );
}
