# Sources: lunar hardware models lane

Covers `tools/models/` and the files it writes to `web/public/models/`.

**About the links:** a link appears here only if we opened it ourselves. The build machine
for the first five models could not reach the source websites (its network blocks them), so
their sources say "link to add"; those figures were given to the team in the brief for this
lane and we have not yet checked them against the original documents ourselves. For the
imported and generated models (second batch, 15 November 2026) every link below was opened on
15 November 2026.

## Figures used in the models

We use only single numbers (sizes) from these sources, cited, not their text or images. The
"License or terms" column says what we know about each source; where we have not been able to
read the source's own license or terms, it says "to check".

| Model | Figure | Value | Source | Label | License or terms | Link |
|---|---|---|---|---|---|---|
| Starship lander (stand-in) | Overall height | 52 m | NASA paper at IAC 2025 (Creech), as tabulated in Wikipedia's Starship HLS article | NASA figure, secondary source | Paper: license to check. Wikipedia text is CC BY-SA 4.0; we reuse only the cited number, no text. | link to add |
| Starship lander (stand-in) | Diameter ("across") | 9 m | Same as above | NASA figure, secondary source | Same as above | link to add |
| Habitat unit | Inflatable section: diameter, height | about 6.5 m, 5.2 m | Burke, Howard and Kessler, AIAA ASCEND 2022 | NASA study | Conference paper published by AIAA: license to check; cited figure only | link to add |
| Habitat unit | Metal section: diameter, height | 4.4 m, 2.6 m | Same as above | NASA study | Same as above | link to add |
| Fission power unit | Stowed size (cylinder): diameter, height | 4 m, 6 m | Kaldon et al., IAC 2024, NASA Technical Reports Server 20240011694 | NASA goal | Terms on the NTRS record: to check; cited figure only | https://ntrs.nasa.gov/citations/20240011694 (record opened 15 November 2026) |
| Solar array mast | Height, panel width | 10 m, 4 m (defaults) | None on file; parameters | our estimate, to be replaced by a published figure | Our own estimate (this repository's Apache-2.0 license) | none |
| Griffin lander | Overall height | about 2 m | Space.com's report of the 15 June 2026 unveiling | company figure, secondary source | News article, publisher's terms: to check; cited figure only | link to add |
| Griffin lander | Overall width | about 4.5 m | Voyager's lunar missions page | company figure, secondary source | Company web page, site terms: to check; cited figure only | link to add |
| Blue Moon Mark 1 cargo lander (imported) | Overall height | 8.05 m ("8.05 meters tall with a diameter of 3.08 meters") | SpaceNews, "NASA payload to fly on first Blue Origin lunar lander mission", Jeff Foust, 12 August 2024, reporting the maker's FCC filing | company figure, secondary source | News article, publisher's terms; cited figure only | https://spacenews.com/nasa-payload-to-fly-on-first-blue-origin-lunar-lander-mission/ |
| VIPER rover (generated) | Overall height | 2.5 m (5 by 5 by 8 feet, 1.5 by 1.5 by 2.5 m) | NASA Science, VIPER In Depth (page updated 19 March 2024) | NASA figure | NASA web page; cited figure only | https://science.nasa.gov/mission/viper/in-depth |
| VIPER rover (generated) | Footprint, for comparison only | 1.7 m by 1.7 m | Bluethmann, VIPER Rover Overview and Mobility and Hardware, 14 November 2024, NASA Technical Reports Server 20240013903 | NASA figure | NTRS record terms; cited figure only | https://ntrs.nasa.gov/api/citations/20240013903/downloads/LSIC_2024-Tech%20Infusion_Panel-VIPER_Mob-HW.pdf |
| Crew rover (generated) | Overall height, to the top of the antenna | about 2.6 m | Maker's news page, "NASA Selects Astrolab to Provide Lunar Rover for Artemis Astronauts' Return to the Moon", 26 May 2026 | company figure (maker's own page) | Company web page, site terms; cited figure only | https://astrolab.space/2026/05/26/nasa-selects-astrolab-to-provide-lunar-rover-for-artemis-astronauts-return-to-the-moon/ |
| Crew rover (generated) | Length and width, for comparison only | about 4 m and 2.3 m | Same page | company figure (maker's own page) | Same as above | https://astrolab.space/2026/05/26/nasa-selects-astrolab-to-provide-lunar-rover-for-artemis-astronauts-return-to-the-moon/ |
| Pressurized rover (generated) | Overall height | 4.85 m (L x W x H = 6.44 m x 4.84 m x 4.85 m) | JAXA Human Spaceflight Technology Directorate, progress report on the crewed pressurized rover (document 99-3, 29 September 2025, filed with the MEXT space development committee), page 8 | JAXA figure | Government committee document; cited figure only | https://www.mext.go.jp/content/20250929-mxt_uchukai01-000045059_005.pdf |
| Pressurized rover (generated) | Length and width, for comparison only | 6.44 m and 4.84 m | Same report | JAXA figure | Same as above | https://www.mext.go.jp/content/20250929-mxt_uchukai01-000045059_005.pdf |

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
- **Imported and generated models:** only the height comes from a published figure; each shape
  is scaled evenly to it, and its width and depth are measured from the scaled shape (status
  "our estimate"). Blue Moon: 4.741 m at the rim of the top deck and 4.30 m across the landing
  leg foot pads, from the community CAD model (no published figure for either; the published
  3.08 m is the body diameter, and at the published height the CAD body is about 3.8 to 4.0 m
  across). VIPER: 1.749 m wide and 1.839 m long, from the generated shape, against NASA's 1.7 m
  by 1.7 m; its lowered drill was flattened to the bottom of the wheels so the 2.5 m runs from
  the wheels to the top of the mast. Crew rover: 2.535 m wide and 3.375 m long, against the
  maker's 2.3 m and 4 m. Pressurized rover:
  4.304 m wide and 6.854 m long, against JAXA's 4.84 m and 6.44 m.

## Imported and generated models

Finished by `finish-model.mjs` (every texture, colour and image removed, one plain grey
material, turned Y up, scaled evenly to the published height, stood on the origin). The raw
files and input pictures are kept by the team outside the repository; each model's JSON records
the raw file's SHA-256, and generated models record the request id.

| Model | Kind | Shape from | Author or picture credit | Terms | Made with | Request id, date | Note in the JSON |
|---|---|---|---|---|---|---|---|
| Blue Moon Mark 1 cargo lander (`blue-moon-mk1`) | imported | Onshape public document "Blue Moon", assembly "Blue Moon Mk1" (https://cad.onshape.com/documents/cc88aa273c89627a864e4c71/w/ae9127fe16876b483f50c07c/e/a0b9d18a7b5130719bd45a0d), exported as GLB on 15 November 2026 | **David Nagy** (author shown in the document's version history) | Onshape Terms of Use (effective 15 July 2020), section 1, item 7 "Intellectual Property", the paragraph on public documents owned by Free Plan users: worldwide, royalty-free, non-exclusive licence to use, copy, modify, publish and distribute (https://www.onshape.com/en/legal/terms-of-use). Onshape's public record of the document: public, owned and created by David Nagy on 26 July 2025, not enterprise-owned. Whether the owner is on the Free Plan, which the clause requires, could not be confirmed from outside. No LICENSE tab seen on 15 November 2026. | Onshape export; Blender 5.3 (reduced from 1,515,782 to 18,978 triangles; the maker's name, mark and lettering recoloured to the surface around them); `finish-model.mjs` | not applicable; exported 15 November 2026 | "illustrative shape from a community CAD model; not the manufacturer's data" |
| VIPER rover (`viper-rover`) | generated | NASA illustration ACD20-0047, "VIPER Drill" (2019 design), cropped to the rover | **Daniel Rutter, NASA Ames Research Center** | NASA image; NASA's media usage guidelines (no NASA insignia in our model) | TRELLIS.2 (`fal-ai/trellis-2`, Microsoft, MIT) on fal.ai, direct run, seed 42, resolution 1024, decimation target 18,000; `finish-model.mjs` | 01a1e06f-bb95-7f42-bc41-27cc7c445683, 15 November 2026 | "illustrative shape, SI/AI-generated from a photo; not the manufacturer's data" |
| Crew rover (`crew-rover`) | generated | A team member's own photo of a full-size display mockup of the rover (front view, exhibition, 8 November 2026); everything outside the vehicle painted white and the maker's name, flag decals and NASA insignia covered before sending | **Dan Lee-Odinson** (team member's own photo) | The team member's own photo, used with the photographer's permission; the photo is not published | TRELLIS.2 (`fal-ai/trellis-2`, Microsoft, MIT) on fal.ai, direct run, seed 42, resolution 1024, decimation target 18,000; `finish-model.mjs` | 01a1e07b-f7d0-7c83-84df-fbbd69871994, 15 November 2026 | "illustrative shape, SI/AI-generated from a photo; not the manufacturer's data" |
| Pressurized rover (`pressurized-rover`) | generated | A team member's own photo of a scale model of the rover in a display case (left side, exhibition, 8 November 2026); everything outside the model, including two people behind the case and two figurines, painted white before sending | **Dan Lee-Odinson** (team member's own photo of a scale model) | The team member's own photo, used with the photographer's permission; the photo is not published | TRELLIS.2 (`fal-ai/trellis-2`, Microsoft, MIT) on fal.ai, direct run, seed 42, resolution 1024, decimation target 18,000; `finish-model.mjs` | 01a1e085-3896-7211-8d26-39bed833541a, 15 November 2026 | "illustrative shape, SI/AI-generated from a photo; not the manufacturer's data" |

### Input pictures (none of them is in the repository)

| Picture | Used for | Credit | Source | What was sent, and where |
|---|---|---|---|---|
| `viper-rover-2.jpg` (1920 by 1080), NASA image ACD20-0047, an illustration | VIPER rover | Daniel Rutter, NASA Ames Research Center | https://science.nasa.gov/image-detail/amf-acd20-0047/ | A 654 by 805 crop around the rover (sky, ground and the drill cuttings left in), with metadata removed, to TRELLIS.2 on fal.ai, 15 November 2026 |
| `astrolab-1.jpg` (3072 by 4080), a team member's own phone photo | Crew rover | Dan Lee-Odinson | Own photo, exhibition, 8 November 2026; not published | A 1512 by 1392 crop of the vehicle only, everything else painted white and the markings on the vehicle covered with the colour around them (by a local Pillow script; no image model), location and all other metadata removed, to TRELLIS.2 on fal.ai, 15 November 2026 |
| `jaxa-pressure-1.jpg` (3072 by 4080), a team member's own phone photo of a scale model | Pressurized rover | Dan Lee-Odinson | Own photo, exhibition, 8 November 2026; not published | A 1681 by 1330 crop of the scale model only, everything else (people, figurines, floor, reflections) painted white (by a local Pillow script; no image model), location and all other metadata removed, to TRELLIS.2 on fal.ai, 15 November 2026 |

## Libraries, tools and services

| Name | Version | Used for | License | Maintained by | Origin check | Link |
|---|---|---|---|---|---|---|
| three.js (npm package `three`) | 0.187.0 (pinned) | Building the shapes, writing `.glb` files (GLTFExporter), merging geometry (BufferGeometryUtils), and the 3D views on the review page (GLTFLoader) | MIT | Ricardo Cabello (mrdoob) and the three.js contributors; npm maintainers mrdoob and mugen87 (Michael Herzog) | Open-source project started in Spain; not of Chinese origin | link to add |
| glTF Validator (npm package `gltf-validator`) | 2.0.0-dev.3.10 (pinned, dev only) | Second, independent validity check in `check-models.mjs` | Apache-2.0 | The Khronos Group (npm maintainers khronos and emackey) | Khronos Group, a US standards consortium; not of Chinese origin | link to add |
| Node.js and its built-in modules (`node:test`, `node:http`, `node:fs`, `node:util`) | 22 or newer | Running the scripts, the unit tests and the preview server | MIT | OpenJS Foundation and Node.js contributors | US foundation; not of Chinese origin | link to add |
| jsDelivr CDN | n/a | Default place the review page loads three.js 0.187.0 from (`?three=local` avoids it) | Free public CDN for open-source packages | jsDelivr (Prospect One, Poland) | Polish service; not of Chinese origin | link to add |
| Playwright | as installed on the build machine (not in package.json) | Optional page test `npm run test:page` and its screenshots | Apache-2.0 | Microsoft | US company; not of Chinese origin | link to add |
| TRELLIS.2 (model `fal-ai/trellis-2`) | as served by fal.ai on 15 November 2026 | Making the generated shapes from a picture (not used by any code in the repository) | MIT (code and weights) | Microsoft | Published by Microsoft (US). Developed at Microsoft Research Asia in Beijing, with co-authors from Tsinghua University and the University of Science and Technology of China, and trained partly on the TexVerse dataset from Chinese universities (see the note below the table). The project plan names it as the only allowed 3D generator; whether that settles the project's rule of nothing of Chinese origin for this tool is the team's decision, not yet recorded here. | https://github.com/microsoft/TRELLIS.2 |
| fal.ai | n/a | Hosted service that ran TRELLIS.2 (paid per request; the request ids are in each generated model's JSON) | Service terms | Features and Labels, Inc. (fal.ai) | US company; not of Chinese origin | https://fal.ai |
| Onshape | n/a | Where the Blue Moon CAD model is published; export to GLB | Onshape Terms of Use | PTC Inc. | US company; not of Chinese origin | https://www.onshape.com/en/legal/terms-of-use |
| Blender | 5.3 | Reducing the Blue Moon CAD export to under 20,000 triangles (outside the repository) | GPL-3.0-or-later | Blender Foundation | Dutch foundation; not of Chinese origin | https://www.blender.org |
| Pillow (Python) | 12.3.0 | Cropping the input pictures, painting everything outside the vehicles white, covering markings and removing metadata (outside the repository) | HPND (MIT-CMU) | Jeffrey A. Clark and the Pillow contributors | Open-source project led from the US; not of Chinese origin | https://python-pillow.github.io |
| NumPy (Python) | 2.5.0 | Pixel arithmetic in the same picture scripts (outside the repository) | BSD-3-Clause | NumPy developers (NumFOCUS-sponsored project) | US-based open-source project; not of Chinese origin | https://numpy.org |

**About TRELLIS.2.** Sources for the origin facts above: the Microsoft Research article on
TRELLIS.2 (https://www.microsoft.com/en-us/research/articles/trellis-2/), the project page with
the authors' affiliations (https://microsoft.github.io/TRELLIS.2), and the paper (arXiv
2512.14692), which says the model was trained on about 800,000 assets "augmented with TexVerse"
(TexVerse, arXiv 2508.10868, comes from the Shanghai Innovation Institute, Jilin, Fudan and Tongji
universities). The published pipeline (https://huggingface.co/microsoft/TRELLIS.2-4B) also loads
Meta's DINOv3 image encoder (DINOv3 License) and, for a picture without transparency, a
background-removal model: BRIA AI's RMBG-2.0 weights (CC BY-NC 4.0) on the BiRefNet architecture
(Nankai University and others). fal.ai does not say whether its hosted version runs these; our
three pictures had no transparency, so if it follows the published pipeline it did. A picture
with a transparent background would skip that step.

`finish-model.mjs` needs no new library: it reads the raw file with this folder's own GLB reader
and writes with three.js. No other packages are installed: `three` has no dependencies of its own, and
`gltf-validator` ships as one bundled file. `gltf-validator` is a development dependency: it is
needed for `npm run check`, not by the website.

### Code bundled inside gltf-validator

From the package's own `NOTICES` file (`node_modules/gltf-validator/NOTICES`), which we read:

| Bundled code | License | Copyright holders | Origin check |
|---|---|---|---|
| Dart SDK and the Dart packages args, collection, isolate, meta, path, source_span, string_scanner, term_glyph | BSD-3-Clause | The Dart project authors (Dart is led by Google) | US; not of Chinese origin |
| vector_math | BSD-3-Clause and a zlib-style license | Google Inc.; Andrew Magill | US; not of Chinese origin |
| yaml (Dart port) | MIT | The Dart project authors; Kirill Simonov (author of the original PyYAML) | Not of Chinese origin |
| node_preamble | MIT | Michael Bullington | Not of Chinese origin |
| PrismJS | MIT | Lea Verou | Not of Chinese origin |

## Datasets, images and 3D models

- **Datasets:** none.
- **Images and textures:** none in the repository. The models use plain colours only; the
  generated models were made from pictures listed above, which are kept outside the repository.
- **3D models from elsewhere:** one, the Blue Moon Mark 1 community CAD model by David Nagy
  (above). The five code-built shapes are built by the code in this folder, written fresh for
  this repository. The generated shapes were made by TRELLIS.2 from the pictures listed above.
- **Logos, insignia, flags, lettering:** none, anywhere. Names appear as plain text only.

## SI/AI use

Super Intelligence (SI) / artificial intelligence (AI) use in this lane: the lane was built with
**Claude Code (Anthropic)**, running the Claude Opus 5.5 model. It wrote the model scripts, the
shared geometry code, the GLB reader, the check script, the unit tests, the review page, the
preview server, the JSON descriptions and this file, and it ran the checks and the deliberate
failure tests. A separate Claude Code reviewer agent, which did not write the code, then ran
the build, the check and all tests itself (all passed) and tried its own breaks. It reported
one blocker (this file had no license column for the figure sources, now added) and several
should-fix items (a check tolerance that was too loose, misleading wording on the page, the
Griffin legs on the diagonals, a solar panel that looked like a banner); the fixes are in the
pull request. Every code-built model's JSON carries the note "illustrative shape, built with
SI/AI-written code". The team reviews the result at the afternoon review.

Second batch (imported and generated models, 15 November 2026): also built with **Claude Code
(Anthropic)**, running the Claude Opus 5.5 model, with one agent per generated model. It wrote
`finish-model.mjs`, the check's rules for the three kinds of model and their tests, the review
page changes and this file's new rows; it cropped the input pictures, looked up the published
sizes, ran the TRELLIS.2 requests listed above (one at a time, each crop approved by a team
member first) and finished the models. The pictures were cropped and masked by local Python
scripts (Pillow), not by an image model; no Nano Banana 2 cleanup was used. Four separate Claude
Code reviewer agents, which did not write the work, then checked the rules, the code, the
finished shapes and every source; their findings (among them Blue Moon's width, which is set by
the top deck, not the legs, and VIPER resting on its drill) were fixed in the pull request. The
generated shapes themselves are SI/AI-generated by TRELLIS.2 and say so in their note.
