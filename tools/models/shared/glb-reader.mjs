// A small, independent reader for binary glTF (.glb) files.
//
// The check script uses this instead of three.js on purpose: the models are written by
// three.js, so measuring them with separate code gives a second opinion. It reads the real
// vertex positions, applies each node's transform, and returns the bounding box, the
// triangle count and a few facts about materials.
//
// GLB layout (glTF 2.0 spec, section "Binary glTF Layout"):
//   12-byte header: magic "glTF", version 2, total length
//   then chunks: [length, type, data]; chunk 0 is JSON, chunk 1 (optional) is BIN.

const GLB_MAGIC = 0x46546c67; // "glTF"
const CHUNK_JSON = 0x4e4f534a; // "JSON"
const CHUNK_BIN = 0x004e4942; // "BIN\0"

const COMPONENT = {
  5120: { bytes: 1, read: (dv, o) => dv.getInt8(o) },
  5121: { bytes: 1, read: (dv, o) => dv.getUint8(o) },
  5122: { bytes: 2, read: (dv, o) => dv.getInt16(o, true) },
  5123: { bytes: 2, read: (dv, o) => dv.getUint16(o, true) },
  5125: { bytes: 4, read: (dv, o) => dv.getUint32(o, true) },
  5126: { bytes: 4, read: (dv, o) => dv.getFloat32(o, true) },
};
const TYPE_SIZE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
const MODE_TRIANGLES = 4;

/** Split a .glb into its JSON part and its binary part. */
export function parseGLB(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (u8.byteLength < 20) throw new Error('file is too short to be a GLB');
  if (dv.getUint32(0, true) !== GLB_MAGIC) throw new Error('not a GLB file (bad magic number)');
  if (dv.getUint32(4, true) !== 2) throw new Error('only glTF version 2 is supported');
  const length = dv.getUint32(8, true);
  if (length !== u8.byteLength) throw new Error(`GLB header says ${length} bytes, file has ${u8.byteLength}`);

  let offset = 12;
  let json = null;
  let bin = null;
  while (offset < length) {
    const chunkLength = dv.getUint32(offset, true);
    const chunkType = dv.getUint32(offset + 4, true);
    const start = offset + 8;
    const chunk = u8.subarray(start, start + chunkLength);
    if (chunkType === CHUNK_JSON && json === null) json = JSON.parse(new TextDecoder().decode(chunk));
    else if (chunkType === CHUNK_BIN && bin === null) bin = chunk;
    offset = start + chunkLength;
  }
  if (!json) throw new Error('GLB has no JSON chunk');
  return { json, bin };
}

/** Read an accessor into a plain array of numbers (itemSize values per element). */
export function readAccessor(gltf, bin, accessorIndex) {
  const accessor = gltf.accessors?.[accessorIndex];
  if (!accessor) throw new Error(`missing accessor ${accessorIndex}`);
  if (accessor.sparse) throw new Error('sparse accessors are not supported by this reader');
  const component = COMPONENT[accessor.componentType];
  const itemSize = TYPE_SIZE[accessor.type];
  if (!component || !itemSize) throw new Error(`unsupported accessor type in accessor ${accessorIndex}`);
  const values = new Array(accessor.count * itemSize);
  if (accessor.bufferView === undefined) return values.fill(0); // all zeros, per the spec

  const view = gltf.bufferViews[accessor.bufferView];
  if ((view.buffer ?? 0) !== 0 || !bin) throw new Error('only data inside the GLB BIN chunk is supported');
  const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const base = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const stride = view.byteStride ?? itemSize * component.bytes;
  for (let i = 0; i < accessor.count; i++) {
    for (let k = 0; k < itemSize; k++) {
      values[i * itemSize + k] = component.read(dv, base + i * stride + k * component.bytes);
    }
  }
  return values;
}

// ---- 4x4 matrices, column-major like glTF ----

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function multiply(a, b) {
  const out = new Array(16).fill(0);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + row] * b[col * 4 + k];
      out[col * 4 + row] = sum;
    }
  }
  return out;
}

function fromTRS(t = [0, 0, 0], q = [0, 0, 0, 1], s = [1, 1, 1]) {
  const [x, y, z, w] = q;
  const [sx, sy, sz] = s;
  return [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    t[0], t[1], t[2], 1,
  ];
}

function localMatrix(node) {
  if (node.matrix) return node.matrix;
  return fromTRS(node.translation, node.rotation, node.scale);
}

function emptyBox() {
  return { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
}

function finishBox(b) {
  const size = [0, 1, 2].map((i) => b.max[i] - b.min[i]);
  const center = [0, 1, 2].map((i) => (b.max[i] + b.min[i]) / 2);
  return { min: b.min, max: b.max, size, center };
}

/**
 * Measure a GLB file.
 * @returns {{
 *   box: {min:number[], max:number[], size:number[], center:number[]},
 *   triangles: number,
 *   nodes: Object<string, {min, max, size, center}>,  bounding box of every named node
 *   materials: object[], images: number, textures: number, samplers: number,
 *   vertexColors: boolean, nonTriangleModes: number[], gltf: object
 * }}
 */
export function measureGLB(bytes) {
  const { json: gltf, bin } = parseGLB(bytes);
  const sceneIndex = gltf.scene ?? 0;
  const scene = gltf.scenes?.[sceneIndex];
  if (!scene) throw new Error('GLB has no scene');

  const overall = emptyBox();
  const nodeBoxes = new Map(); // name -> box
  let triangles = 0;
  let vertexColors = false;
  const nonTriangleModes = [];
  const positionCache = new Map();

  const visit = (nodeIndex, parentMatrix, ancestors) => {
    const node = gltf.nodes[nodeIndex];
    const world = multiply(parentMatrix, localMatrix(node));
    const boxes = [...ancestors];
    if (node.name) {
      if (!nodeBoxes.has(node.name)) nodeBoxes.set(node.name, emptyBox());
      boxes.push(nodeBoxes.get(node.name));
    }
    if (node.mesh !== undefined) {
      for (const primitive of gltf.meshes[node.mesh].primitives) {
        const mode = primitive.mode ?? MODE_TRIANGLES;
        if (mode !== MODE_TRIANGLES) nonTriangleModes.push(mode);
        if (primitive.attributes.COLOR_0 !== undefined) vertexColors = true;
        const posIndex = primitive.attributes.POSITION;
        if (!positionCache.has(posIndex)) positionCache.set(posIndex, readAccessor(gltf, bin, posIndex));
        const positions = positionCache.get(posIndex);
        const vertexCount = positions.length / 3;
        const indexCount = primitive.indices !== undefined ? gltf.accessors[primitive.indices].count : vertexCount;
        if (mode === MODE_TRIANGLES) triangles += indexCount / 3;

        for (let i = 0; i < vertexCount; i++) {
          const x = positions[i * 3];
          const y = positions[i * 3 + 1];
          const z = positions[i * 3 + 2];
          const p = [
            world[0] * x + world[4] * y + world[8] * z + world[12],
            world[1] * x + world[5] * y + world[9] * z + world[13],
            world[2] * x + world[6] * y + world[10] * z + world[14],
          ];
          for (const b of [overall, ...boxes]) {
            for (let k = 0; k < 3; k++) {
              if (p[k] < b.min[k]) b.min[k] = p[k];
              if (p[k] > b.max[k]) b.max[k] = p[k];
            }
          }
        }
      }
    }
    for (const child of node.children ?? []) visit(child, world, boxes);
  };

  for (const root of scene.nodes ?? []) visit(root, IDENTITY, []);
  if (!Number.isFinite(overall.min[0])) throw new Error('GLB scene has no vertices');

  const nodes = {};
  for (const [name, b] of nodeBoxes) if (Number.isFinite(b.min[0])) nodes[name] = finishBox(b);

  return {
    box: finishBox(overall),
    triangles,
    nodes,
    materials: gltf.materials ?? [],
    images: gltf.images?.length ?? 0,
    textures: gltf.textures?.length ?? 0,
    samplers: gltf.samplers?.length ?? 0,
    vertexColors,
    nonTriangleModes,
    gltf,
  };
}
