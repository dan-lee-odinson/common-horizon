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

// Exact wording the project plan asks for in each model's JSON file, by kind of model:
// code-built (a script in this folder draws it), imported (a community CAD model, finished by
// finish-model.mjs) or generated (SI/AI-generated from a photo, finished by finish-model.mjs).
export const SI_AI_NOTE = 'illustrative shape, built with SI/AI-written code';
export const MODEL_NOTES = Object.freeze({
  'code-built': SI_AI_NOTE,
  imported: "illustrative shape from a community CAD model; not the manufacturer's data",
  generated: "illustrative shape, SI/AI-generated from a photo; not the manufacturer's data",
});

export const FRAME_DESCRIPTION =
  'Y up; origin at the centre of the footprint, on the ground (lowest point at y = 0)';
