import { useSyncExternalStore } from 'react';

const PHONE_QUERY = '(max-width: 767px)';
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';
/** The same limit as the `short:` style variant (styles/index.css): a laptop screen about 720 px tall. */
const SHORT_QUERY = '(max-height: 820px)';

function subscribeTo(query: string) {
  return (cb: () => void) => {
    const mql = window.matchMedia(query);
    mql.addEventListener('change', cb);
    return () => mql.removeEventListener('change', cb);
  };
}

const subscribePhone = subscribeTo(PHONE_QUERY);
const subscribeMotion = subscribeTo(REDUCED_MOTION_QUERY);
const subscribeShort = subscribeTo(SHORT_QUERY);

/** True at phone widths, where the planner and panels become drawers. */
export function useIsPhone(): boolean {
  return useSyncExternalStore(subscribePhone, () => window.matchMedia(PHONE_QUERY).matches, () => false);
}

/** True in a short window, where tall panels tighten and graphs take less height. */
export function useShortWindow(): boolean {
  return useSyncExternalStore(subscribeShort, () => window.matchMedia(SHORT_QUERY).matches, () => false);
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribeMotion, () => window.matchMedia(REDUCED_MOTION_QUERY).matches, () => false);
}

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia(REDUCED_MOTION_QUERY).matches;
}
