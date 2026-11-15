// Check every model in web/public/models/.
//
// For each <id>.glb + <id>.json pair it:
//   1. measures the real bounding box from the .glb and fails if any size is more than
//      1 percent off the JSON (width_x, height_y, depth_z, and any named parts);
//   2. counts the triangles and fails if the count is 20,000 or more, or differs from the JSON;
//   3. checks the frame: lowest point on the ground (y = 0) and footprint centred on the
//      origin, both within 1 mm;
//   4. checks the JSON against the brief (status label, brief sizes, required fields,
//      the "illustrative shape, built with SI/AI-written code" note);
//   5. checks for plain colours only: no images, textures or vertex colours;
//   6. runs the Khronos glTF validator and fails on any error.
// It also fails if a brief model is missing or a .glb has no .json.
//
// Run:   npm run check                      (all models)
//        node check-models.mjs habitat-unit (only some models)
//        node check-models.mjs --dir other/folder
// Exit code 0 = all passed, 1 = something failed.

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import validator from 'gltf-validator';
import { measureGLB } from './shared/glb-reader.mjs';
import { BRIEF, TRIANGLE_LIMIT, SIZE_TOLERANCE, ORIGIN_TOLERANCE_M, REQUIRED_NOTE } from './brief-figures.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_DIR = path.resolve(here, '../../web/public/models');
const DIMENSIONS = ['width_x', 'height_y', 'depth_z'];
const AXIS = { width_x: 0, height_y: 1, depth_z: 2 };
const SLACK = 1e-9; // float rounding allowance on top of the 1 percent

export function relativeError(measured, expected) {
  return Math.abs(measured - expected) / Math.abs(expected);
}

function percent(value) {
  return `${(value * 100).toFixed(2)}%`;
}

function isPositiveNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function compareSizes(label, measuredSize, declared, problems) {
  for (const dim of DIMENSIONS) {
    const expected = declared?.[dim];
    if (!isPositiveNumber(expected)) {
      problems.push(`${label}: ${dim} is missing or not a positive number in the JSON`);
      continue;
    }
    const measured = measuredSize[AXIS[dim]];
    const error = relativeError(measured, expected);
    if (error > SIZE_TOLERANCE + SLACK) {
      problems.push(
        `${label}: ${dim} measures ${measured.toFixed(3)} m but the JSON says ${expected} m (${percent(error)} off, limit 1%)`,
      );
    }
  }
}

/** Required fields and wording in a model's JSON file. */
export function checkDescription(json, { fileBase } = {}) {
  const problems = [];
  const need = (condition, message) => {
    if (!condition) problems.push(message);
  };
  need(typeof json.id === 'string' && json.id.length > 0, 'JSON: "id" is missing');
  if (fileBase !== undefined) need(json.id === fileBase, `JSON: "id" is "${json.id}" but the file is ${fileBase}.json`);
  need(typeof json.name === 'string' && json.name.length > 0, 'JSON: "name" is missing');
  need(json.file === `${json.id}.glb`, `JSON: "file" should be "${json.id}.glb"`);
  need(typeof json.status === 'string' && json.status.length > 0, 'JSON: "status" label is missing');
  need(json.note === REQUIRED_NOTE, `JSON: "note" must read exactly "${REQUIRED_NOTE}"`);
  need(json.units === 'meters', 'JSON: "units" must be "meters"');
  need(json.dimensions_m && typeof json.dimensions_m === 'object', 'JSON: "dimensions_m" is missing');
  need(Number.isInteger(json.triangles), 'JSON: "triangles" must be a whole number');
  need(Array.isArray(json.simplifications) && json.simplifications.length > 0, 'JSON: "simplifications" list is missing');

  const sources = Array.isArray(json.dimension_sources) ? json.dimension_sources : [];
  need(sources.length > 0, 'JSON: "dimension_sources" list is missing');
  for (const dim of DIMENSIONS) {
    const entry = sources.find((s) => s.dimension === dim);
    if (!entry) {
      problems.push(`JSON: no source given for ${dim}`);
      continue;
    }
    need(typeof entry.source === 'string' && entry.source.length > 0, `JSON: source text for ${dim} is empty`);
    need(typeof entry.status === 'string' && entry.status.length > 0, `JSON: status label for ${dim} is empty`);
    need(entry.value_m === json.dimensions_m?.[dim], `JSON: source entry for ${dim} says ${entry.value_m} m but dimensions_m says ${json.dimensions_m?.[dim]} m`);
  }
  for (const part of json.parts ?? []) {
    need(typeof part.node === 'string' && part.node.length > 0, 'JSON: a part has no "node" name');
    need(typeof part.source === 'string' && part.source.length > 0, `JSON: part ${part.node} has no source`);
    need(typeof part.status === 'string' && part.status.length > 0, `JSON: part ${part.node} has no status label`);
  }
  return problems;
}

/** Compare a model's JSON with the figures in the brief. */
export function checkAgainstBrief(json, brief) {
  const problems = [];
  const warnings = [];
  if (!brief) {
    problems.push(`brief: "${json.id}" is not one of the models in the brief`);
    return { problems, warnings };
  }
  if (json.status !== brief.status) {
    problems.push(`brief: status should be "${brief.status}" but the JSON says "${json.status}"`);
  }
  for (const [dim, value] of Object.entries(brief.dimensions_m ?? {})) {
    const declared = json.dimensions_m?.[dim];
    if (!isPositiveNumber(declared) || relativeError(declared, value) > SIZE_TOLERANCE + SLACK) {
      problems.push(`brief: ${dim} should be ${value} m but the JSON says ${declared} m`);
    }
  }
  for (const [node, sizes] of Object.entries(brief.parts ?? {})) {
    const part = (json.parts ?? []).find((p) => p.node === node);
    if (!part) {
      problems.push(`brief: the JSON has no part "${node}"`);
      continue;
    }
    for (const [dim, value] of Object.entries(sizes)) {
      const declared = part.dimensions_m?.[dim];
      if (!isPositiveNumber(declared) || relativeError(declared, value) > SIZE_TOLERANCE + SLACK) {
        problems.push(`brief: part ${node} ${dim} should be ${value} m but the JSON says ${declared} m`);
      }
    }
  }
  if (brief.defaults) {
    const parameters = json.parameters;
    if (!parameters) {
      problems.push('brief: the JSON has no "parameters" (this model has size parameters)');
    } else {
      for (const [key, value] of Object.entries(brief.defaults)) {
        if (parameters.defaults?.[key] !== value) {
          problems.push(`brief: default ${key} should be ${value} but the JSON says ${parameters.defaults?.[key]}`);
        }
        if (parameters[key] !== value) {
          problems.push(
            `brief: built with ${key} = ${parameters[key]}, not the default ${value}; rebuild with the defaults before committing`,
          );
        }
      }
      if (relativeError(json.dimensions_m?.height_y, parameters.height_m) > SIZE_TOLERANCE + SLACK) {
        problems.push(`brief: height_y ${json.dimensions_m?.height_y} m does not match the height parameter ${parameters.height_m} m`);
      }
      if (!(json.dimensions_m?.width_x >= parameters.panel_width_m * (1 - SIZE_TOLERANCE))) {
        problems.push(`brief: width_x ${json.dimensions_m?.width_x} m is narrower than the panel width parameter ${parameters.panel_width_m} m`);
      }
    }
  }
  return { problems, warnings };
}

/** Compare what was measured in the .glb with the model's JSON. */
export function checkMeasurements(json, measured) {
  const problems = [];

  // 1. Sizes, overall and per named part
  compareSizes('size', measured.box.size, json.dimensions_m, problems);
  for (const part of json.parts ?? []) {
    const nodeBox = measured.nodes[part.node];
    if (!nodeBox) {
      problems.push(`part ${part.node}: no node with that name in the .glb`);
      continue;
    }
    compareSizes(`part ${part.node}`, nodeBox.size, part.dimensions_m, problems);
  }

  // 2. Triangles
  if (!(measured.triangles < TRIANGLE_LIMIT)) {
    problems.push(`triangles: ${measured.triangles} is not under the limit of ${TRIANGLE_LIMIT}`);
  }
  if (measured.triangles !== json.triangles) {
    problems.push(`triangles: the .glb has ${measured.triangles} but the JSON says ${json.triangles}`);
  }
  if (measured.nonTriangleModes.length > 0) {
    problems.push(`triangles: found non-triangle primitives (modes ${[...new Set(measured.nonTriangleModes)].join(', ')})`);
  }

  // 3. Frame: on the ground, footprint centred on the origin (within 1 mm, whatever the size)
  const ground = measured.box.min[1];
  const [cx, , cz] = measured.box.center;
  if (Math.abs(ground) > ORIGIN_TOLERANCE_M) {
    problems.push(`frame: lowest point is at y = ${ground.toFixed(3)} m; it should be on the ground (y = 0)`);
  }
  if (Math.abs(cx) > ORIGIN_TOLERANCE_M || Math.abs(cz) > ORIGIN_TOLERANCE_M) {
    problems.push(`frame: footprint centre is at x = ${cx.toFixed(3)}, z = ${cz.toFixed(3)} m; it should be at the origin`);
  }

  // 5. Plain colours only
  if (measured.images > 0 || measured.textures > 0 || measured.samplers > 0) {
    problems.push(`colours: found ${measured.images} images, ${measured.textures} textures, ${measured.samplers} samplers; plain colours only`);
  }
  for (const material of measured.materials) {
    const textureKeys = JSON.stringify(material).match(/"[A-Za-z]*Texture"/g);
    if (textureKeys) problems.push(`colours: material "${material.name}" uses ${[...new Set(textureKeys)].join(', ')}`);
  }
  if (measured.vertexColors) problems.push('colours: found per-vertex colours (COLOR_0); plain colours only');

  return problems;
}

/** Run the Khronos glTF validator; returns problems (errors) and warning lines. */
export async function checkWithValidator(bytes, name) {
  const report = await validator.validateBytes(new Uint8Array(bytes), { uri: name, maxIssues: 50 });
  const problems = [];
  const warnings = [];
  for (const message of report.issues.messages) {
    const line = `glTF validator ${message.code} at ${message.pointer ?? '(file)'}: ${message.message}`;
    if (message.severity === 0) problems.push(line);
    else if (message.severity === 1) warnings.push(line);
  }
  if (report.issues.numErrors > 0 && problems.length === 0) problems.push(`glTF validator: ${report.issues.numErrors} errors`);
  return { problems, warnings };
}

/** Check one model; returns { id, problems, warnings, measured }. */
export async function checkModel(dir, id) {
  const problems = [];
  const warnings = [];
  const jsonPath = path.join(dir, `${id}.json`);
  const glbPath = path.join(dir, `${id}.glb`);
  let json;
  try {
    json = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  } catch (error) {
    return { id, problems: [`cannot read ${id}.json: ${error.message}`], warnings, measured: null };
  }
  problems.push(...checkDescription(json, { fileBase: id }));
  const brief = checkAgainstBrief(json, BRIEF[id]);
  problems.push(...brief.problems);
  warnings.push(...brief.warnings);

  let bytes;
  try {
    bytes = fs.readFileSync(glbPath);
  } catch (error) {
    problems.push(`cannot read ${id}.glb: ${error.message}`);
    return { id, problems, warnings, measured: null };
  }
  let measured = null;
  try {
    measured = measureGLB(bytes);
    problems.push(...checkMeasurements(json, measured));
  } catch (error) {
    problems.push(`cannot measure ${id}.glb: ${error.message}`);
  }
  const validation = await checkWithValidator(bytes, `${id}.glb`);
  problems.push(...validation.problems);
  warnings.push(...validation.warnings);
  return { id, problems, warnings, measured, json };
}

/** Check a folder of models. `only` limits the check to some model ids. */
export async function checkFolder(dir = DEFAULT_DIR, { only = [] } = {}) {
  const files = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  const glbs = files.filter((f) => f.endsWith('.glb')).map((f) => f.slice(0, -4));
  const jsons = files.filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5));
  const folderProblems = [];
  // Brief order first, then anything else alphabetically
  const order = Object.keys(BRIEF);
  const rank = (id) => (order.includes(id) ? order.indexOf(id) : order.length);
  let ids = [...new Set([...glbs, ...jsons])].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));

  if (only.length > 0) {
    for (const id of only) if (!ids.includes(id)) folderProblems.push(`${id}: no .glb or .json found`);
    ids = ids.filter((id) => only.includes(id));
  } else {
    for (const id of Object.keys(BRIEF)) {
      if (!ids.includes(id)) folderProblems.push(`${id}: model from the brief is missing`);
    }
  }
  for (const id of ids) {
    if (!glbs.includes(id)) folderProblems.push(`${id}: has a .json but no .glb`);
    if (!jsons.includes(id)) folderProblems.push(`${id}: has a .glb but no .json`);
  }

  const results = [];
  for (const id of ids.filter((i) => glbs.includes(i) && jsons.includes(i))) {
    results.push(await checkModel(dir, id));
  }
  const failed = folderProblems.length > 0 || results.some((r) => r.problems.length > 0);
  return { results, folderProblems, failed };
}

function formatSize(size) {
  return size.map((v) => v.toFixed(3)).join(' x ');
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { dir: { type: 'string' } },
  });
  const dir = path.resolve(values.dir ?? DEFAULT_DIR);
  console.log(`Checking models in ${path.relative(process.cwd(), dir) || '.'}`);
  console.log(`Limits: sizes within ${SIZE_TOLERANCE * 100}% of the JSON, under ${TRIANGLE_LIMIT} triangles\n`);

  const { results, folderProblems, failed } = await checkFolder(dir, { only: positionals });
  for (const r of results) {
    const verdict = r.problems.length === 0 ? 'PASS' : 'FAIL';
    const facts = r.measured
      ? `${formatSize(r.measured.box.size)} m measured (x, y, z), ${r.measured.triangles} triangles`
      : 'not measured';
    console.log(`${verdict}  ${r.id}: ${facts}`);
    if (r.json?.dimensions_m) {
      const d = r.json.dimensions_m;
      console.log(`      JSON: ${d.width_x} x ${d.height_y} x ${d.depth_z} m, ${r.json.triangles} triangles, status "${r.json.status}"`);
    }
    for (const [name, box] of Object.entries(r.measured?.nodes ?? {})) {
      if ((r.json?.parts ?? []).some((p) => p.node === name)) console.log(`      part ${name}: ${formatSize(box.size)} m measured`);
    }
    for (const p of r.problems) console.log(`      x ${p}`);
    for (const w of r.warnings) console.log(`      ! ${w}`);
  }
  for (const p of folderProblems) console.log(`FAIL  ${p}`);
  console.log(failed ? '\nRESULT: FAIL' : `\nRESULT: PASS (${results.length} models)`);
  process.exitCode = failed ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
