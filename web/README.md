# Lunar Landing Site Navigator — website (`web/`)

Team Common Horizon, NASA Space Apps 2026, challenge "Lunar Landing Site Navigator".

The website helps a mission planner pick a lunar landing site and date: choose hardware, see sites
ranked for sunlight, Earth contact and power, and see how a launch delay ("slip") changes the
ranking. Every number comes from the Python backend in `backend/`. Until the backend is connected,
the website runs on **example answers** (mock mode) so it can be shown and tested on its own.

## Run it on your computer

You need Node.js 22 or newer (it includes `npm`). Then, in a terminal:

```bash
cd web
```

```bash
npm install
```

```bash
npm run dev
```

The terminal prints an address such as `http://localhost:5173/`. Open it in a browser.
Press `Ctrl+C` in the terminal to stop the server.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Starts a development server that reloads when you save a file. |
| `npm run build` | Builds the static website into `web/dist/` (plain HTML, CSS and JS; no server needed). |
| `npm run preview` | Serves the built `dist/` folder at `http://localhost:4173/` to check the build. |
| `npm run typecheck` | Checks the TypeScript types without building. |
| `npm test` | Runs the unit tests (Vitest). |
| `npm run test:e2e` | Builds, serves and runs the browser test (Playwright) at a desktop and a phone width. |

Before the first `npm run test:e2e` on a new computer, install the test browser once:

```bash
npx playwright install chromium
```

## Mock mode and the backend

`src/api/client.ts` is the only file that talks to the network.

* **`VITE_API_BASE` unset or empty → mock mode.** Answers come from `src/api/examples/*.json`
  and a small mock model in `src/api/mock/`. The top bar shows an "Example data" badge.
* **`VITE_API_BASE` set → live mode.** Copy `.env.example` to `.env.local` and set the address:

  ```bash
  cp .env.example .env.local
  ```

  then edit `.env.local`, for example `VITE_API_BASE=http://localhost:8000`, and restart `npm run dev`.

The mock answers change with the slip (the Sun's position over each site moves through the lunar
day), so the ranking visibly reorders. They are **not** real data: the geometry is simplified and the
terrain is invented. See `src/api/examples/mock-model.json`.

To see the other states on purpose in mock mode, add one of these to the page address:

| Address ending | Shows |
| --- | --- |
| `?mock=slow` | the waiting state (every answer takes 2.5 s) |
| `?mock=empty` | the empty state (answers with nothing in them) |
| `?mock=error` | the error state (every call fails, with a "Try again" button) |
| `?assistant=off` | the assistant's fifth state: unavailable |
| `?webgl=off` | the flat 2D Moon used when a browser has no 3D (WebGL) |

### API calls (provisional)

The types in `src/api/types.ts` are hand-written and marked **provisional**: they will be
regenerated from the backend's OpenAPI file. Sample answers the website expects are in
`src/api/examples/*.sample.json` (kept in step with the mock by a test).

| Call | Method and path | Purpose |
| --- | --- | --- |
| health | `GET /health` | Is the backend up; is the assistant available? |
| site list | `GET /sites` | Preset sites (latitude, east longitude 0–360). |
| catalog | `GET /catalog` | Hardware rows for the planner. |
| evaluate | `POST /evaluate` | Score each site for a launch time (UTC), slip (0–30 days), stay (days) and hardware. |
| horizon | `POST /horizon` | Skyline, the Sun's path (above / hidden) and Earth's box for one site and time window. |
| fit and power check | `POST /check` | Does the hardware fit; day and night power checks. |
| ask the assistant | `POST /assistant` | Text answer only. The assistant never controls the interface. |

Every call shows four states in the interface — waiting, answer, empty, error — and the assistant
has a fifth: unavailable (the backend answers HTTP 503, or `/health` says so).

## How the screen is organised

* **Top bar** (always): launch date and time (UTC), slip 0 to +30 days, UTC / LTC switch and, in the
  site scene, Play.
* **Mission planner** (right; a drawer on phones): hardware rows, the power balance number (tap it for
  the day and night checks), stay length 1–365.25 days, and the Earth link indicator.
* **Assistant** (bottom, always).
* **View 1**: the Moon with Sun and Earth markers ("not to scale"). Click the Moon (or "Show landing sites").
* **View 2**: site markers and the floating, movable Sites pane (coordinates, presets, ranked list,
  compact horizon plot). Click a site once to highlight it, again to open it.
* **View 3**: the site scene (placeholder ground), "Back to Moon", zoom buttons and the horizon plot.

**Time.** LTC (model value) = UTC + 56.02 microseconds for every day counted from the landing time.
The lunar time standard is still being defined, so it is labelled as a model value.

**Power colours.** Margin of 25 % or more: green. From 0 % up to 25 %: yellow (exactly 0 % counts as
yellow). Below 0 %: red. The word next to the number repeats the meaning.

## Folder map

```
web/
  index.html               page shell
  src/main.tsx             start-up
  src/App.tsx              layout: top bar, workspace, planner, assistant
  src/api/                 client.ts (network), types.ts (provisional), mock/, examples/
  src/state/               app state, data loading, the four-state hook
  src/components/          top bar, planner, sites pane, horizon plot, compare panel, assistant
  src/scene/               3D Moon, 2D fallback, site scene, texture slot
  src/util/                time (LTC), geometry (longitudes), power colours, ranking
  src/styles/theme.css     every colour, as CSS variables (brand colours go here)
  e2e/path.spec.ts         the browser test
  public/textures/         slot for the Moon colour map (see its README)
```

`public/models/` belongs to another part of the team; this folder does not touch it.

## Sources

Libraries, data, figures and licences are listed in [`SOURCES-web.md`](./SOURCES-web.md).
