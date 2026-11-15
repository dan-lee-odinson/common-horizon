// Is 3D available? The answer is no when the browser has no WebGL, or when the page address
// has ?webgl=off (handy for testing the fallback on any machine).

let cached: boolean | null = null;

export function hasWebGL(): boolean {
  if (cached !== null) return cached;
  if (typeof window === 'undefined') return (cached = false);
  if (new URLSearchParams(window.location.search).get('webgl') === 'off') return (cached = false);
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    cached = Boolean(gl);
    (gl as WebGLRenderingContext | null)?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    cached = false;
  }
  return cached;
}
