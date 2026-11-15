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

let corona: THREE.Texture | null = null;

/**
 * The Sun's corona: a wide, faint glow with a few soft streamers, drawn once on a canvas. The
 * streamers are set by a fixed rule (no chance in it), so the picture is the same on every visit.
 */
export function coronaTexture(): THREE.Texture {
  if (corona) return corona;
  const size = 256;
  const c = size / 2;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const g = ctx.createRadialGradient(c, c, 0, c, c, c);
    g.addColorStop(0, 'rgba(255,255,255,0.85)');
    g.addColorStop(0.08, 'rgba(255,255,255,0.42)');
    g.addColorStop(0.25, 'rgba(255,255,255,0.14)');
    g.addColorStop(0.6, 'rgba(255,255,255,0.035)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 14; i++) {
      const angle = (i / 14) * Math.PI * 2 + (i % 3) * 0.21;
      const length = c * (0.55 + 0.4 * (((i * 7) % 5) / 5));
      const halfWidth = 0.035 + 0.02 * (((i * 3) % 4) / 4);
      const streak = ctx.createLinearGradient(c, c, c + Math.cos(angle) * length, c + Math.sin(angle) * length);
      streak.addColorStop(0, 'rgba(255,255,255,0.11)');
      streak.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = streak;
      ctx.beginPath();
      ctx.moveTo(c, c);
      ctx.arc(c, c, length, angle - halfWidth, angle + halfWidth);
      ctx.closePath();
      ctx.fill();
    }
  }
  corona = new THREE.CanvasTexture(canvas);
  corona.colorSpace = THREE.SRGBColorSpace;
  return corona;
}
