// Tests for finish-model.mjs: a raw file with textures, colours, a node transform, Z up and a
// loose bit comes out as one plain shape, Y up, at the published height, on the origin.
// Run: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { finishModel, readSpec, readRawShape, finishShape } from '../finish-model.mjs';
import { measureGLB } from '../shared/glb-reader.mjs';
import { checkModel } from '../check-models.mjs';

/** Write a small GLB by hand: one mesh with UVs, vertex colours and a textured material. */
function rawGLB({ positions, indices, node = {}, withTexture = true }) {
  const chunks = [];
  let offset = 0;
  const views = [];
  const addView = (bytes) => {
    const pad = (4 - (bytes.length % 4)) % 4;
    views.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length });
    chunks.push(Buffer.from(bytes), Buffer.alloc(pad));
    offset += bytes.length + pad;
    return views.length - 1;
  };
  const vertexCount = positions.length / 3;
  const min = [0, 1, 2].map((k) => Math.min(...positions.filter((_, i) => i % 3 === k)));
  const max = [0, 1, 2].map((k) => Math.max(...positions.filter((_, i) => i % 3 === k)));
  const accessors = [
    { bufferView: addView(new Uint8Array(new Float32Array(positions).buffer)), componentType: 5126, count: vertexCount, type: 'VEC3', min, max },
    { bufferView: addView(new Uint8Array(new Uint32Array(indices).buffer)), componentType: 5125, count: indices.length, type: 'SCALAR' },
    { bufferView: addView(new Uint8Array(new Float32Array(vertexCount * 2).fill(0.5).buffer)), componentType: 5126, count: vertexCount, type: 'VEC2' },
    { bufferView: addView(new Uint8Array(new Float32Array(vertexCount * 4).fill(1).buffer)), componentType: 5126, count: vertexCount, type: 'VEC4' },
  ];
  const gltf = {
    asset: { version: '2.0', generator: 'test' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: 'raw', mesh: 0, ...node }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 2, COLOR_0: 3 }, indices: 1, material: 0 }] }],
    materials: [{ name: 'painted', pbrMetallicRoughness: withTexture ? { baseColorTexture: { index: 0 } } : {} }],
    accessors,
    bufferViews: views,
    buffers: [],
  };
  if (withTexture) {
    // A 1x1 PNG, enough for a real images/textures/samplers set.
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    gltf.images = [{ bufferView: addView(png), mimeType: 'image/png' }];
    gltf.samplers = [{}];
    gltf.textures = [{ source: 0, sampler: 0 }];
  }
  const bin = Buffer.concat(chunks);
  gltf.buffers.push({ byteLength: bin.length });
  let json = Buffer.from(JSON.stringify(gltf));
  json = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + json.length + 8 + bin.length, 8);
  const chunk = (type, data) => {
    const h = Buffer.alloc(8);
    h.writeUInt32LE(data.length, 0);
    h.writeUInt32LE(type, 4);
    return Buffer.concat([h, data]);
  };
  return Buffer.concat([header, chunk(0x4e4f534a, json), chunk(0x004e4942, bin)]);
}

/** A box from (x0, y0, z0) to (x1, y1, z1): 8 corners, 12 triangles. */
function boxMesh([x0, y0, z0], [x1, y1, z1], base = 0) {
  const p = [];
  for (const x of [x0, x1]) for (const y of [y0, y1]) for (const z of [z0, z1]) p.push(x, y, z);
  const faces = [
    [0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3],
  ];
  const idx = faces.flatMap(([a, b, c, d]) => [a, b, c, a, c, d]).map((i) => i + base);
  return { p, idx };
}

// Raw shape, Z up like a CAD export: a 2 (x) by 4 (y) by 1 (z, up) block, plus a tiny loose
// triangle far off to the side that should be dropped as a loose bit.
function sampleRaw() {
  const block = boxMesh([0, 0, 0], [2, 4, 1]);
  const loose = { p: [9, 9, 0.2, 9.01, 9, 0.2, 9, 9.01, 0.2], idx: [8, 9, 10] };
  return rawGLB({
    positions: [...block.p, ...loose.p],
    indices: [...block.idx, ...loose.idx],
    node: { translation: [5, -3, 2], scale: [1, 1, 1] },
  });
}

function sampleSpec(overrides = {}) {
  return {
    id: 'sample-generated',
    name: 'Sample',
    kind: 'generated',
    status: 'test figure',
    dimension_sources: [
      { dimension: 'height_y', value_m: 3, meaning: 'overall height', source: 'test source', status: 'test figure' },
      { dimension: 'width_x', published: { value_m: 6, source: 'test source', status: 'test figure' } },
    ],
    generation: {
      picture: { credit: 'A. Photographer' },
      model: 'TRELLIS.2',
      service: 'fal.ai',
      request_id: 'test-request',
      date: '2026-11-15',
    },
    simplifications: ['test'],
    finishing: { rotate_deg: [-90, 0, 0], drop_loose_parts_below: 0.2 },
    ...overrides,
  };
}

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'finish-model-'));
}

test('finish: strips textures and colours, turns Z up into Y up, drops the loose bit, scales and centres', async () => {
  const dir = tempDir();
  try {
    const input = path.join(dir, 'raw.glb');
    fs.writeFileSync(input, sampleRaw());
    const raw = measureGLB(fs.readFileSync(input));
    assert.equal(raw.images, 1);
    assert.equal(raw.vertexColors, true);

    const { description, written } = await finishModel({ input, spec: sampleSpec(), outDir: dir });
    assert.equal(written, true);
    const out = measureGLB(fs.readFileSync(path.join(dir, 'sample-generated.glb')));
    // Height 1 m (Z) becomes Y and is scaled to 3 m: factor 3, so 2 m -> 6 m and 4 m -> 12 m.
    const [x, y, z] = out.box.size;
    assert.ok(Math.abs(y - 3) < 1e-5, `height ${y}`);
    assert.ok(Math.abs(x - 6) < 1e-5, `width ${x}`);
    assert.ok(Math.abs(z - 12) < 1e-5, `depth ${z}`);
    assert.ok(Math.abs(out.box.min[1]) < 1e-6);
    assert.ok(Math.abs(out.box.center[0]) < 1e-6 && Math.abs(out.box.center[2]) < 1e-6);
    assert.equal(out.triangles, 12);
    assert.equal(out.images + out.textures + out.samplers, 0);
    assert.equal(out.vertexColors, false);
    assert.equal(out.materials.length, 1);
    assert.equal(out.materials[0].name, 'neutral');
    const attributes = Object.keys(out.gltf.meshes[0].primitives[0].attributes).sort();
    assert.deepEqual(attributes, ['NORMAL', 'POSITION']);

    assert.equal(description.note, "illustrative shape, SI/AI-generated from a photo; not the manufacturer's data");
    assert.deepEqual(description.dimensions_m, { width_x: 6, height_y: 3, depth_z: 12 });
    assert.equal(description.finishing.removed_loose_parts.pieces, 1);
    assert.equal(description.finishing.removed_loose_parts.triangles, 1);
    assert.equal(description.finishing.scale_factor, 3);
    const width = description.dimension_sources.find((s) => s.dimension === 'width_x');
    assert.equal(width.value_m, 6);
    assert.equal(width.status, 'our estimate');
    assert.equal(width.difference_percent, 0);

    // The independent check agrees with the finished files (no brief entry: that is the only problem).
    const result = await checkModel(dir, 'sample-generated');
    assert.deepEqual(result.problems, ['brief: "sample-generated" is not one of the models in the brief']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('finish: the finished JSON works as the spec and gives the same bytes again', async () => {
  const dir = tempDir();
  const again = path.join(dir, 'again');
  try {
    const input = path.join(dir, 'raw.glb');
    fs.writeFileSync(input, sampleRaw());
    await finishModel({ input, spec: sampleSpec(), outDir: dir });
    const finishedJson = JSON.parse(fs.readFileSync(path.join(dir, 'sample-generated.json'), 'utf8'));
    await finishModel({ input, spec: finishedJson, outDir: again });
    for (const file of ['sample-generated.glb', 'sample-generated.json']) {
      assert.ok(fs.readFileSync(path.join(dir, file)).equals(fs.readFileSync(path.join(again, file))), `${file} differs`);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('finish: refuses a shape with 20,000 triangles or more', async () => {
  const dir = tempDir();
  try {
    const positions = [];
    const indices = [];
    for (let i = 0; i < 20000; i++) {
      positions.push(i, 0, 0, i + 0.5, 1, 0, i, 1, 1);
      indices.push(i * 3, i * 3 + 1, i * 3 + 2);
    }
    const input = path.join(dir, 'big.glb');
    fs.writeFileSync(input, rawGLB({ positions, indices, withTexture: false }));
    const spec = sampleSpec({ finishing: { rotate_deg: [0, 0, 0] } });
    await assert.rejects(finishModel({ input, spec, outDir: dir }), /refused: 20000 triangles is not under the limit/);
    assert.equal(fs.existsSync(path.join(dir, 'sample-generated.glb')), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('finish: the spec must give the kind, the published height and a valid turn', () => {
  assert.throws(() => readSpec(sampleSpec({ kind: 'code-built' })), /"kind" must be "imported" or "generated"/);
  assert.throws(() => readSpec(sampleSpec({ dimension_sources: [] })), /published height/);
  assert.throws(() => readSpec(sampleSpec({ finishing: { rotate_deg: [90, 0] } })), /rotate_deg/);
  assert.deepEqual(readSpec(sampleSpec()), { targetHeight: 3, rotate: [-90, 0, 0], dropBelow: 0.2, flattenBelow: 0 });
  assert.throws(() => readSpec(sampleSpec({ finishing: { flatten_below: 0.2 } })), /flatten_below/);
  const badPublished = sampleSpec();
  badPublished.dimension_sources[1].published = { source: 'x', status: 'y' };
  assert.throws(() => readSpec(badPublished), /published figure for width_x/);
});

// An uneven raw shape: a 2 x 1 x 1 block with a 0.2 x 3 x 0.2 mast at its +X end. Feature
// positions tell whether the node transform and the turn went the right way.
function mastShape() {
  const block = boxMesh([0, 0, 0], [2, 1, 1]);
  const mast = boxMesh([1.8, 1, 0.4], [2, 4, 0.6], 8);
  return { positions: [...block.p, ...mast.p], indices: [...block.idx, ...mast.idx] };
}

/** Every triangle's face direction should agree with its vertices' normals (outward). */
function windingAgreesWithNormals(shape) {
  const n = shape.normals;
  for (let t = 0; t < shape.indices.length; t += 3) {
    const [a, b, c] = [shape.indices[t], shape.indices[t + 1], shape.indices[t + 2]];
    const p = (i) => shape.positions.slice(i * 3, i * 3 + 3);
    const [pa, pb, pc] = [p(a), p(b), p(c)];
    const u = pb.map((v, k) => v - pa[k]);
    const w = pc.map((v, k) => v - pa[k]);
    const face = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const avg = [0, 1, 2].map((k) => n[a * 3 + k] + n[b * 3 + k] + n[c * 3 + k]);
    if (face[0] * avg[0] + face[1] * avg[1] + face[2] * avg[2] <= 0) return false;
  }
  return true;
}

test('finish: node rotation and a mirroring scale are applied, winding follows, the turn goes the right way', () => {
  const { positions, indices } = mastShape();
  // Node: turned 90 degrees about Y (quaternion), mirrored in X, stretched 2x in Z.
  const s = Math.SQRT1_2;
  const node = { rotation: [0, s, 0, s], scale: [-1, 1, 2], translation: [3, 0, 0] };
  const raw = readRawShape(rawGLB({ positions, indices, node, withTexture: false }));
  assert.equal(raw.normals, null); // no NORMAL in this file
  // The mast (local x 1.8..2, y 1..4, z 0.4..0.6) under scale (-1, 1, 2) becomes x -2..-1.8,
  // z 0.8..1.2; turning +90 degrees about Y maps (x, z) to (z, -x), then +3 in x:
  // x 3.8..4.2, z 1.8..2. Its top (y 4) is the highest point.
  let top = null;
  for (let i = 0; i < raw.positions.length; i += 3) {
    if (!top || raw.positions[i + 1] > top[1]) top = raw.positions.slice(i, i + 3);
  }
  assert.ok(top[0] > 3.79 && top[0] < 4.21, `mast x ${top[0]}`);
  assert.ok(top[2] > 1.79 && top[2] < 2.01, `mast z ${top[2]}`);

  // With normals in the file: a mirrored node must flip the winding so faces still point out.
  const normals = [];
  const centre = [1, 0.5, 0.5];
  for (let i = 0; i < positions.length; i += 3) {
    const d = [0, 1, 2].map((k) => positions[i + k] - centre[k]);
    const len = Math.hypot(...d);
    normals.push(...d.map((v) => v / len));
  }
  const withNormals = readRawShape(rawGLBWithNormals({ positions, indices, normals, node: { scale: [-1, 1, 1] } }));
  // Only the block (first 12 triangles) has normals pointing out from its own centre.
  const block = { positions: withNormals.positions, normals: withNormals.normals, indices: withNormals.indices.slice(0, 36) };
  assert.ok(windingAgreesWithNormals(block), 'winding disagrees with normals after a mirroring node');

  // The turn: a Z-up copy of the shape (mast along +Z), turned by rotate_deg [-90, 0, 0], must
  // stand up again with the mast pointing up at the +X end. Turning the wrong way would point
  // the mast down, and the highest points would then be the block's corners.
  const zUp = [];
  for (let i = 0; i < positions.length; i += 3) zUp.push(positions[i], -positions[i + 2], positions[i + 1]);
  const turned = finishShape(readRawShape(rawGLB({ positions: zUp, indices, withTexture: false })), {
    targetHeight: 4, rotate: [-90, 0, 0], dropBelow: 0,
  }).shape;
  const ys = turned.positions.filter((_, i) => i % 3 === 1);
  const highest = Math.max(...ys);
  const tops = [];
  for (let i = 0; i < turned.positions.length; i += 3) {
    if (turned.positions[i + 1] > highest - 1e-6) tops.push(turned.positions.slice(i, i + 3));
  }
  assert.equal(tops.length, 4, 'the four corners of the mast top are the only highest points');
  // Centred: the block spans x -1..1, the mast x 0.8..1 and z -0.1..0.1.
  for (const [x, , z] of tops) assert.ok(x > 0.79 && x < 1.01 && Math.abs(z) < 0.11, `mast top at x ${x}, z ${z}`);
});

test('finish: refuses an empty result and a flat shape instead of writing them', async () => {
  const dir = tempDir();
  try {
    const three = [boxMesh([0, 0, 0], [1, 1, 1]), boxMesh([3, 0, 0], [4, 1, 1], 8), boxMesh([6, 0, 0], [7, 1, 1], 16)];
    const input = path.join(dir, 'three.glb');
    fs.writeFileSync(input, rawGLB({ positions: three.flatMap((b) => b.p), indices: three.flatMap((b) => b.idx), withTexture: false }));
    const spec = sampleSpec({ finishing: { rotate_deg: [0, 0, 0], drop_loose_parts_below: 0.4 } });
    await assert.rejects(finishModel({ input, spec, outDir: dir }), /nothing is left of the shape/);
    const flat = path.join(dir, 'flat.glb');
    fs.writeFileSync(flat, rawGLB({ positions: [0, 0, 0, 1, 0, 0, 0, 0, 1], indices: [0, 2, 1], withTexture: false }));
    await assert.rejects(finishModel({ input: flat, spec: sampleSpec({ finishing: { rotate_deg: [0, 0, 0] } }), outDir: dir }), /no height/);
    assert.equal(fs.existsSync(path.join(dir, 'sample-generated.glb')), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('finish: flatten_below raises a part hanging under the wheels to the wheel line', () => {
  // A 2 m long body from y 1 to 2 on "wheels" down to y 0.5, and a drill down to y 0.45.
  const body = boxMesh([0, 0.5, 0], [2, 2, 1]);
  const drill = boxMesh([0.9, 0.45, 0.4], [1.1, 0.6, 0.6], 8);
  const raw = readRawShape(rawGLB({ positions: [...body.p, ...drill.p], indices: [...body.idx, ...drill.idx], withTexture: false }));
  const plain = finishShape(raw, { targetHeight: 3, rotate: [0, 0, 0], dropBelow: 0 });
  const flat = finishShape(raw, { targetHeight: 3, rotate: [0, 0, 0], dropBelow: 0, flattenBelow: 0.04 });
  // Without flattening the drill tip is the ground; with it the body bottom is.
  const lowestBody = (shape) => Math.min(...shape.positions.filter((_, i) => i % 3 === 1).slice(0, 8));
  assert.ok(lowestBody(plain.shape) > 0.05, 'without flattening the body floats above the drill tip');
  assert.ok(Math.abs(lowestBody(flat.shape)) < 1e-9, 'with flattening the body stands on y = 0');
  // The line is 4% of the height above the drill tip (0.512 m), so the drill's four bottom corners
  // and the body's four bottom corners (0.5 m) are raised to it: 8 points.
  assert.equal(flat.flattened, 8);
});

/** Like rawGLB, but with a NORMAL attribute. */
function rawGLBWithNormals({ positions, indices, normals, node = {} }) {
  const vertexCount = positions.length / 3;
  const pos = Buffer.from(new Float32Array(positions).buffer);
  const nrm = Buffer.from(new Float32Array(normals).buffer);
  const idx = Buffer.from(new Uint32Array(indices).buffer);
  const bin = Buffer.concat([pos, nrm, idx]);
  const min = [0, 1, 2].map((k) => Math.min(...positions.filter((_, i) => i % 3 === k)));
  const max = [0, 1, 2].map((k) => Math.max(...positions.filter((_, i) => i % 3 === k)));
  const gltf = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, ...node }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2 }] }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: vertexCount, type: 'VEC3', min, max },
      { bufferView: 1, componentType: 5126, count: vertexCount, type: 'VEC3' },
      { bufferView: 2, componentType: 5125, count: indices.length, type: 'SCALAR' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: pos.length },
      { buffer: 0, byteOffset: pos.length, byteLength: nrm.length },
      { buffer: 0, byteOffset: pos.length + nrm.length, byteLength: idx.length },
    ],
    buffers: [{ byteLength: bin.length }],
  };
  let json = Buffer.from(JSON.stringify(gltf));
  json = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + json.length + 8 + bin.length, 8);
  const chunk = (type, data) => {
    const h = Buffer.alloc(8);
    h.writeUInt32LE(data.length, 0);
    h.writeUInt32LE(type, 4);
    return Buffer.concat([h, data]);
  };
  return Buffer.concat([header, chunk(0x4e4f534a, json), chunk(0x004e4942, bin)]);
}
