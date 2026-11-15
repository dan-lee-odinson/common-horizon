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
// The level ground is an illustration: it is what is drawn where there are no height files (a
// custom point, or a file that could not be read), and round the real ground's mesh when only the
// near file is drawn (a square hole, uHole, leaves the mesh's own ground to it). It is drawn only
// below a cut-off elevation that lies under the lowest point of the data's skyline, and it fades
// into the skyline band's colour toward that cut, so it never covers sky the data says is open and
// its far edge never shows. A shadow drops each model onto the level of its own base.

export const GROUND_VERTEX = /* glsl */ `
uniform float uProject;
uniform vec2 uShadow;   // (east, south) the shadow of a point one metre up falls from under it
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  if (uProject > 0.5) {
    // Down to the level of the model's own base (where it stands on the ground).
    float base = modelMatrix[3].y;
    w.x -= (w.y - base) * uShadow.x;
    w.z -= (w.y - base) * uShadow.y;
    w.y = base;
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
uniform float uHole;      // half the width of the square the terrain mesh covers (no level ground there), metres; 0 for none
uniform sampler2D uSurface; // the site's surface picture (siteSurface.ts), grayscale, rows flipped so v = 1 is the north edge
uniform float uSurfaceOn;     // 1 while the picture is drawn, 0 for the plain ground
uniform float uSurfaceMean;   // the picture's mean brightness, 0 to 1
uniform float uSurfaceHalf;   // half the width of the square it covers, metres
// The ground's tone from the picture: the pixel under this point over the picture's mean, kept
// between TONE_RANGE's limits (siteSurface.ts). 1 (the plain ground) with no picture.
float surfaceTone(vec2 xz) {
  if (uSurfaceOn < 0.5) return 1.0;
  vec2 uv = vec2((xz.x + uSurfaceHalf) / (2.0 * uSurfaceHalf), (uSurfaceHalf - xz.y) / (2.0 * uSurfaceHalf));
  return clamp(texture2D(uSurface, uv).r / uSurfaceMean, 0.3, 2.4);
}

// A hash with no trigonometry in it: the ground covers most of the picture, so every pixel counts.
float hash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
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
  if (max(abs(vWorld.x), abs(vWorld.z)) < uHole) discard;
  float dist = length(vWorld.xz - cameraPosition.xz);
  // How far below level this point of the ground is seen (as a tangent).
  float t = (cameraPosition.y - vWorld.y) / max(dist, 1e-3);
  if (t < uTanCut) discard;

  float r = length(vWorld.xz);
  // Metres of ground under one pixel: detail finer than that is left out, so nothing shimmers far away.
  vec2 fw = fwidth(vWorld.xz);
  float px = max(fw.x, fw.y);
  float mottle = (valueNoise(vWorld.xz / 7.0) - 0.5) * (1.0 - smoothstep(1.5, 6.0, px))
               + (valueNoise(vWorld.xz / 45.0 + 17.0) - 0.5) * (1.0 - smoothstep(10.0, 40.0, px));
  vec3 col = uGround * surfaceTone(vWorld.xz) * (uAmbient + uDirect * uLit * uSunTerm) * (1.0 + 0.16 * mottle);

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

// The real ground (siteTerrain.ts): the site's surface picture sets its tone (siteSurface.ts; the
// plain grey where there is none), with the same mottle and rings as the level ground, lit by the
// Sun's direction against each point's own slope, with the same display curve (the cosine to the
// power 0.35; on level ground that is exactly `groundSunTerm`). Shading only: the terrain casts no
// shadows. It is never cut off at the skyline: it is data, not an illustration. Where the near grid
// eases back to the level ground (aFlat toward 1) it takes the level ground's fade into the skyline
// band's colour, so the two meet with no edge; toward the far grid's outer edge it fades the same way.
export const TERRAIN_VERTEX = /* glsl */ `
attribute float aFlat;
varying vec3 vWorld;
varying vec3 vNormal;
varying float vFlat;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vNormal = normal;
  vFlat = aFlat;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

export const TERRAIN_FRAGMENT = /* glsl */ `
precision highp float;
varying vec3 vWorld;
varying vec3 vNormal;
varying float vFlat;
uniform vec3 uGround;
uniform vec3 uBand;
uniform vec3 uLine;
uniform vec3 uSunDir;     // toward the Sun (x east, y up, z south); straight down when there is no Sun
uniform float uTanCut;
uniform float uLit;
uniform float uAmbient;
uniform float uRadius;
uniform vec3 uRings;
uniform vec2 uFarFade;    // the far ground fades into the band's colour between these distances, metres
uniform sampler2D uSurface; // the site's surface picture (siteSurface.ts), grayscale, rows flipped so v = 1 is the north edge
uniform float uSurfaceOn;     // 1 while the picture is drawn, 0 for the plain ground
uniform float uSurfaceMean;   // the picture's mean brightness, 0 to 1
uniform float uSurfaceHalf;   // half the width of the square it covers, metres
// The ground's tone from the picture: the pixel under this point over the picture's mean, kept
// between TONE_RANGE's limits (siteSurface.ts). 1 (the plain ground) with no picture.
float surfaceTone(vec2 xz) {
  if (uSurfaceOn < 0.5) return 1.0;
  vec2 uv = vec2((xz.x + uSurfaceHalf) / (2.0 * uSurfaceHalf), (uSurfaceHalf - xz.y) / (2.0 * uSurfaceHalf));
  return clamp(texture2D(uSurface, uv).r / uSurfaceMean, 0.3, 2.4);
}

float hash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float ringLine(float r, float spacing, float w) {
  float d = abs(fract(r / spacing + 0.5) - 0.5) * spacing;
  return 1.0 - smoothstep(w * 0.35, w * 1.05, d);
}

void main() {
  vec3 n = normalize(vNormal);
  float sun = pow(max(dot(n, uSunDir), 0.0), 0.35);
  float r = length(vWorld.xz);
  vec2 fw = fwidth(vWorld.xz);
  float px = max(fw.x, fw.y);
  float mottle = (valueNoise(vWorld.xz / 7.0) - 0.5) * (1.0 - smoothstep(1.5, 6.0, px))
               + (valueNoise(vWorld.xz / 45.0 + 17.0) - 0.5) * (1.0 - smoothstep(10.0, 40.0, px));
  vec3 col = uGround * surfaceTone(vWorld.xz) * (uAmbient + uLit * sun) * (1.0 + 0.16 * mottle);

  // Range rings, measured flat from the landing point and painted on the ground itself.
  float w = fwidth(r);
  float near = ringLine(r, uRings.x, w) * (1.0 - smoothstep(uRings.y - 0.5 * uRings.x, uRings.y + 0.5 * uRings.x, r)) * (1.0 - smoothstep(0.1, 0.25, w / uRings.x));
  float far = ringLine(r, uRings.z, w) * (1.0 - smoothstep(10.0 * uRings.y - 0.5 * uRings.z, 10.0 * uRings.y + 0.5 * uRings.z, r)) * (1.0 - smoothstep(0.1, 0.25, w / uRings.z));
  col += uLine * max(near * 0.4, far * 0.6) * step(0.5 * uRings.x, r);

  float dist = length(vWorld.xz - cameraPosition.xz);
  float t = (cameraPosition.y - vWorld.y) / max(dist, 1e-3);
  float levelKeep = smoothstep(uTanCut, uTanCut * 2.5, t) * (1.0 - smoothstep(0.55 * uRadius, 0.95 * uRadius, r));
  float keep = mix(1.0, levelKeep, vFlat) * (1.0 - smoothstep(uFarFade.x, uFarFade.y, r));
  gl_FragColor = vec4(mix(uBand, col, keep), 1.0);
  #include <colorspace_fragment>
}
`;
