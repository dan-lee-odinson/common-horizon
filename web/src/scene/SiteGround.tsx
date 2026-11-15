// The level ground round the landing point: one flat disc, drawn by the ground shader
// (siteShaders.ts). It is an illustration (the data has no terrain near the site, and the screen
// says so): level, so the shadow lengths on it are the ones the readouts give, and never drawn
// above the cut-off that keeps it under the data's skyline.

import { useEffect, useMemo } from 'react';
import { createGroundMaterial, type GroundUniforms } from './siteNow';
import { SITE_VIEW } from './siteView';

export function SiteGround({ uniforms }: { uniforms: GroundUniforms }) {
  const material = useMemo(() => createGroundMaterial(uniforms, false), [uniforms]);
  useEffect(() => () => material.dispose(), [material]);
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} renderOrder={-2} frustumCulled={false} material={material}>
      <circleGeometry args={[SITE_VIEW.groundRadius, 96]} />
    </mesh>
  );
}
