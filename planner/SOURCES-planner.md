# Sources: planner module

Everything this module uses, where it came from, and its licence. A link is
given only where it was opened while building this module; otherwise the
entry says "link to add".

## Libraries

The planner itself uses only the Python standard library at run time. The
other tools below are for testing and building, and are not shipped with it.

| Library | Used for | Maintained by | Licence | Link |
| --- | --- | --- | --- | --- |
| Python standard library (`json`, `importlib.resources`, `math`, `copy`) | Run time | Python Software Foundation | PSF License | link to add |
| pytest 9.2.0 | Tests (dev only) | pytest-dev team | MIT | link to add |
| pluggy 1.7.0 | Pulled in by pytest | pytest-dev team | MIT | link to add |
| iniconfig 2.3.1 | Pulled in by pytest | pytest-dev team | MIT | link to add |
| packaging 26.3 | Pulled in by pytest and build | Python Packaging Authority | Apache-2.0 OR BSD-2-Clause | link to add |
| Pygments 2.21.0 | Pulled in by pytest (coloured output) | Pygments team | BSD-2-Clause | link to add |
| build 1.6.1 | Building the package (dev only) | Python Packaging Authority | MIT | link to add |
| pyproject_hooks 1.3.3 | Pulled in by build | Python Packaging Authority | MIT | link to add |
| setuptools (77 or newer) | Build backend (dev only) | Python Packaging Authority | MIT | link to add |

None of these is of Chinese origin.

Delta-v from `rocket_delta_v` is worked out by this module from the numbers
typed in, and is labelled "our estimate"; it has no outside source.

## Datasets and images

None. The module contains no images, logos, insignia, flags or lettering.

## Figures

Every figure was supplied by the team as a source name and a status label.
None was looked up or opened while building this module, so each link is still
to add. The catalog file `planner/data/catalog.json` names the source of each
figure; this table groups them by source.

| Source (as named) | Figures | Status label(s) | Link |
| --- | --- | --- | --- |
| Blue Origin; Gunter's Space Page | Blue Moon Mark 1: 3,000 kg payload; 8.05 m tall; 3.08 m wide; fueled mass under 21,350 kg | built, company figure | link to add |
| Blue Origin; Space.com | Blue Moon Mark 2 cargo: 30,000 kg one-way; 20,000 kg reusable; about 16 m tall | company figure | link to add |
| SpaceX HLS program manager, 2022 | Starship HLS: 100,000 kg; 52 m tall; 9 m wide | company figure | link to add |
| Creech, IAC 2025, NTRS 20250008728 | HLS cargo variants: 12,000 to 15,000 kg | NASA figure | link to add |
| Astrobotic (now Voyager Lunar Systems) | Griffin: 625 kg; about 2 m tall; about 4.5 m wide | built, company figure | link to add |
| Kaldon et al., IAC 2024, NTRS 20240011694 | Fission Surface Power 40 kWe: mass goal under 6,000 kg; stowed 4 m by 6 m | NASA goal | link to add |
| Burke and Howard, AIAA ASCEND 2022 | Surface Habitat: 12,000 kg allowable landed mass | NASA study | link to add |
| Csank 2023, NTRS 20230002896 | Habitat crewed 20 kW; uncrewed 2 kW | NASA figure | link to add |
| NTRS 20240004621 | Crew rover keep-warm 9.7 kWh per lunar night | NASA study | link to add |
| Venturi, NASA Aerospace Battery Workshop, Jan 2026 | Crew rover battery 23.22 kWh | NASA study | link to add |
| NTRS 20220005893 | Science rover recharge 500 W | NASA figure | link to add |
| NTRS 19940021211 | Pressurized rover recharge 6.5 kW average, 9.5 kW peak | university study | link to add |
| NTRS 20220005798 | Keep-alive heat 140 W per lander or payload | NASA study | link to add |
| arXiv 2508.10855 | Comms relay 200 W | research estimate | link to add |
| NTRS 20190032521 | ISRU propellant pilot 20 kW | NASA figure | link to add |
| NTRS 20210026557 (Schunk) | Habitat's own array 10 to 15 kW; heat leak 1,550 W; radiator protection 3,840 W deployed, about 700 W stowed | NASA study (published as a NASA reference design; mapping to confirm) | link to add |
| GSFC-STD-1000 Rev I, Table 1.06-1 | 25 percent power margin, Pre-Phase A | NASA figure (inferred, to confirm) | link to add |
| NASA 2018; NASA 2019; NASA 2023 | Delta-v, Artemis halo orbit to the surface: 2,850; 2,750; 2,700 m/s | NASA figure (inferred, to confirm) | link to add |
| NASA HLS-R-0071, through a secondary source | Landing tilt for crew landers: 0 to 8 degrees threshold; 0 to 5 degrees goal | NASA figure; NASA goal (inferred, to confirm) | link to add |
| Voyager | Griffin handles a 10 degree slope | company figure (inferred, to confirm) | link to add |

### Figures whose source is still to add

These figures are in the catalog with `source to add`:

- Astrolab CLV-1 crew rover: about 907 kg; about 4 m long, 2.3 m wide, 2.6 m tall (NASA figure)
- JAXA pressurized rover: 6.0 m long, 5.2 m wide, 3.8 m tall (label to add); mass not published
- Logistics: up to 8,000 kg per 28-day mission (NASA figure)
- ISRU full plant: 60 kW (NASA figure)
- Fission 100 kWe and Fission 40 kWe power sources (NASA goal)
- Solar array mast VSAT 10 kW and VSAT-XL 50 kW (company figure)
- Regenerative fuel cell 10 kW (NASA goal)
- One lunar month: 708.73 hours (a physical constant)
- Standard gravity: 9.80665 m/s^2 (a defined constant, used by the rocket equation)
- Crew rover recharge 2 kW and about 16 kWh per drive day; work-site lighting 1 kW (our estimate: the team's own figures, to be written up)
- Apollo landing Sun elevations, 5 to 25 degrees (reference only; NASA figure, inferred, to confirm)

## SI/AI use

Super Intelligence (SI) / artificial intelligence (AI): this lane (the planner
module, its tests, this file and the README) was built with Claude Code
(Anthropic). A separate Claude Code agent that did not write the code reviewed
it and ran the tests itself; its findings and the fixes made are recorded on
the pull request. The figures, source names and status labels were supplied
by the team. The AI tool entered them, wrote the code and tests, and recorded
its own decisions in the README. Where it inferred a label, the catalog says
so.
