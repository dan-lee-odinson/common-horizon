// What every part of the site world reads each frame: the sky at the instant shown, worked out once
// (by the same function as the HUD's readouts, `skyAt`) and shared, so the Sun's disc, the light,
// the shadows and the ground can never show different instants.

import * as THREE from 'three';
import type { HorizonResponse } from '../api/types';
import { azElToLocal } from '../util/geo';
import { skyAt, type SkyNow } from '../util/quantities';
import { shadowOffsetPerMetre } from '../util/shadow';
import type { GeometryTrack } from '../util/track';
import { cssColor } from './colors';
import { GROUND_FRAGMENT, GROUND_VERTEX, TERRAIN_FRAGMENT, TERRAIN_VERTEX } from './siteShaders';
import { groundCutDeg, groundSunTerm, SITE_VIEW, skylineMinDeg } from './siteView';

export interface SiteNow {
  /** The sky at the instant shown; null before any data. */
  sky: SkyNow | null;
  /** Unit vector toward the Sun in the site's frame (x east, y up, z south). Valid while `hasSun`. */
  sunDir: THREE.Vector3;
  hasSun: boolean;
  /** The horizon answer's word, eased: 1 lit, 0 dark or not known. */
  lit: number;
  /** True while a shadow has a length that can be drawn: the Sun's whole disc is above level. */
  shadows: boolean;
  /** True while the instant shown is before the landing: no hardware stands at the site yet. */
  beforeLanding: boolean;
}

export function createSiteNow(): SiteNow {
  return { sky: null, sunDir: new THREE.Vector3(0, 1, 0), hasSun: false, lit: 0, shadows: false, beforeLanding: false };
}

/** The uniforms the ground and the shadows share (see siteShaders.ts). */
export function createGroundUniforms() {
  return {
    uGround: { value: new THREE.Color(cssColor('--ch-ground')) },
    uBand: { value: new THREE.Color(cssColor('--ch-terrain')) },
    uLine: { value: new THREE.Color(cssColor('--ch-cyan')).multiplyScalar(0.55) },
    uTanCut: { value: Math.tan((-groundCutDeg(null) * Math.PI) / 180) },
    uLit: { value: 0 },
    uSunTerm: { value: 0 },
    uAmbient: { value: SITE_VIEW.ambient },
    uRadius: { value: SITE_VIEW.groundRadius },
    uRings: { value: new THREE.Vector3(SITE_VIEW.ringMinor, SITE_VIEW.ringMinorTo, SITE_VIEW.ringMajor) },
    uShadow: { value: new THREE.Vector2(0, 0) },
    /** Toward the Sun, for the real ground's slopes; straight down while there is no Sun. */
    uSunDir: { value: new THREE.Vector3(0, -1, 0) },
  };
}

export type GroundUniforms = ReturnType<typeof createGroundUniforms>;

/**
 * The ground's material, or (`shadow`) the material that draws a model's shadow on the ground.
 * Both are built here, by hand, so that they hold the very same uniform objects: one write to a
 * shared value (the lit word, the Sun's height, the shadow's direction) reaches both.
 */
export function createGroundMaterial(uniforms: GroundUniforms, shadow: boolean): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: GROUND_VERTEX,
    fragmentShader: GROUND_FRAGMENT,
    uniforms: { ...uniforms, uProject: { value: shadow ? 1 : 0 }, uDirect: { value: shadow ? 0 : 1 }, uHole: { value: 0 } },
    // A shadow lies in the ground's own plane: it is drawn straight after the ground, over it, and
    // leaves the depth alone, so the hardware drawn next stands in front of it.
    depthTest: !shadow,
    depthWrite: !shadow,
  });
}

/**
 * The real ground's material (siteTerrain.ts). It holds the very same uniform objects as the level
 * ground, so the light, the lit word and the rings are the same on both.
 */
export function createTerrainMaterial(uniforms: GroundUniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: TERRAIN_VERTEX,
    fragmentShader: TERRAIN_FRAGMENT,
    uniforms: { ...uniforms, uFarFade: { value: new THREE.Vector2(1e9, 2e9) } },
  });
}

export interface SiteNowInput {
  track: GeometryTrack | null;
  landingMs: number | null;
  site: { id: string; name: string; lat: number; lon_east: number } | null;
  /** This site's horizon answer (never another site's). */
  horizon: HorizonResponse | null;
  /** The instant shown. */
  tMs: number | null;
}

/** Seconds the light takes to follow a change of the lit word. */
const LIT_EASE_S = 0.2;

/**
 * Brings `now` and the shared uniforms up to the instant shown. The sky is worked out again only
 * when the instant or the data has changed; the light then eases to it over a fifth of a second
 * (at once for visitors who prefer reduced motion).
 */
export function createSiteClock(now: SiteNow, uniforms: GroundUniforms) {
  let last: SiteNowInput | null = null;
  return function update(input: SiteNowInput, deltaS: number, instant: boolean): void {
    const changed = last === null || last.tMs !== input.tMs || last.track !== input.track || last.horizon !== input.horizon || last.site !== input.site || last.landingMs !== input.landingMs;
    if (changed) {
      last = { ...input };
      const sky = input.tMs === null ? null : skyAt({ track: input.track, tMs: input.tMs, landingMs: input.landingMs, site: input.site, horizon: input.horizon });
      now.sky = sky;
      now.hasSun = Boolean(sky?.sun);
      now.beforeLanding = input.tMs !== null && input.landingMs !== null && input.tMs < input.landingMs;
      if (sky?.sun) {
        const d = azElToLocal(sky.sun.az, sky.sun.el, 1);
        now.sunDir.set(d.x, d.y, d.z);
        uniforms.uSunTerm.value = groundSunTerm(sky.sun.el);
        uniforms.uSunDir.value.copy(now.sunDir);
      } else {
        uniforms.uSunTerm.value = 0;
        uniforms.uSunDir.value.set(0, -1, 0);
      }
      // Shadows can be drawn only while the Sun's whole disc is above the level plane (and are
      // shown only while the answer says lit: see SiteHardware).
      const offset = sky?.sun ? shadowOffsetPerMetre(sky.sun.az, sky.sun.el) : null;
      now.shadows = offset !== null;
      if (offset) uniforms.uShadow.value.set(offset.x, offset.z);
      // The ground stops below the lowest point of the data's skyline.
      const cut = groundCutDeg(input.horizon ? skylineMinDeg(input.horizon.skyline) : null);
      uniforms.uTanCut.value = Math.tan((-cut * Math.PI) / 180);
    }
    const target = now.sky?.lit === true ? 1 : 0;
    if (now.lit !== target) {
      const step = instant ? 1 : Math.min(1, Math.max(0, deltaS) / LIT_EASE_S);
      now.lit = target > now.lit ? Math.min(target, now.lit + step) : Math.max(target, now.lit - step);
    }
    uniforms.uLit.value = now.lit;
  };
}
