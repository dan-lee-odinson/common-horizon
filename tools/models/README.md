# Lunar hardware models (code-built)

Scripts in this folder build simple 3D models of lunar hardware, drawn at true scale from the
sizes in each model's JSON (published figures where we have them, our own estimates where
marked), and write them to `web/public/models/` for the website. Each model is a `.glb` file (the 3D shape) with a
`.json` file beside it (its sizes, where each size comes from, a status label and the
triangle count).

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
`npm run build` rebuilds all five models. Building is repeatable: the same code always
writes the same bytes, so after a rebuild `git status` shows no change unless the code changed.

To build one model, run its script, for example `node habitat-unit.mjs`. The solar array
mast takes sizes in meters:

```bash
node solar-array-mast.mjs --height 12 --panel-width 5
```

(The committed files use the defaults, 10 m and 4 m. Run `node solar-array-mast.mjs` to go back.)

## Checks

```bash
npm run check
```

Loads every `.glb` with its own small reader (not three.js), measures the bounding box and the
triangle count, and fails if a size is more than 1 percent off its JSON, if a model has
20,000 triangles or more, if the model is more than 1 mm off the ground or off centre, if the
solar array mast was not built with its default sizes, if the JSON disagrees
with the brief (`brief-figures.mjs`), if a model uses textures or vertex colours, or if the
Khronos glTF validator reports an error.

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

- `*.mjs` (top level): one script per model, plus `build-all.mjs`, `check-models.mjs`,
  `brief-figures.mjs` (the brief's figures, used only by the check) and `preview-server.mjs`.
- `shared/`: geometry helpers, GLB export, the independent GLB reader, shared constants.
- `test/`: unit tests. `test-page/`: the optional browser test.
