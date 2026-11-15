// The sentence under the Site view's picture that says what the ground is: the real ground from
// the LOLA height files where they have loaded (each figure taken from their manifest), else the
// level illustration. The scene and this note read the same store, so the note always describes
// the ground actually drawn.

import { groundWords, useSiteTerrain } from '../scene/siteTerrainLoad';

export function GroundNote({ siteId, custom }: { siteId: string | null; custom: boolean }) {
  const terrain = useSiteTerrain(custom ? null : siteId);
  if (terrain.status !== 'ready' || !terrain.entry) return <span data-testid="site-illustration-ground">The ground is an illustration.</span>;
  const words = groundWords(terrain.entry, terrain.far !== null);
  return (
    <span data-testid="site-ground">
      <span data-testid="site-ground-source">{words.source}</span>
      {words.nearSmooth ? (
        <>
          {' '}
          <span data-testid="site-ground-near-smooth">{words.nearSmooth}</span>
        </>
      ) : null}
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
    </span>
  );
}
