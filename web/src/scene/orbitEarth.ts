// Earth in the Orbit stage: its surface map, how it turns, and how it is lit.
//
// WHAT IS DATA AND WHAT IS NOT.
//   * The DIRECTION of the sunlight is data: the one direction that lights the Moon (the Sun is so
//     far away that its direction is the same at Earth as at the Moon).
//   * The surface is NASA's Blue Marble map (web/public/textures/earth/, with its own README).
//   * Earth turns once for each day of previewed time. WHICH FACE of Earth points at the Moon at a
//     given instant is NOT computed, and Earth's axis is drawn upright (parallel to the Moon's);
//     its real tilt is not computed either. The caption on screen says so.
//
// The numbers of the lighting are kept here, outside the shader text, so a test can hold them: a
// night side that was drawn at a quarter of full brightness read as daylight whenever the day side
// was off screen (which it is, in the usual view, for half of every month).

import { latLonToVec3 } from '../util/geo';
import { createStore } from '../state/store';
import { DAY_MS } from '../util/time';

export const EARTH_MAPS = {
  /** Desktop: 4096 x 2048. */
  large: 'textures/earth/earth-color-4k.jpg',
  /** Phones, and any device whose largest texture is under 4096: 2048 x 1024. */
  small: 'textures/earth/earth-color-2k.jpg',
  credit: 'Earth surface: NASA Blue Marble Next Generation (November), Reto Stöckli, NASA Earth Observatory',
} as const;

/** Which surface Earth is showing: the drawn stand-in until the map has loaded (and if it cannot be). */
export const earthSurface = createStore<{ surface: 'drawn' | 'map' }>({ surface: 'drawn' });

export const EARTH_LIGHT = {
  /** Twilight: full night where the Sun is this far below a place's horizon (as a cosine), full day where it is this far above. */
  twilightFrom: -0.1,
  twilightTo: 0.14,
  /**
   * The night side's share of full light, in linear light (before the picture is encoded for the
   * screen, which lifts dark values a great deal: 0.016 shows as about an eighth of full
   * brightness on white ground, and far less on land and sea).
   */
  night: 0.016,
  /** A faint blue of air over the whole night side, so the dark disc still reads against space. */
  nightAir: 0.007,
  /** The NASA map is a dark picture (deep ocean is nearly black): it is brightened by this factor. */
  mapGain: 1.9,
  /** Blue air over the day side: scattered sunlight, most of what makes the oceans read blue from space. */
  dayAir: 0.13,
  /** The thin line of air seen edge-on just inside the limb: its strength by day and by night. */
  rimDay: 0.8,
  rimNight: 0.03,
  /** The shell of air just outside the limb: its strength by day and by night. */
  shellDay: 0.95,
  shellNight: 0.035,
} as const;

function smoothstep(lo: number, hi: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
}

/** Share of direct sunlight (0 to 1) at a place on Earth where the cosine of the Sun's angle from straight overhead is `cosSun`. */
export function earthDaylight(cosSun: number): number {
  return smoothstep(EARTH_LIGHT.twilightFrom, EARTH_LIGHT.twilightTo, cosSun);
}

/**
 * How much light a white patch of Earth's surface sends to the camera, in linear light, 0 to about
 * 1: the night floor, plus daylight that falls off gently toward the day-night line.
 * (The shader, ORBIT_EARTH_FRAGMENT below, does this same sum.)
 */
export function earthBrightness(cosSun: number): number {
  const day = earthDaylight(cosSun);
  return EARTH_LIGHT.night + day * (0.4 + 0.6 * Math.max(cosSun, 0) ** 0.6);
}

/** A linear light value as the screen shows it (the sRGB encoding the renderer applies), 0 to 1. */
export function displayLevel(linear: number): number {
  const v = Math.min(1, Math.max(0, linear));
  return v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
}

/**
 * How far Earth has turned at an instant, degrees eastward, 0 to 360: one turn for each day of
 * time. The starting angle is not computed (see the top of this file), so only the RATE is real.
 */
export function earthTurnDeg(tMs: number): number {
  const turns = tMs / DAY_MS;
  return (turns - Math.floor(turns)) * 360;
}

/**
 * Where a point of Earth is on the map: u from the left edge, v from the bottom edge, both 0 to 1.
 * The map has the prime meridian down the middle, east to the right and north up. `lat` and
 * `lonEast` are Earth's own coordinates; the shader finds them by undoing Earth's turn.
 */
export function earthMapUV(lat: number, lonEast: number): { u: number; v: number } {
  const n = latLonToVec3(lat, lonEast, 1);
  let u = Math.atan2(-n.z, n.x) / (2 * Math.PI) + 0.5;
  if (u >= 1) u -= 1;
  return { u, v: Math.asin(Math.min(1, Math.max(-1, n.y))) / Math.PI + 0.5 };
}

const f = (n: number) => (Number.isInteger(n) ? n.toFixed(1) : String(n));

const NOISE = /* glsl */ `
float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
float vnoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), f.x), mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), f.x), f.y);
  float b = mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), f.x), mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), f.x), f.y);
  return mix(a, b, f.z);
}
float fbm(vec3 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    s += a * vnoise(p);
    p = p * 2.03 + 17.1;
    a *= 0.5;
  }
  return s;
}
`;

export const ORBIT_EARTH_VERTEX = /* glsl */ `
varying vec3 vPos;
varying vec3 vWorld;
void main() {
  vPos = position;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

/** Earth's surface in the Orbit stage: the NASA map (a drawn stand-in until it loads), turning, lit from the Sun's direction. */
export const ORBIT_EARTH_FRAGMENT = /* glsl */ `
precision highp float;
varying vec3 vPos;
varying vec3 vWorld;
uniform vec3 uSunDir;   // the same vector that lights the Moon
uniform vec3 uColor;    // the blue of Earth's air
uniform sampler2D uMap; // NASA's Blue Marble map, when it has loaded
uniform float uUseMap;  // 0 while the drawn surface stands in
uniform float uTurn;    // how far Earth has turned, radians eastward
uniform float uOpacity; // 1, or less while Earth is faded out of the way of the Moon
${NOISE}
void main() {
  vec3 n = normalize(vPos);
  vec3 view = normalize(cameraPosition - vWorld);
  // Earth's own coordinates at this point: the direction with Earth's turn undone.
  float c = cos(uTurn);
  float s = sin(uTurn);
  vec3 e = vec3(c * n.x - s * n.z, n.y, s * n.x + c * n.z);

  vec3 surface;
  if (uUseMap > 0.5) {
    // The map has the prime meridian at its centre column, east to the right and north up.
    vec2 uv = vec2(atan(-e.z, e.x) / 6.2831853 + 0.5, asin(clamp(e.y, -1.0, 1.0)) / 3.14159265 + 0.5);
    // Across the 180 degree meridian the map coordinate jumps from one edge to the other; the size
    // of a pixel is taken from a second coordinate whose jump is on the other side of the globe.
    vec2 ddx = dFdx(uv);
    vec2 ddy = dFdy(uv);
    float uAlt = fract(uv.x + 0.5);
    float altX = dFdx(uAlt);
    float altY = dFdy(uAlt);
    if (abs(ddx.x) + abs(ddy.x) > abs(altX) + abs(altY)) {
      ddx.x = altX;
      ddy.x = altY;
    }
    surface = min(textureGrad(uMap, uv, ddx, ddy).rgb * ${f(EARTH_LIGHT.mapGain)}, vec3(1.0));
  } else {
    // The drawn surface (an illustration): it stands in until the map has loaded, and stays if it cannot.
    float land = smoothstep(0.52, 0.6, fbm(e * 2.4 + 3.0));
    surface = mix(uColor * 0.32, uColor * vec3(0.55, 1.0, 0.6) * 0.6, land);
  }

  // ---- light (data: the Sun's direction) ----
  float cosSun = dot(n, uSunDir);
  float day = smoothstep(${f(EARTH_LIGHT.twilightFrom)}, ${f(EARTH_LIGHT.twilightTo)}, cosSun);
  float sunlight = day * (0.4 + 0.6 * pow(max(cosSun, 0.0), 0.6));
  // Day: the surface in sunlight under blue air. Night: a small share of it, flattened so ice does
  // not glare and land still shows, under a trace of air. (The same sums as earthBrightness.)
  vec3 color = surface * sunlight + uColor * ${f(EARTH_LIGHT.dayAir)} * sunlight;
  color += pow(surface, vec3(0.6)) * ${f(EARTH_LIGHT.night)} + uColor * ${f(EARTH_LIGHT.nightAir)};
  // The air seen edge-on: a thin blue line just inside the limb, bright by day and faint by night.
  color += uColor * pow(1.0 - max(dot(n, view), 0.0), 4.0) * (${f(EARTH_LIGHT.rimNight)} + ${f(EARTH_LIGHT.rimDay)} * day);
  color = color / (1.0 + 0.35 * color);
  gl_FragColor = vec4(color, uOpacity);
  #include <colorspace_fragment>
}
`;

/**
 * Earth's atmosphere in the Orbit stage: a shell a little larger than the planet, drawn from the
 * inside and added to the picture, so only the thin ring just outside the limb shows. Bright on the
 * day side, a trace on the night side.
 */
export const ORBIT_ATMOSPHERE_FRAGMENT = /* glsl */ `
precision highp float;
varying vec3 vPos;
varying vec3 vWorld;
uniform vec3 uSunDir;
uniform vec3 uColor;
uniform float uOpacity;
void main() {
  vec3 n = normalize(vPos);
  vec3 view = normalize(cameraPosition - vWorld);
  // 0 at the shell's own outline, about 0.24 where the planet's limb begins (shell radius 1.03).
  float a = smoothstep(0.0, 0.24, abs(dot(n, view)));
  a *= a;
  float day = smoothstep(-0.22, 0.3, dot(n, uSunDir));
  gl_FragColor = vec4(uColor * (${f(EARTH_LIGHT.shellNight)} + ${f(EARTH_LIGHT.shellDay)} * day) * a * uOpacity, 1.0);
  #include <colorspace_fragment>
}
`;
