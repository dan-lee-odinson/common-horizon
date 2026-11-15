// A veil between the 3D space and the HUD, for the moment the camera changes worlds.
//
// The Moon and the site's terrain are two worlds inside one canvas (one in Moon radii, one in
// metres). The dive to a site ends looking down at it; the veil closes over the last moments of
// the dive, the camera is placed in the site's world behind it, and it lifts on the descent that
// follows. Coming back, it closes at once and lifts on the climb. It is a blink in one descent:
// short, soft, and opacity only. Visitors who prefer reduced motion get a short plain fade.
//
// Only the picture is veiled. The HUD stays above it, so every control answers throughout.

import { useLayoutEffect, useRef } from 'react';
import gsap from 'gsap';
import { appStore } from '../state/app';
import { useStore } from '../state/store';
import { prefersReducedMotion } from '../state/useMedia';

/** Seconds. The dive lasts 1.5 s (see CameraDirector): the veil closes over its last 0.4 s. */
const CLOSE_AT = 1.1;
const CLOSE_S = 0.4;
/** After the change of world the scene is given a moment to draw before the veil lifts. */
const HOLD_S = 0.1;
const LIFT_IN_S = 0.45;
const LIFT_OUT_S = 0.4;
const REDUCED_S = 0.2;

export function SiteVeil() {
  const atSite = useStore(appStore, (s) => s.stage === 'site');
  const diving = useStore(appStore, (s) => s.flight === 'in');
  const ref = useRef<HTMLDivElement>(null);
  const wasAtSite = useRef(atSite);

  // The dive: close over its last moments. If the dive ends anywhere but at the site, open again.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !diving || prefersReducedMotion()) return;
    const closing = gsap.timeline().to(el, { opacity: 1, duration: CLOSE_S, ease: 'power1.in' }, CLOSE_AT);
    return () => {
      closing.kill();
      if (appStore.get().stage !== 'site') gsap.set(el, { opacity: 0 });
    };
  }, [diving]);

  // The change of world, either way: closed at once, then lifted.
  useLayoutEffect(() => {
    const el = ref.current;
    const changed = wasAtSite.current !== atSite;
    wasAtSite.current = atSite;
    if (!el || !changed) return;
    const reduced = prefersReducedMotion();
    gsap.set(el, { opacity: 1 });
    const lifting = gsap
      .timeline()
      .to(el, { opacity: 0, duration: reduced ? REDUCED_S : atSite ? LIFT_IN_S : LIFT_OUT_S, ease: reduced ? 'none' : 'power2.out' }, HOLD_S);
    return () => {
      lifting.kill();
    };
  }, [atSite]);

  return <div ref={ref} className="pointer-events-none absolute inset-0 bg-space" style={{ opacity: 0 }} aria-hidden data-testid="site-veil" />;
}
