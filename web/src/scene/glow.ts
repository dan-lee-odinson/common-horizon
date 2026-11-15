// A soft round glow, drawn once on a canvas and used on additive sprites: the layered light around
// the Sun, Earth and the Moon's limb. (Sprites and shader lines carry the glow; there is no
// full-screen bloom pass.)

import * as THREE from 'three';

let cached: THREE.Texture | null = null;

export function glowTexture(): THREE.Texture {
  if (cached) return cached;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.12, 'rgba(255,255,255,0.55)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.16)');
    g.addColorStop(0.7, 'rgba(255,255,255,0.04)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  cached = new THREE.CanvasTexture(canvas);
  cached.colorSpace = THREE.SRGBColorSpace;
  return cached;
}
