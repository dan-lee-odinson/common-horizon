// The hardware models' shapes: loaded on demand with three's own GLTFLoader from the files served
// with the app (public/models/*.glb), and prepared for the site scene.
//
// TRUE SCALE. One model unit is one metre and nothing here scales a shape. A shape is accepted only
// if it is as tall as its description says (to one part in a hundred) and stands on the ground;
// otherwise the item is treated as having no shape and is not drawn, so the picture can never show
// hardware at a size the hardware list does not state.
//
// Loading never throws and never suspends: a file that is missing or cannot be read resolves to
// null, and the scene carries on without that item.

import * as THREE from 'three';
import { modelUrl } from '../state/models';
import { shapeMatches } from './siteLayout';

export interface ModelPart {
  geometry: THREE.BufferGeometry;
  material: THREE.MeshLambertMaterial;
}

export interface LoadedModel {
  /** The model's parts, merged so there is one for each of its colours. Metres; the lowest point is y = 0. */
  parts: ModelPart[];
  /** Every triangle of the model as one shape with positions only: what casts the shadow. */
  shadow: THREE.BufferGeometry;
}

/** Joins shapes into one. Positions always; normals when asked for. */
function merge(shapes: THREE.BufferGeometry[], withNormals: boolean): THREE.BufferGeometry {
  let vertices = 0;
  let corners = 0;
  for (const g of shapes) {
    const count = g.getAttribute('position').count;
    vertices += count;
    corners += g.index ? g.index.count : count;
  }
  const position = new Float32Array(vertices * 3);
  const normal = withNormals ? new Float32Array(vertices * 3) : null;
  const index = vertices > 65535 ? new Uint32Array(corners) : new Uint16Array(corners);
  let v = 0;
  let c = 0;
  for (const g of shapes) {
    const p = g.getAttribute('position');
    const n = normal ? g.getAttribute('normal') : null;
    for (let k = 0; k < p.count; k++) {
      position.set([p.getX(k), p.getY(k), p.getZ(k)], (v + k) * 3);
      if (normal && n) normal.set([n.getX(k), n.getY(k), n.getZ(k)], (v + k) * 3);
    }
    if (g.index) for (let k = 0; k < g.index.count; k++) index[c++] = g.index.getX(k) + v;
    else for (let k = 0; k < p.count; k++) index[c++] = v + k;
    v += p.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(position, 3));
  if (normal) out.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  out.setIndex(new THREE.BufferAttribute(index, 1));
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}

async function load(modelId: string, heightM: number): Promise<LoadedModel | null> {
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  const gltf = await new GLTFLoader().loadAsync(modelUrl(modelId, 'glb'));
  gltf.scene.updateMatrixWorld(true);

  // Gather every mesh in the scene's own frame, grouped by the material it wears.
  const byMaterial = new Map<THREE.Material, THREE.BufferGeometry[]>();
  gltf.scene.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh || Array.isArray(mesh.material)) return;
    const shape = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
    if (!shape.getAttribute('normal')) shape.computeVertexNormals();
    const list = byMaterial.get(mesh.material);
    if (list) list.push(shape);
    else byMaterial.set(mesh.material, [shape]);
  });
  if (byMaterial.size === 0) return null;

  const parts: ModelPart[] = [];
  const all: THREE.BufferGeometry[] = [];
  const box = new THREE.Box3();
  for (const [source, shapes] of byMaterial) {
    const geometry = merge(shapes, true);
    if (geometry.boundingBox) box.union(geometry.boundingBox);
    // A plain matt surface in the model's own colour: cheap to draw, and with no surroundings to
    // reflect, a metal finish would only come out dark.
    const color = (source as THREE.MeshStandardMaterial).color;
    parts.push({ geometry, material: new THREE.MeshLambertMaterial({ color: color ? color.clone() : new THREE.Color(0.5, 0.5, 0.5), side: source.side }) });
    all.push(...shapes);
  }
  const shadow = merge(all, false);
  for (const shape of all) shape.dispose();

  if (!shapeMatches(box.min.y, box.max.y, heightM)) {
    for (const part of parts) {
      part.geometry.dispose();
      part.material.dispose();
    }
    shadow.dispose();
    return null;
  }
  return { parts, shadow };
}

const cache = new Map<string, Promise<LoadedModel | null>>();

/**
 * A model's shape, loaded once and kept. `heightM` is the height its description gives: a shape
 * that does not match it is refused. Resolves to null when there is no usable shape. Never rejects.
 */
export function loadModel(modelId: string, heightM: number): Promise<LoadedModel | null> {
  const key = `${modelId}@${heightM}`;
  let hit = cache.get(key);
  if (!hit) {
    hit = load(modelId, heightM).catch(() => null);
    cache.set(key, hit);
  }
  return hit;
}
