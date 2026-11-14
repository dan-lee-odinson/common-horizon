// Views 1 and 2: the 3D Moon.
//   View 1 ("globe"): the whole Moon with Sun and Earth markers in the directions the data gives
//                     (not to scale). Click the Moon to go to view 2.
//   View 2 ("sites"): site markers; the Moon turns and zooms. Click a marker to highlight it,
//                     click it again (or "Zoom in to this site" beside its label) and the camera
//                     flies down to the site before the site scene opens. Click elsewhere on the
//                     Moon to pick that latitude and longitude.

import { Suspense, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { Html, OrbitControls, useTexture } from '@react-three/drei';
import gsap from 'gsap';
import * as THREE from 'three';
import type { Geometry } from '../api/types';
import type { KnownSite } from '../state/data';
import type { View } from '../state/app';
import { prefersReducedMotion } from '../state/useMedia';
import { actions, appStore, clamp } from '../state/app';
import { useStore } from '../state/store';
import { ZoomToSiteButton } from '../components/ZoomToSiteButton';
import { latLonToVec3, vec3ToLatLon } from '../util/geo';
import { cssColor } from './colors';
import { MOON_TEXTURE } from './textures';

export interface MoonSceneProps {
  view: Exclude<View, 'scene'>;
  sites: KnownSite[];
  highlightedId: string | null;
  savedIds: Set<string>;
  geometry: Geometry | null;
  isPhone: boolean;
  onMoonClick: () => void;
  onPickPoint: (lat: number, lonEast: number) => void;
  onSiteClick: (site: KnownSite) => void;
  /** Pixels on the left covered by the floating Sites pane; edge arrows stay right of it. */
  leftInset?: number;
}

/** The parts of OrbitControls the camera rig uses. */
interface ControlsLike {
  enabled: boolean;
  target: THREE.Vector3;
  minDistance: number;
  update: () => void;
}

const SUN_DISTANCE = 3.3;
const EARTH_DISTANCE = 2.4;
const GLOBE_RADIUS = 6.8;
const SITES_RADIUS = 3.7;
/** Closest the visitor can zoom with the wheel or a pinch (Moon radii from the centre). */
const MIN_DISTANCE = 1.35;
/** End of the "Zoom in to this site" flight: this far above the site, looking down at it. */
const FLIGHT_HEIGHT = 0.3;
/** Wide screens: shift the Moon right by this many pixels so the floating Sites pane does not cover it. */
const PANE_SHIFT_PX = 210;

function toVector(lat: number, lon: number, r = 1): THREE.Vector3 {
  const v = latLonToVec3(lat, lon, r);
  return new THREE.Vector3(v.x, v.y, v.z);
}

/** Default geometry until the first answer arrives: Sun to one side, Earth over 0° N 0° E. */
const DEFAULT_GEOMETRY: Geometry = { subsolar_lat: 0, subsolar_lon_east: 60, subearth_lat: 0, subearth_lon_east: 0 };

export function MoonScene(props: MoonSceneProps) {
  const sunArrow = useRef<HTMLDivElement>(null);
  const earthArrow = useRef<HTMLDivElement>(null);
  const geometry = props.geometry ?? DEFAULT_GEOMETRY;
  return (
    <div className="absolute inset-0" data-testid="moon-scene">
      <Canvas
        camera={{ position: [4.2, 2.2, 4.8], fov: 40, near: 0.05, far: 200 }}
        dpr={[1, 2]}
        gl={{ antialias: true }}
        aria-label={props.view === 'globe' ? 'The Moon with Sun and Earth markers. Click the Moon to see landing sites.' : 'The Moon with landing site markers'}
        onPointerMissed={() => undefined}
      >
        <color attach="background" args={[cssColor('--ch-space')]} />
        <Stars />
        <ambientLight intensity={0.13} />
        <SunAndEarth geometry={geometry} />
        <Suspense fallback={<MoonMesh {...props} texture={null} />}>{MOON_TEXTURE.enabled ? <TexturedMoon {...props} /> : <MoonMesh {...props} texture={null} />}</Suspense>
        {props.view === 'sites' ? <SiteMarkers {...props} /> : null}
        <OrbitControls makeDefault enablePan={false} minDistance={MIN_DISTANCE} maxDistance={12} rotateSpeed={0.6} zoomSpeed={0.8} enableDamping dampingFactor={0.08} />
        <CameraRig view={props.view} sites={props.sites} highlightedId={props.highlightedId} shiftPx={props.view === 'sites' && !props.isPhone ? PANE_SHIFT_PX : 0} />
        <EdgeTracker geometry={geometry} sunArrow={sunArrow} earthArrow={earthArrow} leftInset={props.leftInset ?? 0} />
      </Canvas>
      <EdgeArrow ref={sunArrow} label="Sun" color="var(--ch-sun)" />
      <EdgeArrow ref={earthArrow} label="Earth" color="var(--ch-earth)" />
    </div>
  );
}

function TexturedMoon(props: MoonSceneProps) {
  const texture = useTexture(props.isPhone ? MOON_TEXTURE.phone : MOON_TEXTURE.desktop);
  texture.colorSpace = THREE.SRGBColorSpace;
  return <MoonMesh {...props} texture={texture} />;
}

function MoonMesh({ view, onMoonClick, onPickPoint, texture }: MoonSceneProps & { texture: THREE.Texture | null }) {
  const color = useMemo(() => cssColor('--ch-moon'), []);
  function onClick(e: ThreeEvent<MouseEvent>) {
    if (e.delta > 4) return; // that was a drag, not a click
    e.stopPropagation();
    if (view === 'globe') {
      onMoonClick();
      return;
    }
    const { lat, lonEast } = vec3ToLatLon(e.point);
    onPickPoint(lat, lonEast);
  }
  return (
    <mesh onClick={onClick} onPointerOver={() => (document.body.style.cursor = 'pointer')} onPointerOut={() => (document.body.style.cursor = '')} name="moon">
      <sphereGeometry args={[1, 128, 64]} />
      <meshStandardMaterial color={texture ? 'white' : color} map={texture ?? undefined} roughness={0.96} metalness={0} />
    </mesh>
  );
}

function SunAndEarth({ geometry }: { geometry: Geometry }) {
  const sunDir = toVector(geometry.subsolar_lat, geometry.subsolar_lon_east);
  const earthDir = toVector(geometry.subearth_lat, geometry.subearth_lon_east);
  const colors = useMemo(() => ({ sun: cssColor('--ch-sun'), earth: cssColor('--ch-earth') }), []);
  return (
    <>
      <directionalLight position={sunDir.clone().multiplyScalar(10)} intensity={2.4} />
      {/* faint earthshine on the night side */}
      <directionalLight position={earthDir.clone().multiplyScalar(10)} intensity={0.05} />
      <mesh position={sunDir.clone().multiplyScalar(SUN_DISTANCE)} name="sun-marker">
        <sphereGeometry args={[0.1, 24, 16]} />
        <meshBasicMaterial color={colors.sun} toneMapped={false} />
      </mesh>
      <mesh position={earthDir.clone().multiplyScalar(EARTH_DISTANCE)} name="earth-marker">
        <sphereGeometry args={[0.13, 32, 24]} />
        <meshStandardMaterial color={colors.earth} emissive={colors.earth} emissiveIntensity={0.18} roughness={0.7} />
      </mesh>
    </>
  );
}

function SiteMarkers({ sites, highlightedId, savedIds, onSiteClick }: MoonSceneProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const colors = useMemo(() => ({ base: cssColor('--ch-marker'), saved: cssColor('--ch-marker-saved'), active: cssColor('--ch-marker-active') }), []);
  return (
    <group>
      {sites.map((site) => {
        const active = site.id === highlightedId;
        const pos = toVector(site.lat, site.lon_east, 1.004);
        return (
          <group key={site.id} position={pos}>
            <mesh
              name={`site-${site.id}`}
              onClick={(e) => {
                if (e.delta > 4) return;
                e.stopPropagation();
                onSiteClick(site);
              }}
              onPointerOver={(e) => {
                e.stopPropagation();
                document.body.style.cursor = 'pointer';
                setHoveredId(site.id);
              }}
              onPointerOut={() => {
                document.body.style.cursor = '';
                setHoveredId((h) => (h === site.id ? null : h));
              }}
            >
              <sphereGeometry args={[0.03, 12, 8]} />
              <meshBasicMaterial transparent opacity={0} depthWrite={false} />
            </mesh>
            <mesh>
              <sphereGeometry args={[active ? 0.016 : 0.011, 16, 12]} />
              <meshBasicMaterial color={active ? colors.active : savedIds.has(site.id) ? colors.saved : colors.base} toneMapped={false} />
            </mesh>
            {active ? <Ring color={colors.active} normal={pos} /> : null}
            {active || hoveredId === site.id ? <MarkerLabel name={site.name} normal={pos} withZoom={active} /> : null}
          </group>
        );
      })}
    </group>
  );
}

/**
 * Name tag next to a marker; hidden while the marker is on the far side of the Moon. The highlighted
 * site's tag also carries "Zoom in to this site" (hidden during a flight).
 */
function MarkerLabel({ name, normal, withZoom }: { name: string; normal: THREE.Vector3; withZoom: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const dir = useMemo(() => normal.clone().normalize(), [normal]);
  const cam = useMemo(() => new THREE.Vector3(), []);
  const flight = useStore(appStore, (s) => s.flight);
  // drei's Html attaches to the element R3F listens on. On a fresh canvas that element is connected a
  // moment after the first render; mounting earlier makes Html move roots and lose its content.
  const connected = useThree((s) => Boolean(s.events.connected));
  useFrame(({ camera }) => {
    if (!ref.current) return;
    cam.copy(camera.position).normalize();
    const facing = cam.dot(dir) > 0.12;
    ref.current.style.opacity = facing ? '1' : '0';
    // A hidden tag must not catch clicks meant for the Moon.
    ref.current.style.visibility = facing ? 'visible' : 'hidden';
  });
  const showZoom = withZoom && flight === null;
  if (!connected) return null;
  return (
    <Html position={[0, 0, 0]} zIndexRange={[15, 10]} style={{ pointerEvents: 'none' }}>
      <div ref={ref} className="ml-3 -mt-2.5 flex flex-col items-start gap-1" style={{ transition: 'opacity 150ms ease' }} data-testid={withZoom ? 'active-site-label' : undefined}>
        <span className="block whitespace-nowrap rounded-md border border-line bg-glass px-1.5 py-0.5 text-[12px] text-ink">{name}</span>
        {showZoom ? (
          <span className="pointer-events-auto block">
            <ZoomToSiteButton siteName={name} compact testId="zoom-to-site-label" />
          </span>
        ) : null}
      </div>
    </Html>
  );
}

function Ring({ color, normal }: { color: string; normal: THREE.Vector3 }) {
  const quaternion = useMemo(() => new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal.clone().normalize()), [normal]);
  return (
    <mesh quaternion={quaternion}>
      <ringGeometry args={[0.026, 0.033, 40]} />
      <meshBasicMaterial color={color} side={THREE.DoubleSide} toneMapped={false} />
    </mesh>
  );
}

function Stars() {
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const n = 900;
    const arr = new Float32Array(n * 3);
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < n; i++) {
      const u = rand() * 2 - 1;
      const t = rand() * Math.PI * 2;
      const r = 60;
      const s = Math.sqrt(1 - u * u);
      arr.set([r * s * Math.cos(t), r * u, r * s * Math.sin(t)], i * 3);
    }
    g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    return g;
  }, []);
  const color = useMemo(() => cssColor('--ch-ink-2'), []);
  return (
    <points geometry={geometry}>
      <pointsMaterial color={color} size={0.12} sizeAttenuation transparent opacity={0.55} depthWrite={false} />
    </points>
  );
}

interface Flight {
  /** Where the camera ends up. */
  position: THREE.Vector3;
  /** The point it looks at when it gets there. */
  target: THREE.Vector3;
  filmOffset: number;
  duration: number;
  ease: string;
  onComplete?: () => void;
}

/**
 * Moves the camera with GSAP from where it is to a new place. The direction from the Moon's centre
 * turns along a great circle, so the path never passes through the Moon. The height above the
 * surface changes on a log scale, so the ground grows (or shrinks) at a steady rate on screen, and
 * the point the camera looks at slides from its old place to the new one.
 */
function flyTo(camera: THREE.PerspectiveCamera, controls: ControlsLike | null, lookAt: THREE.Vector3, f: Flight): gsap.core.Tween {
  const startPos = camera.position.clone();
  const startH = Math.max(1e-3, startPos.length() - 1);
  const startDir = startPos.clone().normalize();
  const endH = Math.max(1e-3, f.position.length() - 1);
  const endDir = f.position.clone().normalize();
  const startTarget = lookAt.clone();
  const startFilm = camera.filmOffset;
  const turn = new THREE.Quaternion().setFromUnitVectors(startDir, endDir);
  const step = new THREE.Quaternion();
  const identity = new THREE.Quaternion();
  const target = new THREE.Vector3();
  const proxy = { t: 0 };
  if (controls) {
    controls.enabled = false;
    // The controls keep the camera this far from what it looks at; a flight goes closer.
    controls.minDistance = Math.min(MIN_DISTANCE, FLIGHT_HEIGHT * 0.5);
  }
  const apply = () => {
    step.copy(identity).slerp(turn, proxy.t);
    camera.position.copy(startDir).applyQuaternion(step).multiplyScalar(1 + startH * (endH / startH) ** proxy.t);
    target.lerpVectors(startTarget, f.target, proxy.t);
    lookAt.copy(target);
    camera.filmOffset = startFilm + (f.filmOffset - startFilm) * proxy.t;
    camera.updateProjectionMatrix();
    camera.lookAt(target);
    if (controls) {
      controls.target.copy(target);
      controls.update();
    }
  };
  return gsap.to(proxy, {
    t: 1,
    duration: prefersReducedMotion() ? 0 : f.duration,
    ease: f.ease,
    onUpdate: apply,
    onComplete: () => {
      apply();
      f.onComplete?.();
    },
  });
}

/** Where the "Zoom in to this site" flight ends: above the site, on the side the camera looks from. */
function flightEnd(lat: number, lon: number): { position: THREE.Vector3; target: THREE.Vector3 } {
  const target = toVector(lat, lon);
  // Look from a latitude no closer than 28 degrees to a pole, so the view never points straight
  // along the Moon's axis (the camera's "up").
  const from = toVector(clamp(lat, -62, 62), lon);
  return { position: target.clone().addScaledVector(from, FLIGHT_HEIGHT), target };
}

/**
 * Turns and zooms the camera with GSAP whenever the view or the highlighted site changes, and flies
 * it down to the highlighted site for "Zoom in to this site" (and back out after "Back to Moon").
 */
function CameraRig({ view, sites, highlightedId, shiftPx }: { view: MoonSceneProps['view']; sites: KnownSite[]; highlightedId: string | null; shiftPx: number }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const width = useThree((s) => s.size.width);
  const controls = useThree((s) => s.controls) as unknown as ControlsLike | null;
  const flight = useStore(appStore, (s) => s.flight);
  const focus = sites.find((s) => s.id === highlightedId) ?? null;
  const focusLat = focus?.lat ?? null;
  const focusLon = focus?.lon_east ?? null;
  const tween = useRef<gsap.core.Tween | null>(null);
  /** The point the camera looks at: the Moon's centre, or the site during a flight. */
  const lookAt = useRef(new THREE.Vector3());
  // Back from a site scene: the first move starts low over the site (the reverse of the flight in).
  const startOverSite = useRef(appStore.get().flight === 'out');

  const filmFor = (px: number) => (width > 0 ? -(px / width) * 2 * Math.tan((camera.fov * Math.PI) / 360) * camera.aspect * camera.getFilmWidth() : 0);

  const release = () => {
    if (!controls) return;
    controls.enabled = true;
    controls.minDistance = MIN_DISTANCE;
  };

  // The usual moves: view 1 <-> view 2, and turning to a newly highlighted site.
  useEffect(() => {
    if (appStore.get().flight === 'in') return;
    if (startOverSite.current && focusLat !== null && focusLon !== null) {
      startOverSite.current = false;
      const end = flightEnd(focusLat, focusLon);
      camera.position.copy(end.position);
      camera.filmOffset = filmFor(shiftPx);
      camera.lookAt(end.target);
      lookAt.current.copy(end.target);
    }
    const startDir = camera.position.clone().normalize();
    let endDir: THREE.Vector3;
    if (view === 'sites') {
      // Look at the highlighted site; otherwise at the southern near side, where most presets are.
      // Latitude is limited so the camera never sits exactly over a pole.
      endDir = focusLat !== null && focusLon !== null ? toVector(clamp(focusLat, -62, 62), focusLon) : toVector(-48, 20);
    } else {
      endDir = camera.position.lengthSq() > 0 ? toVector(18, 55) : startDir;
    }
    const endR = view === 'globe' ? GLOBE_RADIUS : focusLat !== null ? SITES_RADIUS * 0.88 : SITES_RADIUS;
    const flyingOut = appStore.get().flight === 'out';
    tween.current?.kill();
    tween.current = flyTo(camera, controls, lookAt.current, {
      position: endDir.multiplyScalar(endR),
      target: new THREE.Vector3(),
      // Film offset moves the picture sideways without moving the camera (orbiting still centres on the Moon).
      filmOffset: filmFor(shiftPx),
      duration: flyingOut ? 1.2 : 0.9,
      ease: flyingOut ? 'power1.inOut' : 'power2.inOut',
      onComplete: () => {
        release();
        if (flyingOut) actions.finishFlightOut();
      },
    });
    return () => {
      tween.current?.kill();
      release();
    };
    // Only re-run when the destination changes, not on every camera move.
  }, [view, focusLat, focusLon, controls, shiftPx, width]);

  // "Zoom in to this site": fly down to the site, then open the site scene.
  useEffect(() => {
    if (flight !== 'in') return;
    if (focusLat === null || focusLon === null) {
      actions.finishFlightIn();
      return;
    }
    const end = flightEnd(focusLat, focusLon);
    tween.current?.kill();
    tween.current = flyTo(camera, controls, lookAt.current, {
      position: end.position,
      target: end.target,
      filmOffset: camera.filmOffset,
      duration: 1.2,
      ease: 'power1.inOut',
      onComplete: actions.finishFlightIn,
    });
    return () => {
      tween.current?.kill();
      release();
    };
  }, [flight, focusLat, focusLon, controls]);
  return null;
}

/** Points a small arrow at the screen edge towards the Sun or Earth marker when it is out of view. */
function EdgeTracker({
  geometry,
  sunArrow,
  earthArrow,
  leftInset,
}: {
  geometry: Geometry;
  sunArrow: RefObject<HTMLDivElement | null>;
  earthArrow: RefObject<HTMLDivElement | null>;
  leftInset: number;
}) {
  const sunPos = useMemo(() => toVector(geometry.subsolar_lat, geometry.subsolar_lon_east, SUN_DISTANCE), [geometry]);
  const earthPos = useMemo(() => toVector(geometry.subearth_lat, geometry.subearth_lon_east, EARTH_DISTANCE), [geometry]);
  const tmp = useMemo(() => new THREE.Vector3(), []);
  const camSpace = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera, size }) => {
    const placed: { x: number; y: number }[] = [];
    for (const [pos, el] of [
      [sunPos, sunArrow.current],
      [earthPos, earthArrow.current],
    ] as const) {
      if (!el) continue;
      camSpace.copy(pos).applyMatrix4(camera.matrixWorldInverse);
      const behind = camSpace.z > 0;
      tmp.copy(pos).project(camera);
      let x = tmp.x;
      let y = tmp.y;
      if (behind) {
        x = -x;
        y = -y;
      }
      const hiddenByMoon = !behind && rayHitsMoon(camera.position, pos);
      const inView = !behind && !hiddenByMoon && Math.abs(x) <= 0.96 && Math.abs(y) <= 0.94;
      const text = el.querySelector<HTMLElement>('[data-label]');
      if (text) text.textContent = hiddenByMoon ? `${text.dataset.label} (behind the Moon)` : (text.dataset.label ?? '');
      if (inView) {
        el.style.opacity = '0';
        continue;
      }
      const k = 1 / Math.max(Math.abs(x) / 0.9, Math.abs(y) / 0.84, 1e-6);
      const px = Math.max(leftInset + 36, ((x * k + 1) / 2) * size.width);
      let py = ((1 - y * k) / 2) * size.height;
      // Two arrows pointing the same way would overlap: stack the second one.
      for (const p of placed) if (Math.abs(p.x - px) < 70 && Math.abs(p.y - py) < 24) py = p.y + (py > size.height / 2 ? -26 : 26);
      placed.push({ x: px, y: py });
      const angle = Math.atan2(-y, x);
      el.style.opacity = '1';
      el.style.transform = `translate(${px}px, ${py}px) translate(-50%, -50%)`;
      const arrow = el.firstElementChild as HTMLElement | null;
      if (arrow) arrow.style.transform = `rotate(${angle}rad)`;
    }
  });
  return null;
}

/** True when the straight line from the camera to a point passes through the Moon (radius 1). */
function rayHitsMoon(from: THREE.Vector3, to: THREE.Vector3): boolean {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const a = dx * dx + dy * dy + dz * dz;
  const b = 2 * (from.x * dx + from.y * dy + from.z * dz);
  const c = from.x * from.x + from.y * from.y + from.z * from.z - 1;
  const disc = b * b - 4 * a * c;
  if (disc <= 0) return false;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t > 0 && t < 1;
}

function EdgeArrow({ ref, label, color }: { ref: RefObject<HTMLDivElement | null>; label: string; color: string }) {
  return (
    <div
      ref={ref}
      className="pointer-events-none absolute left-0 top-0 z-[5] flex items-center gap-1 rounded-full border border-line bg-glass px-1.5 py-0.5 text-[12px] text-ink"
      style={{ opacity: 0, transition: 'opacity 150ms ease' }}
      data-testid={`edge-arrow-${label.toLowerCase()}`}
      aria-hidden
    >
      <span className="inline-block" style={{ color }}>
        <svg width="14" height="14" viewBox="0 0 14 14">
          <path d="M2 7h9M8 3.5 11.5 7 8 10.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <span data-label={label}>{label}</span>
    </div>
  );
}
