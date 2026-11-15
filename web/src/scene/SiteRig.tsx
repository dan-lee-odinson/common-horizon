// The camera in the site stage. The site is a world in metres inside the same canvas as the Moon,
// so on arrival the camera is simply placed in it (the change of world happens behind a short veil,
// see src/stages/SiteVeil.tsx) and then descends: from high over the landing point, looking
// straight down with the landing point in the middle of the screen (where the dive from the Moon
// left it), turning and tipping up until the horizon rises and it rests beside the lander.
//
// At rest the visitor turns the view by dragging and zooms with the wheel or a pinch; close to a
// tall lander the view can also be tipped up to the sky, and the HUD can ask for the view to be
// turned to the Sun or to Earth. The landing point is kept in the middle of the part of the window
// the panels leave free. A press or a wheel
// turn during the descent stops it there and hands the view over. Visitors who prefer reduced
// motion arrive at the rest pose at once.
//
// Leaving the stage puts back everything the Moon stages expect of the shared camera.

import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import gsap from 'gsap';
import * as THREE from 'three';
import { useStore } from '../state/store';
import { skyAt } from '../util/quantities';
import type { ControlsLike } from './CameraDirector';
import { MOON_CLIP } from './orbitView';
import type { SceneData } from './sceneData';
import { RAD } from '../util/geo';
import { arrivalAzimuth, arrivalPitch, clearUpDeg, descentPose, facePose, frameShift, lookUpLimit, orbitPosition, restPose, siteArrival, siteFrame, siteLook, SITE_VIEW, type SitePose } from './siteView';

/** Seconds: the descent, and the settle when the rest pose changes (a resize, a panel changing height). */
const DESCENT_S = 1.6;
const SETTLE_S = 0.4;
/** Seconds to swing the view round to the Sun, to Earth or back to the lander. */
const LOOK_S = 0.3;

type Controls = ControlsLike & { enableDamping: boolean };

export function SiteRig({ active, data, heightM, layoutRadius }: { active: boolean; data: SceneData; heightM: number | null; layoutRadius: number }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const gl = useThree((s) => s.gl);
  const size = useThree((s) => s.size);
  const controls = useThree((s) => s.controls) as unknown as Controls | null;
  const frame = useStore(siteFrame, (s) => s);
  const look = useStore(siteLook, (s) => s);
  /** The last request to turn the view that was carried out (or was already there on arrival). */
  const looked = useRef(look.seq);
  const fov = data.isPhone ? SITE_VIEW.fovPhone : SITE_VIEW.fov;

  const dataRef = useRef(data);
  dataRef.current = data;
  /** The compass direction the camera faces at rest, and the Sun it was chosen by: fixed once, on arrival. */
  const viewAz = useRef(0);
  const arrivalSun = useRef<{ az: number; el: number } | null>(null);
  /** 'descent' while the camera is on its way down; 'rest' once the visitor has the view. */
  const mode = useRef<'idle' | 'descent' | 'rest'>('idle');
  /** True once the visitor has turned or zoomed the view: their distance is then kept. */
  const moved = useRef(false);
  /** The picture shift in force, pixels (positive x right, positive y up). */
  const view = useRef({ x: 0, y: 0 });
  const tween = useRef<gsap.core.Tween | null>(null);
  const scratch = useMemo(() => new THREE.Vector3(), []);

  const shift = frameShift(frame, size.width, size.height);
  const freeHeight = frame.measured && frame.bottom > frame.top ? frame.bottom - frame.top : size.height;
  const freeShare = size.height > 0 ? freeHeight / size.height : 1;
  const restNow = (): SitePose =>
    restPose({ heightM, layoutRadius, fovDeg: fov, freeShare, viewAzDeg: viewAz.current, pitchDeg: arrivalPitch(arrivalSun.current, clearUpDeg(freeHeight, size.height, fov)) });
  // What the running descent heads for; it follows a rest pose that changes on the way (the panels being measured).
  const goal = useRef({ rest: restNow(), shiftX: shift.x, shiftY: shift.y });
  goal.current = { rest: restNow(), shiftX: shift.x, shiftY: shift.y };

  function place(pose: SitePose) {
    camera.position.set(pose.position.x, pose.position.y, pose.position.z);
    camera.up.set(0, 1, 0);
    camera.lookAt(pose.target.x, pose.target.y, pose.target.z);
    controls?.target.set(pose.target.x, pose.target.y, pose.target.z);
  }

  /** Hand the view to the visitor from wherever the camera is. */
  function release() {
    if (!controls) return;
    mode.current = 'rest';
    siteArrival.settled = true;
    const distance = camera.position.distanceTo(controls.target);
    const polar = Math.acos(THREE.MathUtils.clamp((camera.position.y - controls.target.y) / Math.max(distance, 1e-6), -1, 1));
    // A descent stopped part of the way is higher and steeper than the limits at rest: they open
    // to take it in, so the picture does not jump when the controls take over.
    controls.minDistance = SITE_VIEW.minDistance;
    controls.maxDistance = Math.max(SITE_VIEW.maxDistance, distance);
    controls.minPolarAngle = Math.min(SITE_VIEW.minPolar, polar);
    controls.maxPolarAngle = SITE_VIEW.maxPolar;
    controls.autoRotate = false;
    controls.enableZoom = true;
    controls.enabled = true;
    // Nothing left over from an earlier drag carries into this view.
    const damping = controls.enableDamping;
    controls.enableDamping = false;
    controls.update();
    controls.enableDamping = damping;
  }

  // The field of view (a phone held upright needs a wider one).
  useLayoutEffect(() => {
    if (!active) return;
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }, [active, fov, camera]);

  // Arrival and leaving.
  useLayoutEffect(() => {
    if (!active || !controls) return;
    const d = dataRef.current;
    // Which way to face: worked out once, from the sky at the landing.
    const sky = d.landingMs === null ? null : skyAt({ track: d.track, tMs: d.landingMs, landingMs: d.landingMs, site: d.focus, horizon: d.horizon && d.focus && d.horizon.site_id === d.focus.id ? d.horizon : null });
    arrivalSun.current = sky?.sun ?? null;
    viewAz.current = arrivalAzimuth(sky?.sun ?? null, sky?.earth ?? null);
    goal.current = { ...goal.current, rest: restNow() };
    moved.current = false;
    looked.current = siteLook.get().seq;

    camera.near = SITE_VIEW.near;
    camera.far = SITE_VIEW.far;
    camera.updateProjectionMatrix();
    applied.current = '';

    if (dataRef.current.reducedMotion) {
      place(goal.current.rest);
      view.current = { x: goal.current.shiftX, y: goal.current.shiftY };
      release();
    } else {
      mode.current = 'descent';
      siteArrival.settled = false;
      controls.enabled = false;
      const proxy = { u: 0 };
      const step = () => {
        const g = goal.current;
        const pose = descentPose(proxy.u, g.rest);
        place(pose);
        view.current.x = g.shiftX * pose.shiftShare;
        view.current.y = g.shiftY * pose.shiftShare;
      };
      step();
      tween.current = gsap.to(proxy, {
        u: 1,
        duration: DESCENT_S,
        ease: 'power3.out',
        onUpdate: step,
        onComplete: () => {
          step();
          tween.current = null;
          release();
        },
      });
    }

    // A press or a wheel turn on the scene: the visitor takes the view, at once.
    const onGrab = (e: Event) => {
      if (e.target !== gl.domElement) return;
      moved.current = true;
      // Whatever move is under way stops where it is.
      tween.current?.kill();
      tween.current = null;
      if (mode.current !== 'descent') return;
      release();
      settle();
    };
    window.addEventListener('pointerdown', onGrab, { capture: true });
    window.addEventListener('wheel', onGrab, { capture: true, passive: true });

    return () => {
      window.removeEventListener('pointerdown', onGrab, { capture: true });
      window.removeEventListener('wheel', onGrab, { capture: true });
      tween.current?.kill();
      tween.current = null;
      mode.current = 'idle';
      siteArrival.settled = false;
      camera.clearViewOffset();
      camera.near = MOON_CLIP.near;
      camera.far = MOON_CLIP.far;
      camera.updateProjectionMatrix();
    };
    // Arrival happens once for each visit to the stage; what changes during the visit is handled below.
  }, [active, controls, camera, gl]);

  /** Bring the point looked at, the distance and the picture shift to the rest values, keeping the visitor's own direction. */
  function settle() {
    if (!controls || mode.current !== 'rest') return;
    const g = goal.current;
    const from = { y: controls.target.y, d: camera.position.distanceTo(controls.target), sx: view.current.x, sy: view.current.y };
    // A visitor who has zoomed keeps their distance.
    const distance = moved.current ? from.d : g.rest.distance;
    const apply = () => {
      scratch.copy(camera.position).sub(controls.target).normalize();
      controls.target.y = from.y;
      camera.position.copy(controls.target).addScaledVector(scratch, from.d);
      // A view that was tipped up to the sky comes down with the point it looks at, never under the ground.
      camera.position.y = Math.max(camera.position.y, SITE_VIEW.minCameraHeight);
      controls.maxPolarAngle = lookUpLimit(controls.target.y, from.d);
      view.current.x = from.sx;
      view.current.y = from.sy;
    };
    tween.current?.kill();
    tween.current = gsap.to(from, {
      y: g.rest.target.y,
      d: distance,
      sx: g.shiftX,
      sy: g.shiftY,
      duration: dataRef.current.reducedMotion ? 0 : SETTLE_S,
      ease: 'power3.out',
      onUpdate: apply,
      onComplete: () => {
        // (A move of no length, for visitors who prefer reduced motion, lands here directly.)
        apply();
        tween.current = null;
      },
    });
  }

  // At rest: when the hardware's size arrives, the window changes or a panel changes height, the
  // view settles to the new rest values. (A descent under way heads for them by itself.)
  const restKey = `${goal.current.rest.target.y.toFixed(2)}|${goal.current.rest.distance.toFixed(1)}|${shift.x}|${shift.y}`;
  useLayoutEffect(() => {
    if (!active || mode.current !== 'rest') return;
    settle();
    // `settle` reads the goal of this render.
  }, [active, restKey]);

  // "Look" at the Sun or Earth, and "Reset view": swing the view round, the short way, in a third of a second.
  useLayoutEffect(() => {
    if (!active || !controls || look.seq === looked.current) return;
    looked.current = look.seq;
    if (mode.current !== 'rest') return;
    // Back to the lander: the rest pose, at its own distance again.
    moved.current = !look.home;
    const offset = scratch.copy(camera.position).sub(controls.target);
    const d0 = offset.length();
    const from = { y: controls.target.y, d: d0, az: Math.atan2(-offset.x, offset.z) * RAD, polar: Math.acos(THREE.MathUtils.clamp(offset.y / Math.max(d0, 1e-6), -1, 1)) * RAD };
    const to = look.home ? goal.current.rest : facePose({ body: { az: look.az, el: look.el }, restTargetY: goal.current.rest.target.y, distance: d0, clearUpDeg: clearUpDeg(freeHeight, size.height, fov) });
    const turn = ((((to.azDeg - from.az) % 360) + 540) % 360) - 180;
    const proxy = { k: 0 };
    const apply = () => {
      const k = proxy.k;
      const distance = from.d + (to.distance - from.d) * k;
      controls.target.y = from.y + (to.target.y - from.y) * k;
      const pose = orbitPosition({ x: 0, y: controls.target.y, z: 0 }, distance, from.az + turn * k, from.polar + (to.polarDeg - from.polar) * k);
      // The limit follows the new height at once, so the controls do not pull the camera back.
      controls.maxPolarAngle = lookUpLimit(controls.target.y, distance);
      camera.position.set(pose.x, Math.max(pose.y, SITE_VIEW.minCameraHeight), pose.z);
    };
    tween.current?.kill();
    tween.current = gsap.to(proxy, {
      k: 1,
      duration: dataRef.current.reducedMotion ? 0 : LOOK_S,
      ease: 'power3.out',
      onUpdate: apply,
      onComplete: () => {
        apply();
        tween.current = null;
      },
    });
    // A request is carried out once; the sizes it reads are those of the moment it was made.
  }, [active, controls, look.seq]);

  // Every frame: the picture shift, written only when it or the window has changed.
  const applied = useRef('');
  useFrame(() => {
    if (!active) return;
    // At rest: how far down the camera may swing depends on how close it is (see `lookUpLimit`).
    if (mode.current === 'rest' && controls) controls.maxPolarAngle = lookUpLimit(controls.target.y, camera.position.distanceTo(controls.target));
    const x = Math.round(view.current.x);
    const y = Math.round(view.current.y);
    const key = `${size.width}x${size.height}:${x},${y}`;
    if (key === applied.current) return;
    applied.current = key;
    if (x === 0 && y === 0) camera.clearViewOffset();
    else camera.setViewOffset(size.width, size.height, -x, y, size.width, size.height);
  });

  return null;
}
