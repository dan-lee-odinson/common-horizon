// Small line icons drawn for this project (no icon font, no third-party set).

export type IconName =
  | 'play'
  | 'pause'
  | 'plus'
  | 'minus'
  | 'star'
  | 'star-filled'
  | 'close'
  | 'up'
  | 'down'
  | 'info'
  | 'back'
  | 'grip'
  | 'send'
  | 'sites'
  | 'planner'
  | 'horizon'
  | 'compare';

const PATHS: Record<IconName, string> = {
  play: 'M7 5.5v13l11-6.5z',
  pause: 'M8 5.5v13M16 5.5v13',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  star: 'M12 3.8l2.5 5.2 5.7.8-4.1 4 1 5.6-5.1-2.7-5.1 2.7 1-5.6-4.1-4 5.7-.8z',
  'star-filled': 'M12 3.8l2.5 5.2 5.7.8-4.1 4 1 5.6-5.1-2.7-5.1 2.7 1-5.6-4.1-4 5.7-.8z',
  close: 'M6 6l12 12M18 6L6 18',
  up: 'M12 19V5M6 11l6-6 6 6',
  down: 'M12 5v14M6 13l6 6 6-6',
  info: 'M12 11v6M12 7.5v.5M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
  back: 'M15 5l-7 7 7 7',
  grip: 'M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01',
  send: 'M4 12l16-7-6 16-3-7z',
  sites: 'M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21zM12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  planner: 'M5 6h14M5 12h14M5 18h9',
  horizon: 'M3 17l5-5 4 3 4-6 5 8M3 20h18',
  compare: 'M4 5h7v14H4zM13 5h7v14h-7z',
};

const FILLED = new Set<IconName>(['play', 'star-filled']);

export function Icon({ name, size = 16, title }: { name: IconName; size?: number; title?: string }) {
  const filled = FILLED.has(name);
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={name === 'grip' ? 3 : 1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
    >
      {title ? <title>{title}</title> : null}
      <path d={PATHS[name]} />
    </svg>
  );
}
