// GLSL for the Moon world: the Moon's surface, the ring system around it, Earth and the site
// reticle. Everything is drawn in code; no image files are used.
//
// Honest drawing: the Moon's surface pattern (craters, darker patches) is a generated illustration,
// not a map. What IS data: the direction of the sunlight, the day and night line, the rings' scales
// and the marks for the Sun's and Earth's overhead points.

const NOISE = /* glsl */ `
vec3 hash33(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}
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

export const MOON_VERTEX = /* glsl */ `
varying vec3 vPos;
varying vec3 vWorld;
void main() {
  vPos = position;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

export const MOON_FRAGMENT = /* glsl */ `
precision highp float;
varying vec3 vPos;
varying vec3 vWorld;
uniform vec3 uSunDir;
uniform vec3 uEarthDir;
uniform vec3 uAlbedo;
uniform vec3 uSunColor;
uniform vec3 uEarthColor;
uniform vec3 uLineColor;
uniform float uGrid;      // strength of the latitude / longitude lines
uniform float uMarks;     // strength of the overhead-point marks
uniform float uTerminator; // strength of the day-night line
uniform float uLit;       // 0 until the Sun's direction is known
uniform sampler2D uMap;
uniform float uUseMap;
${NOISE}

// One layer of generated craters: adds the surface slope (a tangent vector) and a shade.
// Each crater reaches at most half a cell from its centre, so only the 8 nearest cells can touch a point.
void craters(vec3 n, float scale, float strength, inout vec3 slope, inout float shade) {
  vec3 q = n * scale;
  vec3 base = floor(q - 0.5);
  for (int x = 0; x <= 1; x++) for (int y = 0; y <= 1; y++) for (int z = 0; z <= 1; z++) {
    vec3 c = base + vec3(float(x), float(y), float(z));
    vec3 centre = c + hash33(c);
    float radius = 0.12 + 0.24 * hash13(c + 7.7);
    vec3 d = q - centre;
    float t = length(d) / radius;
    if (t < 1.35) {
      // A bowl inside the rim and a raised rim around it.
      float bowl = t < 1.0 ? 2.0 * t : 0.0;
      float rim = -2.0 * (t - 1.0) / 0.03 * exp(-((t - 1.0) * (t - 1.0)) / 0.03) * 0.3;
      slope += normalize(d + 1e-5) * (bowl + rim) * strength / radius * 0.014;
      shade += (t < 1.0 ? (t * t - 1.0) * 0.05 : 0.0) * strength;
    }
  }
}

float pxLine(float d, float fw, float halfWidth) {
  return 1.0 - smoothstep(halfWidth - 0.5, halfWidth + 0.5, abs(d) / max(fw, 1e-6));
}

void main() {
  vec3 n = normalize(vPos);
  vec3 view = normalize(cameraPosition - vWorld);

  // ---- surface (illustration) ----
  vec3 slope = vec3(0.0);
  float shade = 0.0;
  float albedo;
  if (uUseMap > 0.5) {
    vec2 uv = vec2(atan(-n.z, n.x) / 6.2831853 + 0.5, asin(clamp(n.y, -1.0, 1.0)) / 3.14159265 + 0.5);
    albedo = dot(texture2D(uMap, uv).rgb, vec3(0.3333)) * 1.6;
  } else {
    craters(n, 3.6, 1.0, slope, shade);
    craters(n, 8.5, 0.8, slope, shade);
    craters(n, 21.0, 0.55, slope, shade);
    float seas = smoothstep(0.46, 0.6, fbm(n * 1.7 + 11.0));
    albedo = (0.82 + 0.36 * fbm(n * 9.0)) * mix(1.0, 0.56, seas) + shade;
  }
  vec3 bumped = normalize(n - (slope - dot(slope, n) * n) * 5.5);

  // ---- light (data: the Sun's direction) ----
  float sun = max(dot(bumped, uSunDir), 0.0);
  // The Moon's dusty surface reflects almost evenly across its lit face; soften the falloff.
  float lit = pow(sun, 0.72) * smoothstep(-0.02, 0.06, dot(n, uSunDir)) * uLit;
  float earthshine = max(dot(n, uEarthDir), 0.0) * 0.035 * uLit;
  vec3 color = uAlbedo * albedo * (uSunColor * lit * 1.05 + uEarthColor * earthshine + vec3(0.012, 0.016, 0.022));

  // ---- line work ----
  float lat = degrees(asin(clamp(n.y, -1.0, 1.0)));
  float lon = degrees(atan(-n.z, n.x));
  // Pixel footprints along north and east, continuous across the longitude seam.
  vec3 east = normalize(vec3(n.z, 0.0, -n.x) + 1e-6);
  vec3 north = cross(n, east);
  vec3 dx = dFdx(n);
  vec3 dy = dFdy(n);
  float fwN = degrees(length(vec2(dot(dx, north), dot(dy, north))));
  float fwE = degrees(length(vec2(dot(dx, east), dot(dy, east))));
  float cosLat = max(cos(radians(lat)), 0.02);
  float latLine = pxLine((fract(lat / 30.0 + 0.5) - 0.5) * 30.0, fwN, 0.6);
  float lonLine = pxLine((fract(lon / 30.0 + 0.5) - 0.5) * 30.0 * cosLat, fwE, 0.6) * smoothstep(89.0, 84.0, abs(lat));
  float equator = pxLine(lat, fwN, 0.9);
  float prime = pxLine(lon * cosLat, fwE, 0.9) * smoothstep(89.0, 84.0, abs(lat));
  float night = 1.0 - smoothstep(-0.1, 0.25, dot(n, uSunDir)) * uLit;
  float grid = (max(latLine, lonLine) * 0.34 + max(equator, prime) * 0.4) * uGrid * mix(0.45, 1.0, night);

  // The day-night line and the overhead points: great-circle distances in degrees.
  float sunAngle = degrees(acos(clamp(dot(n, uSunDir), -1.0, 1.0)));
  float earthAngle = degrees(acos(clamp(dot(n, uEarthDir), -1.0, 1.0)));
  float fwSun = fwidth(sunAngle);
  float fwEarth = fwidth(earthAngle);
  float terminator = pxLine(sunAngle - 90.0, fwSun, 0.55);
  float sunMark = max(pxLine(sunAngle - 2.2, fwSun, 0.8), pxLine(sunAngle - 5.0, fwSun, 0.6) * 0.6) + smoothstep(0.9, 0.5, sunAngle);
  float earthMark = max(pxLine(earthAngle - 2.2, fwEarth, 0.8), pxLine(earthAngle - 5.0, fwEarth, 0.6) * 0.6) + smoothstep(0.9, 0.5, earthAngle);

  color += uLineColor * grid;
  color += uSunColor * (terminator * 0.4 * uTerminator + sunMark * 0.9 * uMarks) * uLit;
  color += uEarthColor * earthMark * 0.9 * uMarks * uLit;

  // A thin cool rim, so the dark limb still reads against space.
  float rim = pow(1.0 - max(dot(n, view), 0.0), 3.2);
  color += uLineColor * rim * 0.22;

  gl_FragColor = vec4(color, 1.0);
  #include <colorspace_fragment>
}
`;

export const DISC_VERTEX = /* glsl */ `
varying vec2 vP;
void main() {
  vP = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/**
 * The ring system in the Moon's equatorial plane. Plane coordinates are Moon radii; the angle is
 * east longitude (0 at +x, 90 E at +y), matching the Moon above it. From the inside out:
 *   scale ring      a longitude scale with a tick every 5 degrees
 *   Sun ring        the Sun rides it at the longitude where the Sun is overhead (that point really
 *                   does circle the Moon once a lunar day); the brighter arc is what it has swept
 *                   since the landing, with an afterglow behind the Sun's line
 *   ring of days    one segment per day of the lunar day, lit for each day since the landing
 *   Earth bracket   NOT a ring: Earth does not circle the Moon's sky. A short arc with end caps
 *                   spanning the range Earth's overhead longitude moves through over the stay, and
 *                   a mark at where it is now. A line runs on from it toward Earth.
 */
export const DISC_FRAGMENT = /* glsl */ `
precision highp float;
varying vec2 vP;
uniform float uOpacity;
uniform float uData;        // 0 until the track has arrived
uniform float uSunLon;      // degrees east, now
uniform float uSunLon0;     // degrees east, at the landing
uniform float uEarthLon;
uniform float uEarthArcMin; // range of Earth's overhead longitude over the stay
uniform float uEarthArcMax;
uniform float uDays;        // days since the landing
uniform float uMonth;       // length of the lunar day, in days
uniform vec4 uRadii;        // scale ring, Sun ring, ring of days, Earth bracket
uniform vec3 uCyan;
uniform vec3 uSun;
uniform vec3 uEarth;

float wrap180(float a) { return mod(a + 180.0, 360.0) - 180.0; }
float line(float dist, float fw, float halfWidth) {
  return 1.0 - smoothstep(halfWidth - 0.5, halfWidth + 0.5, abs(dist) / max(fw, 1e-6));
}
float band(float x, float lo, float hi, float fw) {
  return smoothstep(lo - fw, lo + fw, x) * (1.0 - smoothstep(hi - fw, hi + fw, x));
}

void main() {
  float r = length(vP);
  if (r < 1.03 || r > uRadii.w + 0.14) discard;
  float lon = degrees(atan(vP.y, vP.x));
  vec2 er = vP / r;
  vec2 et = vec2(-er.y, er.x);
  vec2 dx = dFdx(vP);
  vec2 dy = dFdy(vP);
  float fwR = length(vec2(dot(dx, er), dot(dy, er)));   // pixel size across the rings
  float fwT = length(vec2(dot(dx, et), dot(dy, et)));   // pixel size along the rings
  float arc = radians(1.0) * r;                         // length of one degree here

  vec3 col = vec3(0.0);

  // ---- scale ring ----
  float rs = uRadii.x;
  col += uCyan * (line(r - rs, fwR, 0.7) * 0.75 + exp(-abs(r - rs) * 26.0) * 0.1);
  float d5 = abs(fract(lon / 5.0 + 0.5) - 0.5) * 5.0 * arc;
  float d10 = abs(fract(lon / 10.0 + 0.5) - 0.5) * 10.0 * arc;
  float d30 = abs(fract(lon / 30.0 + 0.5) - 0.5) * 30.0 * arc;
  col += uCyan * line(d5, fwT, 0.55) * band(r, rs, rs + 0.03, fwR) * 0.5;
  col += uCyan * line(d10, fwT, 0.6) * band(r, rs, rs + 0.055, fwR) * 0.65;
  col += uCyan * line(d30, fwT, 0.8) * band(r, rs - 0.025, rs + 0.09, fwR) * 0.95;

  // ---- Sun ring ----
  float rsun = uRadii.y;
  float swept = mod(uSunLon0 - uSunLon, 360.0);          // degrees the Sun has moved west since landing
  float fromStart = mod(uSunLon0 - lon, 360.0);
  float done = uDays >= uMonth ? 1.0 : step(fromStart, swept);
  float sunLine = line(r - rsun, fwR, 0.7);
  col += uSun * (sunLine * mix(0.3, 1.0, done * uData) + exp(-abs(r - rsun) * 24.0) * 0.09);
  float dSun = abs(wrap180(lon - uSunLon)) * arc;
  col += uSun * line(dSun, fwT, 0.8) * band(r, 1.05, rsun, fwR) * 0.85 * uData;
  // afterglow behind the Sun's line (east of it: the Sun moves west), no longer than what was swept
  float behind = mod(lon - uSunLon, 360.0);
  float glow = exp(-behind / 13.0) * step(behind, min(swept + 0.001, 70.0)) * band(r, rs, rsun, fwR);
  col += uSun * glow * 0.11 * uData;

  // ---- ring of days ----
  float rd = uRadii.z;
  float dayPos = fromStart / 360.0 * uMonth;
  float within = fract(dayPos);
  float segArc = 360.0 / uMonth * arc;
  float gap = smoothstep(0.0, 1.0, (min(within, 1.0 - within) * segArc - 0.006) / max(fwT, 1e-6));
  float seg = band(r, rd - 0.014, rd + 0.014, fwR) * gap;
  float dayLit = step(floor(dayPos) + 1.0, uDays + 0.0001) * uData;
  float today = step(floor(dayPos), uDays) * step(uDays, floor(dayPos) + 1.0) * uData;
  col += mix(uCyan * 0.28, uCyan * 0.95, dayLit) * seg;
  col += uSun * seg * today * 0.9;

  // ---- Earth bracket ----
  float rb = uRadii.w;
  float span = wrap180(uEarthArcMax - uEarthArcMin);
  float along = wrap180(lon - uEarthArcMin);             // degrees from the bracket's start
  float inArc = step(0.0, along) * step(along, span);
  float capA = abs(along) * arc;
  float capB = abs(along - span) * arc;
  float caps = max(line(capA, fwT, 0.8), line(capB, fwT, 0.8)) * band(r, rb - 0.07, rb + 0.07, fwR);
  float bracket = line(r - rb, fwR, 0.9) * inArc + caps;
  float now = line(abs(wrap180(lon - uEarthLon)) * arc, fwT, 1.0) * band(r, rb - 0.045, rb + 0.045, fwR);
  col += uEarth * (bracket * 0.95 + now * 1.2 + exp(-abs(r - rb) * 30.0) * 0.12 * inArc) * uData;
  // the line from the Moon out toward Earth, through the scale and the bracket
  float dEarth = abs(wrap180(lon - uEarthLon)) * arc;
  col += uEarth * line(dEarth, fwT, 0.6) * band(r, 1.05, rb, fwR) * 0.4 * uData;

  gl_FragColor = vec4(col * uOpacity, 1.0);
  #include <colorspace_fragment>
}
`;

export const EARTH_VERTEX = MOON_VERTEX;

export const EARTH_FRAGMENT = /* glsl */ `
precision highp float;
varying vec3 vPos;
varying vec3 vWorld;
uniform vec3 uSunDir;
uniform vec3 uColor;
${NOISE}
void main() {
  vec3 n = normalize(vPos);
  vec3 view = normalize(cameraPosition - vWorld);
  float land = smoothstep(0.52, 0.6, fbm(n * 2.4 + 3.0));
  float cloud = smoothstep(0.5, 0.72, fbm(n * 4.0 + vec3(0.0, 9.0, 0.0)));
  vec3 surface = mix(uColor * 0.75, uColor * vec3(0.55, 1.0, 0.6) * 0.8, land);
  surface = mix(surface, vec3(0.95), cloud * 0.75);
  float lit = smoothstep(-0.08, 0.22, dot(n, uSunDir));
  vec3 color = surface * (0.06 + lit * 1.05);
  // The air seen edge-on: a thin blue rim just inside the limb, brighter on the day side.
  color += uColor * pow(1.0 - max(dot(n, view), 0.0), 4.0) * (0.25 + 0.75 * lit);
  gl_FragColor = vec4(color, 1.0);
  #include <colorspace_fragment>
}
`;

/**
 * Earth's atmosphere: a shell a little larger than the planet, drawn from the inside and added to
 * the picture, so only the thin ring just outside the limb shows. It is brightest at the limb and
 * fades to nothing at the shell's own edge, and it is dimmer on the night side.
 */
export const ATMOSPHERE_FRAGMENT = /* glsl */ `
precision highp float;
varying vec3 vPos;
varying vec3 vWorld;
uniform vec3 uSunDir;
uniform vec3 uColor;
void main() {
  vec3 n = normalize(vPos);
  vec3 view = normalize(cameraPosition - vWorld);
  // 0 at the shell's own outline, about 0.24 where the planet's limb begins (shell radius 1.03).
  float a = smoothstep(0.0, 0.24, abs(dot(n, view)));
  a *= a;
  float day = smoothstep(-0.35, 0.5, dot(n, uSunDir));
  gl_FragColor = vec4(uColor * (0.22 + 0.9 * day) * a, 1.0);
  #include <colorspace_fragment>
}
`;

export const RETICLE_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv * 2.0 - 1.0;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/** The reticle on the selected site: nested rings, four ticks and one ring that pulses outward. */
export const RETICLE_FRAGMENT = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform vec3 uColor;
uniform float uPulse;   // 0..1, phase of the outgoing ring; negative = no pulse
uniform float uOpacity;
float ring(float r, float radius, float fw, float halfWidth) {
  return 1.0 - smoothstep(halfWidth - 0.5, halfWidth + 0.5, abs(r - radius) / max(fw, 1e-6));
}
void main() {
  float r = length(vUv);
  float fw = fwidth(r);
  float a = 0.0;
  a += ring(r, 0.2, fw, 0.9);
  a += ring(r, 0.34, fw, 0.6) * 0.7;
  a += smoothstep(0.035 + fw, 0.035 - fw, r);
  // four ticks on the axes, between the rings and beyond the outer one
  float axis = min(abs(vUv.x), abs(vUv.y));
  float tick = (1.0 - smoothstep(0.4, 1.4, axis / max(fw, 1e-6))) * (step(0.24, r) * step(r, 0.3) + step(0.38, r) * step(r, 0.5));
  a += tick * 0.9;
  if (uPulse >= 0.0) {
    float pr = mix(0.2, 0.95, uPulse);
    a += ring(r, pr, fw, 1.0) * (1.0 - uPulse) * (1.0 - uPulse);
  }
  a += exp(-r * 5.0) * 0.16;
  gl_FragColor = vec4(uColor * a * uOpacity, 1.0);
  #include <colorspace_fragment>
}
`;
