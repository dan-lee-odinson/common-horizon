// Values shared by every model script.
//
// Coordinate frame for every model (see the brief):
//   - units are meters
//   - +Y points up
//   - the origin sits at the centre of the footprint, on the ground (lowest point is y = 0)

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

// Folder the website serves the models from. Model scripts write their .glb and .json here.
export const OUTPUT_DIR = path.resolve(here, '../../../web/public/models');

// Hard limit from the brief: each model must stay under this many triangles.
export const TRIANGLE_LIMIT = 20000;

// Exact wording the brief asks for in every model's JSON file.
export const SI_AI_NOTE = 'illustrative shape, built with SI/AI-written code';

export const FRAME_DESCRIPTION =
  'Y up; origin at the centre of the footprint, on the ground (lowest point at y = 0)';
