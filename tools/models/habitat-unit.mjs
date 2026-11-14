// Habitat unit: an inflatable section (about 6.5 m across, 5.2 m tall) on top of a metal
// section (4.4 m across, 2.6 m tall).
//
// How the two sections join is OUR simplification: we stack the inflatable section directly
// on the metal section's top, on a shared vertical axis, so the unit is 7.8 m tall overall.
//
// Run:  node habitat-unit.mjs   (writes web/public/models/habitat-unit.glb + .json)

import { revolveRuns, cylinder, box, plainMaterial, Part, assemble } from './shared/geometry.mjs';
import { writeModel, isMain } from './shared/model-io.mjs';

const SOURCE = 'Burke, Howard and Kessler, AIAA ASCEND 2022 (link to add)';
const STATUS = 'NASA study';
const OURS = 'our simplification (how the sections join)';

const INFLATABLE = { diameter: 6.5, height: 5.2 };
const METAL = { diameter: 4.4, height: 2.6 };
// 7.8 m, from our stacking choice (rounded to the millimetre to drop floating-point noise)
const TOTAL_HEIGHT = Number((METAL.height + INFLATABLE.height).toFixed(3));

export const SPEC = {
  id: 'habitat-unit',
  name: 'Habitat unit (inflatable and metal sections)',
  status: STATUS,
  dimensions_m: { width_x: INFLATABLE.diameter, height_y: TOTAL_HEIGHT, depth_z: INFLATABLE.diameter },
  dimension_sources: [
    {
      dimension: 'width_x',
      value_m: INFLATABLE.diameter,
      meaning: 'inflatable section diameter (the widest part)',
      source: SOURCE,
      status: STATUS,
    },
    {
      dimension: 'depth_z',
      value_m: INFLATABLE.diameter,
      meaning: 'inflatable section diameter (round section)',
      source: SOURCE,
      status: STATUS,
    },
    {
      dimension: 'height_y',
      value_m: TOTAL_HEIGHT,
      meaning: 'metal section height 2.6 m plus inflatable section height 5.2 m, stacked',
      source: `${SOURCE} for each section height; adding them is ${OURS}`,
      status: `${STATUS}; stacking is ${OURS}`,
    },
  ],
  parts: [
    {
      node: 'inflatable-section',
      dimensions_m: { width_x: INFLATABLE.diameter, height_y: INFLATABLE.height, depth_z: INFLATABLE.diameter },
      source: SOURCE,
      status: STATUS,
    },
    {
      node: 'metal-section',
      dimensions_m: { width_x: METAL.diameter, height_y: METAL.height, depth_z: METAL.diameter },
      source: SOURCE,
      status: STATUS,
    },
  ],
  simplifications: [
    'How the two sections join is our simplification: the inflatable section sits directly on top of the metal section, on one vertical axis. The source gives the size of each section, not this arrangement.',
    'The inflatable section is drawn as a rounded drum (a superellipse revolved around the vertical axis). Its true inflated shape, straps and seams are not shown.',
    'The hatch on the metal section (1.1 m wide, 1.6 m tall, our estimate) is a separate part and is not counted in the metal section size.',
    'No windows, markings or lettering.',
  ],
  built_by: 'tools/models/habitat-unit.mjs',
};

const SEGMENTS = 64;

// Rounded drum outline: |r/a|^n + |(y - yc)/b|^n = 1 with n = 3, walked from the bottom
// centre, out round the side, to the top centre. The widest point (r = a) is at the middle.
function inflatableProfile() {
  const a = INFLATABLE.diameter / 2;
  const b = INFLATABLE.height / 2;
  const yc = METAL.height + b;
  const e = 2 / 3; // 2 / n
  const steps = 48; // even, so angle 0 (the widest point) is one of the samples
  const points = [];
  for (let k = 0; k <= steps; k++) {
    const t = -Math.PI / 2 + (k / steps) * Math.PI;
    const c = Math.cos(t);
    const s = Math.sin(t);
    const r = k === 0 || k === steps ? 0 : a * Math.abs(c) ** e;
    const y = yc + b * Math.sign(s) * Math.abs(s) ** e;
    points.push([r, y]);
  }
  points[steps / 2] = [a, yc]; // exact widest point
  return points;
}

export function build() {
  const fabric = plainMaterial('fabric-white', 0xe8e4da, { roughness: 0.9 });
  const metal = plainMaterial('metal-grey', 0xa5abb2, { metalness: 0.3, roughness: 0.5 });
  const trim = plainMaterial('hatch-grey', 0x666c74, { metalness: 0.2, roughness: 0.6 });
  const door = plainMaterial('door-light', 0xc4c8cd, { metalness: 0.2, roughness: 0.55 });

  const inflatable = new Part('inflatable-section').add(fabric, revolveRuns([inflatableProfile()], { segments: SEGMENTS }));

  const metalSection = new Part('metal-section').add(
    metal,
    cylinder({ radius: METAL.diameter / 2, bottom: 0, top: METAL.height, segments: SEGMENTS }),
  );

  // Hatch on the +Z side of the metal section: a frame of four bars and a recessed door.
  const r = METAL.diameter / 2;
  const zIn = r - 0.15; // bars start inside the wall so they meet the curved surface
  const zFrame = r + 0.08;
  const zDoor = r + 0.05;
  const hatch = new Part('hatch').add(
    trim,
    box([-0.55, 0.35, zIn], [-0.42, 1.95, zFrame]), // left bar
    box([0.42, 0.35, zIn], [0.55, 1.95, zFrame]), // right bar
    box([-0.42, 0.35, zIn], [0.42, 0.48, zFrame]), // bottom bar
    box([-0.42, 1.82, zIn], [0.42, 1.95, zFrame]), // top bar
  );
  hatch.add(door, box([-0.42, 0.48, zIn], [0.42, 1.82, zDoor]));

  return { scene: assemble(SPEC.id, [inflatable, metalSection, hatch]), spec: SPEC };
}

if (isMain(import.meta.url)) {
  await writeModel(build());
}
