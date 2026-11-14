// Griffin lander: a low deck on four wide-set legs, about 2 m tall and 4.5 m wide.
//
// Run:  node griffin-lander.mjs   (writes web/public/models/griffin-lander.glb + .json)

import { revolveRuns, box, cylinder, sphere, strut, plainMaterial, Part, assemble } from './shared/geometry.mjs';
import { writeModel, isMain } from './shared/model-io.mjs';

const HEIGHT_SOURCE = "Space.com's report of the 15 June 2026 unveiling (link to add)";
const WIDTH_SOURCE = "Voyager's lunar missions page (link to add)";
const STATUS = 'company figure, secondary source';

const HEIGHT = 2.0;
const WIDTH = 4.5;

export const SPEC = {
  id: 'griffin-lander',
  name: 'Griffin lander',
  status: STATUS,
  dimensions_m: { width_x: WIDTH, height_y: HEIGHT, depth_z: WIDTH },
  dimension_sources: [
    { dimension: 'height_y', value_m: HEIGHT, meaning: 'overall height, about 2 m', source: HEIGHT_SOURCE, status: STATUS },
    {
      dimension: 'width_x',
      value_m: WIDTH,
      meaning: 'overall width across the leg foot pads (outer edge to outer edge), about 4.5 m',
      source: WIDTH_SOURCE,
      status: STATUS,
    },
    {
      dimension: 'depth_z',
      value_m: WIDTH,
      meaning: 'same as the width: the four legs sit on the X and Z axes, so the lander is 4.5 m across both ways',
      source: `${WIDTH_SOURCE}; legs on two perpendicular axes is our simplification`,
      status: `${STATUS}; leg layout is our simplification`,
    },
  ],
  simplifications: [
    'Only the overall height (about 2 m) and width (about 4.5 m) come from the sources; we use exactly 2.0 m and 4.5 m.',
    'We place the four legs on the X and Z axes (one each side of the deck), so the lander measures 4.5 m from foot pad to foot pad in both directions and nowhere more, including across the diagonals.',
    'Deck size, tanks, engine, payload boxes, side panel and antenna are our illustration of "a low deck on four wide-set legs".',
    'No markings, logos or lettering.',
  ],
  built_by: 'tools/models/griffin-lander.mjs',
};

const PAD = { radius: 0.3, height: 0.06 };
const FOOT = WIDTH / 2 - PAD.radius; // foot pad centres 1.95 m from the centre, on the X and Z axes
const DECK = { half: 1.25, bottom: 1.05, top: 1.2 };
const BODY = { half: 1.1, bottom: 0.55 };

export function build() {
  const deckGrey = plainMaterial('deck-grey', 0xc9ccd0, { metalness: 0.25, roughness: 0.5 });
  const foilGold = plainMaterial('foil-gold', 0xc9a046, { metalness: 0.3, roughness: 0.4 });
  const tankWhite = plainMaterial('tank-white', 0xe7e7e3, { metalness: 0.05, roughness: 0.6 });
  const legGrey = plainMaterial('leg-grey', 0x585d64, { metalness: 0.2, roughness: 0.6 });
  const engineDark = plainMaterial('engine-dark', 0x3a3d42, { metalness: 0.3, roughness: 0.6 });
  const cellBlue = plainMaterial('cell-blue', 0x243a6e, { metalness: 0.2, roughness: 0.35 });
  const payloadWhite = plainMaterial('payload-white', 0xdadad6, { roughness: 0.7 });

  // Body: deck plate on top of a foil-wrapped box, four tanks and one engine bell underneath.
  const body = new Part('lander-body')
    .add(deckGrey, box([-DECK.half, DECK.bottom, -DECK.half], [DECK.half, DECK.top, DECK.half]))
    .add(foilGold, box([-BODY.half, BODY.bottom, -BODY.half], [BODY.half, DECK.bottom, BODY.half]));
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    body.add(tankWhite, sphere([sx * 0.62, 0.62, sz * 0.62], 0.38));
  }
  const bell = revolveRuns(
    [
      [[0.22, 0.25], [0.16, 0.38], [0.1, BODY.bottom]], // outside, bottom to top
      [[0.08, BODY.bottom], [0.14, 0.38], [0.2, 0.25]], // inside, top to bottom
      [[0.2, 0.25], [0.22, 0.25]], // lip
    ],
    { segments: 24 },
  );
  body.add(engineDark, bell);
  // Side solar panel on the +X face of the body
  body.add(cellBlue, box([BODY.half, 0.62, -0.8], [BODY.half + 0.03, 1.0, 0.8]));

  // Payload on the deck. The tallest box sets the 2.0 m overall height.
  const payload = new Part('payload')
    .add(payloadWhite, box([-0.6, DECK.top, -0.6], [0.6, HEIGHT, 0.6]))
    .add(deckGrey, box([0.75, DECK.top, -1.1], [1.15, 1.65, -0.5]))
    .add(foilGold, box([-1.15, DECK.top, 0.5], [-0.75, 1.55, 1.1]))
    .add(legGrey, cylinder({ radius: 0.03, bottom: DECK.top, top: 1.75, x: -0.95, z: -0.95, segments: 8 }))
    .add(deckGrey, cylinder({ radius: 0.18, bottom: 1.75, top: 1.8, x: -0.95, z: -0.95, segments: 16 }));

  // Four legs, one on each side of the deck, on the +X, -X, +Z and -Z axes. Each leg is a main
  // strut from under the middle of a deck edge and two braces from the lower corners of the
  // body, all meeting at a round foot pad. With the legs on the axes the pad-to-pad span is
  // 4.5 m in every direction (on the diagonals it would be about 6.4 m).
  const legs = new Part('landing-legs');
  for (const [ux, uz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const [vx, vz] = [-uz, ux]; // sideways direction along the deck edge
    const at = (out, side, y) => [ux * out + vx * side, y, uz * out + vz * side];
    const foot = at(FOOT, 0, PAD.height);
    legs.add(
      legGrey,
      strut(at(1.2, 0, DECK.bottom + 0.05), foot, 0.07),
      strut(at(BODY.half, 0.95, BODY.bottom + 0.05), foot, 0.04),
      strut(at(BODY.half, -0.95, BODY.bottom + 0.05), foot, 0.04),
      cylinder({ radius: PAD.radius, bottom: 0, top: PAD.height, x: foot[0], z: foot[2], segments: 24 }),
    );
  }

  return { scene: assemble(SPEC.id, [body, payload, legs]), spec: SPEC };
}

if (isMain(import.meta.url)) {
  await writeModel(build());
}
