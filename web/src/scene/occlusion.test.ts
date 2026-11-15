import { describe, expect, it } from 'vitest';
import { hiddenByMoon } from './occlusion';

describe('hidden behind the Moon', () => {
  const camera = { x: 0, y: 0, z: 6 };

  it('hides a body straight behind the Moon', () => {
    expect(hiddenByMoon(camera, { x: 0, y: 0, z: -2.3 })).toBe(true);
    expect(hiddenByMoon(camera, { x: 0.4, y: 0.2, z: -1.8 })).toBe(true);
  });

  it('shows a body in front of the Moon or beside it', () => {
    expect(hiddenByMoon(camera, { x: 0, y: 0, z: 2.3 })).toBe(false);
    expect(hiddenByMoon(camera, { x: 2.3, y: 0, z: 0 })).toBe(false);
    expect(hiddenByMoon(camera, { x: 1.6, y: 0.3, z: -1.2 })).toBe(false);
  });

  it('shows a body behind the Moon once it clears the limb', () => {
    // From 6 radii away the Moon covers about 9.6 degrees either side of its centre.
    expect(hiddenByMoon(camera, { x: 1.2, y: 0, z: -2 })).toBe(true);
    expect(hiddenByMoon(camera, { x: 1.5, y: 0, z: -2 })).toBe(false);
  });

  it('hides the Sun on its ring when the camera looks from the opposite side, raised above the ring plane', () => {
    // The Orbit camera: 6 radii out, 23 degrees above the ring plane. The Sun rides a ring 2.3 radii out.
    const el = (23 * Math.PI) / 180;
    const orbitCamera = { x: 6 * Math.cos(el), y: 6 * Math.sin(el), z: 0 };
    expect(hiddenByMoon(orbitCamera, { x: -2.3, y: 0, z: 0 })).toBe(true);
    expect(hiddenByMoon(orbitCamera, { x: 2.3, y: 0, z: 0 })).toBe(false);
    expect(hiddenByMoon(orbitCamera, { x: 0, y: 0, z: 2.3 })).toBe(false);
  });
});
