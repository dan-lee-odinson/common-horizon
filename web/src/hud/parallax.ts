// Gentle parallax: HUD layers shift and lean a little with the pointer (and with the tilt of a
// phone), each by its own depth, so the panels read as floating at different distances.
// The lean is at most 1.5 degrees, so with a wing's own 6 degrees a panel never tilts past 8.
// Off for visitors who prefer reduced motion.

import { useEffect, type RefObject } from 'react';
import gsap from 'gsap';

/** Pixels a layer of depth 1 shifts at the edge of the screen. */
const SHIFT_PX = 9;
/** Degrees a layer of depth 1 leans at the edge of the screen. */
const LEAN_DEG = 1.2;
const MAX_DEPTH = 1.25;

interface DeviceOrientationPermission {
  requestPermission?: () => Promise<'granted' | 'denied'>;
}

/**
 * Ask for the phone's tilt where the browser needs a tap first (iOS). Call from a button press.
 * Browsers that need no permission, or have no tilt sensor, are left alone.
 */
export function requestTiltAccess(): void {
  const D = (globalThis as { DeviceOrientationEvent?: DeviceOrientationPermission }).DeviceOrientationEvent;
  if (D && typeof D.requestPermission === 'function') D.requestPermission().catch(() => undefined);
}

/** Layers are the elements under `rootRef` carrying data-depth (0.25 near the scene .. 1.25 near the viewer). */
export function useParallax(rootRef: RefObject<HTMLElement | null>, deps: readonly unknown[] = []): void {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const mm = gsap.matchMedia();
    mm.add('(prefers-reduced-motion: no-preference)', () => {
      const layers = Array.from(root.querySelectorAll<HTMLElement>('[data-depth]')).map((el) => {
        const depth = Math.min(MAX_DEPTH, Math.max(0, Number(el.dataset.depth) || 0));
        const opts = { duration: 0.9, ease: 'power3.out' };
        return {
          depth,
          x: gsap.quickTo(el, 'x', opts),
          y: gsap.quickTo(el, 'y', opts),
          rx: gsap.quickTo(el, 'rotationX', opts),
          ry: gsap.quickTo(el, 'rotationY', opts),
        };
      });
      const move = (nx: number, ny: number) => {
        for (const l of layers) {
          l.x(-nx * SHIFT_PX * l.depth);
          l.y(-ny * SHIFT_PX * l.depth);
          l.ry(nx * LEAN_DEG * l.depth);
          l.rx(-ny * LEAN_DEG * l.depth);
        }
      };
      const onPointer = (e: PointerEvent) => {
        if (e.pointerType === 'touch') return;
        move((e.clientX / window.innerWidth) * 2 - 1, (e.clientY / window.innerHeight) * 2 - 1);
      };
      let baseBeta: number | null = null;
      const onTilt = (e: DeviceOrientationEvent) => {
        if (e.gamma === null || e.beta === null) return;
        // The angle the phone is first held at counts as level.
        baseBeta ??= e.beta;
        move(gsap.utils.clamp(-1, 1, e.gamma / 22), gsap.utils.clamp(-1, 1, (e.beta - baseBeta) / 22));
      };
      window.addEventListener('pointermove', onPointer, { passive: true });
      window.addEventListener('deviceorientation', onTilt, { passive: true });
      return () => {
        window.removeEventListener('pointermove', onPointer);
        window.removeEventListener('deviceorientation', onTilt);
      };
    });
    return () => mm.revert();
    // The layers are looked up again when the HUD's content changes.
  }, [rootRef, ...deps]);
}
