# Lunar hardware models

Simple 3D models of lunar hardware at true scale, for the website, in `web/public/models/`.
Each model is a `.glb` file (the 3D shape) with a `.json` file beside it (its sizes, where each
size comes from, a status label, the triangle count, and how the shape was made). There are
three kinds, and each model's JSON says which it is (`"kind"`) with its own exact note:

| Kind | Made by | Note in the JSON |
|---|---|---|
| `code-built` | a script in this folder, drawn from the sizes in its JSON | "illustrative shape, built with SI/AI-written code" |
| `imported` | a community CAD model, finished by `finish-model.mjs` | "illustrative shape from a community CAD model; not the manufacturer's data" |
| `generated` | TRELLIS.2 from a photo, finished by `finish-model.mjs` | "illustrative shape, SI/AI-generated from a photo; not the manufacturer's data" |

- Units are meters, Y is up, and the origin is the centre of the footprint on the ground.
- Plain colours only: no textures, logos, flags or lettering.
- Each model stays under 20,000 triangles.
- Sources and licenses: [SOURCES-models.md](SOURCES-models.md).

| Script | Model |
|---|---|
| `starship-lander.mjs` | Starship lander stand-in, 52 m tall, 9 m across |
| `habitat-unit.mjs` | Habitat unit: inflatable section on a metal section |
| `fission-power-unit.mjs` | Fission power unit, 4 m by 6 m stowed, radiators shown as an illustration |
| `solar-array-mast.mjs` | Solar array mast; height and panel width are parameters |
| `griffin-lander.mjs` | Griffin lander, about 2 m tall and 4.5 m wide |
| `finish-model.mjs` | Finishes an imported or generated model (see below) |

## How to run it

You need Node.js 22 or newer. In a terminal, from this folder
(`tools/models`):

```bash
npm install
```

```bash
npm run build
```

`npm install` downloads three.js and the glTF validator into `node_modules/` (not committed).
`npm run build` rebuilds the five code-built models. Building is repeatable: the same code always
writes the same bytes, so after a rebuild `git status` shows no change unless the code changed.

To build one model, run its script, for example `node habitat-unit.mjs`. The solar array
mast takes sizes in meters:

```bash
node solar-array-mast.mjs --height 12 --panel-width 5
```

(The committed files use the defaults, 10 m and 4 m. Run `node solar-array-mast.mjs` to go back.)

## Finishing an imported or generated model

```bash
node finish-model.mjs --input <raw.glb> --spec <spec.json>
```

It reads every triangle of the raw file and keeps only the shape: textures, images, UV
coordinates, per-vertex colours and materials are dropped and the shape gets one neutral grey
material. It turns the shape by `finishing.rotate_deg` so Y is up and the front faces +Z (turns
about the shape's own axes: X, then the new Y, then the new Z), can drop small loose pieces
(`finishing.drop_loose_parts_below`, a share of all triangles), can flatten anything hanging
below the wheels (`finishing.flatten_below`, a share of the height above the lowest point),
scales it evenly so its height matches the published figure in the `height_y` entry of
`dimension_sources`, and stands it on the origin. Width and depth are then measured from the
shape (status "our estimate", with any published figure shown beside them for comparison).
It refuses to write a shape with 20,000 triangles or more, an empty shape or a flat one. `--dry-run` prints the result
without writing; `--out-dir` writes somewhere other than `web/public/models/`.

The spec has the same layout as the finished JSON, so to repeat the step pass the finished JSON
back in: `node finish-model.mjs --input <raw.glb> --spec ../../web/public/models/<id>.json`. With
the same raw file (its SHA-256 is in the JSON under `finishing.input_sha256`) it writes the same
bytes. Raw files are kept outside the repository by the team.

## Checks

```bash
npm run check
```

Loads every `.glb` with its own small reader (not three.js), measures the bounding box and the
triangle count, and fails if a size is more than 1 percent off its JSON, if a model has
20,000 triangles or more, if the model is more than 1 mm off the ground or off centre, if the
solar array mast was not built with its default sizes, if the JSON disagrees
with the brief (`brief-figures.mjs`), if a model uses textures or vertex colours, or if the
Khronos glTF validator reports an error. It also fails if a model's `"kind"` is missing or its
note is not the exact note for its kind, if an imported model does not name its author, source
address (a real https address) and terms, if a generated model does not name the picture's
credit, the model (TRELLIS.2), the service, the request id and a real date, or if a published
figure shown beside a size lacks its value, source, status or difference.

```bash
npm test
```

Unit tests (Node's built-in test runner): geometry helpers, every model's size and surface
direction, the solar mast parameters, and that each check really fails on bad input.

```bash
npm run test:page
```

Optional. Opens the review page in a headless browser and checks it, if Playwright is installed.

## Review page

```bash
npm run preview
```

Then open <http://localhost:8080/?three=local>. The page lists every model with its sizes and
sources and shows each one turning. Without `?three=local` the page loads three.js from the
jsDelivr CDN instead of from `node_modules/`, which is how it works on the website at
`/models/index.html`.

## Folder layout

- `*.mjs` (top level): one script per code-built model, plus `finish-model.mjs`, `build-all.mjs`, `check-models.mjs`,
  `brief-figures.mjs` (the brief's figures, used only by the check) and `preview-server.mjs`.
- `shared/`: geometry helpers, GLB export, the independent GLB reader, shared constants.
- `test/`: unit tests. `test-page/`: the optional browser test.
