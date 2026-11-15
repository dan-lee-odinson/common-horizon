// The model scripts, for the tests (helper module, not a test file itself).
import * as starship from '../starship-lander.mjs';
import * as habitat from '../habitat-unit.mjs';
import * as fission from '../fission-power-unit.mjs';
import * as solar from '../solar-array-mast.mjs';
import * as griffin from '../griffin-lander.mjs';

export const MODELS = [
  { id: 'starship-lander', build: () => starship.build() },
  { id: 'habitat-unit', build: () => habitat.build() },
  { id: 'fission-power-unit', build: () => fission.build() },
  { id: 'solar-array-mast', build: () => solar.build() },
  { id: 'griffin-lander', build: () => griffin.build() },
];

export { solar };
