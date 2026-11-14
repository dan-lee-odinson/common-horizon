// Fission power unit: the stowed envelope is a 4 m wide, 6 m tall cylinder. Flat radiator
// panels are shown deployed on both sides as an ILLUSTRATION only: their size is our
// estimate, not a published figure.
//
// Run:  node fission-power-unit.mjs   (writes web/public/models/fission-power-unit.glb + .json)

import { cylinder, box, plainMaterial, Part, assemble } from './shared/geometry.mjs';
import { writeModel, isMain } from './shared/model-io.mjs';

const SOURCE = 'Kaldon et al., IAC 2024, NASA Technical Reports Server 20240011694 (link to add)';
const STATUS = 'NASA goal';
const ILLUSTRATION = 'our illustration, not a published figure';

const STOWED = { diameter: 4, height: 6 };

// Radiator wings (our illustration). Each wing: a short hinge arm, two flat panels with a
// hinge between them, sticking straight out from the body along +X and -X.
const PANEL = { width: 2.4, height: 3.6, thickness: 0.06, bottom: 2.2 };
const ARM_LENGTH = 0.1;
const HINGE_GAP = 0.1;
// Rounded to the millimetre to drop floating-point noise.
const WING_SPAN = Number((ARM_LENGTH + PANEL.width + HINGE_GAP + PANEL.width).toFixed(3)); // 5 m from the body wall
const OVERALL_WIDTH = Number((STOWED.diameter + 2 * WING_SPAN).toFixed(3)); // 14 m tip to tip

export const SPEC = {
  id: 'fission-power-unit',
  name: 'Fission power unit (radiators shown deployed, illustrative)',
  status: STATUS,
  dimensions_m: { width_x: OVERALL_WIDTH, height_y: STOWED.height, depth_z: STOWED.diameter },
  dimension_sources: [
    {
      dimension: 'height_y',
      value_m: STOWED.height,
      meaning: 'stowed height (cylinder)',
      source: SOURCE,
      status: STATUS,
    },
    {
      dimension: 'depth_z',
      value_m: STOWED.diameter,
      meaning: 'stowed diameter (cylinder)',
      source: SOURCE,
      status: STATUS,
    },
    {
      dimension: 'width_x',
      value_m: OVERALL_WIDTH,
      meaning: `radiator tip to radiator tip: 4 m stowed diameter plus two deployed radiator wings of ${WING_SPAN} m each`,
      source: `${SOURCE} for the 4 m diameter; the radiator wings are ${ILLUSTRATION}`,
      status: `${STATUS} (body); ${ILLUSTRATION} (radiators)`,
    },
  ],
  parts: [
    {
      node: 'stowed-body',
      dimensions_m: { width_x: STOWED.diameter, height_y: STOWED.height, depth_z: STOWED.diameter },
      source: SOURCE,
      status: STATUS,
    },
  ],
  simplifications: [
    'The 4 m by 6 m cylinder is the stowed size from the source. The flat radiator panels are shown deployed as an illustration; their number, size (two wings of two 2.4 m x 3.6 m panels) and position are our estimate, not a published figure.',
    'The body is split into a darker lower band (reactor and shielding) and a lighter upper band (power conversion); this split is our illustration.',
    'No markings or lettering.',
  ],
  built_by: 'tools/models/fission-power-unit.mjs',
};

const SEGMENTS = 64;
const LOWER_BAND_TOP = 2.4; // our illustration

export function build() {
  const darkGrey = plainMaterial('body-dark', 0x4b5057, { metalness: 0.3, roughness: 0.55 });
  const lightGrey = plainMaterial('body-light', 0xb3b8be, { metalness: 0.25, roughness: 0.5 });
  const radiatorWhite = plainMaterial('radiator-white', 0xdcdfe2, { metalness: 0.05, roughness: 0.6 });
  const ribGrey = plainMaterial('radiator-rib', 0x8d939a, { metalness: 0.3, roughness: 0.5 });

  const r = STOWED.diameter / 2;
  const body = new Part('stowed-body')
    .add(darkGrey, cylinder({ radius: r, bottom: 0, top: LOWER_BAND_TOP, segments: SEGMENTS }))
    .add(lightGrey, cylinder({ radius: r, bottom: LOWER_BAND_TOP, top: STOWED.height, segments: SEGMENTS }));

  const radiators = new Part('radiator-panels-illustration');
  const t = PANEL.thickness / 2;
  const yb = PANEL.bottom;
  const yt = PANEL.bottom + PANEL.height;
  for (const side of [1, -1]) {
    // x positions along the wing, measured outward from the body wall at x = r
    const armStart = r - 0.2; // arms start inside the body wall
    const panel1 = [r + ARM_LENGTH, r + ARM_LENGTH + PANEL.width];
    const panel2 = [panel1[1] + HINGE_GAP, panel1[1] + HINGE_GAP + PANEL.width];
    const xs = ([a, b]) => (side > 0 ? [a, b] : [-b, -a]);

    for (const [a, b] of [panel1, panel2].map(xs)) {
      radiators.add(radiatorWhite, box([a, yb, -t], [b, yt, t]));
      // Six heat-pipe ribs on each face of each panel
      for (let k = 0; k < 6; k++) {
        const x = a + ((k + 0.5) / 6) * (b - a);
        radiators.add(ribGrey, box([x - 0.02, yb + 0.05, t], [x + 0.02, yt - 0.05, t + 0.03]));
        radiators.add(ribGrey, box([x - 0.02, yb + 0.05, -t - 0.03], [x + 0.02, yt - 0.05, -t]));
      }
    }
    // Hinge arms (top and bottom) and the hinge rod between the two panels
    const [armA, armB] = xs([armStart, panel1[0]]);
    radiators.add(ribGrey, box([armA, yb + 0.2, -0.08], [armB, yb + 0.45, 0.08]));
    radiators.add(ribGrey, box([armA, yt - 0.45, -0.08], [armB, yt - 0.2, 0.08]));
    const [hingeA, hingeB] = xs([panel1[1], panel2[0]]);
    radiators.add(ribGrey, box([hingeA, yb, -0.05], [hingeB, yt, 0.05]));
  }

  return { scene: assemble(SPEC.id, [body, radiators]), spec: SPEC };
}

if (isMain(import.meta.url)) {
  await writeModel(build());
}
