# Common Horizon

**A lunar landing site navigator.** Team Common Horizon, NASA Space Apps Challenge 2026,
challenge "Lunar Landing Site Navigator".

Choose a landing site, a launch date and the hardware to deliver. Common Horizon shows where
the Sun and the Earth sit against that site's real horizon through the stay: how long the site
is lit, how long it can talk to Earth directly, and whether the hardware's power system makes it
through the dark.

- **Website:** <https://commonhorizon.study>
- **API:** <https://d275qzzfmu3iunuwmksur2shpi0smkbc.lambda-url.us-east-1.on.aws/health>

## Team

- **Dan Lee-Odinson**, team owner: app design, the interface and its 3D views, the mission
  planner, the AWS setup, the demo video and the submission.
- **Isabella Lin**: the physics engine. SPICE positions of the Sun, Earth and Moon, the lunar
  coordinate frames, the LOLA terrain lookup, and the horizon and ephemeris calculations.
- **Murariu Alexandru-Stefan (@\~Shaganelul\~)**: the backend, AI-assisted and logged in
  [backend/docs/AI_USE_LOG.md](backend/docs/AI_USE_LOG.md). The API contract and FastAPI
  service, the integration of the physics engine, the website API and site ranking, reviews, and
  AWS testing, including the Mission Assistant's model on Amazon Bedrock.
- **Cam**: mission planning. The three reference missions, the research notes with a
  published source for each figure, and the mission plan.

## The horizon decides the answer

Share of 2027 with any part of the Sun's disc in view, for an observer 2 m above the ground,
hour by hour:

| Site | With terrain | Smooth Moon | Longest dark period, with terrain |
|---|---|---|---|
| Shackleton Connecting Ridge (89.684° S, 196.739° E) | 82.7% | 57.3% | 155 hours |
| Nobile region (85.42088° S, 31.6218° E) | 49.1% | 51.1% | 532 hours |

On a smooth Moon the ridge's longest dark period would be 3,349 hours. Real terrain from NASA's
Lunar Orbiter Laser Altimeter (LOLA) lifts the ridge above its surroundings and cuts that to
about 155 hours. In the Nobile region the terrain works the other way and takes sunlight away.
Terrain also costs sunlight at the two Intuitive Machines sites: 45.5% with terrain against 50.8%
without at the IM-2 site, and 38.8% against 49.8% at the IM-1 site.

These figures move by several percentage points with the resolution of the elevation model and
with how terrain close to the observer is treated. The limits are set out in
[backend/app/physics/horizon/README.md](backend/app/physics/horizon/README.md).

## How it works

- **Positions.** The physics engine (`backend/app/physics/engine/`) reads four NASA NAIF SPICE
  kernels and gives the Sun's and the Earth's position in the Moon's body-fixed frame, then
  turns each into azimuth and elevation at the site.
- **The horizon.** The skyline around a site is computed from LOLA elevation models, every half
  degree of azimuth, with the Moon's curvature included (`backend/app/physics/horizon/`).
  Skylines are stored for six sites in `backend/data/horizon/`.
- **Visibility.** The Sun's and the Earth's discs are compared with the skyline at each time
  step. A body counts as visible when any part of its disc clears the terrain.
- **The planner.** A hardware catalog holds each figure with its source and a status label
  (NASA figure, company figure or our estimate). It checks whether a payload fits a lander and
  whether power sources and storage carry the loads through day and night (`planner/`).
- **The service and the website.** A FastAPI service on AWS Lambda (`backend/`) and a React and
  three.js website on AWS Amplify (`web/`).

## How it is checked

- **Against NASA's JPL Horizons System.** The engine's Sun and Earth directions are compared
  with Horizons for all seventeen preset sites, every hour of 2027. The largest difference is
  0.006° for the Sun, which is the aberration of light, and 0.0002° for the Earth. The Sun's
  disc is 0.53° wide. The service also runs the comparison live, for any place and minute, at
  `/api/v1/horizons/compare`. See [backend/docs/HORIZONS-CHECK.md](backend/docs/HORIZONS-CHECK.md).
- **Against NASA Moon Trek.** The engine's Sun directions are also compared with Moon Trek's Sun
  angle service, for the same seventeen sites and hours. The largest difference is 0.0066°. See the
  same file.
- **Two horizon calculations.** The skyline code was written twice, separately, on different
  LOLA models. At the Shackleton Connecting Ridge the two differ by a median of 0.01°.
- **Automated tests.** The backend's tests run before every deployment
  (`.github/workflows/deploy-backend.yml`). Tests that need the large NASA files skip when the
  files are absent.

## What is in this repository

| Folder | What it holds | Start here |
|---|---|---|
| `backend/` | The service, the physics engine, the stored skylines and the checks | [backend/README.md](backend/README.md) |
| `planner/` | The hardware catalog, the fit check and the power arithmetic | [planner/README.md](planner/README.md) |
| `web/` | The website | [web/README.md](web/README.md) |
| `tools/models/` | Scripts that build the 3D hardware models from published dimensions | [tools/models/README.md](tools/models/README.md) |

Each folder's README says how to run it and its tests on your own computer.

## Data and sources

NASA data and resources used:

- **JPL Horizons System** (<https://ssd.jpl.nasa.gov/horizons/>): the independent check of the
  engine's Sun and Earth directions, stored for every preset site and asked live by the service.
- **NAIF SPICE kernels** (<https://naif.jpl.nasa.gov/pub/naif/generic_kernels/>): every Sun and
  Earth position.
- **NASA Moon Trek** (<https://trek.nasa.gov/moon/>): the LOLA elevation patches behind the preset
  sites' slopes (`backend/data/site_slopes.json`), and a second check of the engine's Sun directions.
- **LOLA elevation models**, Lunar Reconnaissance Orbiter (<https://pgda.gsfc.nasa.gov/products/90>
  and the USGS global model): every terrain skyline.
- **CGI Moon Kit**, NASA's Scientific Visualization Studio (<https://svs.gsfc.nasa.gov/4720>):
  the Moon's surface in the website.
- **NSSDC Apollo landing site coordinates**
  (<https://nssdc.gsfc.nasa.gov/planetary/lunar/lunar_sites.html>), the CLPS landing sites page
  and the NASA Technical Reports Server: preset sites and hardware figures.

Space Agency Partner data: the Chandrayaan-3 landing site (ISRO) and the SLIM landing site
(JAXA's mission).

Every library, dataset, image, font and figure is listed with its license in the sources files:
[backend/docs/SOURCES-horizon.md](backend/docs/SOURCES-horizon.md),
[planner/SOURCES-planner.md](planner/SOURCES-planner.md),
[tools/models/SOURCES-models.md](tools/models/SOURCES-models.md) and
[web/SOURCES-web.md](web/SOURCES-web.md).

## SI/AI use

The team used AI tools to help write and review software and text. No figure in the app comes
from an AI model: positions, skylines, sunlight and power results are computed by this
repository's code from NASA data.

- The Mission Assistant is the one place a language model runs in the app. It words its answers
  with OpenAI's gpt-oss-120b on Amazon Bedrock from the engine's results for the mission on
  screen, and produces no figure of its own.
- Each commit message carries an `SI/AI:` line naming the tool and model that helped.
- The tools and what each did are logged in [docs/AI_USE_LOG.md](docs/AI_USE_LOG.md) and
  [backend/docs/AI_USE_LOG.md](backend/docs/AI_USE_LOG.md).
- The 3D hardware models: five are built by scripts from published dimensions; one is a
  community CAD model (Blue Moon Mark 1, by David Nagy); five are shapes generated by
  TRELLIS.2 (Microsoft) on fal.ai from pictures. Each says which in its file and on the models
  review page; see [tools/models/SOURCES-models.md](tools/models/SOURCES-models.md).

## Physics Engine Data Sources
The physics engine uses NASA/JPL SPICE kernels to calculate time-dependent Sun and Earth positions relative to the Moon, transforming them into local azimuth and elevation at a landing site. Calculations use the `MOON_ME` reference frame, kilometer-based position vectors, planetocentric latitude, east-positive longitude, and azimuth measured clockwise from north, with a default observer height of 2.0 m. Terrain elevation and horizon calculations use NASA Lunar Orbiter Laser Altimeter (LOLA) digital elevation models, including 80 m and 240 m polar datasets and a 118 m global dataset. Precomputed terrain horizon profiles are used as the runtime skyline where available, while the engine's horizon calculation supports generating profiles and providing a fallback. In a direct comparison of our 80 m nearest-pixel horizon calculations against PR #12's stored profiles (generated using a 40 m DEM and bilinear interpolation), Nobile's mean absolute elevation difference was 1.43° for directions whose local skyline points were within 1 km and 0.0212° for directions whose local skyline points were beyond 30 km.

### 1. SPICE Kernels
Download the following four files from NASA/JPL NAIF for lunar ephemerides and reference frames:
Leap seconds: `naif0012.tls` https://naif.jpl.nasa.gov/pub/naif/generic_kernels/lsk/
Sun/Earth/Moon Positions: `de440s.bsp` https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/planets/
Moon orientation:`moon_pa_de440_200625.bpc` https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/moon_pa_de440_200625.bpc
Moon reference frame: `moon_de440_250416.tf` https://naif.jpl.nasa.gov/pub/naif/generic_kernels/fk/satellites/

Place all four files in:
`backend/app/physics/data/datasets/spice/`

### 2. LOLA Elevation Models
The physics engine uses these three LOLA DEM products for lunar terrain elevation and horizon calculations: https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/
`LDEM_80S_80MPP_ADJ.tiff` 80 m/pixel 80°S to south pole
`LDEM_60S_240MPP_ADJ.tiff`  240 m/pixel 60°S to south pole
`Lunar_LRO_LOLA_Global_LDEM_118m_Mar2014.tif` 118 m/pixel, global: https://astrogeology.usgs.gov/search/map/moon_lro_lola_dem_118m

Place all three files in:
`backend/app/physics/data/datasets/lola/`

## License and notices

Apache License 2.0. See [LICENSE](LICENSE).

Common Horizon is not endorsed by NASA or by any company whose hardware it names. Mission and
hardware names appear as plain text for identification only.
