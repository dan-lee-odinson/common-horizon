// Tests for the model scripts: sizes, frame, triangle budget, parameters, repeatable output.
// Run: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countTriangles, measureObject, describeModel, exportGLB } from '../shared/model-io.mjs';
import { measureGLB } from '../shared/glb-reader.mjs';
import { MODELS, solar } from './models-list.mjs';

const near = (actual, expected, tolerance, label) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: expected ${expected}, got ${actual}`);

for (const { id, build } of MODELS) {
  test(`${id}: built shape matches its declared size and sits on the origin`, () => {
    const { scene, spec } = build();
    const { min, max, size } = measureObject(scene);
    const d = spec.dimensions_m;
    near(size[0], d.width_x, 1e-6, 'width_x');
    near(size[1], d.height_y, 1e-6, 'height_y');
    near(size[2], d.depth_z, 1e-6, 'depth_z');
    near(min[1], 0, 1e-6, 'ground');
    near((min[0] + max[0]) / 2, 0, 1e-6, 'centre x');
    near((min[2] + max[2]) / 2, 0, 1e-6, 'centre z');
  });

  test(`${id}: under 20,000 triangles`, () => {
    const { scene } = build();
    assert.ok(countTriangles(scene) < 20000);
  });

  test(`${id}: JSON description has the note and a source for each size`, () => {
    const { scene, spec } = build();
    const json = describeModel(spec, countTriangles(scene));
    assert.equal(json.note, 'illustrative shape, built with SI/AI-written code');
    assert.equal(json.units, 'meters');
    for (const dim of ['width_x', 'height_y', 'depth_z']) {
      const entry = json.dimension_sources.find((s) => s.dimension === dim);
      assert.ok(entry, `no source for ${dim}`);
      assert.equal(entry.value_m, json.dimensions_m[dim]);
      assert.ok(entry.source.length > 0 && entry.status.length > 0);
    }
  });

  test(`${id}: exporting twice gives identical bytes`, async () => {
    const first = await exportGLB(build().scene);
    const second = await exportGLB(build().scene);
    assert.ok(first.equals(second));
  });

  test(`${id}: independent GLB reader agrees with three.js`, async () => {
    const { scene } = build();
    const measured = measureGLB(await exportGLB(scene));
    const { size } = measureObject(scene);
    measured.box.size.forEach((v, i) => near(v, size[i], 1e-5, `axis ${i}`));
    assert.equal(measured.triangles, countTriangles(scene));
  });
}

test('solar-array-mast: height and panel width parameters change the shape', () => {
  const { scene, spec } = solar.build({ height: 12, panelWidth: 5 });
  const { size } = measureObject(scene);
  near(size[0], 5, 1e-6, 'width');
  near(size[1], 12, 1e-6, 'height');
  near(size[2], 2, 1e-6, 'depth');
  assert.deepEqual(spec.dimensions_m, { width_x: 5, height_y: 12, depth_z: 2 });
  assert.deepEqual(spec.parameters.defaults, { height_m: 10, panel_width_m: 4 });
});

test('solar-array-mast: defaults are 10 m and 4 m', () => {
  const { spec } = solar.build();
  assert.equal(spec.parameters.height_m, 10);
  assert.equal(spec.parameters.panel_width_m, 4);
});

test('solar-array-mast: a panel narrower than the base leaves the base as the width', () => {
  const { scene, spec } = solar.build({ panelWidth: 1 });
  near(measureObject(scene).size[0], 2, 1e-6, 'width');
  assert.equal(spec.dimensions_m.width_x, 2);
});

test('solar-array-mast: rejects impossible parameters', () => {
  assert.throws(() => solar.build({ height: 1 }), /height/);
  assert.throws(() => solar.build({ panelWidth: 0 }), /panel width/);
  assert.throws(() => solar.build({ height: Number.NaN }), /height/);
});
