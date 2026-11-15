// The mission's hardware at the site, and its shadows.
//
// TRUE SCALE: each model is drawn exactly as its file gives it, one unit to the metre, never scaled
// (siteModels.ts refuses a shape that does not match its published height). The count of each item
// is the mission's. WHERE each piece stands is an illustration (siteLayout.ts); the data has no
// positions. An item with no model stands as a plain labelled marker instead (SiteMarkers.tsx).
//
// Shadows are flat projections on the level ground: every vertex of a model is dropped onto the
// ground along the sunlight (in the ground's own shader), so a shadow has exactly the length and
// direction the readouts give: height / tan(Sun's elevation), pointing away from the Sun. They are
// drawn only while the horizon answer says the site is lit and the Sun's whole disc is above
// level. Hardware casts shadows on the ground only, not on other hardware.
//
// Before the landing (inside a launch delay) nothing stands at the site: hardware and shadows are
// hidden.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { modelShapes } from '../state/models';
import type { SiteLayout } from './siteLayout';
import { loadModel, type LoadedModel } from './siteModels';
import { createGroundMaterial, type GroundUniforms, type SiteNow } from './siteNow';

export function SiteHardware({ layout, now, uniforms }: { layout: SiteLayout; now: SiteNow; uniforms: GroundUniforms }) {
  const bodies = useRef<THREE.Group>(null);
  const shadows = useRef<THREE.Group>(null);
  /** By model file name: the shape, or null when it could not be used. Missing while loading. */
  const [shapes, setShapes] = useState<Readonly<Record<string, LoadedModel | null>>>({});

  // Which shapes the layout needs, with the height each must have.
  const needed = useMemo(() => {
    const seen = new Map<string, { modelId: string; id: string; height: number }>();
    for (const item of layout.items) if (!seen.has(item.modelId)) seen.set(item.modelId, { modelId: item.modelId, id: item.id, height: item.height });
    return [...seen.values()];
  }, [layout]);
  const neededKey = needed.map((n) => `${n.modelId}@${n.height}`).join(',');

  useEffect(() => {
    let live = true;
    for (const { modelId, id, height } of needed) {
      if (modelShapes.get()[id] === undefined) modelShapes.set({ [id]: 'loading' });
      loadModel(modelId, height).then((model) => {
        modelShapes.set({ [id]: model ? 'ready' : 'failed' });
        if (live) setShapes((prev) => (modelId in prev && prev[modelId] === model ? prev : { ...prev, [modelId]: model }));
      });
    }
    return () => {
      live = false;
    };
    // `needed` changes only with its key.
  }, [neededKey]);

  const shadowMaterial = useMemo(() => createGroundMaterial(uniforms, true), [uniforms]);
  useEffect(() => () => shadowMaterial.dispose(), [shadowMaterial]);

  useFrame(() => {
    const landed = !now.beforeLanding;
    if (bodies.current) bodies.current.visible = landed;
    // While the light fades after a sunset the shadows fade with it (they are ground without sunlight).
    if (shadows.current) shadows.current.visible = landed && now.shadows && now.lit > 0.001;
  });

  return (
    <>
      {/* The models' shapes are kept for the next visit: they are not freed when the stage is left. */}
      <group ref={shadows} visible={false} dispose={null}>
        {layout.items.map((item) => {
          const model = shapes[item.modelId];
          return model ? (
            <mesh key={item.key} geometry={model.shadow} material={shadowMaterial} position={[item.x, 0, item.z]} rotation={[0, item.rotY, 0]} renderOrder={-1} frustumCulled={false} />
          ) : null;
        })}
      </group>
      <group ref={bodies} dispose={null}>
        {layout.items.map((item) => {
          const model = shapes[item.modelId];
          return model ? (
            <group key={item.key} position={[item.x, 0, item.z]} rotation={[0, item.rotY, 0]}>
              {model.parts.map((part, i) => (
                <mesh key={i} geometry={part.geometry} material={part.material} />
              ))}
            </group>
          ) : null;
        })}
      </group>
    </>
  );
}
