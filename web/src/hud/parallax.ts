// Gentle parallax: HUD layers shift and lean a little with the pointer (and with the tilt of a
// phone), each by its own depth, so the panels read as floating at different distances.
// The lean is at most 1.5 degrees, so with a wing's own 6 degrees a panel never tilts past 8.
// Off for visitors who prefer reduced motion.

import { useEffect, useRef, type RefObject } from 'react';
import gsap from 'gsap';

/** Pixels a layer of depth 1 shifts at the edge of the screen. */
const SHIFT_PX = 9;
/** Degrees a layer of depth 1 leans at the edge of the screen. */
const LEAN_DEG = 1.2;
const MAX_DEPTH = 1.25;
/** Degrees of phone tilt that count as the edge of the screen. */
const TILT_RANGE = 22;

interface DeviceOrientationPermission {
  requestPermission?: () => Promise<'granted' | 'denied'>;
}

/**
 * Ask for the phone's tilt where the browser needs a tap first (iOS). Call from a button press.
 * Browsers that need no permission, or have no tilt sensor, are left alone; so are visitors who
 * prefer reduced motion (the parallax is off for them).
 */
export function requestTiltAccess(): void {
  if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const D = (globalThis as { DeviceOrientationEvent?: DeviceOrientationPermission }).DeviceOrientationEvent;
  if (D && typeof D.requestPermission === 'function') D.requestPermission().catch(() => undefined);
}

/** Layers are the elements under `rootRef` carrying data-depth (0.25 near the scene .. 1.25 near the viewer). */
export function useParallax(rootRef: RefObject<HTMLElement | null>, deps: readonly unknown[] = []): void {
  // Where the pointer (or the tilt) last put the layers. Kept across re-runs, so new layers start
  // where the old ones were instead of snapping back to the middle.
  const last = useRef({ nx: 0, ny: 0 });
  const level = useRef<{ beta: number; gamma: number } | null>(null);

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
      const move = (nx: number, ny: number, instant = false) => {
        last.current = { nx, ny };
        for (const l of layers) {
          const x = -nx * SHIFT_PX * l.depth;
          const y = -ny * SHIFT_PX * l.depth;
          const ry = nx * LEAN_DEG * l.depth;
          const rx = -ny * LEAN_DEG * l.depth;
          // With a start value equal to the end value the setter places the layer without a tween.
          if (instant) {
            l.x(x, x);
            l.y(y, y);
            l.ry(ry, ry);
            l.rx(rx, rx);
          } else {
            l.x(x);
            l.y(y);
            l.ry(ry);
            l.rx(rx);
          }
        }
      };
      move(last.current.nx, last.current.ny, true);

      const onPointer = (e: PointerEvent) => {
        if (e.pointerType === 'touch') return;
        move((e.clientX / window.innerWidth) * 2 - 1, (e.clientY / window.innerHeight) * 2 - 1);
      };
      window.addEventListener('pointermove', onPointer, { passive: true });

      // Phone tilt, on touch screens only (a laptop with a sensor keeps to its pointer).
      const coarse = window.matchMedia('(pointer: coarse)').matches;
      const onTilt = (e: DeviceOrientationEvent) => {
        if (e.gamma === null || e.beta === null) return;
        // Turn the two angles to match how the screen is held.
        const turn = (screen.orientation?.angle ?? 0) % 360;
        let across = e.gamma;
        let along = e.beta;
        if (turn === 90) [across, along] = [e.beta, -e.gamma];
        else if (turn === 270) [across, along] = [-e.beta, e.gamma];
        else if (turn === 180) [across, along] = [-e.gamma, -e.beta];
        // The way the phone is held counts as level, and "level" follows slowly, so a new posture
        // re-centres within a few seconds instead of pinning the layers at one edge.
        const base = (level.current ??= { beta: along, gamma: across });
        base.beta += (along - base.beta) * 0.02;
        base.gamma += (across - base.gamma) * 0.02;
        move(gsap.utils.clamp(-1, 1, (across - base.gamma) / TILT_RANGE), gsap.utils.clamp(-1, 1, (along - base.beta) / TILT_RANGE));
      };
      if (coarse) window.addEventListener('deviceorientation', onTilt, { passive: true });
      return () => {
        window.removeEventListener('pointermove', onPointer);
        window.removeEventListener('deviceorientation', onTilt);
      };
    });
    return () => mm.revert();
    // The layers are looked up again when the HUD's content changes.
  }, [rootRef, ...deps]);
}
