// GLSL for the site stage's ground.
//
// One material draws two things. As the ground, it shades a level plane: a flat grey lit by the
// Sun's height (a display curve, see `groundSunTerm`), a faint mottle so the plane reads as a
// surface, and range rings round the landing point. As a shadow (uProject = 1) the same shader
// first drops every vertex of a hardware model onto the ground along the sunlight, then shades it
// as ground with no direct sunlight. A shadow is therefore exactly "ground the Sun does not
// reach": the rings and the far fade carry through it, and two shadows that overlap are no darker
// than one.
//
// The ground is an illustration (the data has no terrain near the site). It is drawn only below a
// cut-off elevation that lies under the lowest point of the data's skyline, and it fades into the
// skyline band's colour toward that cut, so it never covers sky the data says is open and its far
// edge never shows.

export const GROUND_VERTEX = /* glsl */ `
uniform float uProject;
uniform vec2 uShadow;   // (east, south) the shadow of a point one metre up falls from under it
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  if (uProject > 0.5) {
    w.x -= w.y * uShadow.x;
    w.z -= w.y * uShadow.y;
    w.y = 0.0;
  }
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

export const GROUND_FRAGMENT = /* glsl */ `
precision highp float;
varying vec3 vWorld;
uniform vec3 uGround;
uniform vec3 uBand;
uniform vec3 uLine;
uniform float uTanCut;    // tan of the cut-off angle below level
uniform float uLit;       // 1 lit, 0 dark (eased)
uniform float uSunTerm;   // how brightly direct sunlight shows, from the Sun's height
uniform float uDirect;    // 1 for the ground, 0 for a shadow
uniform float uAmbient;
uniform float uRadius;    // radius of the ground disc, metres
uniform vec3 uRings;      // spacing of the near rings, how far out they go, spacing of the far rings (metres)

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
// One thin ring line (about a pixel wide), for rings every "spacing" metres.
float ringLine(float r, float spacing, float w) {
  float d = abs(fract(r / spacing + 0.5) - 0.5) * spacing;
  return 1.0 - smoothstep(w * 0.35, w * 1.05, d);
}

void main() {
  float dist = length(vWorld.xz - cameraPosition.xz);
  // How far below level this point of the ground is seen (as a tangent).
  float t = cameraPosition.y / max(dist, 1e-3);
  if (t < uTanCut) discard;

  float r = length(vWorld.xz);
  // Metres of ground under one pixel: detail finer than that is left out, so nothing shimmers far away.
  vec2 fw = fwidth(vWorld.xz);
  float px = max(fw.x, fw.y);
  float mottle = (valueNoise(vWorld.xz / 7.0) - 0.5) * (1.0 - smoothstep(1.5, 6.0, px))
               + (valueNoise(vWorld.xz / 45.0 + 17.0) - 0.5) * (1.0 - smoothstep(10.0, 40.0, px));
  vec3 col = uGround * (uAmbient + uDirect * uLit * uSunTerm) * (1.0 + 0.16 * mottle);

  // Range rings: near ones out to a set distance, far ones to ten times that. Each kind fades out
  // where its rings would crowd closer than a few pixels (toward the horizon, or from high up).
  float w = fwidth(r);
  float near = ringLine(r, uRings.x, w) * (1.0 - smoothstep(uRings.y - 0.5 * uRings.x, uRings.y + 0.5 * uRings.x, r)) * (1.0 - smoothstep(0.1, 0.25, w / uRings.x));
  float far = ringLine(r, uRings.z, w) * (1.0 - smoothstep(10.0 * uRings.y - 0.5 * uRings.z, 10.0 * uRings.y + 0.5 * uRings.z, r)) * (1.0 - smoothstep(0.1, 0.25, w / uRings.z));
  col += uLine * max(near * 0.4, far * 0.6) * step(0.5 * uRings.x, r);

  // Toward the cut-off, and toward the edge of the disc, the ground takes the skyline band's colour.
  float keep = smoothstep(uTanCut, uTanCut * 2.5, t) * (1.0 - smoothstep(0.55 * uRadius, 0.95 * uRadius, r));
  gl_FragColor = vec4(mix(uBand, col, keep), 1.0);
  #include <colorspace_fragment>
}
`;
