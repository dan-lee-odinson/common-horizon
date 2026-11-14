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

  The backend must allow cross-origin requests (CORS) from the address the website is served
  from, unless both are served from the same address.

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
| evaluate | `POST /evaluate` | Score each site for a launch time (UTC), slip (0–30 days), stay (days), hardware and battery storage (kWh). |
| horizon | `POST /horizon` | Skyline, the Sun's path (above / hidden) and Earth's box for one site and time window. |
| fit and power check | `POST /check` | Does the hardware fit; day and night power checks, with battery storage (kWh). |
| ask the assistant | `POST /assistant` | Text answer only. The assistant never controls the interface. |

Every call shows four states in the interface — waiting, answer, empty, error — and the assistant
has a fifth: unavailable (the backend answers HTTP 503, or `/health` says so).

### Battery storage and the power checks (for the backend)

The planner has a **Battery storage** row: a number typed in kWh (empty or 0 means none). It is not a
catalog row. The website sends it as **`storage_kwh`** (a number, 0 = none) in three requests:
`POST /evaluate`, `POST /check` and the `context` of `POST /assistant`.

The power numbers follow the planner module's `power_check` (see `planner/README.md`). The backend
can pass these straight through:

| Website field (`src/api/types.ts`) | Planner module |
| --- | --- |
| request `storage_kwh` | `power_check(storage_kwh=...)` |
| `night.longest_darkness_h` | `longest_darkness_h`: the longest unbroken darkness inside the stay, from the physics engine. `null` when no site is picked. |
| `day.refill_hours` | `refill_hours` (default: one lunar month, 708.73 h, minus the longest darkness) |
| `day`: `generation_kw`, `load_kw`, `refill_kw`, `refill_kwh`, `margin_percent`, `status`, `passes` | `day`: `available`, `load_kw`, `refill_kw`, `refill_kwh`, `margin_percent`, `status`, `passes` |
| `night`: `generation_kw`, `load_kw`, `per_night_kwh`, `storage_kwh`, `storage_needed_kwh`, `available_kwh`, `load_kwh`, `margin_percent`, `status`, `passes` | `night`: `sources_kw`, `load_kw`, `per_night_kwh`, `storage_kwh`, `storage_needed_kwh`, `available_kwh`, `load_kwh`, `margin_percent`, `status`, `passes` |
| `night.basis`: `energy`, `power`, `power only`, `no darkness` | `night.basis`: "energy over the longest darkness", "power: sources in darkness carry the night", "power (no darkness duration given)", "no darkness" |
| `balance`: `margin_percent`, `status`, `limiting` | `balance`: the same three keys |
| `power_notes` | `notes` |
| evaluate: `power_margin_percent`, `power_status` | that site's `balance.margin_percent` and `balance.status` |

* `status` is `green`, `yellow`, `red` or `none`. A margin can be `null` while the status is `red`
  (a load with nothing at all to power it); the website then shows "no supply".
* With no site picked there is no darkness length, so, as in the planner module, the night check
  compares power only and storage is not counted. The planner says so in words.
* The mock copies the planner's arithmetic in `src/api/mock/power.ts` (tests in
  `src/api/mock/power.test.ts` use the planner README's figures). The mock catalog's
  optional `energy_per_night_kwh` stands for per-night items such as rover keep-warm.

## How the screen is organised

* **Top bar** (always): launch date and time (UTC), slip 0 to +30 days, UTC / LTC switch and, in the
  site scene, Play.
* **Mission planner** (right; a drawer on phones): hardware rows, a typed **Battery storage** figure
  (kWh), the power balance number (tap it for the day and night checks), stay length 1–365.25 days,
  and the Earth link indicator. Beside the balance number the words name the check that limits it,
  for example "power short at night". When the night check fails, the planner shows about how much
  storage would cover the picked site's darkness. Try the nuclear generator, then solar panels with
  batteries, at a site with long darkness and at one with short darkness.
* **Assistant** (bottom, always): a one-line question box. Asking opens the conversation as a
  semi-opaque panel floating over the bottom of the workspace, so nothing behind it moves or resizes.
  It keeps the history of questions and answers (at least six lines tall, at most about 40 % of the
  window, scrolling), has **Hide** (or Escape) and **Clear**, and new answers are announced to screen
  readers. When hidden, a button beside the question box shows it again.
* **View 1**: the Moon with Earth and the Sun in the directions the data gives. Earth is drawn at its
  true size beside the Moon (3.67 times the Moon's diameter) and the Sun larger than Earth, both much
  farther out than before; sizes and distances are still **not to scale**, and a note on screen says
  so. Scroll the mouse wheel (or pinch, or use the + / − buttons) to zoom out until Earth and the Sun
  are in view, and back in to the Moon. Edge arrows point to whichever is out of view. Sunlight on the
  Moon (and on Earth) comes from the Sun's direction. Click the Moon (or "Show landing sites").
* **View 2**: site markers and the floating, movable Sites pane (coordinates, presets, ranked list,
  and the selected-site card with a compact horizon plot). Click a site once to highlight it. Its
  card, and its label on the Moon, carry **Zoom in to this site**: the camera flies down to the site
  (GSAP) and then the site scene opens. Clicking the highlighted site again does the same. Visitors
  who prefer reduced motion get an instant switch.
* **View 3**: the site scene (placeholder ground), "Back to Moon" (the camera starts over the site and
  flies back out), zoom buttons and the horizon plot.

**Time.** LTC (model value) = UTC + 56.02 microseconds for every day counted from the landing time.
The lunar time standard is still being defined, so it is labelled as a model value.

**Power colours.** Margin percent = (available − load) / available × 100, as in the planner module.
Margin of 25 % or more: green. From 0 % up to 25 %: yellow (exactly 0 % counts as yellow). Below 0 %:
red. The words next to the number repeat the meaning and name the limiting check.

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
