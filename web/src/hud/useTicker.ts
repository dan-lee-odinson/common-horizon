// Runs a callback once per animation frame on GSAP's shared ticker (one clock for every running
// readout, graph cursor and leader line, in step with the camera moves).

import { useEffect, useRef } from 'react';
import gsap from 'gsap';

export function useTicker(callback: () => void, active = true): void {
  const ref = useRef(callback);
  ref.current = callback;
  useEffect(() => {
    if (!active) return;
    const tick = () => ref.current();
    gsap.ticker.add(tick);
    tick();
    return () => gsap.ticker.remove(tick);
  }, [active]);
}
