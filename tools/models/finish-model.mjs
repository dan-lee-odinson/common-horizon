// Turn a raw 3D file (an imported CAD export or an SI/AI-generated shape) into a finished model
// for the website: one plain shape at true scale, in the same frame as the code-built models.
//
//   node finish-model.mjs --input <raw.glb> --spec <spec.json> [--out-dir <folder>] [--dry-run]
//
// What it does, in this order:
//   1. reads every triangle of the raw .glb (with each node's transform applied) and keeps only
//      the shape: positions and surface directions (normals). Textures, images, UV coordinates,
//      per-vertex colours and all materials are dropped;
//   2. turns the shape by finishing.rotate_deg ([x, y, z] in degrees, applied X, then Y, then Z)
//      so that Y is up and the front of the vehicle faces +Z;
//   3. optionally drops loose pieces smaller than finishing.drop_loose_parts_below (a share of
//      all triangles; generated shapes sometimes carry small floating bits);
//   4. scales it evenly (same factor on every axis) so its height matches the published figure in
//      the spec's height_y entry, then moves it so it stands on the ground (lowest point y = 0)
//      with the centre of its footprint on the origin;
//   5. gives it one neutral material and writes <id>.glb and <id>.json into the output folder
//      (default web/public/models/). Sizes, triangle count and the finishing record in the JSON
//      are measured from the finished shape; everything else is copied from the spec.
//
// The spec has the same layout as the finished JSON, without the measured fields, so a finished
// JSON can be passed back in as --spec to repeat the step: same raw file, same bytes out.
// It refuses to write a model with 20,000 triangles or more. Check the result with
// `node check-models.mjs <id>`.

import './shared/node-shims.mjs';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import * as THREE from 'three';
import { parseGLB, readAccessor } from './shared/glb-reader.mjs';
import { exportGLB, isMain } from './shared/model-io.mjs';
import { OUTPUT_DIR, TRIANGLE_LIMIT, FRAME_DESCRIPTION, MODEL_NOTES } from './shared/constants.mjs';

export const NEUTRAL_COLOUR = 0xbdbdb8; // light warm grey, the same for every finished model
const DIMENSIONS = ['width_x', 'height_y', 'depth_z'];
const MODE_TRIANGLES = 4;
// Extensions that only change how the raw file is coloured or textured; we drop those anyway.
const IGNORABLE_EXTENSIONS = /^(EXT_texture_webp|KHR_texture_basisu|KHR_texture_transform|KHR_materials_\w+)$/;

const round = (value, places) => Number(value.toFixed(places));

/** 4x4 column-major matrix product a * b (glTF layout). */
function multiply(a, b) {
  return new THREE.Matrix4().fromArray(a).multiply(new THREE.Matrix4().fromArray(b)).toArray();
}

function localMatrix(node) {
  if (node.matrix) return node.matrix;
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(...(node.translation ?? [0, 0, 0])),
    new THREE.Quaternion(...(node.rotation ?? [0, 0, 0, 1])),
    new THREE.Vector3(...(node.scale ?? [1, 1, 1])),
  );
  return m.toArray();
}

/**
 * Read every triangle of a GLB into one list, in world coordinates.
 * @returns {{positions: number[], normals: number[]|null, indices: number[], triangles: number}}
 */
export function readRawShape(bytes) {
  const { json: gltf, bin } = parseGLB(bytes);
  const blocking = (gltf.extensionsRequired ?? []).filter((e) => !IGNORABLE_EXTENSIONS.test(e));
  if (blocking.length > 0) {
    throw new Error(`the raw file needs ${blocking.join(', ')}, which this script cannot read; export it without compression`);
  }
  const scene = gltf.scenes?.[gltf.scene ?? 0];
  if (!scene) throw new Error('the raw file has no scene');

  const positions = [];
  const normals = [];
  const indices = [];
  let allHaveNormals = true;

  const visit = (nodeIndex, parent) => {
    const node = gltf.nodes[nodeIndex];
    const world = multiply(parent, localMatrix(node));
    if (node.mesh !== undefined) {
      const matrix = new THREE.Matrix4().fromArray(world);
      const normalMatrix = new THREE.Matrix3().getNormalMatrix(matrix);
      const flip = matrix.determinant() < 0;
      for (const primitive of gltf.meshes[node.mesh].primitives) {
        const mode = primitive.mode ?? MODE_TRIANGLES;
        if (mode !== MODE_TRIANGLES) throw new Error(`the raw file has a primitive that is not triangles (mode ${mode})`);
        const accessor = gltf.accessors[primitive.attributes.POSITION];
        if (accessor.componentType !== 5126) throw new Error('positions must be plain 32-bit floats (no quantization)');
        const pos = readAccessor(gltf, bin, primitive.attributes.POSITION);
        const nrm = primitive.attributes.NORMAL !== undefined ? readAccessor(gltf, bin, primitive.attributes.NORMAL) : null;
        if (!nrm) allHaveNormals = false;
        const base = positions.length / 3;
        const v = new THREE.Vector3();
        for (let i = 0; i < pos.length / 3; i++) {
          v.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]).applyMatrix4(matrix);
          positions.push(v.x, v.y, v.z);
          if (nrm) {
            v.set(nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2]).applyMatrix3(normalMatrix).normalize();
            normals.push(v.x, v.y, v.z);
          } else {
            normals.push(0, 0, 0);
          }
        }
        const idx = primitive.indices !== undefined
          ? readAccessor(gltf, bin, primitive.indices)
          : Array.from({ length: pos.length / 3 }, (_, i) => i);
        for (let t = 0; t < idx.length; t += 3) {
          if (flip) indices.push(base + idx[t], base + idx[t + 2], base + idx[t + 1]);
          else indices.push(base + idx[t], base + idx[t + 1], base + idx[t + 2]);
        }
      }
    }
    for (const child of node.children ?? []) visit(child, world);
  };
  const identity = new THREE.Matrix4().toArray();
  for (const root of scene.nodes ?? []) visit(root, identity);
  if (indices.length === 0) throw new Error('the raw file has no triangles');
  return { positions, normals: allHaveNormals ? normals : null, indices, triangles: indices.length / 3 };
}

/** Group triangles into connected pieces (vertices at the same place count as joined). */
export function connectedPieces(positions, indices) {
  const key = new Map();
  const canonical = new Int32Array(positions.length / 3);
  for (let i = 0; i < canonical.length; i++) {
    const k = `${Math.round(positions[i * 3] * 1e5)},${Math.round(positions[i * 3 + 1] * 1e5)},${Math.round(positions[i * 3 + 2] * 1e5)}`;
    if (!key.has(k)) key.set(k, i);
    canonical[i] = key.get(k);
  }
  const parent = new Int32Array(canonical.length).map((_, i) => i);
  const find = (x) => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const join = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };
  for (let t = 0; t < indices.length; t += 3) {
    join(canonical[indices[t]], canonical[indices[t + 1]]);
    join(canonical[indices[t]], canonical[indices[t + 2]]);
  }
  const pieceOf = new Int32Array(indices.length / 3);
  for (let t = 0; t < pieceOf.length; t++) pieceOf[t] = find(canonical[indices[t * 3]]);
  return pieceOf;
}

/** Keep only the listed triangles and the vertices they use. */
function compact(shape, keepTriangle) {
  const remap = new Map();
  const positions = [];
  const normals = shape.normals ? [] : null;
  const indices = [];
  for (let t = 0; t < shape.indices.length / 3; t++) {
    if (!keepTriangle(t)) continue;
    for (let k = 0; k < 3; k++) {
      const old = shape.indices[t * 3 + k];
      if (!remap.has(old)) {
        remap.set(old, positions.length / 3);
        positions.push(shape.positions[old * 3], shape.positions[old * 3 + 1], shape.positions[old * 3 + 2]);
        if (normals) normals.push(shape.normals[old * 3], shape.normals[old * 3 + 1], shape.normals[old * 3 + 2]);
      }
      indices.push(remap.get(old));
    }
  }
  return { positions, normals, indices, triangles: indices.length / 3 };
}

function boundsOf(positions) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      if (positions[i + k] < min[k]) min[k] = positions[i + k];
      if (positions[i + k] > max[k]) max[k] = positions[i + k];
    }
  }
  return { min, max, size: [0, 1, 2].map((k) => max[k] - min[k]) };
}

/** Read and check the parts of the spec the finishing step needs. */
export function readSpec(spec) {
  const problems = [];
  if (typeof spec.id !== 'string' || !/^[a-z0-9-]+$/.test(spec.id)) problems.push('"id" must be lower-case letters, digits and dashes');
  if (!['imported', 'generated'].includes(spec.kind)) problems.push('"kind" must be "imported" or "generated" (code-built models have their own scripts)');
  const sources = Array.isArray(spec.dimension_sources) ? spec.dimension_sources : [];
  const height = sources.find((s) => s.dimension === 'height_y');
  if (!height || !(height.value_m > 0)) problems.push('the height_y entry in "dimension_sources" needs the published height in value_m');
  const rotate = spec.finishing?.rotate_deg ?? [0, 0, 0];
  if (!Array.isArray(rotate) || rotate.length !== 3 || !rotate.every(Number.isFinite)) problems.push('"finishing.rotate_deg" must be [x, y, z] in degrees');
  const dropBelow = spec.finishing?.drop_loose_parts_below ?? 0;
  if (!(dropBelow >= 0 && dropBelow < 0.5)) problems.push('"finishing.drop_loose_parts_below" must be a share between 0 and 0.5');
  if (problems.length > 0) throw new Error(`spec: ${problems.join('; ')}`);
  return { targetHeight: height.value_m, rotate, dropBelow };
}

/** Steps 2 to 4: turn, drop loose bits, scale to the published height, stand on the origin. */
export function finishShape(raw, { targetHeight, rotate, dropBelow }) {
  let shape = { ...raw, positions: [...raw.positions], normals: raw.normals ? [...raw.normals] : null };

  const turn = new THREE.Matrix4().makeRotationFromEuler(
    new THREE.Euler(...rotate.map((d) => THREE.MathUtils.degToRad(d)), 'XYZ'),
  );
  const v = new THREE.Vector3();
  for (let i = 0; i < shape.positions.length; i += 3) {
    v.fromArray(shape.positions, i).applyMatrix4(turn).toArray(shape.positions, i);
    if (shape.normals) v.fromArray(shape.normals, i).transformDirection(turn).toArray(shape.normals, i);
  }

  let removed = { pieces: 0, triangles: 0 };
  if (dropBelow > 0) {
    const pieceOf = connectedPieces(shape.positions, shape.indices);
    const counts = new Map();
    for (const p of pieceOf) counts.set(p, (counts.get(p) ?? 0) + 1);
    const limit = dropBelow * pieceOf.length;
    const small = new Set([...counts].filter(([, n]) => n < limit).map(([p]) => p));
    removed = { pieces: small.size, triangles: [...small].reduce((sum, p) => sum + counts.get(p), 0) };
    shape = compact(shape, (t) => !small.has(pieceOf[t]));
  } else {
    shape = compact(shape, () => true);
  }

  const before = boundsOf(shape.positions);
  const scale = targetHeight / before.size[1];
  const shift = [-(before.min[0] + before.max[0]) / 2, -before.min[1], -(before.min[2] + before.max[2]) / 2];
  for (let i = 0; i < shape.positions.length; i += 3) {
    for (let k = 0; k < 3; k++) shape.positions[i + k] = (shape.positions[i + k] + shift[k]) * scale;
  }
  return { shape, scale, removed };
}

/** Step 5a: the finished shape as a three.js scene with one neutral material. */
export function buildScene(id, shape) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(shape.positions, 3));
  if (shape.normals) geometry.setAttribute('normal', new THREE.Float32BufferAttribute(shape.normals, 3));
  geometry.setIndex(shape.indices);
  if (!shape.normals) geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({ name: 'neutral', color: NEUTRAL_COLOUR, metalness: 0, roughness: 0.8 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = `${id}-shape`;
  const root = new THREE.Group();
  root.name = id;
  root.add(mesh);
  const scene = new THREE.Scene();
  scene.name = id;
  scene.add(root);
  return scene;
}

/** Step 5b: the finished JSON, in a fixed order, measured fields filled in. */
export function describeFinished(spec, { size, triangles, scale, removed, input }) {
  const dims = {
    width_x: round(size[0], 3),
    height_y: spec.dimension_sources.find((s) => s.dimension === 'height_y').value_m,
    depth_z: round(size[2], 3),
  };
  const defaultMeaning = {
    width_x: 'overall width (X) of the finished shape',
    depth_z: 'overall depth (Z, front to back) of the finished shape',
  };
  const dimensionSources = DIMENSIONS.map((dim) => {
    const given = spec.dimension_sources.find((s) => s.dimension === dim) ?? { dimension: dim };
    if (dim === 'height_y') return given;
    const entry = {
      dimension: dim,
      value_m: dims[dim],
      meaning: given.meaning ?? defaultMeaning[dim],
      source: given.source ?? 'measured on the finished shape, after scaling it evenly to the published height',
      status: given.status ?? 'our estimate',
    };
    if (given.published) {
      entry.published = given.published;
      entry.difference_percent = round(((dims[dim] - given.published.value_m) / given.published.value_m) * 100, 1);
    }
    return entry;
  });
  const provenance = spec.kind === 'imported' ? { source: spec.source } : { generation: spec.generation };
  return {
    id: spec.id,
    name: spec.name,
    file: `${spec.id}.glb`,
    kind: spec.kind,
    status: spec.status,
    note: MODEL_NOTES[spec.kind],
    units: 'meters',
    frame: FRAME_DESCRIPTION,
    dimensions_m: dims,
    dimension_sources: dimensionSources,
    ...provenance,
    triangles,
    triangle_limit: TRIANGLE_LIMIT,
    simplifications: spec.simplifications,
    finishing: {
      rotate_deg: spec.finishing?.rotate_deg ?? [0, 0, 0],
      drop_loose_parts_below: spec.finishing?.drop_loose_parts_below ?? 0,
      input_file: input.name,
      input_sha256: input.sha256,
      input_triangles: input.triangles,
      removed_loose_parts: removed,
      scale_factor: round(scale, 6),
      material: 'one neutral material; every texture, image, UV coordinate, per-vertex colour and original material removed',
    },
    built_by: 'tools/models/finish-model.mjs',
  };
}

/** The whole step. Returns what was written (or would be, with dryRun). */
export async function finishModel({ input, spec, outDir = OUTPUT_DIR, dryRun = false }) {
  const bytes = fs.readFileSync(input);
  const raw = readRawShape(bytes);
  const settings = readSpec(spec);
  const { shape, scale, removed } = finishShape(raw, settings);
  const triangles = shape.indices.length / 3;
  const size = boundsOf(shape.positions).size;
  const description = describeFinished(spec, {
    size,
    triangles,
    scale,
    removed,
    input: { name: path.basename(input), sha256: crypto.createHash('sha256').update(bytes).digest('hex'), triangles: raw.triangles },
  });
  const summary =
    `${spec.id}: ${size.map((x) => x.toFixed(3)).join(' x ')} m (x, y, z), ${triangles} triangles ` +
    `(raw ${raw.triangles}, ${removed.pieces} loose pieces with ${removed.triangles} triangles dropped), scale x${scale.toFixed(4)}`;
  if (triangles >= TRIANGLE_LIMIT) {
    throw new Error(`${summary}\nrefused: ${triangles} triangles is not under the limit of ${TRIANGLE_LIMIT}`);
  }
  if (dryRun) return { description, summary, written: false };

  const glb = await exportGLB(buildScene(spec.id, shape));
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, `${spec.id}.glb`), glb);
  fs.writeFileSync(path.join(outDir, `${spec.id}.json`), `${JSON.stringify(description, null, 2)}\n`);
  return { description, summary: `${summary}, ${glb.length} bytes`, written: true };
}

async function main() {
  const { values } = parseArgs({
    options: {
      input: { type: 'string' },
      spec: { type: 'string' },
      'out-dir': { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
    },
  });
  if (!values.input || !values.spec) {
    console.error('usage: node finish-model.mjs --input <raw.glb> --spec <spec.json> [--out-dir <folder>] [--dry-run]');
    process.exitCode = 2;
    return;
  }
  const spec = JSON.parse(fs.readFileSync(values.spec, 'utf8'));
  const outDir = path.resolve(values['out-dir'] ?? OUTPUT_DIR);
  const result = await finishModel({ input: values.input, spec, outDir, dryRun: values['dry-run'] });
  console.log(result.summary);
  console.log(result.written ? `wrote ${spec.id}.glb and ${spec.id}.json in ${outDir}` : 'dry run: nothing written');
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
