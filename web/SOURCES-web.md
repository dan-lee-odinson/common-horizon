# Sources — website lane (`web/`)

Everything the website uses, where it came from and its licence. A link appears only where the
person (or tool) writing this file opened it; otherwise the entry says "link to add".
Package facts (version, licence, repository) were read from each package's own `package.json`
as installed by npm from the public npm registry.

## Libraries — shipped to the browser

| Library | Version | Licence | Maintained by | Link |
| --- | --- | --- | --- | --- |
| React, React DOM | 19.3.1 | MIT | React core team (package repository: react/react) | link to add |
| three.js | 0.187.0 | MIT | three.js authors, led by Ricardo Cabello (mrdoob) | link to add |
| @react-three/fiber | 9.8.2 | MIT | Poimandres (pmndrs) open-source collective | link to add |
| @react-three/drei | 10.7.9 | MIT | Poimandres (pmndrs) open-source collective | link to add |
| GSAP | 3.15.1 | GSAP Standard "no charge" licence (not MIT; free to use, see its licence text) | GreenSock, part of Webflow, Inc. | link to add |

Only these five packages (and what they import) end up in the built site. drei pulls in further
packages (for example three-stdlib, camera-controls, troika-three-text, maath, zustand); the website
imports only `OrbitControls`, `Html` (marker labels) and `useTexture` from drei.

## Tools — used to build and test, not shipped

| Tool | Version | Licence | Maintained by | Link |
| --- | --- | --- | --- | --- |
| Vite | 8.3.8 | MIT | Vite team (vitejs), created by Evan You; VoidZero Inc. | link to add |
| @vitejs/plugin-react | 6.3.0 | MIT | Vite team (vitejs) | link to add |
| Vitest | 5.1.0 | MIT | Vitest team (vitest-dev) | link to add |
| TypeScript | 7.0.2 | Apache-2.0 | Microsoft | link to add |
| Tailwind CSS, @tailwindcss/vite | 4.3.5 | MIT | Tailwind Labs | link to add |
| Playwright Test | 1.63.0 | Apache-2.0 | Microsoft | link to add |
| @types/react, @types/react-dom, @types/three, @types/node | 19.3.0 / 19.3.0 / 0.187.0 / 22.20.5 | MIT | DefinitelyTyped community | link to add |

Vite, Vitest, React, three.js, React Three Fiber, drei, GSAP, Tailwind CSS and Playwright
were set by the team's stack decision. In total npm installed 130 packages (direct and indirect);
the list is reproducible with `npm ls --all`. The optional WebAssembly fallbacks of Tailwind's
engine (`@napi-rs/wasm-runtime`, `@emnapi/*`) are declared by `@tailwindcss/oxide-wasm32-wasi` but
are not installed on Linux, macOS or Windows x64/arm64. Indirect packages were not audited one by
one for origin; the table above covers every package the website adds directly.

## Data

| What | Where it came from | Licence | Link |
| --- | --- | --- | --- |
| Preset site list (`src/api/examples/sites.json`): the first 13 names with latitude and east longitude, and the Nobile label | Team brief (Common Horizon), values as given; to be replaced by the team's sourced list | Team-provided | link to add |
| Which missions the list covers: the deliveries shown in NASA's CLPS landing sites viewer | NASA, Commercial Lunar Payload Services, CLPS Landing Sites | NASA media guidelines | https://www.nasa.gov/commercial-lunar-payload-services/clps-landing-sites/ |
| IM-3 (planned): 7.585 N, 58.725 W (301.275 E), the landing point selected at Reiner Gamma | Blewett et al., "Selection and characterization of the landing site for NASA CLPS PRISM1 lunar lander mission CP-11", LPSC 2023, abstract 1780 (NTRS 20230000531) | NASA Technical Reports Server | https://ntrs.nasa.gov/citations/20230000531 |
| Blue Ghost Mission 2 (planned): near Nassau crater on the far side; the crater's center (24.9 S, 177.4 E) is shown because the landing point is not published | Area: Firefly Aerospace mission page. Crater center: IAU Gazetteer of Planetary Nomenclature (USGS), value as widely quoted; to confirm against the gazetteer entry | Facts, no licence needed | https://fireflyspace.com/blue-ghost-mission-2 |
| Blue Ghost Mission 3 (planned): Mons Gruithuisen Gamma (36.56 N, 40.72 W = 319.28 E); the dome's location is shown, not the landing point | Area: NASA CLPS press kits ("Gruithuisen Domes") and the Lunar-VISE team's landing site page. Coordinates: value as widely quoted; to confirm against the IAU gazetteer and Williams et al. 2026, Planet. Sci. J. 7, 161 | Facts, no licence needed | https://sciences.ucf.edu/lunarvise/landing-site/ |
| Draper SERIES-2 (planned; NASA's later documents name the lander APEX 1.0): Schrodinger basin on the far side; the basin's center (75.0 S, 132.4 E) is shown because the landing point is not published | NASA Science, "Schrodinger Impact Basin" and the CP-12 delivery page | NASA media guidelines | https://science.nasa.gov/lunar-science/clps-deliveries/cp-12/ |
| Notes on existing entries: Blue Moon Mark 1 is planned for the Shackleton Connecting Ridge; IM-4 is planned for Mons Mouton; Peregrine Mission-1 was bound for Sinus Viscositatis and did not reach the Moon | NASA news release 26-046 (26 May 2026); NASA CLPS IM-2 press kit NP-2025-02-005-JSC; NASA CLPS Peregrine press kit NP-2023-12-017-JSC | NASA media guidelines | https://www.nasa.gov/news-release/nasa-provides-update-on-moon-base-rovers-landers-missions |
| Hardware catalog numbers (`src/api/examples/catalog.json`) | Invented placeholders for mock mode, not specifications | This project | — |
| Mock terrain, slopes and skylines (`src/api/examples/mock-model.json`) | Invented for mock mode | This project | — |
| Assistant example answers (`src/api/examples/assistant.json`) | Written for mock mode | This project | — |

## Images

| What | Where it came from | Licence | Link |
| --- | --- | --- | --- |
| Moon colour map (planned, not yet included) | NASA's CGI Moon Kit, NASA's Scientific Visualization Studio, item 4720. Credit: "NASA's Scientific Visualization Studio". Download was blocked in the build environment; slot documented in `public/textures/README.md` | NASA imagery is generally not copyrighted; check the item's own terms when downloading | link to add (not opened: blocked) |
| Hardware picture-slot drawings, icons | Drawn for this project as simple line shapes (`src/components/HardwareGlyph.tsx`, `src/components/Icon.tsx`) | This project | — |

No logos, insignia, flags or agency or company lettering are used anywhere. Names appear as plain text.

## Figures and constants

| Figure | Used for | Source | Link |
| --- | --- | --- | --- |
| LTC rate: 56.02 microseconds per day, counted from the landing time | LTC (model value) display | Team brief; lunar time standard still being defined | link to add |
| Synodic month 29.530589 days | Mock Sun motion | Standard astronomical value | link to add |
| Reference new moon 2000-01-06 18:14 UTC | Mock Sun phase | Standard reference epoch for lunations | link to add |
| Sub-solar latitude swing ±1.54° over 346.62 days | Mock Sun height at the poles | Moon's axis tilt to the ecliptic (≈1.54°) and the eclipse year; simplified | link to add |
| Libration ±6.7° latitude (27.2122 d), ±7.9° longitude (27.5546 d) | Mock Earth wobble in the sky | Approximate optical libration amplitudes and the draconic and anomalistic months; simplified | link to add |
| Transit 5 days from launch to landing | Mock landing time | Placeholder for the mock; the backend sets the real value | — |
| Power colour thresholds: green at 25 % margin or more, yellow from 0 % to under 25 %, red below 0 % | Planner and ranked list | Team brief; the same line as the planner module (GSFC-STD-1000 Rev I, Table 1.06-1, as cited in `planner/README.md`) | — |
| Power check rules: margin = (available − load) / available × 100; night storage over the longest darkness; day refill | Mock power checks (`src/api/mock/power.ts`) | Planner module, `planner/README.md` ("power_check"), read only | — |
| One lunar month 708.73 h | Default refill window in the mock power checks | Planner module catalog constant (`planner/README.md`) | — |
| Earth's diameter about 3.67 times the Moon's (mean diameters about 12,742 km and 3,474.8 km) | Earth's size in the Moon view (Moon radius 1, Earth radius 3.67) | Standard astronomical values | link to add |
| Moon view distances (Earth 30, Sun 90 Moon radii) and the Sun's radius (8 Moon radii) | Placing Earth and the Sun in the Moon view | Chosen for this website so both fit on screen; not to scale (really about 221 and 86,000 Moon radii, and the Sun about 400 Moon diameters wide) | — |

## SI/AI use

Super Intelligence (SI) / artificial intelligence (AI): this website lane (everything in `web/`) was
built with Claude Code (Anthropic), an AI coding assistant, which wrote the code, tests and these
documents from the team's brief. People on the team review it before it is used.
