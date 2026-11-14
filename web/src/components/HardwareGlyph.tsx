// Placeholder drawings for the planner's picture slots. Simple shapes drawn for this project:
// no logos, no lettering. Real pictures arrive later through the catalog's "picture" field.

import type { HardwareKind } from '../api/types';

export function HardwareGlyph({ id, kind }: { id: string; kind: HardwareKind }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  let body;
  switch (id) {
    case 'starship':
      body = (
        <>
          <path d="M20 4 C24 8 25 12 25 16 V30 H15 V16 C15 12 16 8 20 4Z" {...common} />
          <path d="M15 30 L11 36 M25 30 L29 36 M20 30 V36" {...common} />
        </>
      );
      break;
    case 'griffin':
      body = (
        <>
          <path d="M12 18 H28 L26 28 H14 Z" {...common} />
          <path d="M14 28 L9 35 M26 28 L31 35 M17 18 V14 H23 V18" {...common} />
        </>
      );
      break;
    case 'hab':
      body = (
        <>
          <rect x="7" y="14" width="26" height="14" rx="7" {...common} />
          <path d="M14 28 V33 M26 28 V33 M17 21 H23" {...common} />
        </>
      );
      break;
    case 'rover':
      body = (
        <>
          <path d="M9 18 H31 V26 H9 Z M24 18 V13 H29" {...common} />
          <circle cx="13" cy="30" r="3.5" {...common} />
          <circle cx="27" cy="30" r="3.5" {...common} />
        </>
      );
      break;
    case 'nuclear':
      body = (
        <>
          <rect x="15" y="12" width="10" height="20" rx="2" {...common} />
          <path d="M15 16 H8 M15 20 H8 M15 24 H8 M25 16 H32 M25 20 H32 M25 24 H32 M17 32 L15 36 M23 32 L25 36" {...common} />
        </>
      );
      break;
    case 'battery':
      body = (
        <>
          <rect x="8" y="12" width="21" height="16" rx="2" {...common} />
          <path d="M29 17 H32 V23 H29 M13 16 V24 M18 16 V24 M23 16 V24" {...common} />
        </>
      );
      break;
    case 'solar':
      body = (
        <>
          <path d="M8 8 H32 V24 H8 Z M16 8 V24 M24 8 V24 M8 16 H32 M20 24 V34 M15 34 H25" {...common} />
        </>
      );
      break;
    default:
      body = kind === 'lander' ? <path d="M12 16 H28 L25 30 H15 Z" {...common} /> : <rect x="10" y="10" width="20" height="20" rx="3" {...common} />;
  }
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden>
      {body}
    </svg>
  );
}
