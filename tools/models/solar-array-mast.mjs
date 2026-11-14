// Solar array mast: a vertical mast on a small base, carrying a flat solar blanket.
//
// No published size is on file, so the mast height and the panel width are PARAMETERS,
// defaulting to 10 m and 4 m. Every size here is our estimate, to be replaced by a published
// figure.
//
// Run with the defaults:   node solar-array-mast.mjs
// Run with other sizes:    node solar-array-mast.mjs --height 12 --panel-width 5
// (Both write web/public/models/solar-array-mast.glb + .json; the committed files use the defaults.)

import { parseArgs } from 'node:util';
import { cylinder, box, plainMaterial, Part, assemble } from './shared/geometry.mjs';
import { writeModel, isMain } from './shared/model-io.mjs';

export const DEFAULTS = Object.freeze({ height: 10, panelWidth: 4 });
const STATUS = 'our estimate, to be replaced by a published figure';
const NO_SOURCE = 'no published size on file; our estimate';

const BASE_SIZE = 2.0; // square base footprint (our estimate)
const BASE_HEIGHT = 0.45;
const TURNTABLE = { radius: 0.35, top: 0.7 };
const MAST_RADIUS = 0.09;
const CAP = 0.2; // mast-top cap height
const BAR = 0.1; // spreader bar thickness
const BLANKET_THICKNESS = 0.03;
const MIN_HEIGHT = 3;
const MIN_PANEL_WIDTH = 0.5;

/** Size facts for a given parameter set (used for the JSON and by the tests). */
export function specFor({ height = DEFAULTS.height, panelWidth = DEFAULTS.panelWidth } = {}) {
  if (!(Number.isFinite(height) && height >= MIN_HEIGHT)) {
    throw new Error(`solar-array-mast: height must be a number of at least ${MIN_HEIGHT} m (got ${height})`);
  }
  if (!(Number.isFinite(panelWidth) && panelWidth >= MIN_PANEL_WIDTH)) {
    throw new Error(`solar-array-mast: panel width must be a number of at least ${MIN_PANEL_WIDTH} m (got ${panelWidth})`);
  }
  const width = Math.max(panelWidth, BASE_SIZE);
  return {
    id: 'solar-array-mast',
    name: 'Solar array mast (sizes are parameters)',
    status: STATUS,
    dimensions_m: { width_x: width, height_y: height, depth_z: BASE_SIZE },
    dimension_sources: [
      {
        dimension: 'height_y',
        value_m: height,
        meaning: `mast height, ground to mast top (parameter "height", default ${DEFAULTS.height} m)`,
        source: NO_SOURCE,
        status: STATUS,
      },
      {
        dimension: 'width_x',
        value_m: width,
        meaning: `solar panel width (parameter "panel width", default ${DEFAULTS.panelWidth} m), or the ${BASE_SIZE} m base if wider`,
        source: NO_SOURCE,
        status: STATUS,
      },
      {
        dimension: 'depth_z',
        value_m: BASE_SIZE,
        meaning: 'square base footprint',
        source: NO_SOURCE,
        status: STATUS,
      },
    ],
    parameters: { height_m: height, panel_width_m: panelWidth, defaults: { height_m: DEFAULTS.height, panel_width_m: DEFAULTS.panelWidth } },
    simplifications: [
      'No published size is on file: the mast height and panel width are parameters (defaults 10 m and 4 m), and the 2 m square base, the panel height and the mast thickness are our estimates.',
      'The solar blanket is one flat sheet split by the mast, with a bar along its top and bottom. Cells, wiring and the sun-tracking drive are not shown.',
      'No markings or lettering.',
    ],
    built_by: 'tools/models/solar-array-mast.mjs',
  };
}

export function build(params = {}) {
  const spec = specFor(params);
  const height = spec.parameters.height_m;
  const panelWidth = spec.parameters.panel_width_m;

  const baseGrey = plainMaterial('base-grey', 0x60656c, { metalness: 0.2, roughness: 0.6 });
  const mastGrey = plainMaterial('mast-grey', 0xa9aeb5, { metalness: 0.3, roughness: 0.45 });
  const cellBlue = plainMaterial('cell-blue', 0x243a6e, { metalness: 0.2, roughness: 0.35 });

  const half = BASE_SIZE / 2;
  const base = new Part('base')
    .add(baseGrey, box([-half, 0, -half], [half, BASE_HEIGHT, half]))
    .add(mastGrey, cylinder({ radius: TURNTABLE.radius, bottom: BASE_HEIGHT, top: TURNTABLE.top, segments: 32 }));

  const mast = new Part('mast')
    .add(mastGrey, cylinder({ radius: MAST_RADIUS, bottom: TURNTABLE.top, top: height - CAP, segments: 16 }))
    .add(baseGrey, cylinder({ radius: MAST_RADIUS + 0.04, bottom: height - CAP, top: height, segments: 16 }));

  // Blanket: from 30 % of the height (at least 1.4 m) up to just under the top spreader bar.
  const topBarTop = height - CAP;
  const blanketTop = topBarTop - BAR;
  const blanketBottom = Math.max(1.4, height * 0.3);
  const w = panelWidth / 2;
  const t = BLANKET_THICKNESS / 2;
  const gap = MAST_RADIUS + 0.03; // the blanket halves stop just short of the mast
  const array = new Part('solar-array')
    .add(cellBlue, box([-w, blanketBottom, -t], [-gap, blanketTop, t]), box([gap, blanketBottom, -t], [w, blanketTop, t]))
    .add(
      mastGrey,
      box([-w, blanketTop, -0.05], [w, topBarTop, 0.05]), // top spreader bar
      box([-w, blanketBottom - BAR, -0.05], [w, blanketBottom, 0.05]), // bottom spreader bar
      cylinder({ radius: 0.02, bottom: blanketBottom, top: blanketTop, x: -w + 0.02, segments: 8 }), // edge rods
      cylinder({ radius: 0.02, bottom: blanketBottom, top: blanketTop, x: w - 0.02, segments: 8 }),
    );

  return { scene: assemble(spec.id, [base, mast, array]), spec };
}

if (isMain(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      height: { type: 'string' },
      'panel-width': { type: 'string' },
    },
  });
  const params = {};
  if (values.height !== undefined) params.height = Number(values.height);
  if (values['panel-width'] !== undefined) params.panelWidth = Number(values['panel-width']);
  await writeModel(build(params));
}
