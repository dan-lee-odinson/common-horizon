// Runs the clocks. In the Orbit stage time previews forward on its own, from the landing through
// one lunar day, and starts over; it never changes the mission's launch date. (Visitors who prefer
// reduced motion start with the preview paused.) In the site stage time runs only while Play is
// on: from the landing to the end of the stay, at the chosen speed, and stops there. GSAP drives
// both clocks, so they stay in step with the camera and the running readouts.

import { useEffect } from 'react';
import gsap from 'gsap';
import { actions, appStore, orbitClock, simClock } from '../state/app';
import { useData } from '../state/data';
import { useStore } from '../state/store';
import { advanceClock, playStart } from '../util/stay';
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

/**
 * The site stage's clock. While Play is on, each frame moves the simulated instant on by the real
 * time that passed, times the speed (simulated days for each second). It runs through the stay:
 * a press on Play before the landing or at the end of the stay starts from the landing. Nothing
 * here starts by itself: the stage arrives paused, for every visitor.
 */
export function SitePlayback() {
  const stage = useStore(appStore, (s) => s.stage);
  const playing = useStore(appStore, (s) => s.playing);
  const { landingMs, windowEndMs } = useData();

  useEffect(() => {
    if (stage !== 'site' || !playing || landingMs === null || windowEndMs === null || !(windowEndMs > landingMs)) return;
    simClock.set({ nowMs: playStart(simClock.get().nowMs ?? landingMs, landingMs, windowEndMs) });
    const tick = (_time: number, deltaMs: number) => {
      // The speed is read each frame, so changing it takes effect at once and nothing restarts.
      const step = advanceClock(simClock.get().nowMs ?? landingMs, deltaMs, appStore.get().speed, landingMs, windowEndMs);
      simClock.set({ nowMs: step.nowMs });
      if (step.ended) actions.setPlaying(false);
    };
    // First in each frame, so every reader of the clock (the readouts, the plot, the scene) shows
    // this frame's instant and none is a frame behind.
    gsap.ticker.add(tick, false, true);
    return () => gsap.ticker.remove(tick);
  }, [stage, playing, landingMs, windowEndMs]);
  return null;
}
