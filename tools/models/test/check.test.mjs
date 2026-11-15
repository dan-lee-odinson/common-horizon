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
    kind: 'code-built',
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
  // A small offset fails too: the rule is 1 mm, not a share of the model's size.
  const nudged = sampleScene();
  nudged.children[0].position.set(0, 0, 0.005);
  assert.match(checkMeasurements(sampleJson(), measureGLB(await exportGLB(nudged))).join('\n'), /footprint centre/);
  const almost = sampleScene();
  almost.children[0].position.set(0.0005, 0, 0);
  assert.deepEqual(checkMeasurements(sampleJson(), measureGLB(await exportGLB(almost))), []);
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
  assert.match(checkDescription(sampleJson({ note: 'built with code' })).join('\n'), /"note" for a code-built model must read exactly/);
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
  assert.equal(results.length, Object.keys(BRIEF).length);
});

test('check: solar array mast built with non-default sizes fails the brief check', () => {
  const json = sampleJson({
    id: 'solar-array-mast',
    status: BRIEF['solar-array-mast'].status,
    dimensions_m: { width_x: 5, height_y: 12, depth_z: 2 },
    parameters: { height_m: 12, panel_width_m: 5, defaults: { height_m: 10, panel_width_m: 4 } },
  });
  const { problems } = checkAgainstBrief(json, BRIEF['solar-array-mast']);
  assert.match(problems.join('\n'), /built with height_m = 12, not the default 10/);
  assert.match(problems.join('\n'), /built with panel_width_m = 5, not the default 4/);
});

// ---- Kinds of model: code-built, imported, generated (each with its own exact note) ----

const NOTES = {
  'code-built': 'illustrative shape, built with SI/AI-written code',
  imported: "illustrative shape from a community CAD model; not the manufacturer's data",
  generated: "illustrative shape, SI/AI-generated from a photo; not the manufacturer's data",
};

function importedJson(overrides = {}) {
  return sampleJson({
    kind: 'imported',
    note: NOTES.imported,
    source: { author: 'A. Author', url: 'https://example.org/model', terms: 'public-document terms' },
    ...overrides,
  });
}

function generatedJson(generationOverrides = {}, overrides = {}) {
  return sampleJson({
    kind: 'generated',
    note: NOTES.generated,
    generation: {
      picture: { credit: 'A. Photographer' },
      model: 'TRELLIS.2',
      service: 'fal.ai',
      request_id: '00000000-0000-0000-0000-000000000000',
      date: '2026-11-15',
      ...generationOverrides,
    },
    ...overrides,
  });
}

test("check: each kind passes with its own note and fails with another kind's note", () => {
  assert.deepEqual(checkDescription(sampleJson()), []);
  assert.deepEqual(checkDescription(importedJson()), []);
  assert.deepEqual(checkDescription(generatedJson()), []);
  assert.match(checkDescription(importedJson({ note: NOTES['code-built'] })).join('\n'), /"note" for an imported model must read exactly/);
  assert.match(checkDescription(generatedJson({}, { note: NOTES.imported })).join('\n'), /"note" for a generated model must read exactly/);
  assert.match(checkDescription(sampleJson({ note: NOTES.generated })).join('\n'), /"note" for a code-built model/);
});

test('check: a missing or unknown kind fails', () => {
  assert.match(checkDescription(sampleJson({ kind: undefined })).join('\n'), /"kind" must be one of code-built, imported, generated/);
  assert.match(checkDescription(sampleJson({ kind: 'scanned' })).join('\n'), /"kind" must be one of/);
});

test('check: an imported model must name the author, the source address and the terms', () => {
  assert.match(checkDescription(importedJson({ source: undefined })).join('\n'), /needs a "source"/);
  const noAuthor = importedJson();
  delete noAuthor.source.author;
  assert.match(checkDescription(noAuthor).join('\n'), /source\.author/);
  assert.match(checkDescription(importedJson({ source: { author: 'A', url: 'example.org', terms: 't' } })).join('\n'), /source\.url/);
  assert.match(checkDescription(importedJson({ source: { author: 'A', url: 'https://x.org', terms: ' ' } })).join('\n'), /source\.terms/);
});

test('check: a generated model must name the picture credit, TRELLIS.2, the service, the request id and the date', () => {
  assert.match(checkDescription(generatedJson({ picture: {} })).join('\n'), /picture\.credit/);
  assert.match(checkDescription(generatedJson({ model: 'Other3D' })).join('\n'), /"generation\.model" must be "TRELLIS\.2"/);
  assert.match(checkDescription(generatedJson({ service: '' })).join('\n'), /generation\.service/);
  assert.match(checkDescription(generatedJson({ request_id: undefined })).join('\n'), /generation\.request_id/);
  assert.match(checkDescription(generatedJson({ date: '15 Nov 2026' })).join('\n'), /generation\.date/);
  assert.match(checkDescription(generatedJson({}, { generation: undefined })).join('\n'), /needs a "generation" record/);
  assert.deepEqual(checkDescription(generatedJson({ cleanup: { model: 'Nano Banana 2', request_id: 'abc' } })), []);
  assert.match(checkDescription(generatedJson({ cleanup: { model: 'Other image model', request_id: 'abc' } })).join('\n'), /must name "Nano Banana 2"/);
});

test('check: the brief fixes the kind, the author, the picture credit and a fixed triangle count', () => {
  const brief = { kind: 'imported', status: 'test', author: 'A. Author', triangles: 12 };
  assert.deepEqual(checkAgainstBrief(importedJson(), brief).problems, []);
  assert.match(checkAgainstBrief(importedJson({ triangles: 13 }), brief).problems.join('\n'), /should have 12 triangles/);
  assert.match(checkAgainstBrief(importedJson({ source: { author: 'B', url: 'https://x', terms: 't' } }), brief).problems.join('\n'), /author should be A\. Author/);
  assert.match(checkAgainstBrief(generatedJson(), brief).problems.join('\n'), /kind should be "imported"/);
  const genBrief = { kind: 'generated', status: 'test', picture_credit: 'A. Photographer' };
  assert.deepEqual(checkAgainstBrief(generatedJson(), genBrief).problems, []);
  assert.match(checkAgainstBrief(generatedJson({ picture: { credit: 'Someone else' } }), genBrief).problems.join('\n'), /picture credit should name A\. Photographer/);
});

test('check: the source address must be a real https address and the date a real date', () => {
  for (const url of ['https://[', 'https:///', 'https://"><x>', 'https://%%', 'https://localhost', 'http://example.org/x', 'https://exa mple.org']) {
    assert.match(checkDescription(importedJson({ source: { author: 'A', url, terms: 't' } })).join('\n'), /source\.url/, url);
  }
  assert.deepEqual(checkDescription(importedJson({ source: { author: 'A', url: 'https://cad.example.org/documents/1', terms: 't' } })), []);
  for (const date of ['2026-99-99', '0000-00-00', '2026-02-30']) {
    assert.match(checkDescription(generatedJson({ date })).join('\n'), /generation\.date/, date);
  }
});

test('check: a published figure beside a size needs a number, a source, a status and the difference', () => {
  const json = sampleJson();
  json.dimension_sources[0].published = { value_m: 2, source: 's', status: 't' };
  json.dimension_sources[0].difference_percent = 0;
  assert.deepEqual(checkDescription(json), []);
  json.dimension_sources[0].published = { value_m: '2', source: 's', status: 't' };
  assert.match(checkDescription(json).join('\n'), /published figure beside width_x/);
  json.dimension_sources[0].published = { value_m: 2, source: 's', status: 't' };
  delete json.dimension_sources[0].difference_percent;
  assert.match(checkDescription(json).join('\n'), /no difference_percent/);
});

test('check: the brief\'s author and picture credit must start the field, not just appear in it', () => {
  const brief = { kind: 'imported', status: 'test', author: 'A. Author' };
  assert.match(checkAgainstBrief(importedJson({ source: { author: 'not A. Author', url: 'https://x.org', terms: 't' } }), brief).problems.join('\n'), /author should be A\. Author/);
  const genBrief = { kind: 'generated', status: 'test', picture_credit: 'A. Photographer' };
  assert.deepEqual(checkAgainstBrief(generatedJson({ picture: { credit: 'A. Photographer (own photo)' } }), genBrief).problems, []);
});
