// The site scene's shared clock: what the light, the ground and the shadows are told each frame.

import { beforeAll, describe, expect, it } from 'vitest';
import sitesJson from '../api/examples/sites.json';
import { configureMock } from '../api/mock';
import { horizonFor, TRANSIT_DAYS } from '../api/mock/model';
import type { SiteRef } from '../api/types';
import { clearGeometryCache, loadTrack } from '../state/geometry';
import { DEG, RAD } from '../util/geo';
import { litPeriods } from '../util/horizon';
import { skyAt } from '../util/quantities';
import { projectToGround, SHADOW_MIN_EL_DEG } from '../util/shadow';
import { DAY_MS, HOUR_MS, SYNODIC_MONTH_DAYS } from '../util/time';
import type { GeometryTrack } from '../util/track';
import { createGroundMaterial, createGroundUniforms, createSiteClock, createSiteNow } from './siteNow';
import { groundCutDeg, groundSunTerm, skylineMinDeg } from './siteView';

const LAUNCH = Date.UTC(2027, 1, 10, 15, 0, 0);
const LANDING = LAUNCH + TRANSIT_DAYS * DAY_MS;
const site = (id: string) => (sitesJson.sites as SiteRef[]).find((s) => s.id === id)!;

let track: GeometryTrack;
beforeAll(async () => {
  configureMock({ latencyMs: 0, scenario: { mode: 'normal', assistant: 'on' } });
  clearGeometryCache();
  track = await loadTrack(LAUNCH, SYNODIC_MONTH_DAYS);
});

function setup(id: string) {
  const s = site(id);
  const horizon = horizonFor(s, LANDING, LANDING + 14 * DAY_MS, 0.25);
  const now = createSiteNow();
  const uniforms = createGroundUniforms();
  const update = createSiteClock(now, uniforms);
  const at = (tMs: number | null, deltaS = 1, instant = false, over: { horizon?: typeof horizon | null; landingMs?: number } = {}) =>
    update({ track, landingMs: over.landingMs ?? LANDING, site: s, horizon: over.horizon === undefined ? horizon : over.horizon, tMs }, deltaS, instant);
  return { s, horizon, now, uniforms, at };
}

describe('the site scene reads the same sky as the readouts', () => {
  it('points the light along the readouts’ own Sun direction', () => {
    const { s, horizon, now, at } = setup('apollo-11');
    for (let k = 0; k < 30; k++) {
      const tMs = LANDING + k * 11 * HOUR_MS;
      at(tMs);
      const sky = skyAt({ track, tMs, landingMs: LANDING, site: s, horizon });
      expect(now.sky).toEqual(sky);
      expect(now.hasSun).toBe(true);
      expect(now.sunDir.length()).toBeCloseTo(1, 12);
      expect(Math.asin(now.sunDir.y) * RAD).toBeCloseTo(sky.sun!.el, 9);
      expect((Math.atan2(now.sunDir.x, -now.sunDir.z) * RAD + 360) % 360).toBeCloseTo(sky.sun!.az, 7);
    }
  });

  it('casts shadows of the right length, pointing away from the Sun', () => {
    const { now, uniforms, at } = setup('apollo-11');
    let checked = 0;
    for (let k = 0; k < 14 * 24; k += 5) {
      at(LANDING + k * HOUR_MS);
      const sun = now.sky!.sun!;
      if (!now.shadows) {
        // No length to draw: the Sun's disc is not wholly above level.
        expect(sun.el).toBeLessThan(SHADOW_MIN_EL_DEG);
        continue;
      }
      // The top of a 52 m lander, dropped onto the ground the way the shader does it.
      const h = 52;
      const tip = projectToGround({ x: 0, y: h, z: 0 }, { x: uniforms.uShadow.value.x, z: uniforms.uShadow.value.y });
      expect(tip.y).toBe(0);
      // Length: h / tan(elevation).
      expect(Math.hypot(tip.x, tip.z)).toBeCloseTo(h / Math.tan(sun.el * DEG), 6);
      // Bearing: straight away from the Sun.
      const bearing = (Math.atan2(tip.x, -tip.z) * RAD + 360) % 360;
      expect(Math.abs(((bearing - (sun.az + 180) + 540) % 360) - 180)).toBeLessThan(1e-6);
      checked++;
    }
    expect(checked).toBeGreaterThan(20);
  });

  it('lights the ground by the Sun’s height, and only while the horizon answer says lit', () => {
    const { horizon, now, uniforms, at } = setup('apollo-11');
    const periods = litPeriods(horizon);
    const lit = periods.find((p) => p.lit)!;
    const dark = periods.find((p) => !p.lit)!;
    at((lit.start + lit.end) / 2, 1);
    expect(now.sky!.lit).toBe(true);
    expect(now.lit).toBe(1);
    expect(uniforms.uLit.value).toBe(1);
    expect(uniforms.uSunTerm.value).toBe(groundSunTerm(now.sky!.sun!.el));
    // Dark: the light eases out over a fifth of a second of real time, and stays out.
    at((dark.start + dark.end) / 2, 0.05);
    expect(now.sky!.lit).toBe(false);
    expect(now.lit).toBeCloseTo(0.75, 12);
    at((dark.start + dark.end) / 2, 0.05);
    expect(uniforms.uLit.value).toBeCloseTo(0.5, 12);
    at((dark.start + dark.end) / 2, 5);
    expect(now.lit).toBe(0);
    expect(uniforms.uLit.value).toBe(0);
    // For visitors who prefer reduced motion the light changes at once.
    at((lit.start + lit.end) / 2, 0.016, true);
    expect(now.lit).toBe(1);
  });

  it('stays dim with no horizon answer for the site, and draws the ground to its default cut', () => {
    const { now, uniforms, at } = setup('shackleton-ridge');
    at(LANDING + HOUR_MS, 1, false, { horizon: null });
    expect(now.sky!.lit).toBeNull();
    expect(now.lit).toBe(0);
    expect(now.hasSun).toBe(true);
    expect(uniforms.uTanCut.value).toBeCloseTo(Math.tan(0.5 * DEG), 12);
    // No instant at all: nothing is known.
    at(null);
    expect(now.sky).toBeNull();
    expect(now.hasSun).toBe(false);
    expect(now.shadows).toBe(false);
    expect(uniforms.uSunTerm.value).toBe(0);
  });

  it('cuts the ground off under the lowest point of this site’s skyline', () => {
    const { horizon, uniforms, at } = setup('shackleton-ridge');
    at(LANDING);
    const cut = groundCutDeg(skylineMinDeg(horizon.skyline));
    expect(cut).toBeLessThan(-0.5);
    expect(uniforms.uTanCut.value).toBeCloseTo(Math.tan(-cut * DEG), 12);
  });

  it('knows when the instant shown is before the landing', () => {
    const { now, at } = setup('apollo-11');
    const landing = LANDING + 3 * DAY_MS;
    at(LANDING + DAY_MS, 1, false, { landingMs: landing });
    expect(now.beforeLanding).toBe(true);
    at(landing, 1, false, { landingMs: landing });
    expect(now.beforeLanding).toBe(false);
    at(landing + HOUR_MS, 1, false, { landingMs: landing });
    expect(now.beforeLanding).toBe(false);
  });
});

describe('the ground and the shadows share one set of values', () => {
  it('a value written once reaches both materials', () => {
    const uniforms = createGroundUniforms();
    const ground = createGroundMaterial(uniforms, false);
    const shadow = createGroundMaterial(uniforms, true);
    uniforms.uLit.value = 0.4;
    uniforms.uShadow.value.set(3, -7);
    for (const m of [ground, shadow]) {
      expect(m.uniforms.uLit.value).toBe(0.4);
      expect(m.uniforms.uShadow.value.x).toBe(3);
      expect(m.uniforms.uTanCut).toBe(uniforms.uTanCut);
    }
    // They differ only in what they are: the ground is lit directly, a shadow is not.
    expect([ground.uniforms.uProject.value, ground.uniforms.uDirect.value]).toEqual([0, 1]);
    expect([shadow.uniforms.uProject.value, shadow.uniforms.uDirect.value]).toEqual([1, 0]);
    // A shadow is laid over the ground and leaves the depth alone, so the hardware stands in front of it.
    expect(shadow.depthTest).toBe(false);
    expect(shadow.depthWrite).toBe(false);
    expect(ground.depthWrite).toBe(true);
  });
});
