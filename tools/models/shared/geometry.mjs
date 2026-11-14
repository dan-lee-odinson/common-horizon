// Small geometry toolkit used by the model scripts. Everything is in meters, Y up.
//
// The shapes are kept simple on purpose: revolved profiles (like a potter's wheel), boxes,
// cylinders and struts. Each helper returns a three.js BufferGeometry with only two
// attributes, "position" and "normal", plus an index. No texture coordinates are kept,
// because the models use plain colours only.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const Y_AXIS = new THREE.Vector3(0, 1, 0);

// Keep only position + normal so geometries from different helpers can be merged.
function clean(geometry) {
  for (const name of Object.keys(geometry.attributes)) {
    if (name !== 'position' && name !== 'normal') geometry.deleteAttribute(name);
  }
  if (!geometry.index) {
    const count = geometry.attributes.position.count;
    geometry.setIndex([...Array(count).keys()]);
  }
  geometry.clearGroups();
  return geometry;
}

/**
 * Revolve one smooth 2D profile around the Y axis.
 *
 * @param {Array<[number, number]>} profile  points as [radius, y]. Walk the profile so the
 *   outside of the surface is on your right: for a closed solid go from the axis at the
 *   bottom, out, up the side, and back in to the axis at the top.
 * @param {object} [options]
 * @param {number} [options.segments=64]  steps around the axis. Use a multiple of 4 so the
 *   widest points land exactly on the X and Z axes (the bounding box is then exact).
 * @returns {THREE.BufferGeometry}
 */
export function revolve(profile, { segments = 64 } = {}) {
  if (profile.length < 2) throw new Error('revolve() needs at least two profile points');
  if (segments % 4 !== 0) throw new Error('revolve() segments must be a multiple of 4');

  const positions = [];
  const normals = [];
  const indices = [];
  const n = profile.length;

  // Normal of the profile curve at each point, from its neighbours. In the (radius, y) plane
  // the outward normal of a direction (dr, dy) is (dy, -dr).
  const profileNormals = profile.map((_, i) => {
    const prev = profile[Math.max(i - 1, 0)];
    const next = profile[Math.min(i + 1, n - 1)];
    const dr = next[0] - prev[0];
    const dy = next[1] - prev[1];
    const length = Math.hypot(dr, dy);
    if (length === 0) throw new Error(`revolve(): repeated profile point at index ${i}`);
    return [dy / length, -dr / length];
  });

  // One ring of vertices per profile point. Angle 0 points along +Z, 90 degrees along +X
  // (the same convention as three.js's LatheGeometry).
  for (let i = 0; i < n; i++) {
    const [r, y] = profile[i];
    const [nr, ny] = profileNormals[i];
    for (let j = 0; j <= segments; j++) {
      const angle = (j / segments) * Math.PI * 2;
      const s = Math.sin(angle);
      const c = Math.cos(angle);
      positions.push(r * s, y, r * c);
      normals.push(nr * s, ny, nr * c);
    }
  }

  // Two triangles per quad, wound counter-clockwise when seen from outside. Where a ring sits
  // on the axis (radius 0) one of the two triangles would have zero area, so it is skipped.
  const row = segments + 1;
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < segments; j++) {
      const a = i * row + j;
      const b = i * row + j + 1;
      const c = (i + 1) * row + j + 1;
      const d = (i + 1) * row + j;
      if (profile[i][0] > 0) indices.push(a, b, c);
      if (profile[i + 1][0] > 0) indices.push(a, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setIndex(indices);
  return geometry;
}

/**
 * Revolve several profile runs and merge them. Use separate runs where the outline has a
 * sharp corner (for example where a flat bottom meets a straight side), so the shading
 * stays crisp at the corner.
 */
export function revolveRuns(runs, options) {
  return mergeGeometries(runs.map((run) => revolve(run, options)));
}

/** Axis-aligned box given its lowest and highest corners, [x, y, z] in meters. */
export function box(min, max) {
  const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  if (size.some((v) => !(v > 0))) throw new Error(`box(): max must be above min on every axis`);
  const geometry = new THREE.BoxGeometry(size[0], size[1], size[2]);
  geometry.translate((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
  return clean(geometry);
}

/**
 * Upright cylinder (or cone frustum) standing on y = bottom.
 * @param {object} o
 * @param {number} o.radius  radius at the bottom (and top, unless radiusTop is given)
 * @param {number} [o.radiusTop]
 * @param {number} o.bottom  y of the bottom face
 * @param {number} o.top     y of the top face
 * @param {number} [o.x=0]
 * @param {number} [o.z=0]
 * @param {number} [o.segments=32]  multiple of 4 keeps the bounding box exact
 * @param {boolean} [o.openEnded=false]
 */
export function cylinder({ radius, radiusTop = radius, bottom, top, x = 0, z = 0, segments = 32, openEnded = false }) {
  if (!(top > bottom)) throw new Error('cylinder(): top must be above bottom');
  const geometry = new THREE.CylinderGeometry(radiusTop, radius, top - bottom, segments, 1, openEnded);
  geometry.translate(x, (top + bottom) / 2, z);
  return clean(geometry);
}

/** Round bar between two points, used for legs, braces and booms. */
export function strut(from, to, radius, { segments = 12 } = {}) {
  const a = new THREE.Vector3(...from);
  const b = new THREE.Vector3(...to);
  const direction = new THREE.Vector3().subVectors(b, a);
  const length = direction.length();
  if (!(length > 0)) throw new Error('strut(): the two end points are the same');
  const geometry = new THREE.CylinderGeometry(radius, radius, length, segments, 1, false);
  const rotation = new THREE.Quaternion().setFromUnitVectors(Y_AXIS, direction.normalize());
  const middle = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
  geometry.applyMatrix4(new THREE.Matrix4().compose(middle, rotation, new THREE.Vector3(1, 1, 1)));
  return clean(geometry);
}

/** Sphere centred on [x, y, z]. */
export function sphere(center, radius, { widthSegments = 24, heightSegments = 12 } = {}) {
  const geometry = new THREE.SphereGeometry(radius, widthSegments, heightSegments);
  geometry.translate(center[0], center[1], center[2]);
  return clean(geometry);
}

/** Plain-colour material. Colours are sRGB hex values, e.g. 0xb9bec4. */
export function plainMaterial(name, color, { metalness = 0, roughness = 0.8 } = {}) {
  return new THREE.MeshStandardMaterial({ name, color, metalness, roughness });
}

/**
 * Collects the pieces of one part of a model (for example "landing-legs") and turns them into
 * a named group with one mesh per material. Merging pieces keeps the file small and simple.
 */
export class Part {
  constructor(name) {
    this.name = name;
    this.pieces = new Map(); // material -> geometries
  }

  add(material, ...geometries) {
    if (!this.pieces.has(material)) this.pieces.set(material, []);
    this.pieces.get(material).push(...geometries);
    return this;
  }

  toGroup() {
    const group = new THREE.Group();
    group.name = this.name;
    for (const [material, geometries] of this.pieces) {
      const merged = mergeGeometries(geometries.map(clean));
      if (!merged) throw new Error(`Part "${this.name}": could not merge geometries`);
      const mesh = new THREE.Mesh(merged, material);
      mesh.name = `${this.name}-${material.name}`;
      group.add(mesh);
    }
    return group;
  }
}

/** Build a scene: Scene > model group (named by id) > part groups > meshes. */
export function assemble(id, parts) {
  const scene = new THREE.Scene();
  scene.name = id;
  const root = new THREE.Group();
  root.name = id;
  for (const part of parts) root.add(part.toGroup());
  scene.add(root);
  return scene;
}
