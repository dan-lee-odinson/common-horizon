// Tests for the geometry helpers and for the surface direction of every model.
// Run: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { revolve, revolveRuns, box, strut } from '../shared/geometry.mjs';
import { countTriangles } from '../shared/model-io.mjs';
import { MODELS } from './models-list.mjs';

const near = (actual, expected, tolerance = 1e-6) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${expected}, got ${actual}`);

function sizeOf(geometry) {
  geometry.computeBoundingBox();
  return geometry.boundingBox.getSize(new THREE.Vector3()).toArray();
}

test('revolve() makes a closed cylinder with an exact bounding box', () => {
  const profile = [[0, 0], [2, 0]];
  const side = [[2, 0], [2, 3]];
  const top = [[2, 3], [0, 3]];
  const geometry = revolveRuns([profile, side, top], { segments: 16 });
  const [x, y, z] = sizeOf(geometry);
  near(x, 4);
  near(y, 3);
  near(z, 4);
  // bottom and top: one triangle per segment (they touch the axis); side: two per segment
  assert.equal(geometry.index.count / 3, 16 + 32 + 16);
});

test('revolve() rejects a segment count that is not a multiple of 4', () => {
  assert.throws(() => revolve([[0, 0], [1, 0]], { segments: 10 }), /multiple of 4/);
});

test('revolve() rejects repeated profile points', () => {
  assert.throws(() => revolve([[1, 0], [1, 0], [1, 1]]), /repeated profile point/);
});

test('box() and strut() land where asked', () => {
  const b = box([-1, 0, 2], [3, 0.5, 4]);
  b.computeBoundingBox();
  assert.deepEqual(b.boundingBox.min.toArray(), [-1, 0, 2]);
  assert.deepEqual(b.boundingBox.max.toArray(), [3, 0.5, 4]);
  const s = strut([0, 0, 0], [0, 5, 0], 0.1, { segments: 8 });
  const [, height] = sizeOf(s);
  near(height, 5, 1e-6);
});

// Every triangle must face the same way as its vertex normals. If a surface were wound the
// wrong way (inside out) it would disappear or look black in the browser.
function insideOutTriangles(object) {
  let bad = 0;
  let checked = 0;
  object.updateMatrixWorld(true);
  object.traverse((child) => {
    if (!child.isMesh) return;
    const pos = child.geometry.attributes.position;
    const nor = child.geometry.attributes.normal;
    const index = child.geometry.index;
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const n = new THREE.Vector3();
    for (let i = 0; i < index.count; i += 3) {
      const [ia, ib, ic] = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
      a.fromBufferAttribute(pos, ia);
      b.fromBufferAttribute(pos, ib);
      c.fromBufferAttribute(pos, ic);
      const face = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
      if (face.length() < 1e-10) continue; // zero-area triangle has no direction
      n.set(0, 0, 0);
      for (const k of [ia, ib, ic]) n.add(new THREE.Vector3().fromBufferAttribute(nor, k));
      checked++;
      if (face.dot(n) <= 0) bad++;
    }
  });
  return { bad, checked };
}

for (const { id, build } of MODELS) {
  test(`${id}: no inside-out triangles`, () => {
    const { scene } = build();
    const { bad, checked } = insideOutTriangles(scene);
    assert.ok(checked > 0);
    assert.equal(bad, 0, `${bad} of ${checked} triangles face the wrong way`);
  });

  test(`${id}: no zero-area triangles`, () => {
    const { scene } = build();
    let zero = 0;
    scene.traverse((child) => {
      if (!child.isMesh) return;
      const pos = child.geometry.attributes.position;
      const index = child.geometry.index;
      const tri = new THREE.Triangle();
      for (let i = 0; i < index.count; i += 3) {
        tri.setFromAttributeAndIndices(pos, index.getX(i), index.getX(i + 1), index.getX(i + 2));
        if (tri.getArea() < 1e-12) zero++;
      }
    });
    assert.equal(zero, 0, `${zero} of ${countTriangles(scene)} triangles have no area`);
  });
}
