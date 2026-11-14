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
imports only `OrbitControls` and `useTexture` from drei.

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
| Preset site list (`src/api/examples/sites.json`): 13 names with latitude and east longitude, and the Nobile label | Team brief (Common Horizon), values as given; to be replaced by the team's sourced list | Team-provided | link to add |
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
| Power colour thresholds: green at 25 % margin or more, yellow from 0 % to under 25 %, red below 0 % | Planner and ranked list | Team brief | — |

## SI/AI use

Super Intelligence (SI) / artificial intelligence (AI): this website lane (everything in `web/`) was
built with Claude Code (Anthropic), an AI coding assistant, which wrote the code, tests and these
documents from the team's brief. People on the team review it before it is used.
