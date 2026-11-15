// Moves the one camera through the three stages with GSAP. The space is continuous: the camera
// flies, nothing reloads.
//   orbit    back from the Moon, looking down on the ring system at an angle. The camera sits on
//            the side away from Earth, turned so Earth stands behind the Moon and to the left,
//            its limb in the top-left corner; it sways a few degrees, leans a little with the
//            pointer, and zooms out until the whole Earth is in view.
//   mission  close to the Moon, turned to the site in the spotlight, the Moon set off-centre and
//            the picture shifted so the site's marker and tag stay clear of the glass panels (see
//            missionView.ts); the visitor can turn and zoom the Moon
//   site     the dive to the site ("in"), and the climb back out ("out"). At the site itself the
//            camera belongs to the site's own rig (SiteRig.tsx), in a world measured in metres;
//            on the way back this director takes it up again from low over the site
// Visitors who prefer reduced motion get cuts instead of flights, and no sway or lean.

import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import gsap from 'gsap';
import * as THREE from 'three';
import { actions, appStore, clamp, type Stage } from '../state/app';
import { useStore } from '../state/store';
import { normalizeLon360 } from '../util/geo';
import { DAY_MS, SYNODIC_MONTH_DAYS } from '../util/time';
import { earthSwing } from '../util/track';
import { missionCameraLatitude, missionDistance as missionDistanceFor, missionFrame, placeInFrame } from './missionView';
import { MOON_CLIP, ORBIT_VIEW, orbitCameraLongitude, orbitDistance, orbitEarthSide, orbitZoomDistance } from './orbitView';
import { geometryNow, toVector, type SceneData } from './sceneData';

/** The parts of OrbitControls the director uses. */
export interface ControlsLike {
  enabled: boolean;
  target: THREE.Vector3;
  minDistance: number;
  maxDistance: number;
  minPolarAngle: number;
  maxPolarAngle: number;
  autoRotate: boolean;
  enableZoom: boolean;
  update: () => void;
}

/** Closest the visitor can zoom in mission select (Moon radii from the centre). */
const MIN_DISTANCE = 1.5;
/** End of the dive: this far above the site, looking down at it. */
const DIVE_HEIGHT = 0.16;
/** On phones the Orbit picture is rolled so the ring ellipse runs along the tall screen. */
const PHONE_ROLL = (48 * Math.PI) / 180;

interface Pose {
  position: THREE.Vector3;
  target: THREE.Vector3;
  /** Picture shift in pixels: positive x moves the Moon right, positive y moves it up. */
  shiftX: number;
  shiftY: number;
  roll: number;
}

export function CameraDirector({ data }: { data: SceneData }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const canvas = useThree((s) => s.gl.domElement);
  const controls = useThree((s) => s.controls) as unknown as ControlsLike | null;
  const stage = useStore(appStore, (s) => s.stage);
  const orbitZoom = useStore(appStore, (s) => s.orbitZoom);
  /** The zoom the camera is at right now: it follows the store's setting with a short eased move. */
  const zoomNow = useRef({ value: 0 });
  const flight = useStore(appStore, (s) => s.flight);
  const { isPhone, reducedMotion } = data;
  const focusLat = data.focus?.lat ?? null;
  const focusLon = data.focus?.lon_east ?? null;
  // Where Earth is overhead fixes which side the Orbit camera looks from: the middle of the range
  // its longitude swings through over the lunar day (so Earth stays in the frame all the way), or
  // its landing value until the track has arrived.
  const landingGeometry = geometryNow({ track: null, landingMs: data.landingMs, landingGeometry: data.landingGeometry });
  const swing = useMemo(
    () => earthSwing(data.track, data.landingMs, data.landingMs === null ? null : data.landingMs + SYNODIC_MONTH_DAYS * DAY_MS),
    [data.track, data.landingMs],
  );
  const earthCentre = swing ? normalizeLon360(swing.lonMin + swing.lonSpan / 2) : (landingGeometry?.subearth_lon_east ?? 0);
  const earthLon = Math.round(earthCentre * 10) / 10;
  const earthSide = orbitEarthSide(landingGeometry);

  /** The live picture shift and roll; tweened with the camera. */
  const view = useRef({ shiftX: 0, shiftY: 0, roll: 0 });
  const tween = useRef<gsap.core.Tween | null>(null);
  /** The pose a flight is heading for, while one is under way. */
  const flightTo = useRef<Pose | null>(null);
  const lookAt = useRef(new THREE.Vector3());
  const first = useRef(true);
  /** The stage the camera was last sent to. */
  const arrivedAt = useRef<'orbit' | 'mission' | null>(null);
  /** The stage this director last saw: coming back from the site, the camera is still in the site's world. */
  const lastStage = useRef<Stage>(stage);
  /** True while the camera rests in its Orbit pose (and sways and leans there). */
  const holding = useRef(false);
  /** Degrees added to the Orbit pose: the slow sway, and the lean toward the pointer. */
  const drift = useRef({ sway: 0, leanX: 0, leanY: 0 });
  const scratch = useMemo(() => new THREE.Vector3(), []);

  const orbitD = useMemo(() => orbitDistance(size.width, size.height, isPhone), [size.width, size.height, isPhone]);
  const missionDistance = missionDistanceFor(size.width, size.height, isPhone);
  // Where the panels of mission select leave room for the spotlight site's marker and tag.
  const frame = useStore(missionFrame, (s) => s);
  const placement = placeInFrame(frame, size.width, size.height, focusLat);
  const missionShiftX = isPhone ? 0 : Math.round(placement.shiftX);
  const missionShiftY = isPhone ? Math.round(size.height * 0.2) : Math.round(placement.shiftY);

  function orbitPosition(out: THREE.Vector3): THREE.Vector3 {
    const d = drift.current;
    // The camera keeps to the longitude Earth is over at the instant shown, so Earth's limb holds its
    // place in the corner while time runs (Earth's overhead point swings several degrees in a
    // month); until the data arrives, the middle of that swing stands in.
    const now = geometryNow(data);
    const lon = now ? now.subearth_lon_east : earthLon;
    return toVector(ORBIT_VIEW.elevation + d.leanY, orbitCameraLongitude(lon, earthSide, d.sway + d.leanX), orbitZoomDistance(orbitD, zoomNow.current.value), out);
  }

  // Zooming in Orbit: out until the whole Earth is in view, and back. The wheel changes the setting;
  // the camera eases to it (at once for visitors who prefer reduced motion).
  useEffect(() => {
    const tween = gsap.to(zoomNow.current, { value: orbitZoom, duration: reducedMotion ? 0 : 0.9, ease: 'power2.inOut', overwrite: true });
    return () => {
      tween.kill();
    };
  }, [orbitZoom, reducedMotion]);
  useEffect(() => {
    if (stage !== 'orbit') return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      actions.setOrbitZoom(appStore.get().orbitZoom + Math.sign(e.deltaY) * 0.2);
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [stage, canvas]);

  function poseFor(target: 'orbit' | 'mission'): Pose {
    if (target === 'orbit') {
      return { position: orbitPosition(new THREE.Vector3()), target: new THREE.Vector3(), shiftX: 0, shiftY: isPhone ? size.height * 0.07 : 0, roll: isPhone ? PHONE_ROLL : 0 };
    }
    // Face the spotlight site; otherwise the southern near side, where most sites are. Latitude is
    // limited so the camera never sits over a pole (its "up" is the Moon's axis).
    const facing = focusLat !== null && focusLon !== null ? toVector(missionCameraLatitude(focusLat), focusLon) : toVector(-40, 20);
    return { position: facing.multiplyScalar(missionDistance), target: new THREE.Vector3(), shiftX: missionShiftX, shiftY: missionShiftY, roll: 0 };
  }

  function diveEnd(lat: number, lon: number): Pose {
    const target = toVector(lat, lon);
    const from = toVector(clamp(lat, -62, 62), lon);
    return { position: target.clone().addScaledVector(from, DIVE_HEIGHT), target, shiftX: 0, shiftY: 0, roll: 0 };
  }

  /**
   * Fly from where the camera is to a pose. The direction from the Moon's centre turns along a
   * great circle, so the path never passes through the Moon; the height above the surface changes
   * on a log scale, so the ground grows (or shrinks) at a steady rate on screen.
   */
  function flyTo(to: Pose, duration: number, ease: string, onComplete?: () => void) {
    tween.current?.kill();
    gsap.killTweensOf(view.current);
    holding.current = false;
    flightTo.current = to;
    const startPos = camera.position.clone();
    const startH = Math.max(1e-3, startPos.length() - 1);
    const startDir = startPos.clone().normalize();
    const endH = Math.max(1e-3, to.position.length() - 1);
    const endDir = to.position.clone().normalize();
    const startTarget = lookAt.current.clone();
    const startView = { ...view.current };
    const turn = new THREE.Quaternion().setFromUnitVectors(startDir, endDir);
    const step = new THREE.Quaternion();
    const identity = new THREE.Quaternion();
    const proxy = { t: 0 };
    if (controls) {
      controls.enabled = false;
      controls.autoRotate = false;
      controls.minDistance = 0.01;
    }
    const apply = () => {
      const t = proxy.t;
      step.copy(identity).slerp(turn, t);
      camera.position.copy(startDir).applyQuaternion(step).multiplyScalar(1 + startH * (endH / startH) ** t);
      lookAt.current.lerpVectors(startTarget, to.target, t);
      view.current.shiftX = startView.shiftX + (to.shiftX - startView.shiftX) * t;
      view.current.shiftY = startView.shiftY + (to.shiftY - startView.shiftY) * t;
      view.current.roll = startView.roll + (to.roll - startView.roll) * t;
      if (controls) controls.target.copy(lookAt.current);
    };
    tween.current = gsap.to(proxy, {
      t: 1,
      duration: reducedMotion || first.current ? 0 : duration,
      ease,
      onUpdate: apply,
      onComplete: () => {
        apply();
        flightTo.current = null;
        onComplete?.();
      },
    });
    first.current = false;
  }

  /** Mission select: the visitor may turn and zoom the Moon. */
  function release() {
    if (!controls) return;
    controls.enabled = true;
    controls.enableZoom = true;
    controls.minDistance = MIN_DISTANCE;
    controls.maxDistance = 9;
    controls.minPolarAngle = 0.25;
    controls.maxPolarAngle = Math.PI - 0.25;
    controls.autoRotate = false;
  }

  // Orbit <-> mission select, turning to a newly chosen site, and the climb back out of a site.
  useEffect(() => {
    if (stage === 'site') {
      lastStage.current = 'site';
      return;
    }
    if (!controls) return;
    if (appStore.get().flight === 'in') return;
    const fromSite = lastStage.current === 'site';
    lastStage.current = stage;
    const flyingOut = appStore.get().flight === 'out';
    // Back from the terrain, to mission select or straight to Orbit: the camera is still where the
    // site left it, in metres. It starts again low over the site, the reverse of the dive.
    const reseat = fromSite || flyingOut;
    const over = reseat && focusLat !== null && focusLon !== null ? diveEnd(focusLat, focusLon) : null;
    if (over) {
      camera.position.copy(over.position);
      lookAt.current.copy(over.target);
      view.current = { shiftX: 0, shiftY: 0, roll: 0 };
    }
    const target = stage;
    // In Orbit the pose depends on where Earth is. When that changes without a change of stage
    // (the data arriving at start-up, a resize), the camera is placed at once: it never swings
    // Earth across the panels on its way. With no site to climb away from, it is placed at once too.
    const settle = (target === 'orbit' && arrivedAt.current === 'orbit') || (fromSite && !over);
    arrivedAt.current = target;
    flyTo(poseFor(target), settle ? 0 : flyingOut ? 1.5 : target === 'mission' ? 1.15 : 1.0, flyingOut ? 'power2.inOut' : 'power3.inOut', () => {
      if (target === 'orbit') holding.current = true;
      else release();
      if (flyingOut) actions.finishFlightOut();
    });
    return () => {
      // A dive to the site that is under way is not this effect's to stop: a resize during the dive
      // would otherwise leave the camera hanging until the flight's time limit.
      if (appStore.get().flight === 'in') return;
      tween.current?.kill();
      flightTo.current = null;
      holding.current = false;
    };
    // Re-run when the destination changes, not on every camera move.
  }, [stage, focusLat, focusLon, controls, orbitD, missionDistance, isPhone, size.width, size.height, earthLon, earthSide]);

  // Mission select: when a panel opens or closes (the drawer, the assistant's history), only the
  // picture slides to keep the marker clear. The camera stays where it is, so a Moon the visitor
  // has turned by hand is not turned back.
  useEffect(() => {
    // Not during the dive to the site: that flight ends with the picture centred on the site.
    if (stage !== 'mission' || flight === 'in') return;
    const flying = flightTo.current;
    if (flying) {
      // A flight is under way: it lands on the new shift.
      flying.shiftX = missionShiftX;
      flying.shiftY = missionShiftY;
      return;
    }
    const slide = gsap.to(view.current, { shiftX: missionShiftX, shiftY: missionShiftY, duration: reducedMotion ? 0 : 0.5, ease: 'power3.out', overwrite: true });
    return () => {
      slide.kill();
    };
  }, [stage, flight, missionShiftX, missionShiftY, reducedMotion]);

  // "Zoom in to this site": dive to the site, then the terrain takes over.
  useEffect(() => {
    if (flight !== 'in' || !controls) return;
    if (focusLat === null || focusLon === null) {
      actions.finishFlightIn();
      return;
    }
    flyTo(diveEnd(focusLat, focusLon), 1.5, 'power2.in', actions.finishFlightIn);
    return () => {
      tween.current?.kill();
      flightTo.current = null;
    };
  }, [flight, focusLat, focusLon, controls]);

  // The Orbit camera's slow sway, and its lean toward the pointer.
  useEffect(() => {
    if (stage !== 'orbit' || reducedMotion) {
      drift.current.sway = drift.current.leanX = drift.current.leanY = 0;
      return;
    }
    const d = drift.current;
    const tl = gsap.timeline();
    tl.to(d, { sway: ORBIT_VIEW.sway, duration: ORBIT_VIEW.swayPeriod / 2, ease: 'sine.inOut' });
    tl.to(d, { sway: -ORBIT_VIEW.sway, duration: ORBIT_VIEW.swayPeriod, ease: 'sine.inOut', yoyo: true, repeat: -1 });
    const leanX = gsap.quickTo(d, 'leanX', { duration: 1.4, ease: 'power3.out' });
    const leanY = gsap.quickTo(d, 'leanY', { duration: 1.4, ease: 'power3.out' });
    const onPointer = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      leanX(-((e.clientX / window.innerWidth) * 2 - 1) * ORBIT_VIEW.lean);
      leanY(((e.clientY / window.innerHeight) * 2 - 1) * ORBIT_VIEW.lean);
    };
    window.addEventListener('pointermove', onPointer, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onPointer);
      tl.kill();
      gsap.killTweensOf(d);
    };
  }, [stage, reducedMotion]);

  // Every frame: place (in Orbit), aim, roll and shift the picture.
  const applied = useRef({ shiftX: NaN, shiftY: NaN, w: 0, h: 0 });
  useFrame(() => {
    if (appStore.get().stage === 'site') {
      // The site has its own picture shift: the Moon's is written afresh on the way back.
      applied.current.shiftX = NaN;
      return;
    }
    // The site stage uses a wider view and clip planes in metres: the Moon's are put back.
    if (camera.fov !== ORBIT_VIEW.fov || camera.near !== MOON_CLIP.near || camera.far !== MOON_CLIP.far) {
      camera.fov = ORBIT_VIEW.fov;
      camera.near = MOON_CLIP.near;
      camera.far = MOON_CLIP.far;
      camera.updateProjectionMatrix();
    }
    if (holding.current) orbitPosition(camera.position);
    const target = controls && controls.enabled ? controls.target : lookAt.current;
    camera.up.set(0, 1, 0);
    camera.lookAt(scratch.copy(target));
    if (view.current.roll !== 0) camera.rotateZ(view.current.roll);
    const a = applied.current;
    const { shiftX, shiftY } = view.current;
    if (a.shiftX !== shiftX || a.shiftY !== shiftY || a.w !== size.width || a.h !== size.height) {
      if (shiftX === 0 && shiftY === 0) camera.clearViewOffset();
      else camera.setViewOffset(size.width, size.height, -shiftX, shiftY, size.width, size.height);
      applied.current = { shiftX, shiftY, w: size.width, h: size.height };
    }
  });

  return null;
}
