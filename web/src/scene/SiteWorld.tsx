// The site world: stage 3, inside the same canvas as the Moon.
//
// A world in metres. The landing point is the origin; x points east, y up, z south. What is drawn:
//   the sky      stars, Earth, the Sun and the terrain skyline on a dome round the camera (SiteSky)
//   the ground   a level disc with range rings: an illustration (SiteGround)
//   the hardware the mission's models at true scale, and their shadows (SiteHardware)
// The Sun's and Earth's directions and the lit / dark word come from `skyAt`, the same function the
// readouts use, at the instant the site clock shows. The light follows the word: with the terrain
// hiding the Sun only a dim fill is left.
//
// The world is mounted while the camera dives to the site (so the models are loading by the time
// it arrives) and shown in the site stage only. Nothing here re-renders while time runs: each
// frame reads the clock and writes straight to the scene.

import { useEffect, useMemo, useRef, type RefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { HorizonResponse } from '../api/types';
import { simClock } from '../state/app';
import { useModelMetas } from '../state/models';
import { RAD } from '../util/geo';
import { anchors } from './anchors';
import { cssColor } from './colors';
import type { SceneData } from './sceneData';
import { SiteGround } from './SiteGround';
import { SiteHardware } from './SiteHardware';
import { siteLayout } from './siteLayout';
import { createGroundUniforms, createSiteClock, createSiteNow, type GroundUniforms, type SiteNow } from './siteNow';
import { SiteRig } from './SiteRig';
import { SiteSky } from './SiteSky';
import { bandProfile, bandTopAt, domePoint, earthDiscRadius, insideFrame, siteArrival, siteFrame, SITE_VIEW, sunDiscRadius } from './siteView';

export function SiteWorld({ data, active }: { data: SceneData; active: boolean }) {
  const now = useMemo(() => createSiteNow(), []);
  const uniforms = useMemo(() => createGroundUniforms(), []);
  // The answer on hand can still be the previous site's while a new one loads: that is not this site's skyline.
  const horizon = data.horizon && data.focus && data.horizon.site_id === data.focus.id ? data.horizon : null;
  const profile = useMemo(() => (horizon && horizon.skyline.length > 0 ? bandProfile(horizon.skyline) : null), [horizon]);

  // Where the hardware stands: from the models' published sizes, which arrive before their shapes.
  const hardwareKey = data.hardware.map((h) => `${h.id}:${h.count}`).join(',');
  const choices = useMemo(() => data.hardware, [hardwareKey]);
  const ids = useMemo(() => choices.map((h) => h.id), [choices]);
  const metas = useModelMetas(ids);
  const layout = useMemo(() => siteLayout(choices, metas), [choices, metas]);

  const dataRef = useRef(data);
  dataRef.current = data;
  const horizonRef = useRef(horizon);
  horizonRef.current = horizon;
  /** Height of the middle of what stands at the landing point: where the reticle sits. */
  const landerMid = useRef(0);
  landerMid.current = layout.primaryLanderId !== null && layout.heightM !== null ? layout.heightM / 2 : 0;

  return (
    <group visible={active}>
      {/* First, so every other part reads this frame's sky. */}
      <SiteClock active={active} dataRef={dataRef} horizonRef={horizonRef} now={now} uniforms={uniforms} />
      <SiteGround uniforms={uniforms} />
      <SiteHardware layout={layout} now={now} uniforms={uniforms} />
      <SiteSky now={now} profile={profile} />
      <SiteAnchors active={active} now={now} profile={profile} landerMid={landerMid} />
      <SiteRig active={active} data={data} heightM={layout.heightM} layoutRadius={layout.radius} />
    </group>
  );
}

/**
 * Works out the sky for the instant shown, once per frame, and sets the light by it: sunlight from
 * the Sun's direction while the answer says lit, and a dim fill always.
 */
function SiteClock({
  active,
  dataRef,
  horizonRef,
  now,
  uniforms,
}: {
  active: boolean;
  dataRef: RefObject<SceneData>;
  horizonRef: RefObject<HorizonResponse | null>;
  now: SiteNow;
  uniforms: GroundUniforms;
}) {
  const sunLight = useRef<THREE.DirectionalLight>(null);
  const update = useMemo(() => createSiteClock(now, uniforms), [now, uniforms]);
  const colors = useMemo(() => ({ sky: cssColor('--ch-ink-2'), space: cssColor('--ch-space') }), []);
  useFrame((_, delta) => {
    if (!active) return;
    const d = dataRef.current;
    update({ track: d.track, landingMs: d.landingMs, site: d.focus, horizon: horizonRef.current, tMs: d.landingMs === null ? null : (simClock.get().nowMs ?? d.landingMs) }, delta, d.reducedMotion);
    const light = sunLight.current;
    if (light) {
      light.intensity = now.hasSun ? SITE_VIEW.sunLight * now.lit : 0;
      if (now.hasSun) light.position.copy(now.sunDir).multiplyScalar(100);
    }
  });
  return (
    <>
      <directionalLight ref={sunLight} intensity={0} />
      <hemisphereLight args={[colors.sky, colors.space, SITE_VIEW.fillLight]} />
    </>
  );
}

/**
 * Writes where the Sun, Earth and the lander are on screen, for the HUD's tags, leader lines and
 * reticle. A tag shows only while its body is in the clear part of the window: the Sun while the
 * answer says the site is lit, Earth while it stands above the skyline band at its direction.
 * The scene's own account of each body (drawn above or below the band) is also written on the
 * scene's element, where the picture can be checked against the horizon plot.
 */
function SiteAnchors({ active, now, profile, landerMid }: { active: boolean; now: SiteNow; profile: readonly number[] | null; landerMid: RefObject<number> }) {
  const size = useThree((s) => s.size);
  const gl = useThree((s) => s.gl);
  const v = useMemo(() => new THREE.Vector3(), []);
  const host = useMemo(() => gl.domElement.closest<HTMLElement>('[data-testid="world"]'), [gl]);
  const said = useRef({ sun: '', earth: '' });

  // Outside the stage the scene says nothing about the site's sky.
  useEffect(() => {
    if (!active || !host) return;
    return () => {
      said.current = { sun: '', earth: '' };
      delete host.dataset.siteSun;
      delete host.dataset.siteEarth;
    };
  }, [active, host]);

  useFrame(({ camera }) => {
    if (!active) return;
    const cam = camera as THREE.PerspectiveCamera;
    cam.updateMatrixWorld();
    const frame = siteFrame.get();
    const focal = size.height / 2 / Math.tan((cam.fov * Math.PI) / 360);
    /** Projects `v`; returns whether it is in front of the camera and inside the window. */
    const project = (name: 'sun' | 'earth' | 'lander'): boolean => {
      v.project(cam);
      const a = anchors[name];
      a.x = ((v.x + 1) / 2) * size.width;
      a.y = ((1 - v.y) / 2) * size.height;
      return v.z > -1 && v.z < 1 && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1;
    };
    const sky = now.sky;
    // The bodies' tags wait until the camera has come to rest.
    const settled = siteArrival.settled;

    let sunSays = 'none';
    if (now.hasSun) {
      // Where the disc is drawn, read back as a direction: the picture's own account.
      const el = Math.asin(THREE.MathUtils.clamp(now.sunDir.y, -1, 1)) * RAD;
      const az = Math.atan2(now.sunDir.x, -now.sunDir.z) * RAD;
      sunSays = el > (profile ? bandTopAt(profile, az) : 0) ? 'above' : 'below';
      v.copy(now.sunDir).multiplyScalar(SITE_VIEW.dome).add(cam.position);
      const seen = project('sun');
      anchors.sun.r = Math.max(4, (sunDiscRadius() / SITE_VIEW.dome) * focal);
      anchors.sun.visible = settled && sky?.lit === true && seen && insideFrame(frame, anchors.sun.x, anchors.sun.y, 24);
    } else anchors.sun.visible = false;

    let earthSays = 'none';
    const e = sky?.earth ?? null;
    if (e) {
      const clear = e.el > (profile ? bandTopAt(profile, e.az) : 0);
      earthSays = clear ? 'above' : 'below';
      const p = domePoint(e.az, e.el);
      v.set(p.x, p.y, p.z).add(cam.position);
      const seen = project('earth');
      anchors.earth.r = Math.max(6, (earthDiscRadius(e.el) / SITE_VIEW.dome) * focal);
      anchors.earth.visible = settled && clear && seen && insideFrame(frame, anchors.earth.x, anchors.earth.y, 24);
    } else anchors.earth.visible = false;

    // The reticle: on the middle of the lander once it has landed, on the landing point before.
    v.set(0, now.beforeLanding ? 0 : landerMid.current, 0);
    anchors.lander.visible = project('lander');
    anchors.lander.r = 36;

    if (host && (said.current.sun !== sunSays || said.current.earth !== earthSays)) {
      said.current = { sun: sunSays, earth: earthSays };
      host.dataset.siteSun = sunSays;
      host.dataset.siteEarth = earthSays;
    }
  });
  return null;
}
