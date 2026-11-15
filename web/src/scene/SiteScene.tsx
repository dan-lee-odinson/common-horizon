// View 3: the site scene. For now the ground is a placeholder (gentle invented bumps, starting
// bare: no hardware placed). The terrain skyline ring, the Sun and Earth come from the horizon
// data, and the Sun moves when Play runs. Drag to rotate, wheel or the +/- buttons to zoom.

import { forwardRef, useImperativeHandle, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import gsap from 'gsap';
import * as THREE from 'three';
import type { HorizonResponse, SiteRef } from '../api/types';
import { simClock } from '../state/app';
import { prefersReducedMotion } from '../state/useMedia';
import { azElToLocal, normalizeLon360 } from '../util/geo';
import { sunAt } from '../components/HorizonPlot';
import { cssColor } from './colors';

export interface SiteSceneHandle {
  zoom: (factor: number) => void;
}

interface Props {
  site: SiteRef;
  horizon: HorizonResponse | null;
  landingMs: number;
}

const SKY_RADIUS = 70;

interface ControlsLike {
  target: THREE.Vector3;
  update: () => void;
  minDistance: number;
  maxDistance: number;
}

export const SiteScene = forwardRef<SiteSceneHandle, Props>(function SiteScene({ site, horizon, landingMs }, ref) {
  const zoomRef = useRef<(factor: number) => void>(() => undefined);
  useImperativeHandle(ref, () => ({ zoom: (f) => zoomRef.current(f) }), []);
  const earthCenter = useMemo(() => earthBoxCenter(horizon), [horizon]);
  // Start the camera looking towards Earth (or north when Earth is not in the sky).
  const lookAz = earthCenter?.az ?? 0;
  const camStart = azElToLocal(lookAz + 180, 9, 15);

  return (
    <div className="absolute inset-0" data-testid="site-scene">
      <Canvas camera={{ position: [camStart.x, camStart.y + 1.6, camStart.z], fov: 50, near: 0.1, far: 400 }} dpr={[1, 2]} aria-label={`Site scene for ${site.name}`}>
        <color attach="background" args={[cssColor('--ch-space')]} />
        <SkyStars />
        <ambientLight intensity={0.12} />
        {/* soft fill so the placeholder ground stays readable when the Sun grazes the horizon */}
        <hemisphereLight args={[cssColor('--ch-ink-2'), cssColor('--ch-space'), 0.35]} />
        <Ground seed={`${site.lat},${site.lon_east}`} />
        {horizon ? <SkylineRing horizon={horizon} /> : null}
        {horizon ? <SunLight horizon={horizon} landingMs={landingMs} /> : null}
        {earthCenter ? <EarthInSky az={earthCenter.az} el={earthCenter.el} /> : null}
        <OrbitControls makeDefault target={[0, 1.6, 0]} enablePan={false} minDistance={3} maxDistance={60} maxPolarAngle={Math.PI / 2 - 0.04} enableDamping dampingFactor={0.08} />
        <ZoomBridge zoomRef={zoomRef} />
      </Canvas>
    </div>
  );
});

function earthBoxCenter(h: HorizonResponse | null): { az: number; el: number } | null {
  const box = h?.earth_box;
  if (!box) return null;
  const span = normalizeLon360(box.az_max - box.az_min);
  return { az: normalizeLon360(box.az_min + span / 2), el: (box.el_min + box.el_max) / 2 };
}

function ZoomBridge({ zoomRef }: { zoomRef: { current: (factor: number) => void } }) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as ControlsLike | null;
  const tween = useRef<gsap.core.Tween | null>(null);
  zoomRef.current = (factor: number) => {
    if (!controls) return;
    tween.current?.kill(); // rapid clicks retarget from where the camera is now
    const offset = camera.position.clone().sub(controls.target);
    const target = Math.min(controls.maxDistance, Math.max(controls.minDistance, offset.length() * factor));
    const proxy = { d: offset.length() };
    const dir = offset.normalize();
    tween.current = gsap.to(proxy, {
      d: target,
      duration: prefersReducedMotion() ? 0 : 0.3,
      ease: 'power4.out',
      onUpdate: () => {
        camera.position.copy(controls.target).addScaledVector(dir, proxy.d);
        controls.update();
      },
    });
  };
  return null;
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Placeholder ground: a wide plane with a few soft bumps and craters, flat in the middle. */
function Ground({ seed }: { seed: string }) {
  const geometry = useMemo(() => {
    const g = new THREE.PlaneGeometry(170, 170, 160, 160);
    g.rotateX(-Math.PI / 2);
    let s = hash(seed) || 1;
    const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const features = Array.from({ length: 60 }, () => ({
      x: (rand() * 2 - 1) * 70,
      z: (rand() * 2 - 1) * 70,
      r: 1.5 + rand() * rand() * 12,
      h: (rand() < 0.7 ? -1 : 1) * (0.15 + rand() * 0.8),
    }));
    const pos = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      let y = 0;
      for (const f of features) {
        const d = Math.hypot(x - f.x, z - f.z) / f.r;
        if (f.h < 0) y += f.h * Math.exp(-d * d * 1.6) + -f.h * 0.35 * Math.exp(-((d - 1.1) ** 2) * 5);
        else y += f.h * Math.exp(-d * d);
      }
      const flat = Math.min(1, Math.hypot(x, z) / 12);
      pos.setY(i, y * flat);
    }
    g.computeVertexNormals();
    return g;
  }, [seed]);
  const color = useMemo(() => cssColor('--ch-ground'), []);
  return (
    <mesh geometry={geometry} receiveShadow>
      <meshStandardMaterial color={color} roughness={1} metalness={0} />
    </mesh>
  );
}

/** The terrain skyline from the horizon data, drawn as a ring of distant hills. */
function SkylineRing({ horizon }: { horizon: HorizonResponse }) {
  const geometry = useMemo(() => {
    const pts = horizon.skyline;
    const n = pts.length;
    const positions: number[] = [];
    const index: number[] = [];
    for (let i = 0; i <= n; i++) {
      const p = pts[i % n];
      const base = azElToLocal(p.az, 0, SKY_RADIUS);
      const top = azElToLocal(p.az, Math.max(p.el, -0.5), SKY_RADIUS);
      positions.push(base.x, -6, base.z, top.x, top.y, top.z);
      if (i < n) {
        const a = i * 2;
        index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setIndex(index);
    g.computeVertexNormals();
    return g;
  }, [horizon]);
  const color = useMemo(() => cssColor('--ch-terrain-edge'), []);
  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.3} side={THREE.DoubleSide} roughness={1} flatShading />
    </mesh>
  );
}

/** Sun disc and sunlight that follow the simulated clock. */
function SunLight({ horizon, landingMs }: { horizon: HorizonResponse; landingMs: number }) {
  const light = useRef<THREE.DirectionalLight>(null);
  const disc = useRef<THREE.Mesh>(null);
  const times = useMemo(() => horizon.sun_path.map((p) => Date.parse(p.t)), [horizon]);
  const color = useMemo(() => cssColor('--ch-sun'), []);
  useFrame(() => {
    const now = simClock.get().nowMs ?? landingMs;
    const sun = sunAt(horizon, times, now);
    if (!sun || !light.current || !disc.current) return;
    const dir = azElToLocal(sun.az, sun.el, SKY_RADIUS - 2);
    disc.current.position.set(dir.x, dir.y, dir.z);
    light.current.position.set(dir.x, dir.y, dir.z);
    light.current.intensity = sun.above ? 1.8 : 0;
    disc.current.visible = sun.el > -3;
  });
  return (
    <>
      <directionalLight ref={light} intensity={2.6} />
      <mesh ref={disc}>
        <sphereGeometry args={[1.6, 24, 16]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
    </>
  );
}

function EarthInSky({ az, el }: { az: number; el: number }) {
  const pos = azElToLocal(az, el, SKY_RADIUS - 4);
  const color = useMemo(() => cssColor('--ch-earth'), []);
  return (
    <mesh position={[pos.x, pos.y, pos.z]}>
      <sphereGeometry args={[2.6, 32, 24]} />
      <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.25} roughness={0.6} />
    </mesh>
  );
}

function SkyStars() {
  const geometry = useMemo(() => {
    const n = 700;
    const arr = new Float32Array(n * 3);
    let s = 11;
    const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < n; i++) {
      const u = rand() * 0.95 + 0.03; // upper hemisphere only
      const t = rand() * Math.PI * 2;
      const r = 150;
      const c = Math.sqrt(1 - u * u);
      arr.set([r * c * Math.cos(t), r * u, r * c * Math.sin(t)], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    return g;
  }, []);
  const color = useMemo(() => cssColor('--ch-ink-2'), []);
  return (
    <points geometry={geometry}>
      <pointsMaterial color={color} size={0.5} sizeAttenuation transparent opacity={0.5} depthWrite={false} />
    </points>
  );
}
