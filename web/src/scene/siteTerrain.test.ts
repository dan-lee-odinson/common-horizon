import { describe, expect, it } from 'vitest';
import { azElToLocal } from '../util/geo';
import { buildGroundMesh, everyOtherPost, FAR_RADIUS_M, gridHalf, gridHeight, groundHeight, meshLines, NEAR_BLEND_M, parseGrid, type TerrainGrid } from './siteTerrain';

/**
 * A made-up grid that rises 1 m for every 10 m to the north and 2 m for every 10 m to the east,
 * 0 at the middle post, written the way the files are: row 0 the north edge, column 0 the west edge.
 */
function slopeGrid(posts = 5, spacing = 10, northRise = 0.1, eastRise = 0.2): TerrainGrid {
  const heights = new Float32Array(posts * posts);
  const half = ((posts - 1) / 2) * spacing;
  for (let row = 0; row < posts; row++) {
    for (let col = 0; col < posts; col++) {
      const north = half - row * spacing;
      const east = -half + col * spacing;
      heights[row * posts + col] = northRise * north + eastRise * east;
    }
  }
  return { posts, spacing, heights };
}

function asFile(grid: TerrainGrid): ArrayBuffer {
  const buffer = new ArrayBuffer(grid.heights.length * 4);
  const view = new DataView(buffer);
  grid.heights.forEach((h, i) => view.setFloat32(i * 4, h, true));
  return buffer;
}

describe('the height files', () => {
  it('are read as little-endian floats, row 0 north and column 0 west', () => {
    const grid = parseGrid(asFile(slopeGrid()), 5, 10);
    expect(grid).not.toBeNull();
    // North-west corner: 20 m north, 20 m west.
    expect(grid!.heights[0]).toBeCloseTo(0.1 * 20 - 0.2 * 20, 5);
    // South-east corner.
    expect(grid!.heights[24]).toBeCloseTo(-0.1 * 20 + 0.2 * 20, 5);
    expect(grid!.heights[12]).toBe(0);
  });

  it('refuse a file of the wrong size or with a height that is not a number', () => {
    expect(parseGrid(new ArrayBuffer(24 * 4), 5, 10)).toBeNull();
    const bad = asFile(slopeGrid());
    new DataView(bad).setFloat32(8, Number.NaN, true);
    expect(parseGrid(bad, 5, 10)).toBeNull();
    expect(parseGrid(new TextEncoder().encode('<!doctype html>').buffer as ArrayBuffer, 5, 10)).toBeNull();
  });

  it('keep every other post for phones', () => {
    const grid = everyOtherPost(slopeGrid(9, 10));
    expect(grid.posts).toBe(5);
    expect(grid.spacing).toBe(20);
    expect(gridHalf(grid)).toBe(40);
    expect(gridHeight(grid, 20, 40)).toBeCloseTo(0.1 * 40 + 0.2 * 20, 5);
  });
});

describe('north and east in the scene', () => {
  const grid = slopeGrid();
  const shape = { near: grid, far: null };

  it('give the height between posts by a straight-line blend', () => {
    expect(gridHeight(grid, 0, 0)).toBe(0);
    expect(gridHeight(grid, 5, 0)).toBeCloseTo(1, 5);
    expect(gridHeight(grid, 0, 15)).toBeCloseTo(1.5, 5);
    expect(gridHeight(grid, 12.5, -7.5)).toBeCloseTo(0.2 * 12.5 - 0.1 * 7.5, 5);
  });

  it('put north and east where the Sun and Earth directions put them', () => {
    // The scene's direction toward azimuth 0 (north) and azimuth 90 (east), at level.
    const north = azElToLocal(0, 0, 1);
    const east = azElToLocal(90, 0, 1);
    // Ten metres toward north, in the scene, is ground 1 m higher; ten metres toward east, 2 m.
    expect(groundHeight(shape, north.x * 10, north.z * 10)).toBeCloseTo(1, 5);
    expect(groundHeight(shape, east.x * 10, east.z * 10)).toBeCloseTo(2, 5);
    expect(groundHeight(shape, -north.x * 10, -north.z * 10)).toBeCloseTo(-1, 5);
    expect(groundHeight(shape, -east.x * 10, -east.z * 10)).toBeCloseTo(-2, 5);
  });

  it('build a mesh whose vertices stand at those heights and whose normals lean away from the rise', () => {
    const mesh = buildGroundMesh(shape);
    const n = meshLines(shape).length;
    expect(mesh.positions.length).toBe(n * n * 3);
    // The vertex 10 m north of the site (z = -10) and the one 10 m east (x = +10).
    let northY = Number.NaN;
    let eastY = Number.NaN;
    let siteNormal: number[] = [];
    for (let k = 0; k < n * n; k++) {
      const [x, y, z] = [mesh.positions[3 * k], mesh.positions[3 * k + 1], mesh.positions[3 * k + 2]];
      if (x === 0 && z === -10) northY = y;
      if (x === 10 && z === 0) eastY = y;
      if (x === 0 && z === 0) siteNormal = [mesh.normals[3 * k], mesh.normals[3 * k + 1], mesh.normals[3 * k + 2]];
    }
    expect(northY).toBeCloseTo(1, 5);
    expect(eastY).toBeCloseTo(2, 5);
    // Ground rising to the north and east faces south and west: the normal points that way.
    const north = azElToLocal(0, 0, 1);
    const east = azElToLocal(90, 0, 1);
    const along = (v: { x: number; z: number }) => siteNormal[0] * v.x + siteNormal[2] * v.z;
    expect(along(north)).toBeLessThan(0);
    expect(along(east)).toBeLessThan(0);
    expect(along(east)).toBeLessThan(along(north));
    expect(siteNormal[1]).toBeGreaterThan(0.9);
  });

  it('wind every triangle so its face is up', () => {
    const mesh = buildGroundMesh(shape);
    const p = (k: number) => [mesh.positions[3 * k], mesh.positions[3 * k + 1], mesh.positions[3 * k + 2]];
    for (let t = 0; t < mesh.index.length; t += 3) {
      const [a, b, c] = [p(mesh.index[t]), p(mesh.index[t + 1]), p(mesh.index[t + 2])];
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      // y of u x v: up for a face that faces up (counter-clockwise seen from above).
      expect(u[2] * v[0] - u[0] * v[2]).toBeGreaterThan(0);
    }
  });
});

describe('the edge of the drawn ground', () => {
  it('eases the near grid back to level past its edge when there is no far grid', () => {
    const shape = { near: slopeGrid(), far: null };
    const half = gridHalf(shape.near);
    expect(groundHeight(shape, half, 0)).toBeCloseTo(4, 5);
    expect(groundHeight(shape, half + NEAR_BLEND_M / 2, 0)).toBeCloseTo(2, 5);
    expect(groundHeight(shape, half + NEAR_BLEND_M, 0)).toBe(0);
    expect(groundHeight(shape, half + NEAR_BLEND_M + 500, 300)).toBe(0);
    const mesh = buildGroundMesh(shape);
    expect(Math.max(...mesh.flat)).toBe(1);
    expect(mesh.flat[Math.floor(mesh.flat.length / 2)]).toBe(0);
  });

  it('joins the near grid to the far grid with no step at the near edge', () => {
    const near = slopeGrid(129, 10, 0.1, 0.2);
    // A far grid that disagrees with the near one by 30 m everywhere but the middle.
    const far = slopeGrid(257, 250, 0.1, 0.2);
    for (let i = 0; i < far.heights.length; i++) far.heights[i] += i === (far.heights.length - 1) / 2 ? 0 : 30;
    const shape = { near, far };
    const half = gridHalf(near);
    for (const z of [-640, -333, 0, 101, 640]) {
      expect(groundHeight(shape, half - 1e-6, z)).toBeCloseTo(gridHeight(far, half, -z), 3);
      expect(groundHeight(shape, half + 1e-6, z)).toBeCloseTo(gridHeight(far, half, -z), 3);
    }
    // Every line of the mesh along the near edge is shared by both sides.
    const lines = meshLines(shape);
    expect(lines).toContain(half);
    expect(lines).toContain(-half);
    expect(lines[lines.length - 1]).toBeLessThanOrEqual(FAR_RADIUS_M);
    // The site itself keeps its own height.
    expect(groundHeight(shape, 0, 0)).toBe(0);
  });
});
