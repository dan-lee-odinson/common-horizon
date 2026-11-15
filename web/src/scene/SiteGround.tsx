// The ground round the landing point.
//
// At a preset site whose height file has loaded: the real ground, one mesh at true scale (one unit
// is one metre) built from the LOLA heights round the site (siteTerrain.ts), lit by the Sun's
// direction against its own slopes and drawn by the terrain shader (siteShaders.ts). Shading only:
// the terrain casts no shadows. With both files the mesh runs out to 32 km (the near file joined
// into the far one); with the near file alone it eases back to the level ground past the file's
// edge, and the level ground carries on beyond it.
//
// Everywhere else (a custom point, a file that could not be read, or while it loads): one level
// disc, an illustration, drawn by the ground shader: level, so the shadow lengths on it are the
// ones the readouts give, and never drawn above the cut-off that keeps it under the data's skyline.

import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { createGroundMaterial, createTerrainMaterial, type GroundUniforms } from './siteNow';
import { buildGroundMesh, FAR_FADE_M, FAR_RADIUS_M, groundReach, type SiteGroundShape } from './siteTerrain';
import { SITE_VIEW } from './siteView';

export function SiteGround({ uniforms, shape }: { uniforms: GroundUniforms; shape: SiteGroundShape | null }) {
  const material = useMemo(() => createGroundMaterial(uniforms, false), [uniforms]);
  useEffect(() => () => material.dispose(), [material]);
  const terrainMaterial = useMemo(() => createTerrainMaterial(uniforms), [uniforms]);
  useEffect(() => () => terrainMaterial.dispose(), [terrainMaterial]);

  const geometry = useMemo(() => {
    if (!shape) return null;
    const mesh = buildGroundMesh(shape);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3));
    g.setAttribute('aFlat', new THREE.BufferAttribute(mesh.flat, 1));
    g.setIndex(new THREE.BufferAttribute(mesh.index, 1));
    g.computeBoundingSphere();
    return g;
  }, [shape]);
  useEffect(() => () => geometry?.dispose(), [geometry]);

  // The level ground is left out where the mesh lies (a metre less, so the two overlap at the join);
  // with the far ground it is not drawn at all. The far ground fades into the band's colour over its
  // last few kilometres, so its outer edge never shows as a line.
  const level = !shape || !shape.far;
  material.uniforms.uHole.value = shape ? groundReach(shape) - 1 : 0;
  terrainMaterial.uniforms.uFarFade.value.set(shape?.far ? FAR_RADIUS_M - FAR_FADE_M : 1e9, shape?.far ? FAR_RADIUS_M : 2e9);

  return (
    <>
      {level ? (
        <mesh rotation={[-Math.PI / 2, 0, 0]} renderOrder={-2} frustumCulled={false} material={material}>
          <circleGeometry args={[SITE_VIEW.groundRadius, 96]} />
        </mesh>
      ) : null}
      {geometry ? <mesh geometry={geometry} material={terrainMaterial} renderOrder={-2} frustumCulled={false} /> : null}
    </>
  );
}
