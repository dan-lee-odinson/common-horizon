// TRUE SCALE, pinned to the files that are served: each hardware model's shape (.glb) is as large
// as its description (.json) says, in metres, and stands on the ground. The scene draws the shapes
// with no scaling at all, so this is what makes "true scale" true.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MODEL_FOR, modelUrl, parseModelMeta } from '../state/models';

function served(path: string): Buffer {
  return readFileSync(fileURLToPath(new URL(`../../public/${path}`, import.meta.url)));
}

interface Gltf {
  scenes?: { nodes?: number[] }[];
  nodes?: { mesh?: number; children?: number[]; matrix?: number[]; translation?: number[]; rotation?: number[]; scale?: number[] }[];
  meshes?: { primitives: { attributes: Record<string, number>; mode?: number; indices?: number }[] }[];
  accessors?: { count: number; min?: number[]; max?: number[] }[];
  textures?: unknown[];
  images?: unknown[];
}

/** The JSON part of a binary glTF file (the first chunk after the 12-byte header). */
function gltfOf(glb: Buffer): Gltf {
  expect(glb.readUInt32LE(0)).toBe(0x46546c67); // "glTF"
  expect(glb.readUInt32LE(4)).toBe(2);
  expect(glb.readUInt32LE(8)).toBe(glb.length);
  const length = glb.readUInt32LE(12);
  expect(glb.readUInt32LE(16)).toBe(0x4e4f534a); // "JSON"
  return JSON.parse(glb.subarray(20, 20 + length).toString('utf8')) as Gltf;
}

describe.each(Object.entries(MODEL_FOR))('%s model', (_catalogId, modelId) => {
  const meta = parseModelMeta(JSON.parse(served(modelUrl(modelId, 'json')).toString('utf8')), modelId)!;
  const gltf = gltfOf(served(modelUrl(modelId, 'glb')));

  it('places every part without moving, turning or scaling it', () => {
    // With no node transforms the vertex positions are the model's own metres.
    for (const node of gltf.nodes ?? []) {
      expect(node.matrix).toBeUndefined();
      expect(node.translation ?? [0, 0, 0]).toEqual([0, 0, 0]);
      expect(node.rotation ?? [0, 0, 0, 1]).toEqual([0, 0, 0, 1]);
      expect(node.scale ?? [1, 1, 1]).toEqual([1, 1, 1]);
    }
  });

  it('is exactly as wide, tall and deep as its description says, and stands on the ground', () => {
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    let triangles = 0;
    for (const mesh of gltf.meshes ?? []) {
      for (const prim of mesh.primitives) {
        const position = gltf.accessors![prim.attributes.POSITION];
        expect(position.min).toHaveLength(3);
        expect(position.max).toHaveLength(3);
        for (let k = 0; k < 3; k++) {
          lo[k] = Math.min(lo[k], position.min![k]);
          hi[k] = Math.max(hi[k], position.max![k]);
        }
        triangles += (prim.indices !== undefined ? gltf.accessors![prim.indices].count : position.count) / 3;
      }
    }
    // Width and depth to the millimetre the descriptions give them in (the imported and generated
    // shapes are measured, then rounded); the height, the published figure, exactly.
    expect(hi[0] - lo[0]).toBeCloseTo(meta.dimensions.width, 3);
    expect(hi[1] - lo[1]).toBeCloseTo(meta.dimensions.height, 5);
    expect(hi[2] - lo[2]).toBeCloseTo(meta.dimensions.depth, 3);
    // The lowest point is on the ground, and the footprint is centred on the origin.
    expect(lo[1]).toBeCloseTo(0, 5);
    expect(lo[0] + hi[0]).toBeCloseTo(0, 5);
    expect(lo[2] + hi[2]).toBeCloseTo(0, 5);
    // Modest geometry: the whole mission must draw in software WebGL.
    expect(triangles).toBeGreaterThan(0);
    expect(triangles).toBeLessThanOrEqual(20000);
  });

  it('carries no picture: colours only', () => {
    expect(gltf.textures ?? []).toHaveLength(0);
    expect(gltf.images ?? []).toHaveLength(0);
  });
});
