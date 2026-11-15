// The entrance of a stage's HUD: one short, authored moment when the stage arrives.
//
// Each moving container carries data-enter:
//   lead    the stage's main element: first, and travels the most
//   left    a left wing: slides in from the left
//   right   a right wing: slides in from the right
//   rise    support: a short rise
//   fade    decoration: fades in place
// One entrance per container: the children of a wing do not animate again inside it.
// Visitors who prefer reduced motion get a plain, short fade of everything together.
//
// The entrance fades with opacity only and never hides a container (no `visibility: hidden`): a
// hidden control refuses keyboard focus and drops out of the Tab order, so a key pressed while the
// stage arrives would be lost. Controls work from the first frame; the entrance is only paint.

import { useLayoutEffect, type RefObject } from 'react';
import gsap from 'gsap';

export function useEntrance(rootRef: RefObject<HTMLElement | null>, play: boolean, delay = 0): void {
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || !play) return;
    const mm = gsap.matchMedia();
    mm.add(
      { reduce: '(prefers-reduced-motion: reduce)', move: '(prefers-reduced-motion: no-preference)' },
      (context) => {
        const all = root.querySelectorAll('[data-enter]');
        if (all.length === 0) return;
        if (context.conditions?.reduce) {
          gsap.from(all, { opacity: 0, duration: 0.2, ease: 'none', clearProps: 'opacity' });
          return;
        }
        const tl = gsap.timeline({ delay, defaults: { ease: 'expo.out', clearProps: 'opacity,transform' } });
        const group = (kind: string) => Array.from(root.querySelectorAll(`[data-enter="${kind}"]`));
        const add = (kind: string, vars: gsap.TweenVars, at: number) => {
          const els = group(kind);
          if (els.length) tl.from(els, vars, at);
        };
        add('lead', { opacity: 0, y: 22, duration: 0.62 }, 0);
        add('left', { opacity: 0, x: -30, duration: 0.56 }, 0.07);
        add('right', { opacity: 0, x: 30, duration: 0.56 }, 0.12);
        add('rise', { opacity: 0, y: 12, duration: 0.5 }, 0.16);
        add('fade', { opacity: 0, duration: 0.45, ease: 'power1.out' }, 0.22);
      },
      root,
    );
    return () => mm.revert();
  }, [rootRef, play, delay]);
}
