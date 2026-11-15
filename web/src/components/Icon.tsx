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
  | 'compare'
  | 'sun'
  | 'left'
  | 'right'
  | 'zoom-in'
  | 'zoom-out'
  | 'chevron-down'
  | 'chevron-up'
  | 'chat'
  | 'reset'
  | 'search'
  | 'target'
  | 'edit'
  | 'skip';

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
  sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4',
  left: 'M19 12H5M11 6l-6 6 6 6',
  right: 'M5 12h14M13 6l6 6-6 6',
  'zoom-in': 'M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM15.3 15.3L20 20M10.5 8v5M8 10.5h5',
  'zoom-out': 'M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM15.3 15.3L20 20M8 10.5h5',
  'chevron-down': 'M6 9l6 6 6-6',
  'chevron-up': 'M6 15l6-6 6 6',
  chat: 'M5 6.5h14v9H10l-4 3.5v-3.5H5z',
  reset: 'M5 12a7 7 0 1 0 2.2-5.1M5 4.5v4.2h4.2',
  search: 'M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM15.3 15.3L20 20',
  target: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 2.5v5M12 16.5v5M2.5 12h5M16.5 12h5',
  edit: 'M5 19h3.5L19 8.5 15.5 5 5 15.5zM13.5 7l3.5 3.5',
  skip: 'M6 6l8.5 6L6 18zM17.5 5.5v13',
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
