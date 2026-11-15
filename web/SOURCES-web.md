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
imports only `OrbitControls` from drei. The hardware models' shapes are loaded with three.js's own
`GLTFLoader` (`three/examples/jsm/loaders/GLTFLoader.js`, part of the three.js package above), on
demand; no other loader and no decoder is used.

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
| Hardware models: each model's shape (`public/models/*.glb`) and its description (`public/models/*.json`: its name, the words that say how well founded its size is, and its width, height and depth in metres) | The models and their descriptions are made by another part of the team (`tools/models/`), which lists the source of every dimension in the same files; the website reads them and changes nothing. The site view draws each shape at true scale (one model unit is one metre; no shape is ever scaled, and one whose height differs from its description by more than 1 % is not drawn) and shows each height with those words beside it. The five models: Starship lander, Griffin lander, habitat unit, fission power unit, solar array mast. The rover has no model and is not drawn | Team-provided | — |
| Mock terrain, slopes and skylines (`src/api/examples/mock-model.json`) | Invented for mock mode | This project | — |
| Assistant example answers (`src/api/examples/assistant.json`) | Written for mock mode | This project | — |

## Fonts

Three families, served from this website only (no font service is called). The files and each
project's licence text are in `src/assets/fonts/`. Each was taken from the project's own GitHub
repository, which was cloned and read when this file was written.

| Font | Used for | File in `src/assets/fonts/` | Taken from | Licence | Maintained by | Link |
| --- | --- | --- | --- | --- | --- | --- |
| Oxanium (variable, weight 200 to 800) | Titles and labels | `Oxanium-Variable.woff2` | `fonts/variable/Oxanium[wght].ttf` at commit a8f39e0 (30 September 2020), compressed to WOFF2 with fontTools 4.68.0; the glyphs are unchanged | SIL Open Font License 1.1 (`Oxanium-OFL.txt`) | Severin Meyer (The Oxanium Project Authors) | https://github.com/sevmeyer/oxanium |
| Geist Mono (variable, weight 100 to 900) | Numeric readouts | `GeistMono-Variable.woff2` | `fonts/GeistMono/webfonts/GeistMono[wght].woff2` at commit ef2597c (6 November 2026), copied unchanged | SIL Open Font License 1.1 (`Geist-OFL.txt`) | Vercel, with Basement Studio (The Geist Project Authors) | https://github.com/vercel/geist-font |
| Geist (variable, weight 100 to 900) | Chat and longer text | `Geist-Variable.woff2` | `fonts/Geist/webfonts/Geist[wght].woff2` at the same commit, copied unchanged | SIL Open Font License 1.1 (`Geist-OFL.txt`) | Vercel, with Basement Studio (The Geist Project Authors) | https://github.com/vercel/geist-font |

## Images

| What | Where it came from | Licence | Link |
| --- | --- | --- | --- |
| Moon surface maps: `public/textures/moon/moon-color-4k.jpg`, `moon-color-2k.jpg` (surface color), `moon-normal-4k.jpg`, `moon-normal-2k.jpg` (terrain relief as normal maps) | NASA's CGI Moon Kit, Scientific Visualization Studio, Goddard Space Flight Center. Credit: NASA's Scientific Visualization Studio (visualizer Ernie Wright, scientist Noah Petro). The color map comes from Lunar Reconnaissance Orbiter Camera imagery and the heights from the Lunar Orbiter Laser Altimeter; NASA describes the color map as made for visual use, not for science. Downloaded 15 November 2026. Made from NASA's files `lroc_color_16bit_srgb_4k.tif`, `lroc_color_2k.jpg` and `ldem_16_uint.tif`: the 4k color map is NASA's 16-bit TIFF saved as an 8-bit JPEG; the 2k color map is NASA's file renamed; the normal maps were computed from the height map at true scale. Checksums of the downloads and the full method are in `public/textures/moon/README.md`. Used as they are: 4k pair on desktop, 2k pair on phones (`src/scene/textures.ts`) | NASA imagery is generally not copyrighted; see the source page for its terms | https://svs.gsfc.nasa.gov/4720 |
| Hardware picture-slot drawings, icons | Drawn for this project as simple line shapes (`src/components/HardwareGlyph.tsx`, `src/components/Icon.tsx`) | This project | — |

No logos, insignia, flags or agency or company lettering are used anywhere. Names appear as plain text.

## Figures and constants

| Figure | Used for | Source | Link |
| --- | --- | --- | --- |
| Lunar south pole season: summer while the Sun's overhead point is south of the lunar equator, when sunlit periods at the south pole run longer | The "Lunar south pole: summer / winter" line (`src/util/season.ts`) | NASA, "Lunar Site Selection" white paper, 2023 Moon to Mars Architecture Concept Review | link to add |
| LTC rate: a clock on the Moon's surface gains 56.02 microseconds per day on a clock on Earth | The LTC (model value) clock and the LTC − UTC readout (`src/util/time.ts`) | Neil Ashby and Bijunath R. Patla (National Institute of Standards and Technology), "A Relativistic Framework to Estimate Clock Rates on the Moon", The Astronomical Journal, volume 168, number 3, article 112 (2024), DOI 10.3847/1538-3881/ad643a; preprint arXiv:2402.11150. The citation was confirmed by a web search; the paper's own page could not be opened from the build environment | link to add (not opened: blocked) |
| Counting the LTC offset from the landing time (offset = 56.02 microseconds x days since landing, so it is zero at the landing) | The same clock and readout | This app's own convention, chosen so the readout starts at zero for each mission. It is not part of the paper and not an agreed standard: the lunar time standard (Coordinated Lunar Time) is still being defined. The interface labels the clock "model" for this reason | — |
| Synodic month 29.530589 days | Mock Sun motion | Standard astronomical value | link to add |
| Reference new moon 2000-01-06 18:14 UTC | Mock Sun phase | Standard reference epoch for lunations | link to add |
| Sub-solar latitude swing ±1.54° over 346.62 days | Mock Sun height at the poles | Moon's axis tilt to the ecliptic (≈1.54°) and the eclipse year; simplified | link to add |
| Libration ±6.7° latitude (27.2122 d), ±7.9° longitude (27.5546 d) | Mock Earth wobble in the sky | Approximate optical libration amplitudes and the draconic and anomalistic months; simplified | link to add |
| Transit 5 days from launch to landing | Mock landing time | Placeholder for the mock; the backend sets the real value | — |
| Power colour thresholds: green at 25 % margin or more, yellow from 0 % to under 25 %, red below 0 % | Planner and ranked list | Team brief; the same line as the planner module (GSFC-STD-1000 Rev I, Table 1.06-1, as cited in `planner/README.md`) | — |
| Power check rules: margin = (available − load) / available × 100; night storage over the longest darkness; day refill | Mock power checks (`src/api/mock/power.ts`) | Planner module, `planner/README.md` ("power_check"), read only | — |
| One lunar month 708.73 h | Default refill window in the mock power checks | Planner module catalog constant (`planner/README.md`) | — |
| Earth's diameter about 3.67 times the Moon's (mean diameters about 12,742 km and 3,474.8 km) | Earth's size in the Moon view (Moon radius 1, Earth radius 3.67) | Standard astronomical values | link to add |
| Orbit picture: Earth drawn at its true size beside the Moon (3.667 Moon radii, from the radii above) but only 11.5 Moon radii away; the Sun as a marker on a ring 1.7 Moon radii out | Placing Earth and the Sun in the Orbit stage (`src/scene/orbitView.ts`) | Chosen for this website so both fit on screen. Sizes of Earth and the Moon are to scale; distances are not (really about 221 Moon radii to Earth and about 86,000 to the Sun), and the Sun is a direction marker, not a body to scale. The caption on screen says so | — |
| Sun radius 695,700 km | The Sun's disc in the site view, drawn at its true apparent size, and the "Sun, apparent width" readout (`src/util/bodies.ts`) | International Astronomical Union, 2015 Resolution B3 (nominal solar radius) | link to add (not opened: blocked) |
| Sun distance 1 astronomical unit = 149,597,870.7 km (a mean distance) | The same disc and readout | International Astronomical Union, 2012 Resolution B2 (re-definition of the astronomical unit of length) | link to add (not opened: blocked) |
| Earth mean radius 6,371.0 km | Earth's disc in the site view, drawn at its true apparent size, and the "Earth, apparent width" readout (`src/util/bodies.ts`) | NASA Earth Fact Sheet (National Space Science Data Coordinated Archive), volumetric mean radius | link to add (not opened: blocked) |
| Earth to Moon mean distance 384,400 km | The same disc and readout | NASA Moon Fact Sheet (National Space Science Data Coordinated Archive), semi-major axis | link to add (not opened: blocked) |
| Moon mean radius 1,737.4 km | The site's own distance from the Moon's centre, when working out how far Earth is from the site | NASA Moon Fact Sheet (National Space Science Data Coordinated Archive), volumetric mean radius | link to add (not opened: blocked) |
| Apparent width of a body seen from a site = 2 × asin(radius ÷ distance from the site to the body's centre). Sun: 0.53°. Earth: 1.90° on the horizon to 1.91° overhead (the site is one Moon radius from the Moon's centre; Earth's centre is 384,400 km along the direction to Earth) | Sizes of the two discs in the site view and their two readouts | Geometry, from the five values above. Both distances are mean values, so the screen says "mean distances"; the answers of the data layer carry directions only | — |
| Brightness of the ground in the site view: (sine of the Sun's elevation) to the power 0.35, times whether the site is lit | The illustrative level ground (`groundSunTerm` in `src/scene/siteView.ts`) | A display curve chosen for this website so that grazing sunlight at a polar site (Sun about 1° up) is still readable. It is not a photometric model of the lunar surface | — |
| Site view layout: where each piece of hardware stands round the landing point; range rings every 10 m (out to 200 m) and every 100 m (out to 2 km); field of view 42° (58° on phones) | The site view (`src/scene/siteLayout.ts`, `src/scene/siteView.ts`) | Chosen for this website. The data has no positions for hardware and no terrain near the site: the screen says the ground and the places are an illustration | — |
| Shadow length on level ground = height ÷ tan(Sun's elevation), pointing away from the Sun. No length is given while the Sun's disc touches the level plane (elevation under 0.27°, half the disc's width); one figure, labelled "about", up to 5.3° (ten disc widths); two figures above | The shadow readouts in the site view (`src/util/shadow.ts`), and the shadows drawn on the ground there (each model flattened onto the level ground along the sunlight) | Geometry. The limits follow from the Sun's apparent width above; the site's real ground is not in the data, so every length is for level ground | — |

## SI/AI use

Super Intelligence (SI) / artificial intelligence (AI): this website lane (everything in `web/`) was
built with Claude Code (Anthropic), an AI coding assistant, which wrote the code, tests and these
documents from the team's brief. People on the team review it before it is used.
