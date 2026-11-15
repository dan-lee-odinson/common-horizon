// The star field: fixed points on a far sphere, placed by a seeded sequence so the sky is the same
// on every load. Decoration only: these are not real star positions.

import { useMemo } from 'react';
import * as THREE from 'three';
import { cssColor } from './colors';

export function Stars({ radius = 90, count = 1100, upperOnly = false }: { radius?: number; count?: number; upperOnly?: boolean }) {
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const base = new THREE.Color(cssColor('--ch-star'));
    for (let i = 0; i < count; i++) {
      const u = upperOnly ? rand() * 0.97 + 0.02 : rand() * 2 - 1;
      const t = rand() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      positions.set([radius * s * Math.cos(t), radius * u, radius * s * Math.sin(t)], i * 3);
      // Most stars are faint; a few are bright.
      const k = 0.25 + 0.75 * rand() ** 3;
      colors.set([base.r * k, base.g * k, base.b * k], i * 3);
    }
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return g;
  }, [radius, count, upperOnly]);
  return (
    <points geometry={geometry} frustumCulled={false}>
      {/* Fixed pixel size: the stars look the same however far the camera is. */}
      <pointsMaterial vertexColors size={1.7} sizeAttenuation={false} transparent opacity={0.9} depthWrite={false} toneMapped={false} />
    </points>
  );
}
