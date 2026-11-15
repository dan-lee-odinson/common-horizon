# Site context pictures

One picture of the lunar surface around each of the 17 preset sites, 960 x 600 pixels, with the
site at the center. The website's Site stage shows these while the live NASA Moon Trek map loads,
and keeps them on screen if Moon Trek cannot be reached.

## Source

- **Service:** NASA Moon Trek, <https://trek.nasa.gov/moon/>, through its public WMTS tile service
  (<https://trek.nasa.gov/tiles/apidoc/trekAPI.html?body=moon>).
- **Fetched:** 15 November 2026. `manifest.json` records the layer, zoom level and ground scale of
  every picture.
- **Made by:** `tools/site-context/make_site_context.py`, which fetches the tiles around each site,
  joins them and crops to the site. Nothing else is done to the pixels.

| Sites | Moon Trek layer | Data behind it |
|---|---|---|
| Shackleton Connecting Ridge (south of 87.5° S) | `LRO_LOLA_ClrShade_SPole875_5mp_v04` | Lunar Reconnaissance Orbiter LOLA elevation model, color shaded relief |
| Other sites south of 60° S | `LRO_WAC_Mosaic_SPole60_100m_v02` | Lunar Reconnaissance Orbiter Camera wide-angle mosaic, south pole |
| All other sites | `LRO_WAC_Mosaic_Global_303ppd_v02` | Lunar Reconnaissance Orbiter Camera wide-angle mosaic, global |

The ridge site uses shaded relief because the camera mosaic is in shadow there.

## Layout

- **Polar pictures** are in Moon Trek's south polar stereographic grid: the south pole is toward
  the middle of that grid and 0° longitude points up.
- **All other pictures** have north up. They are squeezed east to west by the cosine of the site's
  latitude so that distances read the same in both directions at the site.
- `meters_per_pixel` in `manifest.json` is the ground scale at the site.

## Credit

Lunar Reconnaissance Orbiter data: NASA/GSFC/Arizona State University (camera mosaics) and
NASA/GSFC (LOLA). Map tiles: NASA Moon Trek, NASA/JPL-Caltech.

## To make them again

```
pip install pillow
python tools/site-context/make_site_context.py sites.json web/public/site-context
```

`sites.json` is the answer from the backend's `GET /sites`. The script needs `curl` on the path.
