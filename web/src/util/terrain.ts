// Whether an answer says the terrain is not included for a site. The backend says so in words: on
// /evaluate in the site's own `warnings` ("Local terrain is NOT included: ...", or from its test
// fixture "Terrain is not modelled: smooth horizon, ..."), and on /horizon with
// `skyline_source: "smooth_sphere"` and a warning. The website then says, on the site's card and in
// the Site stage: "smooth Moon, terrain not included".

export const TERRAIN_NOT_INCLUDED = 'smooth Moon, terrain not included';

const SAYS_NOT_INCLUDED = /terrain\b[^.]*?\bnot\s+(included|modell?ed)/i;

/** True when any of the warnings says the terrain is not included (or not modelled). */
export function warnsTerrainNotIncluded(warnings: readonly string[] | null | undefined): boolean {
  return Array.isArray(warnings) && warnings.some((w) => typeof w === 'string' && SAYS_NOT_INCLUDED.test(w));
}

/** True when a site's evaluation or its horizon answer says the terrain is not included. */
export function terrainNotIncluded(
  evaluation: { warnings?: readonly string[] | null } | null | undefined,
  horizon?: { skyline_source?: string; warnings?: readonly string[] | null } | null,
): boolean {
  if (warnsTerrainNotIncluded(evaluation?.warnings)) return true;
  if (!horizon) return false;
  return horizon.skyline_source === 'smooth_sphere' || warnsTerrainNotIncluded(horizon.warnings);
}
