// Views 1 and 2: the 3D Moon.
//   View 1 ("globe"): the whole Moon with Earth and the Sun in the directions the data gives. Earth
//                     is drawn at its true size next to the Moon (3.67 times its diameter) and the
//                     Sun larger still, but both far closer than they really are: not to scale.
//                     Scroll or pinch to zoom out and see them. Click the Moon to go to view 2.
//   View 2 ("sites"): site markers; the Moon turns and zooms. Click a marker to highlight it,
//                     click it again (or "Zoom in to this site" beside its label) and the camera
//                     flies down to the site before the site scene opens. Click elsewhere on the
//                     Moon to pick that latitude and longitude.

import { Suspense, forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type RefObject } from 'react';
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

// Sizes and distances in Moon radii (the Moon is a sphere of radius 1). NOT TO SCALE: really, Earth
// is about 221 Moon radii away and the Sun about 86,000, and the Sun is about 400 times as wide as
// the Moon. Earth's size alone is true: its diameter is about 3.67 times the Moon's.
const EARTH_RADIUS = 3.67;
const EARTH_DISTANCE = 30;
/** Larger than Earth, as it must be, though nowhere near its true size. */
const SUN_RADIUS = 8;
const SUN_DISTANCE = 90;
/** Farthest the wheel or a pinch can zoom out: far enough to see Earth and the Sun. */
const MAX_DISTANCE = 230;
/**
 * Mouse wheel zoom: the distance changes by e^(this x pixels scrolled), so one 100-pixel notch is about
 * 20 % and a trackpad's small steps add up smoothly. About 19 notches go from the whole Moon to the
 * farthest view.
 */
const WHEEL_ZOOM_PER_PIXEL = 0.0018;
/** The star sphere sits well beyond everything, so zooming out never reaches it. */
const STAR_RADIUS = 1500;
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

export interface MoonSceneHandle {
  /** Multiply the camera's distance from the Moon by this factor (below 1 zooms in). */
  zoom: (factor: number) => void;
}

export const MoonScene = forwardRef<MoonSceneHandle, MoonSceneProps>(function MoonScene(props, ref) {
  const sunArrow = useRef<HTMLDivElement>(null);
  const earthArrow = useRef<HTMLDivElement>(null);
  const zoomRef = useRef<(factor: number) => void>(() => undefined);
  useImperativeHandle(ref, () => ({ zoom: (f) => zoomRef.current(f) }), []);
  const geometry = props.geometry ?? DEFAULT_GEOMETRY;
  return (
    <div className="absolute inset-0" data-testid="moon-scene">
      <Canvas
        camera={{ position: [4.2, 2.2, 4.8], fov: 40, near: 0.05, far: 4000 }}
        dpr={[1, 2]}
        gl={{ antialias: true }}
        aria-label={
          props.view === 'globe'
            ? 'The Moon with Earth and the Sun, not to scale. Scroll or pinch to zoom out and see them. Click the Moon to see landing sites.'
            : 'The Moon with landing site markers'
        }
        onPointerMissed={() => undefined}
      >
        <color attach="background" args={[cssColor('--ch-space')]} />
        <Stars />
        <ambientLight intensity={0.13} />
        <SunAndEarth geometry={geometry} />
        <Suspense fallback={<MoonMesh {...props} texture={null} />}>{MOON_TEXTURE.enabled ? <TexturedMoon {...props} /> : <MoonMesh {...props} texture={null} />}</Suspense>
        {props.view === 'sites' ? <SiteMarkers {...props} /> : null}
        {/* The zoom range runs from just above the Moon out past Earth and the Sun. The wheel is handled by
            WheelZoom; the controls keep pinch (spreading two fingers twice as far zooms about 2.8 times). */}
        <OrbitControls makeDefault enablePan={false} minDistance={MIN_DISTANCE} maxDistance={MAX_DISTANCE} rotateSpeed={0.6} zoomSpeed={1.5} enableDamping dampingFactor={0.08} />
        <WheelZoom />
        <CameraRig view={props.view} sites={props.sites} highlightedId={props.highlightedId} shiftPx={props.view === 'sites' && !props.isPhone ? PANE_SHIFT_PX : 0} />
        <ZoomBridge zoomRef={zoomRef} />
        <EdgeTracker geometry={geometry} sunArrow={sunArrow} earthArrow={earthArrow} leftInset={props.leftInset ?? 0} />
      </Canvas>
      <EdgeArrow ref={sunArrow} label="Sun" color="var(--ch-sun)" />
      <EdgeArrow ref={earthArrow} label="Earth" color="var(--ch-earth)" />
    </div>
  );
});

/**
 * Mouse wheel and trackpad zoom, in proportion to how far the wheel turned. (drei's OrbitControls
 * zooms by one fixed step per wheel event, which makes a mouse slow and a trackpad jumpy over a range
 * this long.) It listens before the controls do and keeps the event from them.
 */
function WheelZoom() {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as ControlsLike | null;
  const connected = useThree((s) => s.events.connected) as HTMLElement | undefined;
  const canvas = useThree((s) => s.gl.domElement);
  useEffect(() => {
    const el = connected ?? canvas;
    const onWheel = (e: WheelEvent) => {
      if (!controls) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (!controls.enabled || appStore.get().flight !== null) return;
      let pixels = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1);
      if (e.ctrlKey) pixels *= 10; // a pinch on a trackpad arrives as a wheel event with Ctrl held
      pixels = clamp(pixels, -400, 400); // one huge event never jumps the whole range
      const offset = camera.position.clone().sub(controls.target);
      const distance = clamp(offset.length() * Math.exp(pixels * WHEEL_ZOOM_PER_PIXEL), MIN_DISTANCE, MAX_DISTANCE);
      camera.position.copy(controls.target).addScaledVector(offset.normalize(), distance);
      controls.update();
    };
    el.addEventListener('wheel', onWheel, { passive: false, capture: true });
    return () => el.removeEventListener('wheel', onWheel, { capture: true });
  }, [camera, controls, connected, canvas]);
  return null;
}

/** The +/- buttons: a short GSAP move along the line to the Moon, kept inside the zoom range. */
function ZoomBridge({ zoomRef }: { zoomRef: { current: (factor: number) => void } }) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as ControlsLike | null;
  const tween = useRef<gsap.core.Tween | null>(null);
  useEffect(() => () => void tween.current?.kill(), []);
  zoomRef.current = (factor: number) => {
    if (!controls || !controls.enabled || appStore.get().flight !== null) return;
    tween.current?.kill(); // rapid presses go on from where the camera is now
    const offset = camera.position.clone().sub(controls.target);
    const from = offset.length();
    const to = clamp(from * factor, MIN_DISTANCE, MAX_DISTANCE);
    const dir = offset.normalize();
    const proxy = { d: from };
    tween.current = gsap.to(proxy, {
      d: to,
      duration: prefersReducedMotion() ? 0 : 0.35,
      ease: 'power3.out',
      onUpdate: () => {
        camera.position.copy(controls.target).addScaledVector(dir, proxy.d);
        controls.update();
      },
    });
  };
  return null;
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
      {/* Sunlight comes from the Sun's direction (parallel rays), on the Moon and on Earth alike. */}
      <directionalLight position={sunDir.clone().multiplyScalar(10)} intensity={2.4} />
      {/* faint earthshine on the Moon's night side */}
      <directionalLight position={earthDir.clone().multiplyScalar(10)} intensity={0.05} />
      <Body name="sun" label="Sun" position={sunDir.clone().multiplyScalar(SUN_DISTANCE)} radius={SUN_RADIUS} color={colors.sun} glow />
      <Body name="earth" label="Earth" position={earthDir.clone().multiplyScalar(EARTH_DISTANCE)} radius={EARTH_RADIUS} color={colors.earth} />
      <MoonLabel />
    </>
  );
}

/**
 * Earth or the Sun: a sphere with a name under it. It fades when the camera comes close, so zooming
 * out straight through one never fills the screen with it.
 */
function Body({ name, label, position, radius, color, glow = false }: { name: string; label: string; position: THREE.Vector3; radius: number; color: string; glow?: boolean }) {
  const material = useRef<THREE.MeshBasicMaterial & THREE.MeshStandardMaterial>(null);
  const labelPos = useMemo(() => position.clone().add(new THREE.Vector3(0, -radius * 1.45, 0)), [position, radius]);
  useFrame(({ camera }) => {
    const m = material.current;
    if (!m) return;
    const near = clamp((camera.position.distanceTo(position) - radius * 1.1) / (radius * 2), 0, 1);
    const opacity = 0.12 + 0.88 * near;
    const transparent = opacity < 0.999;
    if (m.transparent !== transparent) {
      m.transparent = transparent;
      m.depthWrite = !transparent;
      m.needsUpdate = true;
    }
    m.opacity = opacity;
  });
  return (
    <group>
      <mesh position={position} name={`${name}-body`}>
        <sphereGeometry args={[radius, 48, 32]} />
        {glow ? (
          <meshBasicMaterial ref={material} color={color} toneMapped={false} />
        ) : (
          <meshStandardMaterial ref={material} color={color} emissive={color} emissiveIntensity={0.12} roughness={0.7} metalness={0} />
        )}
      </mesh>
      {glow ? <Glow position={position} radius={radius} color={color} /> : null}
      <SpaceLabel position={labelPos} text={label} />
    </group>
  );
}

/** A soft halo around the Sun: a camera-facing sprite with a radial gradient drawn here. */
function Glow({ position, radius, color }: { position: THREE.Vector3; radius: number; color: string }) {
  const texture = useMemo(() => {
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      g.addColorStop(0, 'rgba(255,255,255,0.65)');
      g.addColorStop(0.3, 'rgba(255,255,255,0.22)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, size, size);
    }
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, []);
  useEffect(() => () => texture.dispose(), [texture]);
  return (
    <sprite position={position} scale={[radius * 4.5, radius * 4.5, 1]}>
      <spriteMaterial map={texture} color={color} transparent depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
    </sprite>
  );
}

/** A plain-text name in space, centred on a point. */
function SpaceLabel({ position, text, minCameraDistance = 0 }: { position: THREE.Vector3; text: string; minCameraDistance?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const connected = useThree((s) => Boolean(s.events.connected));
  useFrame(({ camera }) => {
    if (ref.current) ref.current.style.opacity = camera.position.length() >= minCameraDistance ? '1' : '0';
  });
  if (!connected) return null;
  return (
    <Html position={position} center zIndexRange={[8, 6]} style={{ pointerEvents: 'none' }}>
      <span ref={ref} className="block whitespace-nowrap rounded-md border border-line bg-glass px-1.5 py-0.5 text-[12px] text-ink" style={{ transition: 'opacity 200ms ease' }} data-testid={`space-label-${text.toLowerCase()}`}>
        {text}
      </span>
    </Html>
  );
}

/** Once the camera is far out, the Moon is a dot: name it. */
function MoonLabel() {
  const position = useMemo(() => new THREE.Vector3(0, -1.6, 0), []);
  return <SpaceLabel position={position} text="Moon" minCameraDistance={22} />;
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
      const r = STAR_RADIUS;
      const s = Math.sqrt(1 - u * u);
      arr.set([r * s * Math.cos(t), r * u, r * s * Math.sin(t)], i * 3);
    }
    g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    return g;
  }, []);
  const color = useMemo(() => cssColor('--ch-ink-2'), []);
  return (
    <points geometry={geometry}>
      {/* Fixed pixel size: the stars look the same however far the camera zooms out. */}
      <pointsMaterial color={color} size={1.6} sizeAttenuation={false} transparent opacity={0.6} depthWrite={false} />
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

/** Points a small arrow at the screen edge towards the Sun or Earth when it is out of view. */
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
      el.dataset.inView = inView ? 'true' : 'false';
      if (inView) {
        el.style.opacity = '0';
        continue;
      }
      const k = 1 / Math.max(Math.abs(x) / 0.9, Math.abs(y) / 0.84, 1e-6);
      // Keep the whole arrow on screen: clear of the Sites pane on the left and of the right edge.
      const px = clamp(((x * k + 1) / 2) * size.width, leftInset + 36, Math.max(leftInset + 36, size.width - 40));
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
