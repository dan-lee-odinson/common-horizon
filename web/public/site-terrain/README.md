# Site terrain heights

Real ground heights around each of the 17 preset sites, for the website's Site view. They come
from NASA's Lunar Orbiter Laser Altimeter (LOLA) elevation models, fetched through NASA Moon Trek.

## What is here

| File | Covers | Posts | Spacing |
|---|---|---|---|
| `<site>.near.f32` (all 17 sites) | 1.28 km across, centered on the site | 129 x 129 | 10 m |
| `<site>.far.f32` (all 17 sites) | 64 km across, centered on the site | 257 x 257 | 250 m |
| `manifest.json` | For each file: the Moon Trek layer, its pixel size, the site's elevation, lowest and highest value. For each site: how high the ground rises on the skyline, and whether the physics engine's sunlight numbers include terrain there | | |

## Format

- Little-endian 32-bit floats, row by row. Row 0 is the north edge and column 0 is the west edge.
- Each value is the height in meters above the horizontal plane through the site. The middle
  post is the site itself and is 0.
- East and north are measured in the plane that touches the Moon at the site.
- In the far files the Moon's curvature is already included, so distant ground drops away as it
  does on the real Moon (about 300 m lower at 32 km).

## Source

- **Service:** NASA Moon Trek, <https://trek.nasa.gov/moon/>, elevation subset service
  `https://trek.nasa.gov/moon/TrekWS/rest/transform/latlon/subset/stream/tiff`.
- **Fetched:** 15 November 2026 with `tools/site-terrain/fetch_site_terrain.py`.

| Sites | File | Moon Trek layer | Pixel size |
|---|---|---|---|
| Shackleton Connecting Ridge | near | `LRO_LOLA_DEM_SPole875_5mp_v04` | 5 m |
| Nobile, IM-1, IM-2, Draper | near | `LRO_LOLA_DEM_SPole75_30mp_v04` | 30 m |
| The other twelve sites | near | `LRO_LOLA_DEM_Global_128ppd_v04` | about 237 m |
| The six sites south of 60° S | far | `LRO_LOLA_DEM_SPole45_100mp_v04` | 100 m |
| The other eleven sites | far | `LRO_LOLA_DEM_Global_128ppd_v04` | about 237 m |

Where a grid is finer than the 237 m model it was made from, the ground is a smooth surface
through that model's heights, with no small-scale detail.

## The drawn ground and the sunlight numbers

The physics engine works out sunlight with a stored terrain skyline at six sites and with a
smooth horizon at the other eleven. At those eleven the drawn terrain is not in the sunlight
numbers. The table gives the highest ground in view from 2 m above each site, out to 31.9 km,
worked out from these files (`skyline_from_these_files` in the manifest).

| Site | Engine's sunlight uses | Highest ground in view | Toward (clockwise from north) | Directions above 1° |
|---|---|---|---|---|
| IM-1 Odysseus | terrain skyline | 11.49° | 149° | 76% |
| Nobile region | terrain skyline | 6.86° | 30° | 39% |
| IM-2 Athena | terrain skyline | 4.06° | 118° | 45% |
| Draper SERIES-2 (planned) | terrain skyline | 3.81° | 240° | 51% |
| Chandrayaan-3 | terrain skyline | 2.40° | 348° | 52% |
| Shackleton Connecting Ridge | terrain skyline | 1.33° | 56° | 2% |
| Apollo 17 | smooth horizon | 14.03° | 358° | 98% |
| Apollo 15 | smooth horizon | 13.49° | 180° | 72% |
| SLIM | smooth horizon | 9.70° | 350° | 81% |
| Apollo 16 | smooth horizon | 5.35° | 164° | 61% |
| Blue Ghost Mission 3 (planned) | smooth horizon | 4.79° | 246° | 57% |
| Apollo 14 | smooth horizon | 3.48° | 69° | 50% |
| Blue Ghost Mission 2 (planned) | smooth horizon | 3.14° | 94° | 70% |
| Blue Ghost Mission 1 | smooth horizon | 2.22° | 138° | 14% |
| Apollo 12 | smooth horizon | 1.19° | 53° | 9% |
| Apollo 11 | smooth horizon | 1.17° | 270° | 2% |
| IM-3 (planned) | smooth horizon | 0.79° | 114° | 0% |

## Checked against the physics engine's stored skylines

A skyline worked out from these files was compared with the engine's stored profile in
`backend/data/horizon/`, for the directions whose skyline point lies within 30 km.

| Site | Directions compared | Correlation | Mean difference | Largest difference |
|---|---|---|---|---|
| Shackleton Connecting Ridge | 394 of 720 | 0.939 | +0.06° | 1.64° |
| IM-1 Odysseus | 664 of 720 | 0.998 | +0.17° | 0.83° |
| Nobile region | 682 of 720 | 0.993 | +0.08° | 1.38° |

The site elevations agree to within 3 m. The differences close to the site come from the finer
models used here (5 m and 30 m) against the 40 m model the engine's skylines were made from. The
engine's skyline is the one every sunlight number uses; these files are for drawing the ground.

## Credit

LOLA elevation data: NASA/GSFC. Served by NASA Moon Trek, NASA/JPL-Caltech.

## To make them again

```
pip install numpy rasterio
python tools/site-terrain/fetch_site_terrain.py sites.json web/public/site-terrain backend/data/horizon
```

`sites.json` is the answer from the backend's `GET /sites`. The script needs `curl` on the path.
