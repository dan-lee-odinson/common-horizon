# Sources: terrain horizon profiles

Everything the horizon profiles and their checks use, where it came from, and
how to recognise the exact files. All data is NASA data. None of the data,
libraries or services is of Chinese origin, and no data or citation from a
Chinese mission is used.

The data files are large and are **not** in this repository. They are kept in
folders outside it and passed to the scripts by path.

## Elevation data

NASA Goddard Space Flight Center, Planetary Geodesy Data Archive (PGDA),
product 90, "A New View of the Lunar South Pole from LOLA":
<https://pgda.gsfc.nasa.gov/products/90>

Cite as the product page asks:

> Barker, M. K., et al. (2023). A New View of the Lunar South Pole from the
> Lunar Orbiter Laser Altimeter (LOLA). *The Planetary Science Journal*, 4, 183.
> doi:10.3847/PSJ/acf3e1. Data doi:10.60903/gsfcpgda-lola-spole.

| File | Pixel | Coverage | Size (bytes) | SHA-256 | Server date | Downloaded |
| --- | --- | --- | --- | --- | --- | --- |
| `LDEM_80S_40MPP_ADJ.TIF` | 40 m | 80 S to the pole (15200 x 15200 pixels, 608 km square) | 716,299,920 | `b7f3567bfa405dbcb42f867f6cd3c9932ca9752b4363ce1eef835f9115c1dd76` | 2023-07-07 | 2026-11-14 |
| `LDEM_60S_240MPP_ADJ.TIF` | 240 m | 60 S to the pole (7760 x 7760 pixels, 1862.4 km square) | 218,961,039 | `3f9663257b63022f2b0d5a623482ff3cadddceb91594a4e4ca14a94d8cec8b34` | 2023-07-07 | 2026-11-14 |

Links, taken from the product page:

- <https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_80S_40MPP_ADJ.TIF>
- <https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_60S_240MPP_ADJ.TIF>

What the files say about themselves (read with rasterio, not assumed):

- Projection: polar stereographic, latitude of origin -90, central meridian 0,
  no false easting or northing, true scale at the pole, on a sphere of radius
  1,737,400 m ("Moon (2015) - Sphere / Ocentric / South Polar").
  PROJ string: `+proj=stere +lat_0=-90 +lat_ts=-90 +lon_0=0 +x_0=0 +y_0=0 +R=1737400 +units=m`.
- Grid: north-up, pixel values are areas (`AREA_OR_POINT=Area`); upper-left
  corner at (-304000, 304000) m for the 40 m file and (-931200, 931200) m for
  the 240 m file. The south pole is the exact centre of each grid.
- Values: 32-bit floats, no-data is NaN (every pixel of both files has a value).
- Height unit: the files carry **no unit tag**. The product page states the
  LDEM values are "surface height (in meters)", and the files' history tag shows
  a multiplication by 1000 from kilometres. The loader records that the unit
  comes from the documentation and refuses a file whose range of heights is
  not plausible lunar relief in metres. Ranges: -7296.5 to 7026.8 m (40 m file),
  -9127.1 to 7024.8 m (240 m file).
- Reference: heights are above the 1737.4 km sphere; coordinates are in the
  MOON_ME frame of the DE421 ephemeris (product page).

Check of the coordinate conversion on known points
(`python backend/scripts/compute_horizon_profiles.py --dem-dir <folder> --check-georeferencing`):
the projection formula agrees with PROJ within 1.3e-9 m; the pole falls on each
grid's centre; the craters Shackleton, de Gerlache, Shoemaker, Haworth and
Faustini are found as depressions 1.8 to 4.0 km deep at their gazetteer
coordinates in both files; and the two files agree with each other to 3.1 m rms
(mean -0.01 m) at 20,000 random points south of 80.5 S, against 50.6 m rms when
one grid is shifted by a single 240 m pixel.

## SPICE kernels

NASA Jet Propulsion Laboratory, Navigation and Ancillary Information Facility
(NAIF), generic kernels: <https://naif.jpl.nasa.gov/pub/naif/generic_kernels/>

| File | What it is | Path under `generic_kernels/` | Size (bytes) | SHA-256 | Server date | Downloaded |
| --- | --- | --- | --- | --- | --- | --- |
| `naif0012.tls` | Leap seconds | `lsk/` | 5,257 | `678e32bdb5a744117a467cd9601cd6b373f0e9bc9bbde1371d5eee39600a039b` | 2016-07-15 | 2026-11-14 |
| `de440s.bsp` | Planetary ephemeris DE440 (short span) | `spk/planets/` | 32,726,016 | `c1c7feeab882263fc493a9d5a5b2ddd71b54826cdf65d8d17a76126b260a49f2` | 2020-12-21 | 2026-11-14 |
| `moon_pa_de440_200625.bpc` | Lunar orientation (principal axes, DE440) | `pck/` | 12,863,488 | `60cd55aa401ea2ea97360636f567554bfe4e37bb829f901b4460a455dfaf783f` | 2021-06-26 | 2026-11-14 |
| `moon_de440_250416.tf` | Lunar frames; defines MOON_ME | `fk/satellites/` | 19,478 | `a47c71e9c9f33796bdafb2c9d69a7ee447b6016ecad80f71cd6f3e479f9cf768` | 2025-04-16 | 2026-11-14 |

These are the same four kernels the physics engine loads. In
`moon_de440_250416.tf`, MOON_ME is the mean Earth / polar axis frame
`MOON_ME_DE440_ME421`, the DE440 orientation expressed in the DE421 mean Earth
frame, which is the frame of the elevation data.

## Other sources

| What | Used for | Source |
| --- | --- | --- |
| Crater names, centres and diameters (Shackleton, de Gerlache, Shoemaker, Haworth, Faustini) and Mons Mouton | Known points for the coordinate check and a direction test | IAU / USGS Gazetteer of Planetary Nomenclature, <https://planetarynames.wr.usgs.gov/>, read 2026-11-14 |
| Site coordinates | The sites the profiles are computed for | `web/src/api/examples/sites.json` in this repository (its own sources are in `web/SOURCES-web.md`) |
| Sun radius 695,700 km | Angular size of the Sun's disc in the check | IAU 2015 Resolution B3, nominal solar radius |
| Earth equatorial radius 6378.1366 km | Angular size of the Earth's disc in the check | IAU 2009 system of astronomical constants |
| Moon reference radius 1737.4 km | Heights and observer radius | The API contract (`app/models/results.py`) and the elevation files' own sphere |

## Published illumination figures

No published illumination figure was found for the exact points of
`shackleton-ridge` (89.684 S, 196.739 E) or `nobile` (85.42088 S, 31.6218 E),
so none is quoted for them.

The nearest published figure found is for a different point and a different
period, and is given only as context:

> Gläser, P., Scholten, F., De Rosa, D., Figuera, R. M., Oberst, J.,
> Mazarico, E., Neumann, G., Robinson, M. S. (2014). Illumination conditions
> at the lunar south pole using high resolution Digital Terrain Models from
> LOLA. *Icarus*, 243, 78-90. doi:10.1016/j.icarus.2014.08.013.

Its abstract reports, for a location on the "Connecting Ridge" between
Shackleton and de Gerlache over a 19-year lunar precession cycle, sunlight for
92.27% of the time at 2 m above ground and 95.65% at 10 m, with longest dark
periods of typically 3 to 5 days at the best locations. The abstract does not
give the location's coordinates, so the same point could not be recomputed
here. Read from the DLR publication record, <https://elib.dlr.de/94240/>.

Mazarico, E., et al. (2011), *Icarus* 211, 1066-1081,
doi:10.1016/j.icarus.2010.10.030, is the standard reference for polar
illumination from LOLA topography; its site table could not be read during this
work, so no number from it is quoted.

## Libraries (offline tools only)

Pinned in `backend/requirements-tools.txt`. They are not installed in the
service image and the service does not import them.

| Library | Used for | Maintained by | Licence |
| --- | --- | --- | --- |
| numpy 2.5.4 | Array arithmetic in the ray walker | NumPy developers (NumFOCUS) | BSD-3-Clause |
| rasterio 1.5.2 | Reading GeoTIFF files and their georeferencing; brings GDAL and PROJ | Rasterio contributors (originally Mapbox) | BSD-3-Clause |
| spiceypy 6.0.0 | Python wrapper for NASA NAIF's CSPICE toolkit (N0067) | Andrew Annex and contributors | MIT |

rasterio pulls in affine, attrs, certifi, click and pyparsing.
