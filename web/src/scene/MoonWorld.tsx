// The Moon world: stages 1 (orbit) and 2 (mission select).
//   The Moon, showing NASA's CGI Moon Kit maps (a drawn surface until they load), lit from the
//   direction the data gives for the Sun, with the day-night line and the two overhead points
//   marked on its surface.
//   The ring system in the Moon's equatorial plane: a longitude scale, the Sun ring, a ring of days
//   and a short bracket for the range Earth's overhead point moves through over the stay.
//   The Sun ring carries a tick at the longitude where the Sun is overhead; the Sun itself is not
//   drawn on the ring. Its light is shown by the lit sides of the Moon and Earth and by faint lines
//   of light across the scene (the HUD draws those from what this file works out each frame).
//   Earth is drawn at its true size beside the Moon, behind it and out along its true direction,
//   joined to its bracket by a line; its distance is not to scale. It shows NASA's Blue Marble map,
//   turns once a day of previewed time and is lit from the same direction as the Moon. Earth is
//   never drawn between the camera and the Moon: when the visitor turns the view to Earth's side
//   it fades out.
//   The far sky (FarSky, below) rides with the camera: the stars, and the Sun's own disc at its
//   true direction and true apparent size. Being infinitely far away, they keep their places
//   against each other however the camera turns or zooms.
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
import { glowTexture } from './glow';
import { hiddenByMoon } from './occlusion';
import { MISSION_VIEW } from './missionView';
import { EARTH_MAPS, earthSurface, earthTurnDeg, ORBIT_ATMOSPHERE_FRAGMENT, ORBIT_EARTH_FRAGMENT, ORBIT_EARTH_VERTEX } from './orbitEarth';
import { earthFade, orbitSun, SUN_DRAW_DISTANCE, sunBallRadius, sunHiddenBy, sunRadiusPx } from './orbitTurn';
import { ORBIT_VIEW, ringRadii, SUN_TICK } from './orbitView';
import { geometryNow, sceneTimeMs, toVector, type SceneData } from './sceneData';
import { DISC_FRAGMENT, DISC_VERTEX, MOON_FRAGMENT, MOON_VERTEX, RETICLE_FRAGMENT, RETICLE_VERTEX } from './shaders';
import { lineReach, sunlightSheet, sunlightStrength, sunlightView, SUNLIGHT, type Circle, type ScreenLine } from './sunlight';
import { Stars } from './Stars';
import { MOON_MAPS, MOON_RELIEF_STRENGTH } from './textures';

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
  const atmosphere = useRef<THREE.ShaderMaterial>(null);
  const earthGroup = useRef<THREE.Group>(null);
  const earthLine = useRef<THREE.Mesh>(null);
  /** Shared with the anchors: are the bodies drawn, and is Earth being kept off the Moon's face? */
  const shown = useRef({ bodies: false, earth: false, opacity: 0 });
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

  // The Sun's direction: ONE vector, shared by the Moon, Earth and Earth's air, so the three cannot
  // be lit from different sides. It is rewritten each frame from the data.
  const sunDir = useMemo(() => new THREE.Vector3(0.6, 0.2, 0.77).normalize(), []);
  const moonUniforms = useMemo(
    () => ({
      uSunDir: { value: sunDir },
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
    [colors, blank, sunDir],
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
      uSunTick: { value: new THREE.Vector2(SUN_TICK.inner, SUN_TICK.outer) },
      uCyan: { value: colors.cyan },
      uSun: { value: colors.sun },
      uEarth: { value: colors.earth },
    }),
    [colors, radii],
  );
  const earthUniforms = useMemo(
    () => ({ uSunDir: { value: sunDir }, uColor: { value: colors.earth }, uMap: { value: blank as THREE.Texture }, uUseMap: { value: 0 }, uTurn: { value: 0 }, uOpacity: { value: 1 } }),
    [colors, blank, sunDir],
  );
  const atmosphereUniforms = useMemo(() => ({ uSunDir: { value: sunDir }, uColor: { value: colors.earth.clone().lerp(new THREE.Color('#ffffff'), 0.35) }, uOpacity: { value: 1 } }), [colors, sunDir]);

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

  // Earth's real surface (see orbitEarth.ts): NASA's Blue Marble map, the larger copy on desktop and
  // the smaller on phones, loaded the same way. The drawn stand-in shows until it is ready.
  useEffect(() => {
    const path = data.isPhone || gl.capabilities.maxTextureSize < 4096 ? EARTH_MAPS.small : EARTH_MAPS.large;
    let alive = true;
    let map: THREE.Texture | null = null;
    new THREE.TextureLoader().load(
      `${import.meta.env.BASE_URL}${path}`,
      (t) => {
        const m = earth.current;
        if (!alive || !m) {
          t.dispose();
          return;
        }
        map = t;
        t.colorSpace = THREE.SRGBColorSpace;
        t.wrapS = THREE.RepeatWrapping;
        t.anisotropy = Math.min(4, gl.capabilities.getMaxAnisotropy());
        t.needsUpdate = true;
        m.uniforms.uMap.value = t;
        m.uniforms.uUseMap.value = 1;
        earthSurface.set({ surface: 'map' });
      },
      undefined,
      () => {
        // The drawn surface stays, and the caption keeps saying so.
      },
    );
    return () => {
      alive = false;
      const m = earth.current;
      if (m) {
        m.uniforms.uUseMap.value = 0;
        m.uniforms.uMap.value = blank;
      }
      earthSurface.set({ surface: 'drawn' });
      map?.dispose();
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
    shown.current.opacity = show;
    if (!g) {
      shown.current.earth = false;
      if (earthGroup.current) earthGroup.current.visible = false;
      if (earthLine.current) earthLine.current.visible = false;
      return;
    }
    // The one light direction (see `sunDir` above): the Moon, Earth and Earth's air all read this vector.
    toVector(g.subsolar_lat, g.subsolar_lon_east, 1, sunDir);
    toVector(g.subearth_lat, g.subearth_lon_east, 1, earthDir);
    if (m) m.uniforms.uEarthDir.value.copy(earthDir);
    // Earth turns once for each day of the time shown.
    if (earth.current && t !== null) earth.current.uniforms.uTurn.value = (earthTurnDeg(t) * Math.PI) / 180;
    if (k) {
      const landingG = d.landingMs !== null && d.track && d.landingMs >= d.track.startMs && d.landingMs <= d.track.endMs ? d.track.at(d.landingMs) : (d.landingGeometry ?? g);
      k.uniforms.uSunLon.value = g.subsolar_lon_east;
      k.uniforms.uSunLon0.value = landingG.subsolar_lon_east;
      k.uniforms.uEarthLon.value = g.subearth_lon_east;
      k.uniforms.uEarthArcMin.value = swing ? swing.lonMin : g.subearth_lon_east;
      k.uniforms.uEarthArcMax.value = swing ? swing.lonMax : g.subearth_lon_east;
      k.uniforms.uDays.value = t !== null && d.landingMs !== null ? Math.max(0, (t - d.landingMs) / DAY_MS) : 0;
    }

    // Earth: out along its true direction. It can never cover the Moon's face or a site marker: in
    // the standard view it stands behind the Moon, and when the visitor turns the view so that it
    // would come between the camera and the Moon, it fades out (see earthFade).
    const earthPos = earthGroup.current?.position.copy(earthDir).multiplyScalar(earthDistance);
    const fadeE = earthPos ? earthFade(camera.position, earthPos, earthRadius) : 0;
    const earthShown = bodies && fadeE > 0.01;
    // Its tag, its leader line and the lines of sunlight treat it as there only while it is mostly drawn.
    shown.current.earth = bodies && fadeE > 0.5;
    if (earthGroup.current) {
      earthGroup.current.visible = earthShown;
      earthGroup.current.scale.setScalar(Math.max(0.001, show));
    }
    if (earth.current) {
      const e = earth.current;
      e.uniforms.uOpacity.value = fadeE;
      // Solid while fully drawn (it then hides what is behind it, the Sun included); see-through while fading.
      const solid = fadeE > 0.999;
      if (e.transparent === solid) {
        e.transparent = !solid;
        e.needsUpdate = true;
      }
      e.depthWrite = fadeE > 0.5;
    }
    if (atmosphere.current) atmosphere.current.uniforms.uOpacity.value = fadeE;
    if (earthLine.current) {
      // The line from the bracket on toward Earth.
      const from = radii[3];
      const to = earthDistance - earthRadius * 1.15;
      (earthLine.current.material as THREE.MeshBasicMaterial).opacity = 0.55 * fadeE;
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

      <group ref={earthGroup} visible={false}>
        <mesh name="earth-body">
          <sphereGeometry args={[earthRadius, 128, 80]} />
          <shaderMaterial ref={earth} vertexShader={ORBIT_EARTH_VERTEX} fragmentShader={ORBIT_EARTH_FRAGMENT} uniforms={earthUniforms} />
        </mesh>
        {/* The thin glow of the atmosphere just outside the limb. */}
        <mesh name="earth-atmosphere" renderOrder={-1}>
          <sphereGeometry args={[earthRadius * 1.03, 128, 80]} />
          <shaderMaterial
            ref={atmosphere}
            vertexShader={ORBIT_EARTH_VERTEX}
            fragmentShader={ORBIT_ATMOSPHERE_FRAGMENT}
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
  shown: RefObject<{ bodies: boolean; earth: boolean; opacity: number }>;
  earthDistance: number;
  earthRadius: number;
}) {
  const size = useThree((s) => s.size);
  const v = useMemo(() => new THREE.Vector3(), []);
  const p = useMemo(() => new THREE.Vector3(), []);
  const camSpace = useMemo(() => new THREE.Vector3(), []);
  const sunV = useMemo(() => new THREE.Vector3(), []);
  const forward = useMemo(() => new THREE.Vector3(), []);
  const { pool, sunPoint, oppositePoint, a2, b2, moonOutline, earthOutline } = useMemo(
    () => ({
      pool: [] as (ScreenLine & { k: number })[],
      sunPoint: { x: 0, y: 0 },
      oppositePoint: { x: 0, y: 0 },
      a2: { x: 0, y: 0 },
      b2: { x: 0, y: 0 },
      moonOutline: { x: 0, y: 0, r: 0, long: { ux: 1, uy: 0, r: 0 }, shadow: true },
      // Earth hides the lines that cross its face but casts no shadow on them (see sunlight.ts).
      earthOutline: { x: 0, y: 0, r: 0, long: { ux: 1, uy: 0, r: 0 }, shadow: false },
    }),
    [],
  );
  // Leaving the Moon's stages, the light goes with them.
  useEffect(
    () => () => {
      sunlightView.shown = false;
      sunlightView.lines.length = 0;
    },
    [],
  );
  useFrame(({ camera }) => {
    if (appStore.get().stage === 'site') {
      sunlightView.shown = false;
      return;
    }
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
    if (!g || !shown.current.bodies) anchors.sunDisc.visible = false;
    if (g && shown.current.bodies) {
      // The Sun's tag stands at its tick on the Sun ring (in the ring's plane), not at a body.
      place('sun', toVector(0, g.subsolar_lon_east, radii[1], v), false);
      anchors.sun.r = 5;
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
      // With the view turned, Earth can stand behind a glass panel: its tag is then left out rather than laid over the panel.
      limb.visible = e.r > 0 && limb.x >= 0 && limb.x <= size.width && limb.y >= 0 && limb.y <= size.height && !nearPanel(limb.x, limb.y, 150, 44);
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

    // ---- the Sun's light, for the HUD's lines and edge glow (sunlight.ts) ----
    const light = sunlightView;
    const inOrbit = appStore.get().stage === 'orbit';
    if (!g || !shown.current.bodies || !inOrbit) {
      light.shown = false;
      light.lines.length = 0;
      anchors.sunDisc.visible = false;
      return;
    }
    const toPx = (ndc: THREE.Vector3, out: { x: number; y: number }) => {
      out.x = ((ndc.x + 1) / 2) * size.width;
      out.y = ((1 - ndc.y) / 2) * size.height;
      return out;
    };
    const sun = toVector(g.subsolar_lat, g.subsolar_lon_east, 1, sunV);
    cam.getWorldDirection(forward);
    const ahead = sun.dot(forward);
    light.shown = true;
    light.opacity = shown.current.opacity;
    light.gapPx = SUNLIGHT.spacing * anchors.moon.r;
    // Where the Sun's direction meets the picture (a point infinitely far along it), and the point straight opposite.
    light.sun = ahead > 1e-3 ? toPx(p.copy(cam.position).addScaledVector(sun, 1e5).project(cam), sunPoint) : null;
    const opposite = ahead < -1e-3 ? toPx(p.copy(cam.position).addScaledVector(sun, -1e5).project(cam), oppositePoint) : null;
    const sheet = sunlightSheet(sun, cam.position);
    light.strength = sunlightStrength(sheet.across);
    let n = 0;
    if (light.strength > 0) {
      for (const row of sheet.lines) {
        p.set(row.point.x, row.point.y, row.point.z).project(cam);
        if (p.z <= -1 || p.z >= 1) continue;
        toPx(p, a2);
        toPx(p.set(row.point.x, row.point.y, row.point.z).addScaledVector(sun, 0.5).project(cam), b2);
        const len = Math.hypot(b2.x - a2.x, b2.y - a2.y);
        if (len < 1e-4) continue;
        const line = (pool[n] ??= { k: 0, x: 0, y: 0, ux: 0, uy: 0, from: 0, to: 0 });
        line.k = row.k;
        line.x = a2.x;
        line.y = a2.y;
        line.ux = (b2.x - a2.x) / len;
        line.uy = (b2.y - a2.y) / len;
        const reach = lineReach(a2, light.sun, opposite);
        line.to = reach.to;
        line.from = reach.from;
        light.lines[n++] = line;
      }
    }
    light.lines.length = n;
    // The heading of the Sun's direction at the Moon's centre: the glow sits where it leaves the frame.
    light.origin.x = anchors.moon.x;
    light.origin.y = anchors.moon.y;
    toPx(p.copy(sun).multiplyScalar(0.5).project(cam), b2);
    const hl = Math.hypot(b2.x - anchors.moon.x, b2.y - anchors.moon.y);
    if (hl > 1e-4) {
      light.heading.ux = (b2.x - anchors.moon.x) / hl;
      light.heading.uy = (b2.y - anchors.moon.y) / hl;
    } else {
      // The Sun's direction runs straight along the line of sight: its point on screen is the heading's only clue.
      light.heading.ux = 0;
      light.heading.uy = -1;
    }
    // The Sun's own disc: where its direction meets the picture, at its true apparent size. Its tag
    // says what hides it, and stands aside from the glass panels.
    const disc = anchors.sunDisc;
    light.sunRadius = sunRadiusPx(size.height);
    const hiddenBy = sunHiddenBy(cam.position, sun, shown.current.earth ? toVector(g.subearth_lat, g.subearth_lon_east, earthDistance, v) : null, earthRadius);
    light.sunHiddenBy = hiddenBy;
    orbitSun.set({ hiddenBy });
    if (light.sun) {
      disc.x = light.sun.x;
      disc.y = light.sun.y;
      disc.r = light.sunRadius;
      const onScreen = disc.x >= 0 && disc.x <= size.width && disc.y >= 0 && disc.y <= size.height;
      // Under or beside a panel the tag would cover it: the disc is still drawn, the tag is not.
      disc.visible = onScreen && !nearPanel(disc.x, disc.y, 200, 48) && shown.current.opacity > 0.5;
    } else disc.visible = false;

    // The Moon and Earth as outlines on screen: a line of light stops at the Moon, and is not drawn across Earth.
    toPx(p.copy(cam.position).add(forward).project(cam), a2);
    light.bodies.length = 0;
    light.bodies.push(outline(cam, forward, a2, pxPerUnit, size, v.set(0, 0, 0), 1, moonOutline));
    if (shown.current.earth) light.bodies.push(outline(cam, forward, a2, pxPerUnit, size, toVector(g.subearth_lat, g.subearth_lon_east, earthDistance, v), earthRadius, earthOutline));
  });
  return null;
}

const scratch = new THREE.Vector3();

/** Is a point of the picture under a glass panel or the controls, or within reach of one (so a tag there would touch it)? */
function nearPanel(x: number, y: number, reachX: number, reachY: number): boolean {
  return sunlightView.keepClear.some((b) => x > b.left - reachX && x < b.right + reachX && y > b.top - reachY && y < b.bottom + reachY);
}

/**
 * A ball's outline on screen. Away from the middle of a perspective picture a ball is drawn as an
 * ellipse, longer along the line from the picture's centre; this gives that ellipse exactly (the
 * simple "radius over depth" circle is up to a twentieth too small for Earth in the corner).
 */
function outline(cam: THREE.PerspectiveCamera, forward: THREE.Vector3, centrePx: { x: number; y: number }, pxPerUnit: number, size: { width: number; height: number }, world: THREE.Vector3, radius: number, out: Circle & { long: { ux: number; uy: number; r: number } }) {
  const rel = scratch.copy(world).sub(cam.position);
  const dist = rel.length();
  const depth = rel.dot(forward);
  const off = Math.acos(Math.min(1, Math.max(-1, depth / dist))); // angle from the line of sight
  const half = Math.asin(Math.min(1, radius / dist)); // half the ball's apparent width
  const lim = (88 * Math.PI) / 180;
  const inner = pxPerUnit * Math.tan(Math.max(-lim, off - half));
  const outer = pxPerUnit * Math.tan(Math.min(lim, off + half));
  // The ball's centre on screen gives the direction of the long axis.
  const c = scratch.copy(world).project(cam);
  let ux = ((c.x + 1) / 2) * size.width - centrePx.x;
  let uy = ((1 - c.y) / 2) * size.height - centrePx.y;
  const len = Math.hypot(ux, uy);
  if (len > 1e-6) {
    ux /= len;
    uy /= len;
  } else {
    ux = 1;
    uy = 0;
  }
  const mid = (inner + outer) / 2;
  const cos2 = Math.cos(off) ** 2 - Math.sin(half) ** 2;
  out.x = centrePx.x + ux * mid;
  out.y = centrePx.y + uy * mid;
  out.long.ux = ux;
  out.long.uy = uy;
  out.long.r = (outer - inner) / 2;
  out.r = cos2 > 1e-6 ? Math.min(out.long.r, (pxPerUnit * Math.sin(half)) / Math.sqrt(cos2)) : out.long.r;
  return out;
}

// ---------- the far sky ----------

/** The Sun's glow is this many disc widths across, in two layers: a bright one close in and a faint wide one. */
const SUN_GLOW = { near: 9, nearOpacity: 0.55, far: 34, farOpacity: 0.16 } as const;

/**
 * What is infinitely far away: the stars, and (in Orbit) the Sun's own disc with its glow.
 * The whole group rides with the camera, so nothing in it shifts when the camera moves: only when
 * it turns. The Sun stands along its true direction from the camera, as a ball exactly as wide as
 * the Sun looks (0.53 degrees), so its size on screen is true at any zoom. It is drawn behind
 * everything else: the Moon and Earth hide it, and its glow, whenever they are in front of it.
 */
export function FarSky({ data, visible }: { data: SceneData; visible: boolean }) {
  const stage = useStore(appStore, (s) => s.stage);
  const group = useRef<THREE.Group>(null);
  const sun = useRef<THREE.Group>(null);
  const discMaterial = useRef<THREE.MeshBasicMaterial>(null);
  const nearGlow = useRef<THREE.SpriteMaterial>(null);
  const farGlow = useRef<THREE.SpriteMaterial>(null);
  const dataRef = useRef(data);
  dataRef.current = data;
  const colors = useMemo(() => {
    const amber = color('--ch-sun');
    // The disc is the Sun's amber burnt toward white, so its edge stays crisp inside the glow.
    return { disc: amber.clone().lerp(new THREE.Color(1, 1, 1), 0.6), glow: amber };
  }, []);
  const glow = useMemo(() => glowTexture(), []);
  const radius = sunBallRadius();
  // The Sun belongs to the Orbit stage: it fades out with the rings on the way to mission select.
  const fade = useRef({ k: stage === 'orbit' ? 1 : 0 });
  useEffect(() => {
    const tween = gsap.to(fade.current, { k: stage === 'orbit' ? 1 : 0, duration: data.reducedMotion ? 0 : 0.6, ease: 'power2.out' });
    return () => {
      tween.kill();
    };
  }, [stage, data.reducedMotion]);
  useFrame(({ camera }) => {
    group.current?.position.copy(camera.position);
    const s = sun.current;
    if (!s) return;
    const g = geometryNow(dataRef.current);
    const k = fade.current.k;
    s.visible = Boolean(g) && k > 0.01;
    if (!g) return;
    toVector(g.subsolar_lat, g.subsolar_lon_east, SUN_DRAW_DISTANCE, s.position);
    if (discMaterial.current) discMaterial.current.opacity = k;
    if (nearGlow.current) nearGlow.current.opacity = SUN_GLOW.nearOpacity * k;
    if (farGlow.current) farGlow.current.opacity = SUN_GLOW.farOpacity * k;
  });
  return (
    <group ref={group} visible={visible}>
      <Stars />
      <group ref={sun} visible={false}>
        <mesh name="sun-disc" renderOrder={-3} frustumCulled={false}>
          <sphereGeometry args={[radius, 32, 20]} />
          <meshBasicMaterial ref={discMaterial} color={colors.disc} transparent depthWrite={false} toneMapped={false} />
        </mesh>
        {/* The glow is light round the disc, not the disc: the caption says so. */}
        <sprite scale={[radius * 2 * SUN_GLOW.near, radius * 2 * SUN_GLOW.near, 1]} renderOrder={-4}>
          <spriteMaterial ref={nearGlow} map={glow} color={colors.glow} transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
        </sprite>
        <sprite scale={[radius * 2 * SUN_GLOW.far, radius * 2 * SUN_GLOW.far, 1]} renderOrder={-5}>
          <spriteMaterial ref={farGlow} map={glow} color={colors.glow} transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
        </sprite>
      </group>
    </group>
  );
}
