// Writing a model to disk: the .glb file (3D shape) and the .json file beside it (facts).

import './node-shims.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { OUTPUT_DIR, TRIANGLE_LIMIT, SI_AI_NOTE, FRAME_DESCRIPTION } from './constants.mjs';

/** Number of triangles in every mesh under `object`. */
export function countTriangles(object) {
  let total = 0;
  object.updateMatrixWorld(true);
  object.traverse((child) => {
    if (!child.isMesh) return;
    const geometry = child.geometry;
    const count = geometry.index ? geometry.index.count : geometry.attributes.position.count;
    total += count / 3;
  });
  return total;
}

/** Bounding box of `object` measured by three.js (used by the build and the unit tests). */
export function measureObject(object) {
  object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object);
  return {
    min: box.min.toArray(),
    max: box.max.toArray(),
    size: box.getSize(new THREE.Vector3()).toArray(),
  };
}

/** Convert a three.js scene into GLB bytes (a Node Buffer). */
export async function exportGLB(scene) {
  const exporter = new GLTFExporter();
  const arrayBuffer = await exporter.parseAsync(scene, { binary: true, onlyVisible: true });
  return Buffer.from(arrayBuffer);
}

/**
 * Put the JSON fields in a fixed, readable order. `spec` comes from the model script;
 * the triangle count is measured from the geometry that was actually built.
 */
export function describeModel(spec, triangles) {
  return {
    id: spec.id,
    name: spec.name,
    file: `${spec.id}.glb`,
    kind: 'code-built',
    status: spec.status,
    note: SI_AI_NOTE,
    units: 'meters',
    frame: FRAME_DESCRIPTION,
    dimensions_m: {
      width_x: spec.dimensions_m.width_x,
      height_y: spec.dimensions_m.height_y,
      depth_z: spec.dimensions_m.depth_z,
    },
    dimension_sources: spec.dimension_sources,
    ...(spec.parts ? { parts: spec.parts } : {}),
    ...(spec.parameters ? { parameters: spec.parameters } : {}),
    triangles,
    triangle_limit: TRIANGLE_LIMIT,
    simplifications: spec.simplifications,
    built_by: spec.built_by,
  };
}

/**
 * Export a built model: writes <id>.glb and <id>.json into the output folder.
 * @param {{scene: THREE.Scene, spec: object}} model  what a model script's build() returns
 */
export async function writeModel({ scene, spec }, { outDir = OUTPUT_DIR } = {}) {
  const triangles = countTriangles(scene);
  if (triangles > TRIANGLE_LIMIT) {
    // Still written, so the check script can report it; but warn loudly here too.
    console.warn(`WARNING ${spec.id}: ${triangles} triangles is over the ${TRIANGLE_LIMIT} limit`);
  }
  const glb = await exportGLB(scene);
  const description = describeModel(spec, triangles);

  fs.mkdirSync(outDir, { recursive: true });
  const glbPath = path.join(outDir, `${spec.id}.glb`);
  const jsonPath = path.join(outDir, `${spec.id}.json`);
  fs.writeFileSync(glbPath, glb);
  fs.writeFileSync(jsonPath, `${JSON.stringify(description, null, 2)}\n`);

  const { size } = measureObject(scene);
  console.log(
    `${spec.id}: ${size.map((v) => v.toFixed(3)).join(' x ')} m (x, y, z), ` +
      `${triangles} triangles, ${glb.length} bytes -> ${path.relative(process.cwd(), glbPath)}`,
  );
  return { glbPath, jsonPath, triangles, bytes: glb.length };
}

/** True when the module at `importMetaUrl` was started directly with `node file.mjs`. */
export function isMain(importMetaUrl) {
  return Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(importMetaUrl);
}
