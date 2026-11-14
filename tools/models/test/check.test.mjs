// Tests for the GLB reader and the check script itself: each check must pass good input and
// fail bad input.
// Run: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as THREE from 'three';
import { exportGLB } from '../shared/model-io.mjs';
import { parseGLB, measureGLB } from '../shared/glb-reader.mjs';
import { box, plainMaterial, Part, assemble } from '../shared/geometry.mjs';
import {
  checkMeasurements,
  checkDescription,
  checkAgainstBrief,
  checkWithValidator,
  checkFolder,
  DEFAULT_DIR,
} from '../check-models.mjs';
import { BRIEF } from '../brief-figures.mjs';

// A 2 m x 3 m x 4 m box standing on the ground, centred on the origin.
function sampleScene() {
  const part = new Part('block').add(plainMaterial('grey', 0x888888), box([-1, 0, -2], [1, 3, 2]));
  return assemble('sample', [part]);
}

function sampleJson(overrides = {}) {
  return {
    id: 'sample',
    name: 'Sample',
    file: 'sample.glb',
    status: 'test',
    note: 'illustrative shape, built with SI/AI-written code',
    units: 'meters',
    dimensions_m: { width_x: 2, height_y: 3, depth_z: 4 },
    dimension_sources: ['width_x', 'height_y', 'depth_z'].map((dimension, i) => ({
      dimension,
      value_m: [2, 3, 4][i],
      source: 'test',
      status: 'test',
    })),
    triangles: 12,
    simplifications: ['test'],
    ...overrides,
  };
}

test('GLB reader: measures size, triangles and node boxes, applying node transforms', async () => {
  const scene = sampleScene();
  scene.children[0].position.set(5, 1, -2);
  scene.children[0].rotation.y = Math.PI / 2; // turns 2 x 4 into 4 x 2
  scene.children[0].scale.set(1, 2, 1);
  const measured = measureGLB(await exportGLB(scene));
  const expected = new THREE.Box3().setFromObject(scene);
  measured.box.min.forEach((v, i) => assert.ok(Math.abs(v - expected.min.getComponent(i)) < 1e-5));
  measured.box.max.forEach((v, i) => assert.ok(Math.abs(v - expected.max.getComponent(i)) < 1e-5));
  assert.equal(measured.triangles, 12);
  assert.ok(measured.nodes.block);
  assert.ok(Math.abs(measured.nodes.block.size[0] - 4) < 1e-5);
});

test('GLB reader: rejects a file that is not a GLB', () => {
  assert.throws(() => parseGLB(Buffer.from('this is not a glb file at all')), /magic/);
});

test('check: a correct model passes', async () => {
  const measured = measureGLB(await exportGLB(sampleScene()));
  assert.deepEqual(checkMeasurements(sampleJson(), measured), []);
  assert.deepEqual(checkDescription(sampleJson(), { fileBase: 'sample' }), []);
});

test('check: 0.5% off passes, 1.5% off fails', async () => {
  const measured = measureGLB(await exportGLB(sampleScene()));
  const ok = sampleJson({ dimensions_m: { width_x: 2 * 1.005, height_y: 3, depth_z: 4 } });
  assert.deepEqual(checkMeasurements(ok, measured), []);
  const bad = sampleJson({ dimensions_m: { width_x: 2, height_y: 3 * 1.015, depth_z: 4 } });
  const problems = checkMeasurements(bad, measured);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /height_y measures 3.000 m/);
});

test('check: triangle limit and triangle mismatch', async () => {
  const measured = measureGLB(await exportGLB(sampleScene()));
  assert.match(checkMeasurements(sampleJson({ triangles: 13 }), measured).join('\n'), /the .glb has 12 but the JSON says 13/);
  const over = { ...measured, triangles: 20000 };
  assert.match(checkMeasurements(sampleJson({ triangles: 20000 }), over).join('\n'), /not under the limit/);
  const under = { ...measured, triangles: 19999 };
  assert.deepEqual(checkMeasurements(sampleJson({ triangles: 19999 }), under), []);
});

test('check: model off the origin or off the ground fails', async () => {
  // Move the model's root group (a glTF scene itself has no transform, so the exporter would
  // drop a transform set on the Scene object).
  const lifted = sampleScene();
  lifted.children[0].position.y = 0.5;
  assert.match(checkMeasurements(sampleJson(), measureGLB(await exportGLB(lifted))).join('\n'), /lowest point/);
  const shifted = sampleScene();
  shifted.children[0].position.x = 0.5;
  assert.match(checkMeasurements(sampleJson(), measureGLB(await exportGLB(shifted))).join('\n'), /footprint centre/);
});

test('check: textures and vertex colours fail (plain colours only)', async () => {
  const measured = measureGLB(await exportGLB(sampleScene()));
  const textured = {
    ...measured,
    images: 1,
    textures: 1,
    materials: [{ name: 'x', pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }],
  };
  const problems = checkMeasurements(sampleJson(), textured).join('\n');
  assert.match(problems, /1 images/);
  assert.match(problems, /baseColorTexture/);

  const scene = sampleScene();
  scene.traverse((o) => {
    if (o.isMesh) {
      const count = o.geometry.attributes.position.count;
      o.geometry.setAttribute('color', new THREE.Float32BufferAttribute(new Array(count * 3).fill(0.5), 3));
      o.material.vertexColors = true;
    }
  });
  assert.match(checkMeasurements(sampleJson(), measureGLB(await exportGLB(scene))).join('\n'), /per-vertex colours/);
});

test('check: missing note, missing source and wrong file name fail', () => {
  assert.match(checkDescription(sampleJson({ note: 'built with code' })).join('\n'), /"note" must read exactly/);
  const noSource = sampleJson();
  noSource.dimension_sources = noSource.dimension_sources.slice(0, 2);
  assert.match(checkDescription(noSource).join('\n'), /no source given for depth_z/);
  assert.match(checkDescription(sampleJson(), { fileBase: 'other' }).join('\n'), /the file is other.json/);
});

test('check: JSON that disagrees with the brief fails', () => {
  const starship = sampleJson({
    id: 'starship-lander',
    status: 'NASA study',
    dimensions_m: { width_x: 9, height_y: 50, depth_z: 9 },
  });
  const { problems } = checkAgainstBrief(starship, BRIEF['starship-lander']);
  assert.match(problems.join('\n'), /status should be "NASA figure, secondary source"/);
  assert.match(problems.join('\n'), /height_y should be 52 m/);
  assert.match(checkAgainstBrief(sampleJson(), undefined).problems.join('\n'), /not one of the models/);
});

test('check: glTF validator catches a corrupted file', async () => {
  const bytes = await exportGLB(sampleScene());
  assert.deepEqual((await checkWithValidator(bytes, 'ok.glb')).problems, []);

  // Rewrite the JSON chunk with a wrong POSITION maximum (same length, so the layout stays valid).
  const { json } = parseGLB(bytes);
  const chunkLength = bytes.readUInt32LE(12);
  const accessor = json.accessors[json.meshes[0].primitives[0].attributes.POSITION];
  accessor.max = [accessor.max[0] + 1, accessor.max[1], accessor.max[2]];
  const text = JSON.stringify(json).padEnd(chunkLength, ' ');
  assert.ok(Buffer.byteLength(text) === chunkLength, 'test setup: JSON must keep its length');
  const broken = Buffer.from(bytes);
  broken.write(text, 20, 'utf8');
  const { problems } = await checkWithValidator(broken, 'broken.glb');
  assert.ok(problems.length > 0);
  assert.match(problems.join('\n'), /ACCESSOR_MAX_MISMATCH/);
});

test('check: folder with a .glb but no .json, or a missing brief model, fails', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'models-check-'));
  try {
    fs.copyFileSync(path.join(DEFAULT_DIR, 'griffin-lander.glb'), path.join(dir, 'griffin-lander.glb'));
    const all = await checkFolder(dir);
    assert.equal(all.failed, true);
    assert.match(all.folderProblems.join('\n'), /starship-lander: model from the brief is missing/);
    assert.match(all.folderProblems.join('\n'), /griffin-lander: has a .glb but no .json/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('check: the committed models pass', async () => {
  const { failed, results, folderProblems } = await checkFolder(DEFAULT_DIR);
  const problems = [...folderProblems, ...results.flatMap((r) => r.problems.map((p) => `${r.id}: ${p}`))];
  assert.equal(failed, false, problems.join('\n'));
  assert.equal(results.length, 5);
});
