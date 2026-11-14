# Sources: lunar hardware models lane

Covers `tools/models/` and the files it writes to `web/public/models/`.

**About the links:** a link appears here only if we opened it ourselves. The build machine
for this lane could not reach the source websites (its network blocks them), so every source
below says "link to add". The figures were given to the team in the brief for this lane; we
have not yet checked them against the original documents ourselves.

## Figures used in the models

| Model | Figure | Value | Source | Label | Link |
|---|---|---|---|---|---|
| Starship lander (stand-in) | Overall height | 52 m | NASA paper at IAC 2025 (Creech), as tabulated in Wikipedia's Starship HLS article | NASA figure, secondary source | link to add |
| Starship lander (stand-in) | Diameter ("across") | 9 m | Same as above | NASA figure, secondary source | link to add |
| Habitat unit | Inflatable section: diameter, height | about 6.5 m, 5.2 m | Burke, Howard and Kessler, AIAA ASCEND 2022 | NASA study | link to add |
| Habitat unit | Metal section: diameter, height | 4.4 m, 2.6 m | Same as above | NASA study | link to add |
| Fission power unit | Stowed size (cylinder): diameter, height | 4 m, 6 m | Kaldon et al., IAC 2024, NASA Technical Reports Server 20240011694 | NASA goal | link to add |
| Solar array mast | Height, panel width | 10 m, 4 m (defaults) | None on file; parameters | our estimate, to be replaced by a published figure | none |
| Griffin lander | Overall height | about 2 m | Space.com's report of the 15 June 2026 unveiling | company figure, secondary source | link to add |
| Griffin lander | Overall width | about 4.5 m | Voyager's lunar missions page | company figure, secondary source | link to add |

### Our own estimates and illustrations (not from any source)

These are listed in each model's JSON under `simplifications` as well.

- **Starship lander:** nose length 14 m, 2 m gap under the hull, six legs with 0.5 m foot pads,
  six engine bells. All kept inside the 9 m diameter.
- **Habitat unit:** how the two sections join (inflatable stacked on top of the metal section,
  giving 7.8 m overall); the rounded-drum outline of the inflatable; the 1.1 m by 1.6 m hatch.
- **Fission power unit:** the radiator panels (two wings of two 2.4 m by 3.6 m panels, 14 m tip
  to tip) are an illustration only; so is the two-tone split of the body.
- **Solar array mast:** every size (2 m square base, mast thickness, panel height), as well as
  the 10 m and 4 m defaults.
- **Griffin lander:** square 4.5 m by 4.5 m leg footprint (legs on the diagonals); deck, tanks,
  engine, payload boxes, side panel and antenna.

## Libraries, tools and services

| Name | Version | Used for | License | Maintained by | Origin check | Link |
|---|---|---|---|---|---|---|
| three.js (npm package `three`) | 0.187.0 (pinned) | Building the shapes, writing `.glb` files (GLTFExporter), merging geometry (BufferGeometryUtils), and the 3D views on the review page (GLTFLoader) | MIT | Ricardo Cabello (mrdoob) and the three.js contributors; npm maintainers mrdoob and mugen87 (Michael Herzog) | Open-source project started in Spain; not of Chinese origin | link to add |
| glTF Validator (npm package `gltf-validator`) | 2.0.0-dev.3.10 (pinned, dev only) | Second, independent validity check in `check-models.mjs` | Apache-2.0 | The Khronos Group (npm maintainers khronos and emackey) | Khronos Group, a US standards consortium; not of Chinese origin | link to add |
| Node.js and its built-in modules (`node:test`, `node:http`, `node:fs`, `node:util`) | 22 or newer | Running the scripts, the unit tests and the preview server | MIT | OpenJS Foundation and Node.js contributors | US foundation; not of Chinese origin | link to add |
| jsDelivr CDN | n/a | Default place the review page loads three.js 0.187.0 from (`?three=local` avoids it) | Free public CDN for open-source packages | jsDelivr (Prospect One, Poland) | Polish service; not of Chinese origin | link to add |
| Playwright | as installed on the build machine (not in package.json) | Optional page test `npm run test:page` and its screenshots | Apache-2.0 | Microsoft | US company; not of Chinese origin | link to add |

No other packages are installed: `three` has no dependencies of its own, and
`gltf-validator` ships as a single bundled file.

## Datasets, images and 3D models

- **Datasets:** none.
- **Images and textures:** none. The models use plain colours only.
- **3D models from elsewhere:** none. Every shape is built by the code in this folder, written
  fresh for this repository.
- **Logos, insignia, flags, lettering:** none, anywhere. Names appear as plain text only.

## SI/AI use

Super Intelligence (SI) / artificial intelligence (AI) use in this lane: the lane was built with
**Claude Code (Anthropic)**, running the Claude Opus 5.5 model. It wrote the model scripts, the
shared geometry code, the GLB reader, the check script, the unit tests, the review page, the
preview server, the JSON descriptions and this file, and it ran the checks. A separate Claude
Code reviewer agent, which did not write the code, reviewed the work and ran the tests itself.
Every model's JSON carries the note "illustrative shape, built with SI/AI-written code". The
team reviews the result at the afternoon review.
