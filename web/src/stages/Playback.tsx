// Runs the clocks. In the Orbit stage time previews forward on its own, from the landing through
// one lunar day, and starts over; it never changes the mission's launch date. (Visitors who prefer
// reduced motion start with the preview paused.) GSAP drives the clock, so it stays in step with
// the camera and the running readouts.

import { useEffect } from 'react';
import gsap from 'gsap';
import { appStore, orbitClock } from '../state/app';
import { useData } from '../state/data';
import { useStore } from '../state/store';
import { HOUR_MS } from '../util/time';

/** Simulated hours per second of the Orbit preview. */
export const PREVIEW_HOURS_PER_SECOND = 6;

export function OrbitPreview() {
  const stage = useStore(appStore, (s) => s.stage);
  const playing = useStore(appStore, (s) => s.previewPlaying);
  const { landingMs, orbitEndMs } = useData();

  useEffect(() => {
    if (stage !== 'orbit' || !playing || landingMs === null || orbitEndMs === null) return;
    const now = orbitClock.get().nowMs;
    const from = now !== null && now >= landingMs && now < orbitEndMs - 1000 ? now : landingMs;
    const proxy = { t: from };
    const seconds = (a: number, b: number) => (b - a) / HOUR_MS / PREVIEW_HOURS_PER_SECOND;
    const tl = gsap.timeline({ onUpdate: () => orbitClock.set({ nowMs: proxy.t }) });
    tl.to(proxy, { t: orbitEndMs, duration: seconds(from, orbitEndMs), ease: 'none' });
    tl.add(gsap.fromTo(proxy, { t: landingMs }, { t: orbitEndMs, duration: seconds(landingMs, orbitEndMs), ease: 'none', repeat: -1, immediateRender: false }));
    return () => {
      tl.kill();
    };
  }, [stage, playing, landingMs, orbitEndMs]);
  return null;
}
