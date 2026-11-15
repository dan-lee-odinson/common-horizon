// The Sun's light in the Orbit picture, as plain arithmetic: faint parallel lines of light that
// cross the scene along the Sun's direction, and a soft glow where that direction leaves the frame.
//
// The lines are parallel IN SPACE (the Sun is so far away that its rays are), so on screen they are
// drawn in perspective like everything else: they all head for the one point where the Sun's
// direction meets the picture, which is where the Sun's own disc is drawn (see sunPoint below).
// With the Sun far to one side of the view they run very nearly parallel on screen.
//
// A line that reaches the Moon stops at its lit edge and is not drawn beyond it: the empty strip
// behind the Moon is its shadow. A line is never drawn across Earth's face, but Earth casts NO
// shadow on the lines: it is drawn far nearer than it is, and its real shadow reaches the Moon only
// during an eclipse (around full moon the drawn Earth stands between the Moon and the Sun's point
// on screen, and the lines then come out from behind it). Lines and glow keep clear of the glass
// panels and of the controls.
//
// Kept free of 3D-library and page code so the layout can be checked by tests; the HUD draws
// exactly what these functions return (src/stages/SunlightField.tsx).

import type { Vec3 } from './orbitView';

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * A body's outline on screen. A ball seen away from the middle of a perspective picture is drawn as
 * an ellipse, longer along the line from the picture's centre: `long` gives that direction (a unit
 * vector) and the half-length along it, and `r` is then the half-width across it. Without `long`
 * the outline is a circle of radius `r`.
 */
export interface Circle {
  x: number;
  y: number;
  r: number;
  long?: { ux: number; uy: number; r: number };
  /**
   * Does the body cast a shadow on the lines of light? True (the default) for the Moon: a line that
   * meets it is not drawn beyond it. False for Earth: a line is only left out where it would cross
   * Earth's face (see the top of this file).
   */
  shadow?: boolean;
}

export interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export const SUNLIGHT = {
  /** Moon radii between neighbouring lines of light. */
  spacing: 0.3,
  /** Lines each side of the one through the Moon's centre: enough to cross the whole-Earth view. */
  count: 52,
  /** Pixels kept between a line (or the glow) and a glass panel. */
  margin: 10,
  /** Pixels kept between a line and the edge of the Moon or Earth where it arrives. */
  bodyGap: 5,
  /** A piece of a line shorter than this many pixels is not drawn (short stubs between panels read as dashes, not light). */
  minLength: 80,
  /** Radius of the glow at the frame's edge, in pixels (and on phones). */
  glowRadius: 190,
  glowRadiusPhone: 120,
  /** Neighbouring lines closer on screen than this many pixels are thinned out (every second, then every fourth, line stays). */
  minGapPx: 34,
  /**
   * With the view turned, the lines can be seen in steep perspective: they all meet at the Sun's
   * point on screen (or, with the Sun behind the camera, at the point straight opposite it). A line
   * is drawn only if the point where it passes nearest the Moon is in the frame (grown by this
   * share of its size), and it stops this many pixels short of the meeting point, so the lines
   * never pile up there.
   */
  rowSlack: 0.15,
  apexGap: 150,
  /** The lines fade out as the Sun's direction comes within this sine of the line of sight (they would be seen end-on). */
  endOnFrom: 0.16,
  endOnTo: 0.4,
} as const;

function unit(v: Vec3): Vec3 {
  const len = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

/**
 * The sheet of light: evenly spaced lines, all along the Sun's direction, lying in the plane
 * through the Moon's centre that holds that direction and faces the camera. Returns one point of
 * each line (the point nearest the Moon's centre), with its place in the row: 0 is the line through
 * the centre. `across` is the sine of the angle between the Sun's direction and the line of sight:
 * near 0 the lines are seen end-on and are not drawn.
 */
export function sunlightSheet(sun: Vec3, toCamera: Vec3, spacing: number = SUNLIGHT.spacing, count: number = SUNLIGHT.count): { across: number; lines: { k: number; point: Vec3 }[] } {
  const s = unit(sun);
  const raw = cross(s, unit(toCamera));
  const across = Math.hypot(raw.x, raw.y, raw.z);
  if (across < 1e-6) return { across: 0, lines: [] };
  const a = { x: raw.x / across, y: raw.y / across, z: raw.z / across };
  const lines: { k: number; point: Vec3 }[] = [];
  for (let k = -count; k <= count; k++) lines.push({ k, point: { x: a.x * k * spacing, y: a.y * k * spacing, z: a.z * k * spacing } });
  return { across, lines };
}

/** How strongly the lines are drawn for a given `across` (see sunlightSheet): 0 seen end-on, 1 seen from the side. */
export function sunlightStrength(across: number): number {
  const t = Math.min(1, Math.max(0, (across - SUNLIGHT.endOnFrom) / (SUNLIGHT.endOnTo - SUNLIGHT.endOnFrom)));
  return t * t * (3 - 2 * t);
}

/**
 * How strongly line `k` of the row is drawn when neighbouring lines are `gapPx` pixels apart on
 * screen: zoomed out, every second and then every fourth line stays, so the lines never crowd.
 * (Lines are thinned, never moved: a line that stays keeps its place.)
 */
export function lineLevel(k: number, gapPx: number): number {
  const step = Math.abs(k) % 4 === 0 ? 4 : Math.abs(k) % 2 === 0 ? 2 : 1;
  if (step === 4) return 1;
  const t = Math.min(1, Math.max(0, (gapPx * step - SUNLIGHT.minGapPx) / 14));
  return t * t * (3 - 2 * t);
}

/**
 * One line of light on screen. It passes through (x, y) heading (ux, uy), a unit vector toward the
 * Sun. `from` and `to` limit it along that heading, in pixels from the point: a line seen in
 * perspective ends at the Sun's point on screen (`to`), or, with the Sun behind the camera, starts
 * at the point straight opposite the Sun (`from`). Unlimited ends are -Infinity and Infinity.
 */
export interface ScreenLine {
  x: number;
  y: number;
  ux: number;
  uy: number;
  from: number;
  to: number;
}

/** Is a line's own point (where it passes nearest the Moon) inside the frame, grown a little? Lines that are not are left out. */
export function rowInFrame(line: { x: number; y: number }, frame: Box, slack: number = SUNLIGHT.rowSlack): boolean {
  const mx = (frame.right - frame.left) * slack;
  const my = (frame.bottom - frame.top) * slack;
  return line.x > frame.left - mx && line.x < frame.right + mx && line.y > frame.top - my && line.y < frame.bottom + my;
}

/**
 * How far a line runs along its heading, given the Sun's point on screen and the point straight
 * opposite it (each null when it is behind the camera): it ends short of the Sun's point, or starts
 * short of the opposite point.
 */
export function lineReach(at: { x: number; y: number }, sun: { x: number; y: number } | null, opposite: { x: number; y: number } | null, gap: number = SUNLIGHT.apexGap): { from: number; to: number } {
  return {
    to: sun ? Math.hypot(sun.x - at.x, sun.y - at.y) - gap : Infinity,
    from: opposite ? -(Math.hypot(opposite.x - at.x, opposite.y - at.y) - gap) : -Infinity,
  };
}

/** The stretch of a line (as distances along its heading) that lies inside a box, or null. */
function insideBox(line: ScreenLine, box: Box): [number, number] | null {
  let lo = -Infinity;
  let hi = Infinity;
  for (const [p, u, min, max] of [
    [line.x, line.ux, box.left, box.right],
    [line.y, line.uy, box.top, box.bottom],
  ] as const) {
    if (Math.abs(u) < 1e-12) {
      if (p <= min || p >= max) return null;
      continue;
    }
    const a = (min - p) / u;
    const b = (max - p) / u;
    lo = Math.max(lo, Math.min(a, b));
    hi = Math.min(hi, Math.max(a, b));
  }
  return hi > lo ? [lo, hi] : null;
}

function grow(box: Box, by: number): Box {
  return { left: box.left - by, top: box.top - by, right: box.right + by, bottom: box.bottom + by };
}

/**
 * The pieces of one line of light that are drawn:
 *   * inside the frame;
 *   * only on the Sun's side of the Moon, if it meets the Moon: it stops a little short of the Moon's
 *     lit edge and is not drawn across the Moon or beyond it, in the Moon's shadow;
 *   * not across Earth's face (it stops a little short of Earth's edge and carries on beyond it);
 *   * outside every keep-clear box (the glass panels and the controls), by `margin` pixels.
 */
export function clipLine(line: ScreenLine, frame: Box, bodies: readonly Circle[], keepClear: readonly Box[], margin: number = SUNLIGHT.margin, minLength: number = SUNLIGHT.minLength, bodyGap: number = SUNLIGHT.bodyGap): Segment[] {
  const within = insideBox(line, frame);
  if (!within) return [];
  let lo = Math.max(within[0], line.from);
  const hi = Math.min(within[1], line.to);
  const faces: [number, number][] = [];
  for (const body of bodies) {
    // Where the line crosses the body's outline (grown by the gap): keep only what is beyond the crossing, toward the Sun.
    const r = body.r + bodyGap;
    let ox = line.x - body.x;
    let oy = line.y - body.y;
    let ux = line.ux;
    let uy = line.uy;
    if (body.long) {
      // An ellipse: squeeze the picture along its long axis until the outline is a circle of radius r.
      const k = r / (body.long.r + bodyGap) - 1;
      const o = ox * body.long.ux + oy * body.long.uy;
      const u = ux * body.long.ux + uy * body.long.uy;
      ox += body.long.ux * o * k;
      oy += body.long.uy * o * k;
      ux += body.long.ux * u * k;
      uy += body.long.uy * u * k;
    }
    const a = ux * ux + uy * uy;
    const b = ox * ux + oy * uy;
    const disc = b * b - a * (ox * ox + oy * oy - r * r);
    if (disc <= 0) continue;
    const far = (-b + Math.sqrt(disc)) / a;
    if (body.shadow === false) faces.push([(-b - Math.sqrt(disc)) / a, far]);
    else lo = Math.max(lo, far);
  }
  if (hi - lo < minLength) return [];
  let pieces: [number, number][] = [[lo, hi]];
  const remove = (cut: [number, number]) => {
    const next: [number, number][] = [];
    for (const [a, b] of pieces) {
      if (cut[1] <= a || cut[0] >= b) next.push([a, b]);
      else {
        if (cut[0] > a) next.push([a, cut[0]]);
        if (cut[1] < b) next.push([cut[1], b]);
      }
    }
    pieces = next;
  };
  for (const face of faces) remove(face);
  for (const box of keepClear) {
    const cut = insideBox(line, grow(box, margin));
    if (cut) remove(cut);
  }
  return pieces.filter(([a, b]) => b - a >= minLength).map(([a, b]) => ({ x1: line.x + line.ux * a, y1: line.y + line.uy * a, x2: line.x + line.ux * b, y2: line.y + line.uy * b }));
}

/**
 * Is the Sun inside the frame? `sun` is the point where its direction meets the picture, or null
 * when the Sun is behind the camera. Its disc counts as inside while any of it would show.
 */
export function sunInFrame(sun: { x: number; y: number } | null, frame: Box, discRadius = 0): boolean {
  return sun !== null && sun.x > frame.left - discRadius && sun.x < frame.right + discRadius && sun.y > frame.top - discRadius && sun.y < frame.bottom + discRadius;
}

/**
 * Where the Sun's direction leaves the clear part of the picture: follow it from `from` (the
 * Moon's centre on screen) along `heading` until it meets the frame's edge or a keep-clear box
 * (grown by `margin`). Null when the start is itself outside the frame or inside a box.
 */
export function sunExit(from: { x: number; y: number }, heading: { ux: number; uy: number }, frame: Box, keepClear: readonly Box[], margin: number = SUNLIGHT.margin): { x: number; y: number; at: 'frame' | 'panel' } | null {
  const line: ScreenLine = { x: from.x, y: from.y, ux: heading.ux, uy: heading.uy, from: 0, to: Infinity };
  const within = insideBox(line, frame);
  if (!within || within[0] > 0 || within[1] <= 0) return null;
  let reach = within[1];
  let at: 'frame' | 'panel' = 'frame';
  for (const box of keepClear) {
    const cut = insideBox(line, grow(box, margin));
    if (!cut || cut[1] <= 0) continue;
    if (cut[0] <= 0) return null;
    if (cut[0] < reach) {
      reach = cut[0];
      at = 'panel';
    }
  }
  return { x: from.x + heading.ux * reach, y: from.y + heading.uy * reach, at };
}

function overlaps(a: Box, b: Box): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

const area = (b: Box) => Math.max(0, b.right - b.left) * Math.max(0, b.bottom - b.top);

/**
 * The box the edge glow is drawn in: a square of `radius` round the exit point, cut back to the
 * frame and cut clear of every keep-clear box (grown by `margin`). The exit point stays in the box
 * or on its edge, and the glow's light is centred on it. Null when no clear box is left.
 */
export function glowBox(point: { x: number; y: number }, radius: number, frame: Box, keepClear: readonly Box[], margin: number = SUNLIGHT.margin): Box | null {
  let box: Box = { left: Math.max(frame.left, point.x - radius), top: Math.max(frame.top, point.y - radius), right: Math.min(frame.right, point.x + radius), bottom: Math.min(frame.bottom, point.y + radius) };
  const slack = 0.5;
  for (const keep of keepClear) {
    const k = grow(keep, margin);
    if (!overlaps(box, k)) continue;
    // Cut the box on one side of the panel: a side the exit point is on, leaving the most room.
    const cuts: Box[] = [];
    if (point.x <= k.left + slack) cuts.push({ ...box, right: Math.min(box.right, k.left) });
    if (point.x >= k.right - slack) cuts.push({ ...box, left: Math.max(box.left, k.right) });
    if (point.y <= k.top + slack) cuts.push({ ...box, bottom: Math.min(box.bottom, k.top) });
    if (point.y >= k.bottom - slack) cuts.push({ ...box, top: Math.max(box.top, k.bottom) });
    if (!cuts.length) return null;
    box = cuts.reduce((best, c) => (area(c) > area(best) ? c : best));
  }
  return area(box) > 1 ? box : null;
}

/**
 * The glow's radius inside its box: the full radius, or less where a panel cut the box short on a
 * side away from the exit point, so the glow has faded to nothing before it reaches that cut (no
 * hard edge hangs in the open picture). Sides on the frame's own edge do not limit it.
 */
export function glowRadius(point: { x: number; y: number }, box: Box, frame: Box, radius: number): number {
  let r = radius;
  const slack = 1;
  if (box.left > frame.left + slack && point.x - box.left > slack) r = Math.min(r, point.x - box.left);
  if (box.right < frame.right - slack && box.right - point.x > slack) r = Math.min(r, box.right - point.x);
  if (box.top > frame.top + slack && point.y - box.top > slack) r = Math.min(r, point.y - box.top);
  if (box.bottom < frame.bottom - slack && box.bottom - point.y > slack) r = Math.min(r, box.bottom - point.y);
  return r;
}

/** A glow squeezed to under this radius (pixels) by the panels round it is not drawn. */
export const MIN_GLOW = 36;

export interface EdgeGlow {
  /** Where the Sun's direction leaves the clear part of the picture: the centre of the glow's light. */
  x: number;
  y: number;
  at: 'frame' | 'panel';
  /** The box the glow is drawn in, clear of every panel, and the radius of its light. */
  box: Box;
  radius: number;
}

/**
 * The soft glow at the frame's edge, where the Sun's direction leaves the picture. It is drawn ONLY
 * while the Sun itself is outside the frame: when the Sun's disc is in the picture, the disc shows
 * and there is no glow. `sun` is the Sun's point on screen (null with the Sun behind the camera)
 * and `sunRadius` its disc's radius in pixels.
 */
export function edgeGlow(
  origin: { x: number; y: number },
  heading: { ux: number; uy: number },
  sun: { x: number; y: number } | null,
  sunRadius: number,
  frame: Box,
  keepClear: readonly Box[],
  fullRadius: number = SUNLIGHT.glowRadius,
  margin: number = SUNLIGHT.margin,
): EdgeGlow | null {
  if (sunInFrame(sun, frame, sunRadius)) return null;
  const exit = sunExit(origin, heading, frame, keepClear, margin);
  if (!exit) return null;
  const box = glowBox(exit, fullRadius, frame, keepClear, margin);
  if (!box) return null;
  const radius = glowRadius(exit, box, frame, fullRadius);
  return radius >= MIN_GLOW ? { x: exit.x, y: exit.y, at: exit.at, box, radius } : null;
}

// ---------- what the scene tells the HUD, once per frame ----------

/**
 * The Sun's light as the camera sees it this frame. The scene (MoonWorld) writes it; the HUD's
 * SunlightField reads it and draws. Positions are CSS pixels from the top left of the scene.
 */
export interface SunlightView {
  /** False until the Sun's direction is known, and outside the Orbit stage. */
  shown: boolean;
  /** 0 to 1: how strongly the instruments (and so the light) are drawn; they fade on the way to mission select. */
  opacity: number;
  /** 0 to 1: the lines' own strength (they fade when seen end-on). */
  strength: number;
  /** Pixels between neighbouring lines at the Moon. */
  gapPx: number;
  /** The lines of the sheet that are in front of the camera. */
  lines: (ScreenLine & { k: number })[];
  /** The Moon's centre on screen, and the heading of the Sun's direction there. */
  origin: { x: number; y: number };
  heading: { ux: number; uy: number };
  /** Where the Sun's direction meets the picture: the Sun's disc is drawn here. Null with the Sun behind the camera. */
  sun: { x: number; y: number } | null;
  /** The Sun's disc on screen: its radius in pixels (true apparent size), and what hides it, if anything. */
  sunRadius: number;
  sunHiddenBy: 'moon' | 'earth' | null;
  /** The Moon and (while it is drawn) Earth, as discs on screen. */
  bodies: Circle[];
  /** The glass panels and the controls as the HUD last measured them (the HUD writes this; the scene keeps the Sun's tag off them). */
  keepClear: Box[];
}

export const sunlightView: SunlightView = {
  shown: false,
  opacity: 0,
  strength: 0,
  gapPx: 0,
  lines: [],
  origin: { x: 0, y: 0 },
  heading: { ux: 1, uy: 0 },
  sun: null,
  sunRadius: 0,
  sunHiddenBy: null,
  bodies: [],
  keepClear: [],
};
