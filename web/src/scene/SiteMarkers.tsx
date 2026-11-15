// A plain labelled marker for each item of the mission that has no 3D model (state/models.ts holds
// the table of which items have one): a thin post with the item's catalog name and count. It is a
// sign, not a shape: it has no size of its own, and where it stands is an illustration, like the
// rest of the layout (siteLayout.ts). Hidden before the landing, like the hardware.

import { useRef } from 'react';
import { Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import type * as THREE from 'three';
import { MARKER_HEIGHT_M, type SiteLayout } from './siteLayout';
import type { SiteNow } from './siteNow';

export function SiteMarkers({ layout, names, now, active }: { layout: SiteLayout; names: Readonly<Record<string, string>>; now: SiteNow; active: boolean }) {
  const group = useRef<THREE.Group>(null);
  const labels = useRef<(HTMLDivElement | null)[]>([]);
  useFrame(() => {
    const show = active && !now.beforeLanding;
    if (group.current) group.current.visible = show;
    for (const el of labels.current) if (el) el.style.display = show ? '' : 'none';
  });
  if (layout.markers.length === 0) return null;
  return (
    <group ref={group} dispose={null}>
      {layout.markers.map((m, i) => (
        <group key={m.key} position={[m.x, 0, m.z]}>
          <mesh position={[0, MARKER_HEIGHT_M / 2, 0]}>
            <cylinderGeometry args={[0.06, 0.06, MARKER_HEIGHT_M, 6]} />
            <meshBasicMaterial color="#9fb3c8" />
          </mesh>
          <Html position={[0, MARKER_HEIGHT_M, 0]} center zIndexRange={[2, 0]} style={{ pointerEvents: 'none' }}>
            <div
              ref={(el) => {
                labels.current[i] = el;
              }}
              className="tag whitespace-nowrap bg-glass-strong normal-case tracking-[0.02em] text-ink"
              data-testid="site-marker"
              data-id={m.id}
            >
              {names[m.id] ?? m.id}
              {m.count > 1 ? ` × ${m.count}` : ''}
            </div>
          </Html>
        </group>
      ))}
    </group>
  );
}
