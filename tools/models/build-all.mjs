// Build every model, in the order of the brief, with default settings.
// Run:  npm run build   (or: node build-all.mjs)

import { writeModel } from './shared/model-io.mjs';
import * as starship from './starship-lander.mjs';
import * as habitat from './habitat-unit.mjs';
import * as fission from './fission-power-unit.mjs';
import * as solar from './solar-array-mast.mjs';
import * as griffin from './griffin-lander.mjs';

export const MODEL_SCRIPTS = [starship, habitat, fission, solar, griffin];

for (const script of MODEL_SCRIPTS) {
  await writeModel(script.build());
}
