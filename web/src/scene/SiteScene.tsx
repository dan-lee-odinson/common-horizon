// The site scene as it was before the terrain moved into the one canvas, kept behind the new HUD
// with the changes that make its sky true: the Sun's and Earth's directions and the lit / dark word
// come from the same function as the readouts (skyAt), both discs are drawn at their true apparent
// size, the skyline is the horizon answer's own and rides with the camera (it has no distance), and
// the placeholder ground never rises above level. Drag to turn, wheel or pinch to zoom.

import { useLayoutEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import type { HorizonResponse, SiteRef } from '../api/types';
import { simClock } from '../state/app';
import { EARTH_MOON_DISTANCE_KM, EARTH_RADIUS_KM, earthDistanceFromSiteKm, SUN_DISTANCE_KM, SUN_RADIUS_KM } from '../util/bodies';
import { azElToLocal, sampleProfile } from '../util/geo';
import { skyAt } from '../util/quantities';
import type { GeometryTrack } from '../util/track';
import { anchors } from './anchors';
import { cssColor } from './colors';
import { EARTH_FRAGMENT, EARTH_VERTEX } from './shaders';
import { arrivalAzimuth, frameShift, insideFrame, siteFrame } from './siteView';
import { Stars } from './Stars';

interface Props {
  site: SiteRef;
  /** This site's horizon answer; null until it arrives. */
  horizon: HorizonResponse | null;
  track: GeometryTrack | null;
  landingMs: number;
  isPhone: boolean;
}

/** The skyline band rides on a sphere of this radius around the camera; the Sun and Earth sit behind it. */
const SKYLINE_RADIUS = 70;
const BODY_RADIUS = 90;
/** The band reaches this far below level, so the ground's far edge is always in front of it. */
const BAND_FLOOR_DEG = -12;
/** The camera looks at a point this high over the landing point, from this far away on arrival. */
const TARGET_HEIGHT = 1.6;
const ARRIVAL_DISTANCE = 15;

export function SiteScene({ site, horizon, track, landingMs, isPhone }: Props) {
  // Where the camera stands on arrival: worked out once, at the landing time.
  const start = useMemo(() => {
    const sky = skyAt({ track, tMs: landingMs, landingMs, site, horizon });
    const facing = (arrivalAzimuth(sky.sun, sky.earth) * Math.PI) / 180;
    const up = (9 * Math.PI) / 180;
    return [-Math.sin(facing) * Math.cos(up) * ARRIVAL_DISTANCE, TARGET_HEIGHT + Math.sin(up) * ARRIVAL_DISTANCE, Math.cos(facing) * Math.cos(up) * ARRIVAL_DISTANCE] as const;
    // Worked out for the site and the landing only: when later answers arrive the visitor may
    // already be turning the view, and the camera is not taken out of their hands.
  }, [site.id, landingMs]);

  return (
    <div className="absolute inset-0" data-testid="site-scene">
      <Canvas flat camera={{ position: [start[0], start[1], start[2]], fov: isPhone ? 62 : 50, near: 0.1, far: 400 }} dpr={[1, 2]} aria-label={`The view from ${site.name}`} role="img">
        <color attach="background" args={[cssColor('--ch-space')]} />
        <Ground seed={`${site.lat},${site.lon_east}`} />
        <Sky site={site} horizon={horizon} track={track} landingMs={landingMs} />
        <OrbitControls
          makeDefault
          target={[0, TARGET_HEIGHT, 0]}
          enablePan={false}
          minDistance={4}
          maxDistance={40}
          minPolarAngle={Math.PI / 3}
          maxPolarAngle={Math.PI / 2 - 0.04}
          enableDamping
          dampingFactor={0.08}
        />
        <FrameShift />
      </Canvas>
    </div>
  );
}

/** Keeps the middle of the picture in the middle of the part of the window the panels leave free. */
function FrameShift() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const applied = useRef('');
  useFrame(() => {
    const shift = frameShift(siteFrame.get(), size.width, size.height);
    const key = `${size.width}x${size.height}:${shift.x},${shift.y}`;
    if (key === applied.current) return;
    applied.current = key;
    if (shift.x === 0 && shift.y === 0) camera.clearViewOffset();
    else camera.setViewOffset(size.width, size.height, -shift.x, shift.y, size.width, size.height);
  });
  return null;
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * Placeholder ground: a wide plane with a few soft hollows near the landing point. It is an
 * illustration (the screen says so) and never rises above level, so it cannot hide sky that the
 * data says is open; beyond 45 units it is level all the way out.
 */
function Ground({ seed }: { seed: string }) {
  const geometry = useMemo(() => {
    const g = new THREE.PlaneGeometry(320, 320, 200, 200);
    g.rotateX(-Math.PI / 2);
    let s = hash(seed) || 1;
    const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const hollows = Array.from({ length: 40 }, () => ({
      x: (rand() * 2 - 1) * 42,
      z: (rand() * 2 - 1) * 42,
      r: 2.5 + rand() * rand() * 11,
      depth: 0.15 + rand() * 0.7,
    }));
    const pos = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const r = Math.hypot(x, z);
      if (r >= 45) continue;
      let y = 0;
      for (const f of hollows) {
        const d = Math.hypot(x - f.x, z - f.z) / f.r;
        y -= f.depth * Math.exp(-d * d * 1.6);
      }
      // Level under the landing point, and fading back to level between 30 and 45 units out.
      const near = Math.min(1, r / 12);
      const far = 1 - Math.min(1, Math.max(0, (r - 30) / 15));
      pos.setY(i, Math.min(0, y * near * far));
    }
    g.computeVertexNormals();
    return g;
  }, [seed]);
  const color = useMemo(() => cssColor('--ch-ground'), []);
  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial color={color} roughness={1} metalness={0} />
    </mesh>
  );
}

/**
 * The sky: stars, Earth, the Sun and the skyline band, all on spheres centred on the camera, with
 * the light that goes with them. The band is the only thing in the sky that hides anything.
 */
function Sky({ site, horizon, track, landingMs }: Omit<Props, 'isPhone'>) {
  const group = useRef<THREE.Group>(null);
  const sun = useRef<THREE.Mesh>(null);
  const earth = useRef<THREE.Mesh>(null);
  const light = useRef<THREE.DirectionalLight>(null);
  const ambient = useRef<THREE.AmbientLight>(null);
  const fill = useRef<THREE.HemisphereLight>(null);
  const colors = useMemo(
    () => ({ sun: cssColor('--ch-sun'), earth: new THREE.Color(cssColor('--ch-earth')), sky: cssColor('--ch-ink-2'), space: cssColor('--ch-space') }),
    [],
  );
  const earthUniforms = useMemo(() => ({ uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uColor: { value: colors.earth } }), [colors]);
  // True apparent sizes: a ball of the body's radius at the body's distance, shrunk onto the sphere it is drawn on.
  const sunRadius = (BODY_RADIUS * SUN_RADIUS_KM) / SUN_DISTANCE_KM;
  const earthBaseRadius = (BODY_RADIUS * EARTH_RADIUS_KM) / EARTH_MOON_DISTANCE_KM;
  const input = useRef({ site, horizon, track, landingMs });
  useLayoutEffect(() => {
    input.current = { site, horizon, track, landingMs };
  });
  const scratch = useMemo(() => ({ v: new THREE.Vector3(), toPoint: new THREE.Vector3(), forward: new THREE.Vector3() }), []);
  const size = useThree((s) => s.size);

  useFrame(({ camera }) => {
    const { site: s, horizon: h, track: t, landingMs: landing } = input.current;
    group.current?.position.copy(camera.position);
    const sky = skyAt({ track: t, tMs: simClock.get().nowMs ?? landing, landingMs: landing, site: s, horizon: h });
    const lit = sky.lit === true;
    const frame = siteFrame.get();
    /** Writes where a point of the sky is on screen; returns whether it is in view. */
    const { v, toPoint, forward } = scratch;
    camera.getWorldDirection(forward);
    const focal = size.height / 2 / Math.tan(((camera as THREE.PerspectiveCamera).fov * Math.PI) / 360);
    const project = (name: 'sun' | 'earth' | 'lander', radiusUnits: number, distance: number): boolean => {
      const depth = toPoint.copy(v).sub(camera.position).dot(forward);
      v.project(camera);
      const x = (v.x * 0.5 + 0.5) * size.width;
      const y = (-v.y * 0.5 + 0.5) * size.height;
      const a = anchors[name];
      a.x = x;
      a.y = y;
      a.r = distance > 0 ? Math.max(4, (radiusUnits / distance) * focal) : 0;
      return depth > 0 && x >= 0 && x <= size.width && y >= 0 && y <= size.height;
    };

    if (sun.current) {
      sun.current.visible = sky.sun !== null;
      if (sky.sun) {
        const d = azElToLocal(sky.sun.az, sky.sun.el, 1);
        sun.current.position.set(d.x * BODY_RADIUS, d.y * BODY_RADIUS, d.z * BODY_RADIUS);
        earthUniforms.uSunDir.value.set(d.x, d.y, d.z);
        light.current?.position.set(d.x, d.y, d.z);
        v.set(d.x, d.y, d.z).multiplyScalar(BODY_RADIUS).add(camera.position);
        const seen = project('sun', sunRadius, BODY_RADIUS);
        // The tag points at the Sun only while the answer says it is above the terrain.
        anchors.sun.visible = lit && seen && insideFrame(frame, anchors.sun.x, anchors.sun.y, 24);
      } else anchors.sun.visible = false;
    }
    // The light follows the horizon answer's word: with the Sun behind the terrain only a dim fill is left.
    if (light.current) light.current.intensity = lit ? 1.8 : 0;
    if (ambient.current) ambient.current.intensity = lit ? 0.12 : 0.04;
    if (fill.current) fill.current.intensity = lit ? 0.35 : 0.1;

    if (earth.current) {
      earth.current.visible = sky.earth !== null;
      if (sky.earth) {
        const d = azElToLocal(sky.earth.az, sky.earth.el, 1);
        earth.current.position.set(d.x * BODY_RADIUS, d.y * BODY_RADIUS, d.z * BODY_RADIUS);
        // The site's own place on the Moon changes its distance to Earth by up to a Moon radius.
        const scale = EARTH_MOON_DISTANCE_KM / earthDistanceFromSiteKm(sky.earth.el);
        earth.current.scale.setScalar(scale);
        v.set(d.x, d.y, d.z).multiplyScalar(BODY_RADIUS).add(camera.position);
        const seen = project('earth', earthBaseRadius * scale, BODY_RADIUS);
        const skylineThere = h && h.skyline.length ? sampleProfile(h.skyline, sky.earth.az) : 0;
        anchors.earth.visible = seen && sky.earth.el > skylineThere && insideFrame(frame, anchors.earth.x, anchors.earth.y, 24);
      } else anchors.earth.visible = false;
    }

    // The landing point: the middle of the ground.
    v.set(0, 0, 0);
    const distance = camera.position.length();
    anchors.lander.visible = project('lander', 0, distance);
    anchors.lander.r = 0;
  });

  return (
    <>
      <ambientLight ref={ambient} intensity={0.12} />
      <hemisphereLight ref={fill} args={[colors.sky, colors.space, 0.35]} />
      <directionalLight ref={light} intensity={0} />
      <group ref={group}>
        <Stars radius={150} count={700} upperOnly />
        <mesh ref={earth} visible={false}>
          <sphereGeometry args={[earthBaseRadius, 32, 20]} />
          <shaderMaterial vertexShader={EARTH_VERTEX} fragmentShader={EARTH_FRAGMENT} uniforms={earthUniforms} />
        </mesh>
        <mesh ref={sun} visible={false}>
          <sphereGeometry args={[sunRadius, 20, 12]} />
          <meshBasicMaterial color={colors.sun} toneMapped={false} />
        </mesh>
        {horizon && horizon.skyline.length > 0 ? <SkylineBand horizon={horizon} /> : null}
      </group>
    </>
  );
}

/** The terrain skyline from the horizon answer, as a band from well below level up to the skyline, with its edge drawn. */
function SkylineBand({ horizon }: { horizon: HorizonResponse }) {
  const { band, edge } = useMemo(() => {
    const positions: number[] = [];
    const index: number[] = [];
    const top: number[] = [];
    for (let az = 0; az <= 360; az++) {
      const el = sampleProfile(horizon.skyline, az);
      const base = azElToLocal(az, BAND_FLOOR_DEG, SKYLINE_RADIUS);
      const up = azElToLocal(az, el, SKYLINE_RADIUS);
      positions.push(base.x, base.y, base.z, up.x, up.y, up.z);
      top.push(up.x, up.y, up.z);
      if (az < 360) {
        const a = az * 2;
        index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const b = new THREE.BufferGeometry();
    b.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    b.setIndex(index);
    const e = new THREE.BufferGeometry();
    e.setAttribute('position', new THREE.Float32BufferAttribute(top, 3));
    return { band: b, edge: e };
  }, [horizon]);
  const colors = useMemo(() => ({ fill: cssColor('--ch-terrain'), edge: cssColor('--ch-cyan') }), []);
  const line = useMemo(() => new THREE.Line(edge, new THREE.LineBasicMaterial({ color: colors.edge, toneMapped: false })), [edge, colors]);
  return (
    <>
      <mesh geometry={band} frustumCulled={false}>
        <meshBasicMaterial color={colors.fill} side={THREE.DoubleSide} toneMapped={false} />
      </mesh>
      <primitive object={line} frustumCulled={false} />
    </>
  );
}
