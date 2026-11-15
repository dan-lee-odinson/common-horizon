// What the Site view says about its ground. Where the LOLA height files have loaded, the "Ground"
// panel gives where they come from (each figure taken from their manifest); where they have not
// (a custom point, a file that could not be read), the caption under the picture keeps saying the
// ground is an illustration. The scene and these words read the same store, so they always
// describe the ground actually drawn.
//
// The panel sits in a wing (on a phone, in the sheet), not in the console: the console's height
// frames the 3D picture, and a taller console would push a low Sun out of it.

import { Glass } from '../hud/Glass';
import { groundWords, useSiteTerrain, type SiteTerrainState } from '../scene/siteTerrainLoad';

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
 * The Ground panel: where the drawn ground comes from, then (where it applies) that the sunlight
 * numbers use a smooth horizon, then that the near ground is smooth. In a crowded wing it keeps
 * most of its height and scrolls the rest; the Hardware panel below keeps room for a row.
 * Nothing while the ground is level.
 */
export function GroundPanel({ siteId, custom, bare = false, className = '' }: { siteId: string | null; custom: boolean; bare?: boolean; className?: string }) {
  const terrain = useGround(siteId, custom);
  if (!terrain || !terrain.entry) return null;
  const words = groundWords(terrain.entry, terrain.far !== null);
  const body = (
    <>
      <h3 className="panel-title m-0">Ground</h3>
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
        {words.nearSmooth ? (
          <>
            {' '}
            <span data-testid="site-ground-near-smooth">{words.nearSmooth}</span>
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
