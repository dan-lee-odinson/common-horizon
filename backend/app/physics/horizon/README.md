# Terrain horizon profiles

Near the lunar south pole the Sun never climbs more than a degree or two above
the horizontal, so whether a site is lit is decided by the terrain skyline. This
package computes that skyline for a site, stores it, and tells how much of the
Sun's or the Earth's disc clears it.

The physics engine is owned by the physics lead. This package is an offered
building block for it, not a replacement.

## What a profile is

A profile is the skyline seen from one point: for each azimuth from 0 to 359.5
degrees in 0.5 degree steps, the elevation angle of the highest terrain in that
direction, seen from an observer 2 m above the surface. It is the contract's
`TerrainSkyline` (`azimuth_deg`, `horizon_elevation_deg`) with provenance added.

Stored profiles are in `backend/data/horizon/<site_id>.json`. Besides the two
arrays each file holds the site's coordinates and height, the observer height,
the distance of the skyline point per azimuth (`max_distance_m`), per-azimuth
coverage flags (`coverage.ran_out_of_data`, `reached_max_range`,
`at_first_sample`), the elevation files used (name, SHA-256, projection), the
citation, the sampling settings and the time of computation.

| Site | Elevation data | Site height (m) |
| --- | --- | --- |
| `shackleton-ridge`, `nobile`, `im-2-athena` | 40 m | 1726.6, 6416.1, 5321.8 |
| `im-1-odysseus` | 40 m, and 240 m beyond the 40 m file's edge (56 of 720 azimuths) | 2592.1 |
| `draper-cp12`, `chandrayaan-3` | 240 m only, marked `"coarse": true` | -4639.7, 529.3 |

## Conventions

- Azimuth: degrees clockwise from local north, `0 <= azimuth < 360`; 0 is north, 90 is east.
- Elevation: degrees above the observer's local horizontal plane, the plane
  perpendicular to the radius through the observer. The skyline is often
  **negative**: from high ground the terrain horizon lies below the horizontal,
  and even on a smooth sphere it lies at the geometric dip,
  `-arccos(R / (R + h))`, which is -0.087 degrees for a 2 m observer.
- Moon: a sphere of radius 1737.4 km. Heights are relative to it. Positions and
  directions are in the MOON_ME frame; latitude is planetocentric, longitude
  east-positive.
- Geometry: exact 3D with curvature. The observer is at radius
  `R + site height + observer height`, each terrain sample at `R + its height`.
  No atmosphere, so no refraction.

## Using a profile (pure Python, no extra packages)

```python
from app.physics.horizon import load_site_profile, body_visibility

profile = load_site_profile("shackleton-ridge")
skyline = profile.elevation_at(azimuth_deg=123.4)          # interpolated, wraps at 360
result = body_visibility(profile, azimuth_deg, elevation_deg, angular_radius_deg)
result.fraction    # share of the disc above the skyline, 0..1
result.state       # visible, partial, terrain_blocked or below_horizon
profile.to_terrain_skyline()                               # the contract's TerrainSkyline
```

The disc is cut into vertical strips, each compared with the skyline at its
own azimuth; the disc's width in azimuth grows as `1 / cos(elevation)`. The
state is decided from the fraction first, because a body can be seen below 0
degrees elevation where the skyline dips. A fully hidden body is
`terrain_blocked` when its upper limb is above the horizontal plane and
`below_horizon` otherwise.

`HorizonProfile.smooth_sphere(...)` gives the "no terrain" reference.

## Regenerating a profile

Needs `pip install -r requirements-dev.txt -r requirements-tools.txt` and the
two elevation files described in `backend/docs/SOURCES-horizon.md`, kept in a
folder outside the repository.

```bash
python backend/scripts/compute_horizon_profiles.py --dem-dir /path/to/lola --check-georeferencing
python backend/scripts/compute_horizon_profiles.py --dem-dir /path/to/lola --sites shackleton-ridge nobile im-2-athena im-1-odysseus
python backend/scripts/compute_horizon_profiles.py --dem-dir /path/to/lola --coarse-only --sites draper-cp12 chandrayaan-3
```

After regenerating a profile, regenerate `backend/data/horizon_validation/` as
well (the two `.240m` profiles with `--coarse-only --out-dir ... --suffix .240m`,
then `validate_horizon.py --json-out`); a test fails if the stored results no
longer belong to the stored profiles.

Site coordinates come from `web/src/api/examples/sites.json`. `--point ID LAT LON`
computes a point that is not in that file. A profile takes about a second once
the files are loaded (about 1.2 GB of memory).

How a ray is walked: the first sample is 1.5 pixels from the site, the step is
half a pixel and grows as 0.00025 x distance once that is larger (20 m steps out
to 80 km and 100 m at 400 km for the 40 m file). Close to the site the steps are
split further, so that none is longer than 0.5% of the distance (down to 0.5 m):
for an observer 2 m up, ground 60 to 300 m away changes its elevation by about
half a degree in 20 m. A ray stops when terrain at the
models' highest value could no longer rise above the current maximum, or at
400 km. Heights between pixel centres are interpolated bilinearly. The 40 m
file is used wherever it has data and the 240 m file beyond its edge.

## Checking against the real sky

`backend/scripts/validate_horizon.py` drives the stored profiles with hourly Sun
and Earth positions from SPICE for a year. It is a check, not the engine. When
the physics engine's modules (`app.physics.engine`) are present it uses their
position and frame functions; otherwise it calls SPICE itself with light-time
and stellar aberration corrections. Its output for 2027 is in
`backend/data/horizon_validation/results_2027.json`, made with the engine's
functions (the file records which were used; the script's own SPICE calls give
the same percentages to two decimals):

| Site | Sun at least partly visible, with terrain | On a smooth sphere | Longest dark period, with terrain | Earth at least partly visible, with terrain |
| --- | --- | --- | --- | --- |
| `shackleton-ridge` | 82.67% | 57.29% | 155 h | 50.24% |
| `nobile` | 49.05% | 51.08% | 532 h | 63.37% |

```bash
python backend/scripts/validate_horizon.py --kernel-dir /path/to/naif --sites shackleton-ridge nobile --year 2027 --compare-dir backend/data/horizon_validation --compare-suffix .240m
```

## Limits

- **Pixel size.** Terrain smaller than a pixel (40 m, or 240 m for the coarse
  sites) is not in the skyline. Boulders, small craters and the lander's own
  surroundings can hide a low Sun and are not modelled.
- **Skipped near field.** Terrain within 1.5 pixels of the site (60 m, or 360 m
  for coarse profiles) is skipped on purpose, so that the observer's own cell
  does not block the view. This choice matters and works one way only: skipped
  ground can only be higher than what is reported. Where the skyline point is
  the very first sample, the value is set by the cut-off itself; those azimuths
  are flagged in `coverage.at_first_sample` (49 of 720 at `shackleton-ridge`,
  115 at `nobile`, none at `im-2-athena` or `im-1-odysseus`). With the skip
  shortened to 20 m, the share of 2027 with the Sun at least partly visible
  falls from 82.67% to 79.77% at `shackleton-ridge` and its longest dark period
  grows from 155 h to 208 h; at `nobile` the share falls from 49.05% to 48.46%.
- **The answer depends on resolution.** Recomputed from the 240 m file alone,
  the share of 2027 with the Sun at least partly visible changes from 82.67% to
  88.89% at `shackleton-ridge` and from 49.05% to 55.70% at `nobile`, and the
  Earth figure at `nobile` from 63.37% to 72.81%. Together with the near-field
  choice above, treat the 40 m sunlight figures as uncertain by several
  percentage points either way (79.8% to 88.9% at `shackleton-ridge`, with a
  longest dark period anywhere from 69 h to 208 h), and the coarse sites by
  more. At `nobile` half of the skyline (363 of 720 azimuths) is set by terrain
  closer than 200 m, so the exact landing point matters.
- **Where data ran out.** Each profile flags, per azimuth, rays that left the
  elevation data before the stopping rule was met (`coverage.ran_out_of_data`).
  None of the six stored profiles has such a ray, and none reached 400 km.
- **One ray per azimuth.** The skyline is sampled along 720 thin rays and
  interpolated in between. A peak narrower than the gap between two rays (0.5
  degrees: 87 m at 10 km, 870 m at 100 km) can be missed.
- **One observer height.** Profiles are for 2 m above the surface. Another
  height needs a new profile.
- **Coverage.** The elevation files reach 60 S. Sites north of that have no
  profile, and the tool refuses a site with no elevation data under it.
- **Sphere, not the true figure.** "Horizontal" is perpendicular to the radius,
  not to local gravity or to a lander's deck.
- **Sampling of time.** The yearly figures above are hourly samples of one
  year (2027); "visible" means any part of the disc above the skyline.

## Not done here

- Wiring the profiles into the engine adapter (`app/physics/engine_adapter.py`).
- Shipping `backend/data/horizon` in the container image (the Dockerfile copies only `app/`).
