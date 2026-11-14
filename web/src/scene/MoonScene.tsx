// Views 1 and 2: the 3D Moon.
//   View 1 ("globe"): the whole Moon with Sun and Earth markers in the directions the data gives
//                     (not to scale). Click the Moon to go to view 2.
//   View 2 ("sites"): site markers; the Moon turns and zooms. Click a marker to highlight it,
//                     click it again to open the site scene. Click elsewhere on the Moon to pick
//                     that latitude and longitude.

import { Suspense, useEffect, useMemo, useRef, type RefObject } from 'react';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { OrbitControls, useTexture } from '@react-three/drei';
import gsap from 'gsap';
import * as THREE from 'three';
import type { Geometry } from '../api/types';
import type { KnownSite } from '../state/data';
import type { View } from '../state/app';
import { prefersReducedMotion } from '../state/useMedia';
import { clamp } from '../state/app';
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
}

/** The parts of OrbitControls the camera rig uses. */
interface ControlsLike {
  enabled: boolean;
  target: THREE.Vector3;
  update: () => void;
}

const SUN_DISTANCE = 3.3;
const EARTH_DISTANCE = 2.4;
const GLOBE_RADIUS = 6.8;
const SITES_RADIUS = 3.7;
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
        <OrbitControls makeDefault enablePan={false} minDistance={1.35} maxDistance={12} rotateSpeed={0.6} zoomSpeed={0.8} enableDamping dampingFactor={0.08} />
        <CameraRig view={props.view} sites={props.sites} highlightedId={props.highlightedId} shiftPx={props.view === 'sites' && !props.isPhone ? PANE_SHIFT_PX : 0} />
        <EdgeTracker geometry={geometry} sunArrow={sunArrow} earthArrow={earthArrow} />
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
              }}
              onPointerOut={() => (document.body.style.cursor = '')}
            >
              <sphereGeometry args={[0.03, 12, 8]} />
              <meshBasicMaterial transparent opacity={0} depthWrite={false} />
            </mesh>
            <mesh>
              <sphereGeometry args={[active ? 0.016 : 0.011, 16, 12]} />
              <meshBasicMaterial color={active ? colors.active : savedIds.has(site.id) ? colors.saved : colors.base} toneMapped={false} />
            </mesh>
            {active ? <Ring color={colors.active} normal={pos} /> : null}
          </group>
        );
      })}
    </group>
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

/** Turns and zooms the camera with GSAP whenever the view or the highlighted site changes. */
function CameraRig({ view, sites, highlightedId, shiftPx }: { view: MoonSceneProps['view']; sites: KnownSite[]; highlightedId: string | null; shiftPx: number }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const width = useThree((s) => s.size.width);
  const controls = useThree((s) => s.controls) as unknown as ControlsLike | null;
  const focus = sites.find((s) => s.id === highlightedId) ?? null;
  const focusLat = focus?.lat ?? null;
  const focusLon = focus?.lon_east ?? null;

  useEffect(() => {
    const startPos = camera.position.clone();
    const startR = startPos.length();
    const startDir = startPos.clone().normalize();
    let endDir: THREE.Vector3;
    if (view === 'sites') {
      // Look at the highlighted site; otherwise at the southern near side, where most presets are.
      // Latitude is limited so the camera never sits exactly over a pole.
      endDir = focusLat !== null && focusLon !== null ? toVector(clamp(focusLat, -62, 62), focusLon) : toVector(-48, 20);
    } else {
      endDir = startPos.lengthSq() > 0 ? toVector(18, 55) : startDir;
    }
    const endR = view === 'globe' ? GLOBE_RADIUS : focus ? SITES_RADIUS * 0.88 : SITES_RADIUS;
    // Film offset moves the picture sideways without moving the camera (orbiting still centres on the Moon).
    const startFilm = camera.filmOffset;
    const endFilm = width > 0 ? -(shiftPx / width) * 2 * Math.tan((camera.fov * Math.PI) / 360) * camera.aspect * camera.getFilmWidth() : 0;
    const turn = new THREE.Quaternion().setFromUnitVectors(startDir, endDir.normalize());
    const proxy = { t: 0 };
    const step = new THREE.Quaternion();
    const identity = new THREE.Quaternion();
    if (controls) controls.enabled = false;
    const apply = () => {
      step.copy(identity).slerp(turn, proxy.t);
      const dir = startDir.clone().applyQuaternion(step);
      camera.position.copy(dir.multiplyScalar(startR + (endR - startR) * proxy.t));
      camera.filmOffset = startFilm + (endFilm - startFilm) * proxy.t;
      camera.updateProjectionMatrix();
      camera.lookAt(0, 0, 0);
      controls?.target.set(0, 0, 0);
      controls?.update();
    };
    const tween = gsap.to(proxy, {
      t: 1,
      duration: prefersReducedMotion() ? 0 : 1.2,
      ease: 'power2.inOut',
      onUpdate: apply,
      onComplete: () => {
        apply();
        if (controls) controls.enabled = true;
      },
    });
    return () => {
      tween.kill();
      if (controls) controls.enabled = true;
    };
    // Only re-run when the destination changes, not on every camera move.
  }, [view, focusLat, focusLon, controls, shiftPx, width]);
  return null;
}

/** Points a small arrow at the screen edge towards the Sun or Earth marker when it is out of view. */
function EdgeTracker({ geometry, sunArrow, earthArrow }: { geometry: Geometry; sunArrow: RefObject<HTMLDivElement | null>; earthArrow: RefObject<HTMLDivElement | null> }) {
  const sunPos = useMemo(() => toVector(geometry.subsolar_lat, geometry.subsolar_lon_east, SUN_DISTANCE), [geometry]);
  const earthPos = useMemo(() => toVector(geometry.subearth_lat, geometry.subearth_lon_east, EARTH_DISTANCE), [geometry]);
  const tmp = useMemo(() => new THREE.Vector3(), []);
  const camSpace = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera, size }) => {
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
      const inView = !behind && Math.abs(x) <= 0.96 && Math.abs(y) <= 0.94;
      if (inView) {
        el.style.opacity = '0';
        continue;
      }
      const k = 1 / Math.max(Math.abs(x) / 0.9, Math.abs(y) / 0.84, 1e-6);
      const px = ((x * k + 1) / 2) * size.width;
      const py = ((1 - y * k) / 2) * size.height;
      const angle = Math.atan2(-y, x);
      el.style.opacity = '1';
      el.style.transform = `translate(${px}px, ${py}px) translate(-50%, -50%)`;
      const arrow = el.firstElementChild as HTMLElement | null;
      if (arrow) arrow.style.transform = `rotate(${angle}rad)`;
    }
  });
  return null;
}

function EdgeArrow({ ref, label, color }: { ref: RefObject<HTMLDivElement | null>; label: string; color: string }) {
  return (
    <div
      ref={ref}
      className="pointer-events-none absolute left-0 top-0 flex items-center gap-1 rounded-full border border-line bg-glass px-1.5 py-0.5 text-[11px] text-ink"
      style={{ opacity: 0, transition: 'opacity 150ms ease' }}
      data-testid={`edge-arrow-${label.toLowerCase()}`}
      aria-hidden
    >
      <span className="inline-block" style={{ color }}>
        <svg width="14" height="14" viewBox="0 0 14 14">
          <path d="M2 7h9M8 3.5 11.5 7 8 10.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      {label}
    </div>
  );
}
