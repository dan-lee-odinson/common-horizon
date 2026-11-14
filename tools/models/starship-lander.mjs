// Starship lander (stand-in): a 9 m wide, 52 m tall steel cylinder with a rounded nose,
// engine bells underneath and six short landing legs. No flaps. To be replaced by a
// detailed model later.
//
// Run:  node starship-lander.mjs   (writes web/public/models/starship-lander.glb + .json)

import { revolveRuns, cylinder, strut, plainMaterial, Part, assemble } from './shared/geometry.mjs';
import { writeModel, isMain } from './shared/model-io.mjs';

const SOURCE =
  "NASA paper at IAC 2025 (Creech), as tabulated in Wikipedia's Starship HLS article (secondary source; link to add)";
const STATUS = 'NASA figure, secondary source';

export const SPEC = {
  id: 'starship-lander',
  name: 'Starship lander (stand-in)',
  status: STATUS,
  dimensions_m: { width_x: 9, height_y: 52, depth_z: 9 },
  dimension_sources: [
    { dimension: 'height_y', value_m: 52, meaning: 'overall height, ground to nose tip', source: SOURCE, status: STATUS },
    { dimension: 'width_x', value_m: 9, meaning: 'hull diameter', source: SOURCE, status: STATUS },
    { dimension: 'depth_z', value_m: 9, meaning: 'hull diameter (round hull)', source: SOURCE, status: STATUS },
  ],
  simplifications: [
    'Stand-in shape until a detailed model replaces it.',
    'Only the overall height and diameter come from the source. The nose length (14 m), the 2 m gap under the hull, the six legs, their 0.5 m foot pads and the six engine bells are our illustration, sized to stay inside the 9 m diameter.',
    'No flaps, windows, thrusters, markings or lettering.',
  ],
  built_by: 'tools/models/starship-lander.mjs',
};

// Shape numbers (meters). Only HEIGHT and DIAMETER come from the source.
const HEIGHT = SPEC.dimensions_m.height_y;
const RADIUS = SPEC.dimensions_m.width_x / 2;
const HULL_BOTTOM = 2.0; // underside of the hull; legs and engine bells sit below it (our estimate)
const NOSE_LENGTH = 14; // our estimate for a rounded, ogive-like nose
const SEGMENTS = 64;

const LEG_COUNT = 6;
const FOOT_RADIUS = 0.5;
const FOOT_HEIGHT = 0.2;
const FOOT_CENTER_R = 3.95; // foot centre distance from the axis; outer edge 4.45 m < 4.5 m

// Point at distance r from the axis, at `degrees` around it (0 degrees = +Z, 90 degrees = +X).
function around(r, degrees, y) {
  const a = (degrees * Math.PI) / 180;
  return [r * Math.sin(a), y, r * Math.cos(a)];
}

function hullProfileRuns() {
  const noseBase = HEIGHT - NOSE_LENGTH;
  // Rounded nose: radius = R * sqrt(1 - s^1.5) for s from 0 (nose base) to 1 (tip).
  // It meets the cylinder smoothly and ends in a round tip rather than a point.
  const nose = [];
  const steps = 24;
  for (let k = 1; k <= steps; k++) {
    const u = k / steps;
    const s = 1 - (1 - u) ** 2; // more points near the tip, where the curve bends most
    const r = k === steps ? 0 : RADIUS * Math.sqrt(1 - s ** 1.5);
    nose.push([r, noseBase + s * NOSE_LENGTH]);
  }
  return [
    [[0, HULL_BOTTOM], [RADIUS, HULL_BOTTOM]], // flat bottom
    [[RADIUS, HULL_BOTTOM], [RADIUS, noseBase], ...nose], // side and nose, one smooth run
  ];
}

// Open engine bell hanging down from the hull bottom, with a thin wall.
function engineBell({ x, z, throatRadius, exitRadius, length }) {
  const top = HULL_BOTTOM;
  const bottom = top - length;
  const wall = 0.04;
  const steps = 8;
  const contour = []; // [radius, y] from exit (bottom) to throat (top)
  for (let k = 0; k <= steps; k++) {
    const t = k / steps; // 0 = exit, 1 = throat
    const r = throatRadius + (exitRadius - throatRadius) * (1 - t) ** 1.6;
    contour.push([r, bottom + t * length]);
  }
  const outer = contour.map(([r, y]) => [r + wall, y]);
  const inner = [...contour].reverse();
  const geometry = revolveRuns(
    [
      outer, // outside surface, bottom to top
      inner, // inside surface, top to bottom
      [[exitRadius, bottom], [exitRadius + wall, bottom]], // lip at the exit
    ],
    { segments: 24 },
  );
  geometry.translate(x, 0, z);
  return geometry;
}

export function build() {
  const steel = plainMaterial('steel', 0xc3c7cc, { metalness: 0.3, roughness: 0.45 });
  const dark = plainMaterial('engine-dark', 0x3a3d42, { metalness: 0.3, roughness: 0.6 });
  const legGrey = plainMaterial('leg-grey', 0x5b6068, { metalness: 0.2, roughness: 0.6 });

  const hull = new Part('hull').add(steel, revolveRuns(hullProfileRuns(), { segments: SEGMENTS }));

  // Three smaller inner bells and three larger outer bells, between the legs.
  const engines = new Part('engines');
  for (let k = 0; k < 3; k++) {
    const [xi, , zi] = around(1.2, k * 120, 0);
    engines.add(dark, engineBell({ x: xi, z: zi, throatRadius: 0.22, exitRadius: 0.65, length: 1.1 }));
    const [xo, , zo] = around(2.9, 60 + k * 120, 0);
    engines.add(dark, engineBell({ x: xo, z: zo, throatRadius: 0.3, exitRadius: 1.1, length: 1.4 }));
  }

  // Six legs: a main strut and a brace from under the hull down to a round foot pad.
  const legs = new Part('landing-legs');
  for (let k = 0; k < LEG_COUNT; k++) {
    const angle = 30 + k * (360 / LEG_COUNT);
    const foot = around(FOOT_CENTER_R, angle, FOOT_HEIGHT);
    const [fx, , fz] = foot;
    legs.add(
      legGrey,
      strut(around(3.55, angle, HULL_BOTTOM + 0.3), foot, 0.16),
      strut(around(2.5, angle, HULL_BOTTOM + 0.3), foot, 0.1),
      cylinder({ radius: FOOT_RADIUS, bottom: 0, top: FOOT_HEIGHT, x: fx, z: fz, segments: 24 }),
    );
  }

  return { scene: assemble(SPEC.id, [hull, engines, legs]), spec: SPEC };
}

if (isMain(import.meta.url)) {
  await writeModel(build());
}
