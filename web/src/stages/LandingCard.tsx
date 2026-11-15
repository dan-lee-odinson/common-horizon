// The landing card: a glass card over the Orbit stage on first load, with the rings still turning
// behind it. It says what the app is, what it is for and how to use it. "Begin", Escape or a press
// outside closes it; "About" in the top bar opens it again. Text only: no logo.

import { useLayoutEffect, useRef } from 'react';
import gsap from 'gsap';
import { isMockMode } from '../api/client';
import { useLayer } from '../hud/focus';
import { requestTiltAccess } from '../hud/parallax';
import { actions, appStore } from '../state/app';
import { useStore } from '../state/store';

export function LandingCard() {
  const open = useStore(appStore, (s) => s.cardOpen);
  const ref = useRef<HTMLDivElement>(null);
  useLayer(ref, open, actions.closeCard, { trap: true, closeOnOutside: true, initialFocus: '[data-begin]' });

  // The card rises into place once when it opens. No movement for visitors who prefer reduced motion.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !open) return;
    const mm = gsap.matchMedia();
    mm.add('(prefers-reduced-motion: no-preference)', () => {
      gsap.from(el, { autoAlpha: 0, y: 26, scale: 0.975, duration: 0.7, ease: 'expo.out', clearProps: 'opacity,visibility,transform' });
    });
    return () => mm.revert();
  }, [open]);

  if (!open) return null;
  return (
    <div className="absolute inset-0 z-[60] grid place-items-center overflow-y-auto p-4" data-testid="landing-layer">
      <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse at center, rgb(1 4 9 / 0.5), rgb(1 4 9 / 0.78))' }} aria-hidden />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="landing-title"
        aria-describedby="landing-line"
        tabIndex={-1}
        className="glass glass-strong brackets relative flex w-full max-w-[41rem] flex-col gap-6 px-9 py-8 outline-none max-md:gap-4 max-md:px-5 max-md:py-6"
        data-testid="landing-card"
      >
        <div className="flex flex-col gap-2.5">
          <h2 id="landing-title" className="title m-0 text-[clamp(2rem,5vw,2.9rem)] uppercase tracking-[0.07em] text-ink">
            Common Horizon
          </h2>
          <p id="landing-line" className="m-0 font-display text-[clamp(1.05rem,2.1vw,1.3rem)] font-medium tracking-[0.02em] text-accent">
            Where to land on the Moon, and when.
          </p>
        </div>

        <p className="m-0 max-w-[62ch] text-[16px] leading-[1.6] text-ink">
          Common Horizon ranks lunar landing sites for a mission you define. It shows how much sunlight each site gets, whether Earth is in view for communications, and
          whether your hardware has power through the dark. Change the launch date and the ranking changes with it.
        </p>

        <div className="flex flex-col gap-2.5">
          <h3 className="label m-0">How to use it</h3>
          <ol className="m-0 flex list-none flex-col gap-2 p-0 text-[15px] leading-[1.5] text-ink">
            {[
              'Set your mission: lander, hardware, launch date and length of stay.',
              'Compare the ranked sites, then drag the launch delay to see what a late launch does.',
              'Zoom in to a site and watch the Sun cross its horizon.',
            ].map((step, i) => (
              <li key={step} className="flex gap-3">
                <span className="num w-5 shrink-0 text-accent" aria-hidden>
                  {i + 1}.
                </span>
                <span>
                  <span className="sr-only">{i + 1}. </span>
                  {step}
                </span>
              </li>
            ))}
          </ol>
        </div>

        <div className="flex items-center gap-4">
          <button
            type="button"
            className="btn btn-primary btn-lg min-w-[9.5rem]"
            data-begin
            onClick={() => {
              requestTiltAccess();
              actions.closeCard();
            }}
            data-testid="begin"
          >
            Begin
          </button>
        </div>

        <p className="m-0 border-t border-line pt-4 text-[13px] leading-[1.55] text-ink-2">
          Built by Team Common Horizon for the NASA Space Apps Challenge 2026, challenge “Lunar Landing Site Navigator”. Not endorsed by NASA.
          {isMockMode() ? ' Numbers marked “Example data” are placeholders.' : ''}
        </p>
      </div>
    </div>
  );
}
