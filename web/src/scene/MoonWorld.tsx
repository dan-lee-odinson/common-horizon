// The Moon world: stages 1 (orbit) and 2 (mission select).
//   The Moon, showing NASA's CGI Moon Kit maps (a drawn surface until they load), lit from the
//   direction the data gives for the Sun, with the day-night line and the two overhead points
//   marked on its surface.
//   The ring system in the Moon's equatorial plane: a longitude scale, the Sun ring, a ring of days
//   and a short bracket for the range Earth's overhead point moves through over the stay.
//   The Sun rides its ring at the longitude where it is overhead: a direction marker, not a body
//   to scale. Earth is drawn at its true size beside the Moon, behind it and out along its true
//   direction, joined to its bracket by a line; its distance is not to scale. Earth is never drawn
//   between the camera and the Moon.
//   Site markers, and a pulsing reticle on the site in the spotlight. (Both fade out as the camera
//   dives to a site: the HUD's own reticle carries the landing point from there.)

import { useEffect, useMemo, useRef, type RefObject } from 'react';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import gsap from 'gsap';
import * as THREE from 'three';
import { actions, appStore } from '../state/app';
import { useStore } from '../state/store';
import { vec3ToLatLon } from '../util/geo';
import { DAY_MS, SYNODIC_MONTH_DAYS } from '../util/time';
import { earthSwing } from '../util/track';
import { anchors, type AnchorName } from './anchors';
import { cssColor } from './colors';
import { coronaTexture, glowTexture } from './glow';
import { hiddenByMoon } from './occlusion';
import { MISSION_VIEW } from './missionView';
import { ORBIT_VIEW, ringRadii } from './orbitView';
import { geometryNow, sceneTimeMs, toVector, type SceneData } from './sceneData';
import { DISC_FRAGMENT, DISC_VERTEX, ATMOSPHERE_FRAGMENT, EARTH_FRAGMENT, EARTH_VERTEX, MOON_FRAGMENT, MOON_VERTEX, RETICLE_FRAGMENT, RETICLE_VERTEX } from './shaders';
import { MOON_MAPS, MOON_RELIEF_STRENGTH } from './textures';

const SUN_BODY_RADIUS = 0.085;
const UP = new THREE.Vector3(0, 1, 0);

function color(name: string): THREE.Color {
  return new THREE.Color(cssColor(name));
}

export function MoonWorld({ data, visible }: { data: SceneData; visible: boolean }) {
  const stage = useStore(appStore, (s) => s.stage);
  const moon = useRef<THREE.ShaderMaterial>(null);
  const disc = useRef<THREE.ShaderMaterial>(null);
  const discMesh = useRef<THREE.Mesh>(null);
  const earth = useRef<THREE.ShaderMaterial>(null);
  const sunGroup = useRef<THREE.Group>(null);
  const earthGroup = useRef<THREE.Group>(null);
  const earthLine = useRef<THREE.Mesh>(null);
  const sunStem = useRef<THREE.Mesh>(null);
  /** Shared with the anchors: are the bodies drawn, and is Earth being kept off the Moon's face? */
  const shown = useRef({ bodies: false, earth: false });
  const radii = useMemo(() => ringRadii(data.isPhone), [data.isPhone]);
  const earthDistance = ORBIT_VIEW.earthDistance;
  const earthRadius = ORBIT_VIEW.earthRadius;
  // The range Earth's overhead point moves through over the stay: the bracket.
  const swing = useMemo(() => earthSwing(data.track, data.landingMs, data.stayEndMs), [data.track, data.landingMs, data.stayEndMs]);
  const dataRef = useRef(data);
  dataRef.current = data;

  const colors = useMemo(
    () => ({ cyan: color('--ch-cyan'), sun: color('--ch-sun'), earth: color('--ch-earth'), moon: color('--ch-moon') }),
    [],
  );
  const blank = useMemo(() => {
    const t = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    t.needsUpdate = true;
    return t;
  }, []);

  const moonUniforms = useMemo(
    () => ({
      uSunDir: { value: new THREE.Vector3(0.6, 0.2, 0.77).normalize() },
      uEarthDir: { value: new THREE.Vector3(1, 0, 0) },
      uAlbedo: { value: colors.moon },
      uSunColor: { value: new THREE.Color('#fff4dc') },
      uEarthColor: { value: colors.earth },
      uLineColor: { value: colors.cyan },
      uGrid: { value: 1 },
      uMarks: { value: 1 },
      uTerminator: { value: 1 },
      uLit: { value: 0 },
      uMap: { value: blank as THREE.Texture },
      uNormalMap: { value: blank as THREE.Texture },
      uUseMap: { value: 0 },
      uRelief: { value: MOON_RELIEF_STRENGTH },
    }),
    [colors, blank],
  );
  const discUniforms = useMemo(
    () => ({
      uOpacity: { value: 1 },
      uData: { value: 0 },
      uSunLon: { value: 0 },
      uSunLon0: { value: 0 },
      uEarthLon: { value: 0 },
      uEarthArcMin: { value: 0 },
      uEarthArcMax: { value: 0 },
      uDays: { value: 0 },
      uMonth: { value: SYNODIC_MONTH_DAYS },
      uRadii: { value: new THREE.Vector4(...radii) },
      uCyan: { value: colors.cyan },
      uSun: { value: colors.sun },
      uEarth: { value: colors.earth },
    }),
    [colors, radii],
  );
  const earthUniforms = useMemo(() => ({ uSunDir: { value: new THREE.Vector3(1, 0, 0) }, uColor: { value: colors.earth } }), [colors]);
  // The atmosphere shares the Sun's direction with the planet (the same vector object), so the two cannot disagree.
  const atmosphereUniforms = useMemo(() => ({ uSunDir: earthUniforms.uSunDir, uColor: { value: colors.earth.clone().lerp(new THREE.Color('#ffffff'), 0.35) } }), [colors, earthUniforms]);

  const gl = useThree((st) => st.gl);
  // The Moon's real surface (see textures.ts): the larger pair of maps on desktop, the smaller on
  // phones and on any device whose largest texture is under 4096. They load in the background from
  // the app's own files; the drawn surface shows until both are ready and stays if either fails.
  useEffect(() => {
    const set = data.isPhone || gl.capabilities.maxTextureSize < 4096 ? MOON_MAPS.small : MOON_MAPS.large;
    const loader = new THREE.TextureLoader();
    const made: THREE.Texture[] = [];
    let alive = true;
    const load = (path: string, isColor: boolean) =>
      new Promise<THREE.Texture>((resolve, reject) => {
        loader.load(
          `${import.meta.env.BASE_URL}${path}`,
          (t) => {
            if (!alive) {
              // Finished after this effect was cleaned up: nothing will use it.
              t.dispose();
              reject(new Error('no longer needed'));
              return;
            }
            made.push(t);
            // The color map is an ordinary picture; the relief map is numbers, not colors.
            t.colorSpace = isColor ? THREE.SRGBColorSpace : THREE.NoColorSpace;
            t.wrapS = THREE.RepeatWrapping;
            t.anisotropy = Math.min(4, gl.capabilities.getMaxAnisotropy());
            t.needsUpdate = true;
            resolve(t);
          },
          undefined,
          reject,
        );
      });
    Promise.all([load(set.color, true), load(set.normal, false)])
      .then(([color, normal]) => {
        const m = moon.current;
        if (!alive || !m) return;
        m.uniforms.uMap.value = color;
        m.uniforms.uNormalMap.value = normal;
        m.uniforms.uUseMap.value = 1;
        actions.setMoonSurface('map');
      })
      .catch(() => {
        // The drawn surface stays, and the caption keeps saying it is an illustration.
      });
    return () => {
      alive = false;
      const m = moon.current;
      if (m) {
        // Take the maps off the material before freeing them, or the next frame would upload them again.
        m.uniforms.uUseMap.value = 0;
        m.uniforms.uMap.value = blank;
        m.uniforms.uNormalMap.value = blank;
      }
      actions.setMoonSurface('drawn');
      for (const t of made) t.dispose();
    };
  }, [data.isPhone, gl, blank]);

  // The rings, the bodies and the surface marks belong to the Orbit stage: they fade out on the
  // way to mission select, where nothing may stand between the camera and the sites.
  const fade = useRef({ instruments: stage === 'orbit' ? 1 : 0 });
  useEffect(() => {
    const tween = gsap.to(fade.current, { instruments: stage === 'orbit' ? 1 : 0, duration: data.reducedMotion ? 0 : 0.6, ease: 'power2.out' });
    return () => {
      tween.kill();
    };
  }, [stage, data.reducedMotion]);

  const sunDir = useMemo(() => new THREE.Vector3(), []);
  const earthDir = useMemo(() => new THREE.Vector3(), []);

  useFrame(({ camera }) => {
    const d = dataRef.current;
    const g = geometryNow(d);
    const t = sceneTimeMs(d.landingMs);
    const m = moon.current;
    const k = disc.current;
    const show = fade.current.instruments;
    if (m) {
      m.uniforms.uMarks.value = show;
      m.uniforms.uTerminator.value = 0.6 + 0.4 * show;
      m.uniforms.uLit.value = g ? 1 : 0;
    }
    if (k) {
      k.uniforms.uOpacity.value = show;
      k.uniforms.uData.value = g ? 1 : 0;
    }
    if (discMesh.current) discMesh.current.visible = show > 0.01;
    const bodies = Boolean(g) && show > 0.01;
    shown.current.bodies = bodies;
    if (sunGroup.current) {
      sunGroup.current.visible = bodies;
      sunGroup.current.scale.setScalar(Math.max(0.001, show));
    }
    if (sunStem.current) sunStem.current.visible = bodies;
    if (!g) {
      shown.current.earth = false;
      if (earthGroup.current) earthGroup.current.visible = false;
      if (earthLine.current) earthLine.current.visible = false;
      return;
    }
    toVector(g.subsolar_lat, g.subsolar_lon_east, 1, sunDir);
    toVector(g.subearth_lat, g.subearth_lon_east, 1, earthDir);
    if (m) {
      m.uniforms.uSunDir.value.copy(sunDir);
      m.uniforms.uEarthDir.value.copy(earthDir);
    }
    if (earth.current) earth.current.uniforms.uSunDir.value.copy(sunDir);
    if (k) {
      const landingG = d.landingMs !== null && d.track && d.landingMs >= d.track.startMs && d.landingMs <= d.track.endMs ? d.track.at(d.landingMs) : (d.landingGeometry ?? g);
      k.uniforms.uSunLon.value = g.subsolar_lon_east;
      k.uniforms.uSunLon0.value = landingG.subsolar_lon_east;
      k.uniforms.uEarthLon.value = g.subearth_lon_east;
      k.uniforms.uEarthArcMin.value = swing ? swing.lonMin : g.subearth_lon_east;
      k.uniforms.uEarthArcMax.value = swing ? swing.lonMax : g.subearth_lon_east;
      k.uniforms.uDays.value = t !== null && d.landingMs !== null ? Math.max(0, (t - d.landingMs) / DAY_MS) : 0;
    }
    if (sunGroup.current) sunGroup.current.position.copy(sunDir).multiplyScalar(radii[1]);
    if (sunStem.current) {
      // A stem from the Sun to the ring plane shows its latitude.
      const y = sunDir.y * radii[1];
      sunStem.current.position.set(sunDir.x * radii[1], y / 2, sunDir.z * radii[1]);
      sunStem.current.scale.set(1, Math.max(1e-4, Math.abs(y)), 1);
    }

    // Earth: out along its true direction. It is drawn only while it is farther from the camera
    // than the Moon's centre, so it can never cover the Moon's face or a site marker.
    const earthPos = earthGroup.current?.position.copy(earthDir).multiplyScalar(earthDistance);
    const camDist = camera.position.length();
    const behind = earthPos ? earthPos.distanceTo(camera.position) > camDist + 0.2 && earthPos.dot(camera.position) < 0 : false;
    const earthShown = bodies && behind;
    shown.current.earth = earthShown;
    if (earthGroup.current) {
      earthGroup.current.visible = earthShown;
      earthGroup.current.scale.setScalar(Math.max(0.001, show));
    }
    if (earthLine.current) {
      // The line from the bracket on toward Earth.
      const from = radii[3];
      const to = earthDistance - earthRadius * 1.15;
      earthLine.current.visible = earthShown;
      earthLine.current.position.copy(earthDir).multiplyScalar((from + to) / 2);
      earthLine.current.quaternion.setFromUnitVectors(UP, earthDir);
      earthLine.current.scale.set(1, Math.max(1e-4, to - from), 1);
    }
  });

  function onMoonClick(e: ThreeEvent<MouseEvent>) {
    if (e.delta > 4 || !dataRef.current.pickEnabled) return; // a drag, or not in "Custom coordinates" mode
    e.stopPropagation();
    const { lat, lonEast } = vec3ToLatLon(e.point);
    dataRef.current.onPickPoint(lat, lonEast);
  }

  const glow = useMemo(() => glowTexture(), []);
  const corona = useMemo(() => coronaTexture(), []);
  const discSize = (radii[3] + 0.2) * 2;

  return (
    <group visible={visible}>
      <mesh name="moon" onClick={onMoonClick}>
        <sphereGeometry args={[1, 160, 80]} />
        <shaderMaterial ref={moon} vertexShader={MOON_VERTEX} fragmentShader={MOON_FRAGMENT} uniforms={moonUniforms} />
      </mesh>
      {/* A faint cool halo behind the Moon's limb. */}
      <sprite scale={[3.3, 3.3, 1]} renderOrder={-1}>
        <spriteMaterial map={glow} color={colors.cyan} transparent opacity={0.16} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </sprite>

      {/* The ring system, in the equatorial plane. */}
      <mesh ref={discMesh} rotation={[-Math.PI / 2, 0, 0]} renderOrder={2}>
        <planeGeometry args={[discSize, discSize]} />
        <shaderMaterial
          ref={disc}
          vertexShader={DISC_VERTEX}
          fragmentShader={DISC_FRAGMENT}
          uniforms={discUniforms}
          transparent
          depthWrite={false}
          side={THREE.DoubleSide}
          blending={THREE.AdditiveBlending}
        />
      </mesh>

      <group ref={sunGroup} visible={false}>
        <mesh name="sun-body">
          <sphereGeometry args={[SUN_BODY_RADIUS, 32, 20]} />
          <meshBasicMaterial color="#fff6d8" toneMapped={false} />
        </mesh>
        <sprite scale={[0.62, 0.62, 1]}>
          <spriteMaterial map={glow} color={colors.sun} transparent opacity={0.95} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
        </sprite>
        {/* A soft glow and a faint corona. The Sun here is a direction marker, not a body to scale. */}
        <sprite scale={[2.0, 2.0, 1]}>
          <spriteMaterial map={glow} color={colors.sun} transparent opacity={0.36} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
        </sprite>
        <sprite scale={[3.6, 3.6, 1]}>
          <spriteMaterial map={corona} color={colors.sun} transparent opacity={0.5} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
        </sprite>
      </group>
      <mesh ref={sunStem} visible={false}>
        <cylinderGeometry args={[0.004, 0.004, 1, 6]} />
        <meshBasicMaterial color={colors.sun} transparent opacity={0.7} toneMapped={false} />
      </mesh>

      <group ref={earthGroup} visible={false}>
        <mesh name="earth-body">
          <sphereGeometry args={[earthRadius, 128, 80]} />
          <shaderMaterial ref={earth} vertexShader={EARTH_VERTEX} fragmentShader={EARTH_FRAGMENT} uniforms={earthUniforms} />
        </mesh>
        {/* The thin glow of the atmosphere just outside the limb. */}
        <mesh name="earth-atmosphere" renderOrder={-1}>
          <sphereGeometry args={[earthRadius * 1.03, 128, 80]} />
          <shaderMaterial
            vertexShader={EARTH_VERTEX}
            fragmentShader={ATMOSPHERE_FRAGMENT}
            uniforms={atmosphereUniforms}
            side={THREE.BackSide}
            transparent
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
      </group>
      <mesh ref={earthLine} visible={false}>
        <cylinderGeometry args={[0.006, 0.006, 1, 6]} />
        <meshBasicMaterial color={colors.earth} transparent opacity={0.55} toneMapped={false} />
      </mesh>

      <SiteMarkers data={data} />
      <MoonAnchors dataRef={dataRef} radii={radii} shown={shown} earthDistance={earthDistance} earthRadius={earthRadius} />
    </group>
  );
}

// ---------- site markers ----------

function SiteMarkers({ data }: { data: SceneData }) {
  const stage = useStore(appStore, (s) => s.stage);
  const diving = useStore(appStore, (s) => s.flight === 'in');
  // During the dive to a site the markers cannot be picked: they are on their way out.
  const interactive = stage === 'mission' && !diving;
  const colors = useMemo(() => ({ base: color('--ch-marker'), saved: color('--ch-marker-saved'), active: color('--ch-marker-active') }), []);

  // The markers and the reticle are sized for the whole Moon. Near the end of the dive a marker
  // would be a quarter of the picture across, so they fade out as the dive begins (the HUD's own
  // reticle keeps the landing point marked) and come back with the Moon.
  const group = useRef<THREE.Group>(null);
  const fade = useRef({ k: diving ? 0 : 1, applied: 1 });
  useEffect(() => {
    const tween = gsap.to(fade.current, { k: diving ? 0 : 1, duration: data.reducedMotion ? 0 : 0.4, ease: 'power2.out' });
    return () => {
      tween.kill();
    };
  }, [diving, data.reducedMotion]);
  useFrame(() => {
    const f = fade.current;
    if (f.k === 1 && f.applied === 1) return;
    f.applied = f.k;
    group.current?.traverse((node) => {
      const base = node.userData.markerOpacity as number | undefined;
      if (base === undefined) return;
      ((node as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = base * f.k;
    });
  });

  return (
    <group ref={group}>
      {data.sites.map((site) => {
        const active = site.id === data.focus?.id;
        const pos = toVector(site.lat, site.lon_east, MISSION_VIEW.markerRadius);
        const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), pos.clone().normalize());
        const opacity = stage === 'orbit' && !active ? 0.55 : 1;
        return (
          <group key={site.id} position={pos} quaternion={quaternion}>
            {interactive ? (
              <mesh
                name={`site-${site.id}`}
                onClick={(e) => {
                  if (e.delta > 4) return;
                  e.stopPropagation();
                  data.onSiteClick(site);
                }}
                onPointerOver={(e) => {
                  e.stopPropagation();
                  document.body.style.cursor = 'pointer';
                }}
                onPointerOut={() => {
                  document.body.style.cursor = '';
                }}
              >
                <sphereGeometry args={[0.035, 10, 8]} />
                <meshBasicMaterial transparent opacity={0} depthWrite={false} />
              </mesh>
            ) : null}
            <mesh userData={{ markerOpacity: opacity }}>
              <circleGeometry args={[active ? 0.012 : 0.009, 20]} />
              <meshBasicMaterial color={active ? colors.active : data.savedIds.has(site.id) ? colors.saved : colors.base} toneMapped={false} transparent opacity={opacity * fade.current.k} />
            </mesh>
            {active ? <SiteReticle color={colors.active} pulsing={stage === 'mission' && !data.reducedMotion} size={stage === 'orbit' ? 0.2 : MISSION_VIEW.reticleSize} fade={fade} /> : null}
          </group>
        );
      })}
    </group>
  );
}

/** The reticle on the spotlight site: drawn flat on the surface, with one ring pulsing outward. */
function SiteReticle({ color: c, pulsing, size, fade }: { color: THREE.Color; pulsing: boolean; size: number; fade: RefObject<{ k: number }> }) {
  const material = useRef<THREE.ShaderMaterial>(null);
  const uniforms = useMemo(() => ({ uColor: { value: c }, uPulse: { value: -1 }, uOpacity: { value: 1 } }), [c]);
  const started = useMemo(() => performance.now(), []);
  useFrame(() => {
    if (!material.current) return;
    material.current.uniforms.uPulse.value = pulsing ? ((performance.now() - started) / 2400) % 1 : -1;
    // Fades with the markers as the camera dives to the site.
    material.current.uniforms.uOpacity.value = fade.current.k;
  });
  return (
    <mesh position={[0, 0, 0.002]} renderOrder={3}>
      <planeGeometry args={[size, size]} />
      <shaderMaterial ref={material} vertexShader={RETICLE_VERTEX} fragmentShader={RETICLE_FRAGMENT} uniforms={uniforms} transparent depthWrite={false} blending={THREE.AdditiveBlending} />
    </mesh>
  );
}

// ---------- anchors for the HUD ----------

/** Writes where the Sun, Earth, the scale marks and the spotlight site are on screen. */
function MoonAnchors({
  dataRef,
  radii,
  shown,
  earthDistance,
  earthRadius,
}: {
  dataRef: RefObject<SceneData>;
  radii: readonly number[];
  shown: RefObject<{ bodies: boolean; earth: boolean }>;
  earthDistance: number;
  earthRadius: number;
}) {
  const size = useThree((s) => s.size);
  const v = useMemo(() => new THREE.Vector3(), []);
  const p = useMemo(() => new THREE.Vector3(), []);
  const camSpace = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera }) => {
    if (appStore.get().stage === 'site') return;
    const d = dataRef.current;
    const g = geometryNow(d);
    camera.updateMatrixWorld();
    const cam = camera as THREE.PerspectiveCamera;
    const pxPerUnit = size.height / 2 / Math.tan((cam.fov * Math.PI) / 360);
    const place = (name: AnchorName, world: THREE.Vector3, onSurface: boolean, radius = 0) => {
      const a = anchors[name];
      p.copy(world).project(camera);
      const depth = -camSpace.copy(world).applyMatrix4(camera.matrixWorldInverse).z;
      const inFront = p.z < 1 && p.z > -1;
      const onScreen = Math.abs(p.x) <= 1.02 && Math.abs(p.y) <= 1.02;
      // A point on the surface is in view while it faces the camera; a body, while the Moon is not in the way.
      const clear = onSurface ? world.dot(camera.position) > 1.0 : !hiddenByMoon(camera.position, world);
      a.x = ((p.x + 1) / 2) * size.width;
      a.y = ((1 - p.y) / 2) * size.height;
      a.r = radius > 0 && depth > 0 ? (radius / depth) * pxPerUnit : 0;
      a.visible = inFront && onScreen && clear;
    };
    if (g && shown.current.bodies) {
      place('sun', toVector(g.subsolar_lat, g.subsolar_lon_east, radii[1], v), false, 0.085);
      place('subsolar', toVector(g.subsolar_lat, g.subsolar_lon_east, 1, v), true);
      place('subearth', toVector(g.subearth_lat, g.subearth_lon_east, 1, v), true);
    } else {
      anchors.sun.visible = anchors.subsolar.visible = anchors.subearth.visible = false;
    }
    place('moon', v.set(0, 0, 0), false, 1);
    if (g && shown.current.earth) {
      place('earth', toVector(g.subearth_lat, g.subearth_lon_east, earthDistance, v), false, earthRadius);
      // Earth is far larger than the picture's corner it stands in, and its centre is usually off
      // screen. Its tag and leader line start from the point of its limb nearest the Moon.
      const e = anchors.earth;
      const limb = anchors.earthLimb;
      const dx = anchors.moon.x - e.x;
      const dy = anchors.moon.y - e.y;
      const len = Math.hypot(dx, dy) || 1;
      limb.x = e.x + (dx / len) * e.r;
      limb.y = e.y + (dy / len) * e.r;
      limb.r = 0;
      limb.visible = e.r > 0 && limb.x >= 0 && limb.x <= size.width && limb.y >= 0 && limb.y <= size.height;
    } else {
      anchors.earth.visible = false;
      anchors.earthLimb.visible = false;
    }
    // The spotlight site's anchor carries the radius of its reticle's outer ring, so its tag sits just outside.
    if (d.focus) place('site', toVector(d.focus.lat, d.focus.lon_east, MISSION_VIEW.markerRadius, v), true, MISSION_VIEW.reticleSize * MISSION_VIEW.ringShare);
    else anchors.site.visible = false;
    place('moon', v.set(0, 0, 0), false, 1);
    // The four numbered marks of the longitude scale ring.
    const labelRadius = radii[0] + 0.15;
    place('lon0', toVector(0, 0, labelRadius, v), false);
    place('lon90', toVector(0, 90, labelRadius, v), false);
    place('lon180', toVector(0, 180, labelRadius, v), false);
    place('lon270', toVector(0, 270, labelRadius, v), false);
  });
  return null;
}
