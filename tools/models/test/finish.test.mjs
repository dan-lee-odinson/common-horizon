// Tests for finish-model.mjs: a raw file with textures, colours, a node transform, Z up and a
// loose bit comes out as one plain shape, Y up, at the published height, on the origin.
// Run: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { finishModel, readSpec } from '../finish-model.mjs';
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
  assert.deepEqual(readSpec(sampleSpec()), { targetHeight: 3, rotate: [-90, 0, 0], dropBelow: 0.2 });
});
