// The real ground round a preset site, as plain arithmetic: reading the height files in
// public/site-terrain/ (see its README), the height at any point, and the mesh the Site view draws.
// Kept free of 3D-library code so it can be checked by tests.
//
// A file is a square grid of heights, little-endian 32-bit floats row by row: row 0 is the north
// edge, column 0 the west edge, and each value is metres above the horizontal plane through the
// site (the middle post is the site and is 0). The scene's frame is the one the Sun's and Earth's
// directions use (`azElToLocal`): x east, y up, z SOUTH. So east is +x and north is -z.
//
// Two files per site: the near grid (129 x 129 posts, 10 m apart, 1.28 km across) and the far grid
// (257 x 257 posts, 250 m apart, 64 km across, the Moon's curvature already in it). The drawn
// ground is one mesh on a grid of lines that is fine where the near file is and coarse beyond:
//   near only  the near file, eased back to level ground over `NEAR_BLEND_M` past its edge
//   near + far the near file, eased into the far file over its outer `JOIN_M`, then the far file
//              out to `FAR_RADIUS_M`. The two meshes share their lines, so there is no seam.

/** Past the near grid's edge, its heights ease back to the level ground over this distance, metres. */
export const NEAR_BLEND_M = 1500;
/** Inside the near grid's edge, its heights ease into the far grid's over this distance, metres. */
export const JOIN_M = 160;
/** The far ground is drawn out to this distance from the site, metres. */
export const FAR_RADIUS_M = 32_000;
/** Over its last this-many metres the far ground fades into the skyline band's colour. */
export const FAR_FADE_M = 4_000;
/** Spacing of the lines of the eased ring round the near grid (near only), metres. */
const RING_STEP_M = 50;

export interface TerrainGrid {
  /** Posts along each side. */
  posts: number;
  /** Metres between posts. */
  spacing: number;
  /** Heights, metres: row by row from the north edge, each row from the west edge. */
  heights: Float32Array;
}

/** Half the width of a grid, metres: its edges are this far east, west, north and south of the site. */
export function gridHalf(grid: Pick<TerrainGrid, 'posts' | 'spacing'>): number {
  return ((grid.posts - 1) / 2) * grid.spacing;
}

/**
 * Reads a height file. Null unless it holds exactly `posts` x `posts` finite heights (a file that
 * is cut short, or a page of HTML in its place, is not ground).
 */
export function parseGrid(buffer: ArrayBuffer, posts: number, spacing: number): TerrainGrid | null {
  if (!Number.isInteger(posts) || posts < 3 || posts % 2 !== 1 || !(spacing > 0)) return null;
  if (buffer.byteLength !== posts * posts * 4) return null;
  const view = new DataView(buffer);
  const heights = new Float32Array(posts * posts);
  for (let i = 0; i < heights.length; i++) {
    const h = view.getFloat32(i * 4, true);
    if (!Number.isFinite(h)) return null;
    heights[i] = h;
  }
  return { posts, spacing, heights };
}

/** Keeps every other post (a grid of 2n + 1 posts becomes n + 1, twice as far apart). */
export function everyOtherPost(grid: TerrainGrid): TerrainGrid {
  const posts = (grid.posts + 1) / 2;
  if (!Number.isInteger(posts) || posts < 3) return grid;
  const heights = new Float32Array(posts * posts);
  for (let r = 0; r < posts; r++) for (let c = 0; c < posts; c++) heights[r * posts + c] = grid.heights[2 * r * grid.posts + 2 * c];
  return { posts, spacing: grid.spacing * 2, heights };
}

/**
 * The height at a point `east` and `north` metres from the site, metres: a straight-line blend of
 * the four posts round it. Outside the grid, the height at the nearest point of its edge.
 */
export function gridHeight(grid: TerrainGrid, east: number, north: number): number {
  const n = grid.posts;
  const half = gridHalf(grid);
  const col = Math.min(n - 1, Math.max(0, (east + half) / grid.spacing));
  const row = Math.min(n - 1, Math.max(0, (half - north) / grid.spacing));
  const c0 = Math.min(n - 2, Math.floor(col));
  const r0 = Math.min(n - 2, Math.floor(row));
  const fc = col - c0;
  const fr = row - r0;
  const h = grid.heights;
  const top = h[r0 * n + c0] * (1 - fc) + h[r0 * n + c0 + 1] * fc;
  const bottom = h[(r0 + 1) * n + c0] * (1 - fc) + h[(r0 + 1) * n + c0 + 1] * fc;
  return top * (1 - fr) + bottom * fr;
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** What the Site view draws as ground: the near grid alone, or the near and far grids joined. */
export interface SiteGroundShape {
  near: TerrainGrid;
  far: TerrainGrid | null;
}

/**
 * The drawn ground's height at a point of the scene (x east, z south), metres. The same function
 * builds the mesh and stands the hardware, the markers and the camera on it.
 */
export function groundHeight(shape: SiteGroundShape, x: number, z: number): number {
  const north = -z;
  const half = gridHalf(shape.near);
  const out = Math.max(Math.abs(x), Math.abs(north));
  if (shape.far) {
    if (out >= half) return gridHeight(shape.far, x, north);
    const near = gridHeight(shape.near, x, north);
    const w = smoothstep(half - JOIN_M, half, out);
    return w === 0 ? near : near * (1 - w) + gridHeight(shape.far, x, north) * w;
  }
  const edge = gridHeight(shape.near, x, north);
  if (out <= half) return edge;
  // Past the edge: the edge's height, eased to level over NEAR_BLEND_M.
  const beyond = Math.hypot(Math.max(0, Math.abs(x) - half), Math.max(0, Math.abs(north) - half));
  return edge * (1 - smoothstep(0, NEAR_BLEND_M, beyond));
}

/** How far the drawn ground reaches from the site along each axis, metres. */
export function groundReach(shape: SiteGroundShape): number {
  return shape.far ? Math.min(FAR_RADIUS_M, gridHalf(shape.far)) : gridHalf(shape.near) + NEAR_BLEND_M;
}

/**
 * The lines of the mesh along one axis, metres from the site, west to east (or south to north):
 * every post of the near grid, then, outside it, every post of the far grid out to its reach (near
 * and far) or lines every `RING_STEP_M` across the eased ring (near only).
 */
export function meshLines(shape: SiteGroundShape): number[] {
  const half = gridHalf(shape.near);
  const inner: number[] = [];
  for (let i = 0; i < shape.near.posts; i++) inner.push(-half + i * shape.near.spacing);
  const outer: number[] = [];
  if (shape.far) {
    const reach = groundReach(shape);
    const step = shape.far.spacing;
    for (let v = Math.ceil((half + 1e-6) / step) * step; v <= reach + 1e-6; v += step) outer.push(v);
  } else {
    for (let v = half + RING_STEP_M; v <= half + NEAR_BLEND_M + 1e-6; v += RING_STEP_M) outer.push(v);
  }
  return [...outer.map((v) => -v).reverse(), ...inner, ...outer];
}

export interface GroundMesh {
  /** x, y, z of each vertex, metres (x east, y up, z south). */
  positions: Float32Array;
  /** The upward unit normal at each vertex. */
  normals: Float32Array;
  /** How much each vertex is the level illustration rather than data, 0 to 1 (the eased ring, near only). */
  flat: Float32Array;
  /** Three vertices a triangle, wound counter-clockwise seen from above. */
  index: Uint32Array;
}

/**
 * The ground as one mesh over the lines of `meshLines`, heights from `groundHeight`. Each normal is
 * worked out from the heights of the vertex's neighbours. Cells farther than `FAR_RADIUS_M` from
 * the site are left out.
 */
export function buildGroundMesh(shape: SiteGroundShape): GroundMesh {
  const xs = meshLines(shape);
  const n = xs.length;
  const half = gridHalf(shape.near);
  // Row j runs west to east at z = xs[j] (north at the top: z from -reach to +reach).
  const heights = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) heights[j * n + i] = groundHeight(shape, xs[i], xs[j]);
  const positions = new Float32Array(n * n * 3);
  const normals = new Float32Array(n * n * 3);
  const flat = new Float32Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      positions[3 * k] = xs[i];
      positions[3 * k + 1] = heights[k];
      positions[3 * k + 2] = xs[j];
      const i0 = Math.max(0, i - 1);
      const i1 = Math.min(n - 1, i + 1);
      const j0 = Math.max(0, j - 1);
      const j1 = Math.min(n - 1, j + 1);
      const dx = (heights[j * n + i1] - heights[j * n + i0]) / (xs[i1] - xs[i0]);
      const dz = (heights[j1 * n + i] - heights[j0 * n + i]) / (xs[j1] - xs[j0]);
      const len = Math.hypot(dx, 1, dz);
      normals[3 * k] = -dx / len;
      normals[3 * k + 1] = 1 / len;
      normals[3 * k + 2] = -dz / len;
      if (!shape.far) {
        const beyond = Math.hypot(Math.max(0, Math.abs(xs[i]) - half), Math.max(0, Math.abs(xs[j]) - half));
        flat[k] = smoothstep(0, NEAR_BLEND_M, beyond);
      }
    }
  }
  const radius = shape.far ? FAR_RADIUS_M : Infinity;
  const index: number[] = [];
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      if (Math.hypot((xs[i] + xs[i + 1]) / 2, (xs[j] + xs[j + 1]) / 2) > radius) continue;
      const a = j * n + i;
      const b = a + 1;
      const c = a + n;
      const d = c + 1;
      // Seen from above (y up, z south): a north-west, b north-east, c south-west, d south-east.
      index.push(a, c, b, b, c, d);
    }
  }
  return { positions, normals, flat, index: Uint32Array.from(index) };
}
