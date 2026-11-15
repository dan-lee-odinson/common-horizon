// What the Site view says about its ground. Where the LOLA height files have loaded, the "Ground"
// panel gives where they come from (each figure taken from their manifest); where they have not
// (a custom point, a file that could not be read), the caption under the picture keeps saying the
// ground is an illustration. The scene and these words read the same store, so they always
// describe the ground actually drawn.
//
// The panel sits in the left wing under the Sun panel (on a phone, in the sheet), not in the
// console: the console's height frames the 3D picture, and a taller console would push a low Sun
// out of it. Where the Hardware panel is hidden (a window under 1024 px wide or 760 px tall) the
// left wing has no room left and the right wing has: the panel goes there, under Earth.

import { useSyncExternalStore } from 'react';
import { Glass } from '../hud/Glass';
import { groundWords, useSiteTerrain, type SiteTerrainState } from '../scene/siteTerrainLoad';

/** The windows where the Site view hides its Hardware panel (the same limits as its classes in SiteHud). */
const HARDWARE_HIDDEN = '(max-width: 1023.98px), (max-height: 759px)';

function subscribeHardwareHidden(cb: () => void) {
  const mql = window.matchMedia(HARDWARE_HIDDEN);
  mql.addEventListener('change', cb);
  return () => mql.removeEventListener('change', cb);
}

/** Which wing holds the Ground panel: the left, under the Sun panel; the right where the Hardware panel is hidden. */
export function useGroundWing(): 'left' | 'right' {
  const hidden = useSyncExternalStore(subscribeHardwareHidden, () => window.matchMedia(HARDWARE_HIDDEN).matches, () => false);
  return hidden ? 'right' : 'left';
}

function useGround(siteId: string | null, custom: boolean): SiteTerrainState | null {
  const terrain = useSiteTerrain(custom ? null : siteId);
  return terrain.status === 'ready' && terrain.entry ? terrain : null;
}

/**
 * The words in the caption under the picture: "The ground is an illustration." on level ground;
 * with the real ground, nothing (the Ground panel says it), or on a phone a short pointer to it.
 */
export function GroundNote({ siteId, custom, pointer = false }: { siteId: string | null; custom: boolean; pointer?: boolean }) {
  const terrain = useGround(siteId, custom);
  if (!terrain) return <span data-testid="site-illustration-ground">The ground is an illustration.</span>;
  return pointer ? <span data-testid="site-ground-pointer">Ground: LOLA heights, true scale.</span> : null;
}

/**
 * The Ground panel: where the drawn ground comes from and, where it applies, that the sunlight
 * numbers use a smooth horizon. Its words open with "Ground:", so it carries no title of its own.
 * Nothing while the ground is level.
 */
export function GroundPanel({ siteId, custom, bare = false, className = '' }: { siteId: string | null; custom: boolean; bare?: boolean; className?: string }) {
  const terrain = useGround(siteId, custom);
  if (!terrain || !terrain.entry) return null;
  const words = groundWords(terrain.entry, terrain.far !== null);
  const body = (
    <>
      <p className={`m-0 text-[12px] leading-snug text-ink-2 ${bare ? '' : 'min-h-0 overflow-y-auto overscroll-contain'}`} data-testid="site-ground" tabIndex={bare ? undefined : 0}>
        <span data-testid="site-ground-source">{words.source}</span>
        {words.smoothHorizon ? (
          <>
            {' '}
            <span data-testid="site-ground-smooth-horizon">
              {words.smoothHorizon.before}
              <span data-q="terrain_rise_deg">{words.smoothHorizon.deg}</span>
              {words.smoothHorizon.after}
            </span>
          </>
        ) : null}
      </p>
    </>
  );
  if (bare) {
    return (
      <section className={`site-section flex flex-col gap-2.5 ${className}`} aria-label="Ground" data-testid="ground-panel">
        {body}
      </section>
    );
  }
  return (
    <Glass as="section" className={`flex min-h-0 flex-col gap-2 p-3.5 ${className}`} aria-label="Ground" data-panel data-testid="ground-panel">
      {body}
    </Glass>
  );
}
