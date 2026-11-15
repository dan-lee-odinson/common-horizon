# Site terrain heights

Real ground heights around each of the 17 preset sites, for the website's Site view. They come
from NASA's Lunar Orbiter Laser Altimeter (LOLA) elevation models, fetched through NASA Moon Trek.

## What is here

| File | Covers | Posts | Spacing |
|---|---|---|---|
| `<site>.near.f32` (all 17 sites) | 1.28 km across, centered on the site | 129 x 129 | 10 m |
| `<site>.far.f32` (the six sites south of 60° S) | 64 km across, centered on the site | 257 x 257 | 250 m |
| `manifest.json` | For each file: the Moon Trek layer, its pixel size, the site's elevation, lowest and highest value | | |

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

| Sites | Moon Trek layer | Pixel size |
|---|---|---|
| Shackleton Connecting Ridge, near | `LRO_LOLA_DEM_SPole875_5mp_v04` | 5 m |
| Nobile, IM-1, IM-2, Draper, near | `LRO_LOLA_DEM_SPole75_30mp_v04` | 30 m |
| The other twelve sites, near | `LRO_LOLA_DEM_Global_128ppd_v04` | about 237 m |
| All six far files | `LRO_LOLA_DEM_SPole45_100mp_v04` | 100 m |

The near grid is finer than the 237 m model at the twelve sites that use it, so there the ground
is a smooth surface through that model's heights, with no small-scale detail.

## Checked against the physics engine's stored skylines

A skyline was worked out from these files (observer 2 m above the site, out to 32 km) and compared
with the engine's stored profile in `backend/data/horizon/`, for the directions whose skyline point
lies within 30 km.

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
python tools/site-terrain/fetch_site_terrain.py sites.json web/public/site-terrain
```

`sites.json` is the answer from the backend's `GET /sites`. The script needs `curl` on the path.
