# Site surface pictures

One picture of the real ground per preset site, for the website's Site view to lay over the
terrain mesh (`web/public/site-terrain/`).

## What is here

- `<site>.jpg` for all 17 sites: grayscale, 1024 x 1024 pixels.
- `manifest.json`: for each picture, the Moon Trek layer, its own pixel size, what kind of
  picture it is, and its mean brightness (0 to 255).

## How a picture lies on the ground

- It covers the same 64 km square as the site's far terrain file: 32 km each way from the
  site, in the plane that touches the Moon at the site.
- Row 0 is the north edge and column 0 the west edge. One pixel is 62.5 m.
- Pixel (row, col) lies over east = -32000 + (col + 0.5) x 62.5 m and
  north = 32000 - (row + 0.5) x 62.5 m.
- The same picture serves the near ground: 1.28 km is about 20 pixels of it, so close to
  the lander it gives a tone and no detail.

## Two kinds of picture

| Kind | Sites | Source | Own pixel size |
|---|---|---|---|
| Camera mosaic | the eleven non-polar sites | `LRO_WAC_Mosaic_Global_303ppd_v02` | about 83 m |
| Camera mosaic | IM-1, IM-2, Draper, Chandrayaan-3 | `LRO_WAC_Mosaic_SPole60_100m_v02` | about 265 m |
| Relief from LOLA heights | Shackleton Connecting Ridge, Nobile | `LRO_LOLA_DEM_SPole45_100mp_v04` | 100 m |

At the ridge and at Nobile the camera mosaic is 70% and 48% permanent shadow, so the picture
there is worked out from LOLA elevation: the ground lit evenly from four sides, flat ground
bright and steep ground dark. It is a drawing of the measured shape, with no real brightness
in it. The manifest's `kind` says which a picture is.

The camera mosaics have the Sun of the day they were taken baked in. The Site view lights the
ground from the engine's Sun direction on top of that.

## Checked

Laid beside the shaded terrain heights, the pictures line up: Hadley Rille runs through the
Apollo 15 site, the Taurus-Littrow valley holds the Apollo 17 site, and Shackleton crater sits
beside the ridge site.

## Source and credit

- NASA Moon Trek, <https://trek.nasa.gov/moon/>, fetched 15 November 2026 with
  `tools/site-texture/make_site_texture.py`.
- Camera mosaics (Lunar Reconnaissance Orbiter Camera, Wide Angle Camera):
  NASA/GSFC/Arizona State University.
- LOLA elevation: NASA/GSFC.

## To make them again

```
pip install numpy pillow rasterio
python tools/site-texture/make_site_texture.py sites.json web/public/site-texture
```

`sites.json` is the answer from the backend's `GET /sites`. The script needs `curl` on the path
and uses the helpers in `tools/site-context/` and `tools/site-terrain/`.
