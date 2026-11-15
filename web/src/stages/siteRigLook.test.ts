// The Site stage's "Look" buttons ask the camera rig (scene/SiteRig.tsx) to turn the view to the Sun
// or Earth. A press while the camera is still coming down to the site used to be marked done and
// dropped; it is now kept and carried out once the camera rests. (This test lives here, not in
// scene/, to leave that folder to the terrain work going on there.)

import { describe, expect, it } from 'vitest';
import { lookStep } from '../scene/SiteRig';

describe('a "Look" request', () => {
  it('is carried out at once while the camera rests', () => {
    expect(lookStep(1, 0, 'rest')).toBe('turn');
  });

  it('pressed on the way down is kept, not dropped', () => {
    expect(lookStep(1, 0, 'descent')).toBe('wait');
    expect(lookStep(1, 0, 'idle')).toBe('wait');
  });

  it('is carried out once, when the camera comes to rest', () => {
    // On arrival the rig takes the count as it stands: nothing is pending.
    let looked = 0;
    let mode: 'idle' | 'descent' | 'rest' = 'descent';
    expect(lookStep(0, looked, mode)).toBe('done');
    // "Look" at Earth, 0.3 s before the descent ends (as in the failing browser run).
    const seq = 1;
    expect(lookStep(seq, looked, mode)).toBe('wait');
    // The camera comes to rest: the rig asks again, and the kept request is carried out.
    mode = 'rest';
    expect(lookStep(seq, looked, mode)).toBe('turn');
    looked = seq;
    // Asked again (another re-render) it is not carried out a second time.
    expect(lookStep(seq, looked, mode)).toBe('done');
  });

  it('a later press replaces a kept one: the newest is the one carried out', () => {
    const looked = 0;
    expect(lookStep(1, looked, 'descent')).toBe('wait');
    expect(lookStep(2, looked, 'descent')).toBe('wait');
    expect(lookStep(2, looked, 'rest')).toBe('turn');
  });
});
