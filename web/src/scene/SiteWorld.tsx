// The site world: stage 3, inside the same canvas as the Moon.
//
// A world in metres. The landing point is the origin; x points east, y up, z south. What is drawn:
//   the sky      stars, Earth, the Sun, its path over the stay and the terrain skyline, on a dome
//                round the camera (SiteSky)
//   the ground   at a preset site, the real ground from the LOLA height files at true scale out
//                to 32 km, with range rings painted on it; elsewhere a level disc with range rings,
//                an illustration (SiteGround, siteTerrain.ts)
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
import { SiteMarkers } from './SiteMarkers';
import { hiddenByHardware, siteLayout, standOnGround, type PlacedItem, type SiteLayout } from './siteLayout';
import { createGroundUniforms, createSiteClock, createSiteNow, type GroundUniforms, type SiteNow } from './siteNow';
import { SiteRig } from './SiteRig';
import { SiteSky } from './SiteSky';
import { everyOtherPost, groundHeight, terrainSkylineDeg, type SiteGroundShape } from './siteTerrain';
import { useSiteTerrain } from './siteTerrainLoad';
import { bandProfile, bandTopAt, domePoint, earthDiscRadius, insideFrame, siteArrival, siteFrame, SITE_VIEW, sunDiscRadius, sunPathOnDome } from './siteView';

const NOTHING: readonly PlacedItem[] = [];

export function SiteWorld({ data, active }: { data: SceneData; active: boolean }) {
  const now = useMemo(() => createSiteNow(), []);
  const uniforms = useMemo(() => createGroundUniforms(), []);
  // The answer on hand can still be the previous site's while a new one loads: that is not this site's skyline.
  const horizon = data.horizon && data.focus && data.horizon.site_id === data.focus.id ? data.horizon : null;
  const profile = useMemo(() => (horizon && horizon.skyline.length > 0 ? bandProfile(horizon.skyline) : null), [horizon]);
  const sunPath = useMemo(() => (horizon ? sunPathOnDome(horizon.sun_path) : null), [horizon]);

  // Where the hardware stands: from the models' published sizes, which arrive before their shapes.
  const hardwareKey = data.hardware.map((h) => `${h.id}:${h.count}`).join(',');
  const choices = useMemo(() => data.hardware, [hardwareKey]);
  const ids = useMemo(() => choices.map((h) => h.id), [choices]);
  const metas = useModelMetas(ids);
  // The real ground, at a preset site whose near file has loaded (custom points keep the level ground).
  const terrain = useSiteTerrain(data.focus?.custom ? null : (data.focus?.id ?? null));
  // On phones the far ground keeps every other post.
  const isPhone = data.isPhone;
  const shape = useMemo<SiteGroundShape | null>(
    () => (terrain.near ? { near: terrain.near, far: terrain.far ? (isPhone ? everyOtherPost(terrain.far) : terrain.far) : null } : null),
    [terrain.near, terrain.far, isPhone],
  );
  const groundAt = useMemo(() => (shape ? (x: number, z: number) => groundHeight(shape, x, z) : null), [shape]);
  const layout = useMemo(() => standOnGround(siteLayout(choices, metas), groundAt), [choices, metas, groundAt]);
  // How high the skyline stands toward a direction: the higher of the data's line and the drawn terrain.
  const skylineAt = useMemo(
    () => (profile || shape ? (az: number, eye: { x: number; y: number; z: number }) => Math.max(profile ? bandTopAt(profile, az) : -90, shape ? terrainSkylineDeg(shape, eye, az) : -90) : null),
    [profile, shape],
  );

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
      <SiteGround uniforms={uniforms} shape={shape} />
      <SiteHardware layout={layout} now={now} uniforms={uniforms} />
      <SiteMarkers layout={layout} names={data.hardwareNames ?? {}} now={now} active={active} />
      <SiteSky now={now} profile={profile} sunPath={sunPath} />
      <SiteAnchors active={active} now={now} profile={profile} landerMid={landerMid} layout={layout} ground={shape ? (shape.far ? 'terrain' : 'terrain-near') : 'level'} shape={shape} />
      <SiteRig active={active} data={data} heightM={layout.heightM} layoutRadius={layout.radius} groundAt={groundAt} skylineAt={skylineAt} />
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
  const bounce = useRef<THREE.HemisphereLight>(null);
  const update = useMemo(() => createSiteClock(now, uniforms), [now, uniforms]);
  const colors = useMemo(() => ({ sky: cssColor('--ch-ink-2'), space: cssColor('--ch-space'), ground: cssColor('--ch-ground') }), []);
  useFrame((_, delta) => {
    if (!active) return;
    const d = dataRef.current;
    update({ track: d.track, landingMs: d.landingMs, site: d.focus, horizon: horizonRef.current, tMs: d.landingMs === null ? null : (simClock.get().nowMs ?? d.landingMs) }, delta, d.reducedMotion);
    const light = sunLight.current;
    if (light) {
      light.intensity = now.hasSun ? SITE_VIEW.sunLight * now.lit : 0;
      if (now.hasSun) light.position.copy(now.sunDir).multiplyScalar(100);
    }
    // The lit ground throws light back up: as bright as the ground itself is drawn.
    if (bounce.current) bounce.current.intensity = SITE_VIEW.bounceLight * now.lit * uniforms.uSunTerm.value;
  });
  return (
    <>
      <directionalLight ref={sunLight} intensity={0} />
      <hemisphereLight args={[colors.sky, colors.space, SITE_VIEW.fillLight]} />
      {/* From below only: the sky above sends none of it (space is as good as black). */}
      <hemisphereLight ref={bounce} args={[colors.space, colors.ground, 0]} />
    </>
  );
}

/**
 * Writes where the Sun, Earth and the lander are on screen, for the HUD's tags, leader lines and
 * reticle. A tag shows only while its body is in the clear part of the window: the Sun while the
 * answer says the site is lit, Earth while it stands above the skyline band at its direction.
 * The scene's own account of each body (drawn above or below the band), and of whether the
 * hardware is shown, is also written on the scene's element, where the picture can be checked
 * against the horizon plot and the clock.
 */
function SiteAnchors({
  active,
  now,
  profile,
  landerMid,
  layout,
  ground,
  shape,
}: {
  active: boolean;
  now: SiteNow;
  profile: readonly number[] | null;
  landerMid: RefObject<number>;
  layout: SiteLayout;
  shape: SiteGroundShape | null;
  /** What ground is drawn: the real ground from the height files, or the level illustration. */
  ground: string;
}) {
  const size = useThree((s) => s.size);
  const gl = useThree((s) => s.gl);
  const v = useMemo(() => new THREE.Vector3(), []);
  const host = useMemo(() => gl.domElement.closest<HTMLElement>('[data-testid="world"]'), [gl]);
  const said = useRef({ sun: '', earth: '', hardware: '' });
  /** Where the camera stood when the skyline's place in the picture was last worked out. */
  const skylineFrom = useMemo(() => new THREE.Vector3(Number.NaN, 0, 0), []);
  const skylineShape = useRef<SiteGroundShape | null>(null);

  // Outside the stage the scene says nothing about the site's sky.
  useEffect(() => {
    if (!active || !host) return;
    return () => {
      said.current = { sun: '', earth: '', hardware: '' };
      delete host.dataset.siteSun;
      delete host.dataset.siteEarth;
      delete host.dataset.siteHardware;
      delete host.dataset.siteFacing;
      delete host.dataset.siteSkyline;
      skylineFrom.set(Number.NaN, 0, 0);
    };
  }, [active, host]);

  // Which ground is drawn, on the scene's element, where it can be checked.
  useEffect(() => {
    if (!active || !host) return;
    host.dataset.siteGround = ground;
    return () => {
      delete host.dataset.siteGround;
    };
  }, [active, host, ground]);

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
    // The bodies' tags wait until the camera has come to rest, and step back while the hardware stands in front of their body.
    const settled = siteArrival.settled;
    const blockers = now.beforeLanding ? NOTHING : layout.items;

    let sunSays = 'none';
    if (now.hasSun) {
      // Where the disc is drawn, read back as a direction: the picture's own account.
      const el = Math.asin(THREE.MathUtils.clamp(now.sunDir.y, -1, 1)) * RAD;
      const az = Math.atan2(now.sunDir.x, -now.sunDir.z) * RAD;
      sunSays = el > (profile ? bandTopAt(profile, az) : 0) ? 'above' : 'below';
      v.copy(now.sunDir).multiplyScalar(SITE_VIEW.dome).add(cam.position);
      const seen = project('sun');
      anchors.sun.r = Math.max(4, (sunDiscRadius() / SITE_VIEW.dome) * focal);
      anchors.sun.visible = settled && sky?.lit === true && seen && insideFrame(frame, anchors.sun.x, anchors.sun.y, 24) && !hiddenByHardware(cam.position, now.sunDir, blockers);
    } else anchors.sun.visible = false;

    let earthSays = 'none';
    const e = sky?.earth ?? null;
    if (e) {
      const clear = e.el > (profile ? bandTopAt(profile, e.az) : 0);
      earthSays = clear ? 'above' : 'below';
      const p = domePoint(e.az, e.el);
      const behind = hiddenByHardware(cam.position, p, blockers);
      v.set(p.x, p.y, p.z).add(cam.position);
      const seen = project('earth');
      anchors.earth.r = Math.max(6, (earthDiscRadius(e.el) / SITE_VIEW.dome) * focal);
      anchors.earth.visible = settled && clear && seen && insideFrame(frame, anchors.earth.x, anchors.earth.y, 24) && !behind;
    } else anchors.earth.visible = false;

    // The reticle: on the middle of the lander once it has landed, on the landing point before.
    v.set(0, now.beforeLanding ? 0 : landerMid.current, 0);
    anchors.lander.visible = project('lander');
    anchors.lander.r = 36;

    // The compass direction the camera faces, whole degrees: where the picture can be checked against the ground.
    cam.getWorldDirection(v);
    const facingDeg = ((Math.atan2(v.x, -v.z) * RAD) % 360 + 360) % 360;
    const facing = String(Math.round(facingDeg) % 360);
    if (host && host.dataset.siteFacing !== facing) host.dataset.siteFacing = facing;
    // Whether the skyline at that direction is in the clear part of the window with sky above it:
    // the data's line and the drawn terrain's top, each projected (worked out once the camera rests,
    // and again only when it has moved).
    if (host && profile && settled && (!cam.position.equals(skylineFrom) || skylineShape.current !== shape)) {
      skylineFrom.copy(cam.position);
      skylineShape.current = shape;
      let inView = true;
      const tops = [bandTopAt(profile, facingDeg)];
      if (shape) tops.push(terrainSkylineDeg(shape, cam.position, facingDeg));
      for (const el of tops) {
        const p = domePoint(facingDeg, el);
        v.set(p.x, p.y, p.z).add(cam.position).project(cam);
        const x = ((v.x + 1) / 2) * size.width;
        const y = ((1 - v.y) / 2) * size.height;
        if (!(v.z < 1) || !insideFrame(frame, x, y, 24)) inView = false;
      }
      const says = inView ? 'in-view' : 'out-of-view';
      if (host.dataset.siteSkyline !== says) host.dataset.siteSkyline = says;
    }

    // Before the landing no hardware stands at the site.
    const hardwareSays = now.beforeLanding ? 'hidden' : 'shown';
    if (host && (said.current.sun !== sunSays || said.current.earth !== earthSays || said.current.hardware !== hardwareSays)) {
      said.current = { sun: sunSays, earth: earthSays, hardware: hardwareSays };
      host.dataset.siteSun = sunSays;
      host.dataset.siteEarth = earthSays;
      host.dataset.siteHardware = hardwareSays;
    }
  });
  return null;
}
