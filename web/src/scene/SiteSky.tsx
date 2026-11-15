// The site's sky: stars, Earth, the Sun and the terrain skyline, all on a dome centred on the camera.
// The Sun's path over the stay is drawn across it as a thin line.
//
// The data gives directions only (where the Sun and Earth stand, how high the terrain reaches at
// each compass direction) and no distances, so nothing here has a place in the world: the whole
// dome moves with the camera, and the picture matches the horizon answer wherever the camera goes.
// The skyline band is the only thing in the sky that hides anything; whatever stands near the
// camera (the hardware, the ground) is drawn first and hides the sky behind it.
//
// The Sun and Earth are balls of the size that makes them exactly as wide as they look from the
// site (see `sunDiscRadius`), so their size on screen is true at any field of view. The soft glow
// round the Sun is faint, wider than the disc and not part of it.

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { cssColor } from './colors';
import { glowTexture } from './glow';
import { EARTH_FRAGMENT, EARTH_VERTEX } from './shaders';
import type { SiteNow } from './siteNow';
import { bandAz, domePoint, earthDiscRadius, SITE_VIEW, sunDiscRadius } from './siteView';
import { Stars } from './Stars';

/** The Sun's glow is this many disc widths across, at this opacity while the site is lit. */
const GLOW_WIDTHS = 10;
const GLOW_OPACITY = 0.38;

export function SiteSky({ now, profile, sunPath }: { now: SiteNow; profile: readonly number[] | null; sunPath: readonly number[] | null }) {
  const group = useRef<THREE.Group>(null);
  const sun = useRef<THREE.Mesh>(null);
  const glow = useRef<THREE.Sprite>(null);
  const glowMaterial = useRef<THREE.SpriteMaterial>(null);
  const earth = useRef<THREE.Mesh>(null);
  const colors = useMemo(() => {
    const amber = new THREE.Color(cssColor('--ch-sun'));
    return {
      // The disc itself is the Sun's amber burnt toward white, so its edge stays crisp inside the glow.
      disc: amber.clone().lerp(new THREE.Color(1, 1, 1), 0.55),
      glow: amber,
      earth: new THREE.Color(cssColor('--ch-earth')),
    };
  }, []);
  const earthUniforms = useMemo(() => ({ uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uColor: { value: colors.earth } }), [colors]);
  const sunRadius = sunDiscRadius();
  const earthBase = earthDiscRadius(0);
  const texture = useMemo(() => glowTexture(), []);

  useFrame(({ camera }) => {
    const g = group.current;
    if (!g) return;
    g.position.copy(camera.position);
    const sky = now.sky;
    const dome = SITE_VIEW.dome;
    if (sun.current) {
      sun.current.visible = now.hasSun;
      if (now.hasSun) sun.current.position.copy(now.sunDir).multiplyScalar(dome);
    }
    if (glow.current && glowMaterial.current) {
      // The glow belongs to direct sunlight: none while the terrain hides the Sun.
      glow.current.visible = now.hasSun && now.lit > 0.01;
      glow.current.position.copy(now.sunDir).multiplyScalar(dome);
      glowMaterial.current.opacity = GLOW_OPACITY * now.lit;
    }
    if (earth.current) {
      const e = sky?.earth ?? null;
      earth.current.visible = e !== null;
      if (e) {
        const p = domePoint(e.az, e.el);
        earth.current.position.set(p.x, p.y, p.z);
        // The site's own place on the Moon changes its distance to Earth by up to a Moon radius.
        earth.current.scale.setScalar(earthDiscRadius(e.el) / earthBase);
        // Earth's lit side faces the Sun: the Sun is so far off that its direction is the same from Earth as from here.
        if (now.hasSun) earthUniforms.uSunDir.value.copy(now.sunDir);
      }
    }
  });

  return (
    <group ref={group}>
      <Stars radius={SITE_VIEW.dome - 200} count={900} upperOnly renderOrder={0} />
      {sunPath && sunPath.length >= 6 ? <SunPath points={sunPath} /> : null}
      <mesh ref={earth} visible={false} renderOrder={1} frustumCulled={false}>
        <sphereGeometry args={[earthBase, 40, 24]} />
        <shaderMaterial vertexShader={EARTH_VERTEX} fragmentShader={EARTH_FRAGMENT} uniforms={earthUniforms} transparent depthWrite={false} />
      </mesh>
      <mesh ref={sun} visible={false} renderOrder={2} frustumCulled={false}>
        <sphereGeometry args={[sunRadius, 24, 16]} />
        <meshBasicMaterial color={colors.disc} transparent depthWrite={false} toneMapped={false} />
      </mesh>
      <sprite ref={glow} visible={false} renderOrder={3} scale={[sunRadius * 2 * GLOW_WIDTHS, sunRadius * 2 * GLOW_WIDTHS, 1]}>
        <spriteMaterial ref={glowMaterial} map={texture} color={colors.glow} transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </sprite>
      {profile ? <SkylineBand profile={profile} /> : null}
    </group>
  );
}

/**
 * The Sun's path over the window the horizon answer covers, as a thin line across the sky: the same
 * samples the horizon plot draws. It is drawn behind the skyline band, so the stretches where the
 * terrain hides the Sun are hidden here too.
 */
function SunPath({ points }: { points: readonly number[] }) {
  const line = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    const material = new THREE.LineBasicMaterial({ color: cssColor('--ch-sun'), transparent: true, opacity: 0.5, depthWrite: false, toneMapped: false });
    const object = new THREE.Line(geometry, material);
    object.frustumCulled = false;
    object.renderOrder = 0.5;
    return object;
  }, [points]);
  useEffect(
    () => () => {
      line.geometry.dispose();
      line.material.dispose();
    },
    [line],
  );
  return <primitive object={line} />;
}

/**
 * The terrain skyline from the horizon answer: a band from well below level up to the skyline at
 * each compass direction, with the skyline itself drawn as a thin bright line. With no horizon
 * answer for the site there is no band: the app does not invent a skyline.
 */
function SkylineBand({ profile }: { profile: readonly number[] }) {
  const { band, edge } = useMemo(() => {
    const bandPos: number[] = [];
    const edgePos: number[] = [];
    const index: number[] = [];
    const steps = profile.length - 1;
    for (let k = 0; k <= steps; k++) {
      const az = bandAz(profile, k);
      const el = profile[k];
      const base = domePoint(az, SITE_VIEW.bandFloorDeg);
      const top = domePoint(az, el);
      const over = domePoint(az, el + SITE_VIEW.edgeDeg);
      bandPos.push(base.x, base.y, base.z, top.x, top.y, top.z);
      edgePos.push(top.x, top.y, top.z, over.x, over.y, over.z);
      if (k < steps) {
        const a = k * 2;
        index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const make = (positions: number[]) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      g.setIndex(index);
      return g;
    };
    return { band: make(bandPos), edge: make(edgePos) };
  }, [profile]);
  // A new answer builds a new band: the old shapes are freed.
  useEffect(
    () => () => {
      band.dispose();
      edge.dispose();
    },
    [band, edge],
  );
  const colors = useMemo(() => ({ fill: cssColor('--ch-terrain'), edge: cssColor('--ch-cyan') }), []);
  return (
    <>
      <mesh geometry={band} frustumCulled={false} renderOrder={4}>
        <meshBasicMaterial color={colors.fill} side={THREE.DoubleSide} transparent depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh geometry={edge} frustumCulled={false} renderOrder={5}>
        <meshBasicMaterial color={colors.edge} side={THREE.DoubleSide} transparent depthWrite={false} toneMapped={false} />
      </mesh>
    </>
  );
}
