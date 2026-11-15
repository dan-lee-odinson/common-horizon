# Check against NASA's JPL Horizons System

The physics engine works out where the Sun and the Earth are in a landing site's sky from NASA
NAIF SPICE kernels. NASA's JPL Horizons System (<https://ssd.jpl.nasa.gov/horizons/>), one of
the NASA resources listed for this challenge, answers the same question from JPL's own service.
This check asks both for the same sites and the same hours and measures how far apart the two
answers are.

## Result

Hourly for 30 days from 15 February 2027 (721 samples per site and body), observer 2 m above
each site. The figure is the angle on the sky between the engine's direction and Horizons'.

| Site | Sun, largest | Sun, mean | Earth, largest | Earth, mean |
|---|---|---|---|---|
| Shackleton Connecting Ridge (89.684° S, 196.739° E) | 0.00596° | 0.00574° | 0.00021° | 0.00020° |
| Nobile region (85.42088° S, 31.6218° E) | 0.00596° | 0.00574° | 0.00021° | 0.00020° |
| Apollo 11 (0.67416° N, 23.47314° E) | 0.00596° | 0.00574° | 0.00021° | 0.00019° |

For scale, the Sun's disc is about 0.53° wide from the Moon and the Earth's about 1.9°.

The differences are the size expected from two known causes. Horizons reports apparent
directions, corrected for the time light takes to arrive and for the aberration of light,
which for the Sun is about 0.0057°. The engine's positions are geometric. Horizons places the
observer in its own mean-Earth frame for the Moon, and the engine uses the MOON_ME frame from
the NAIF kernels.

The full record, with the query sent to Horizons for each site and body and every 120th sample
side by side, is in `backend/data/horizon_validation/horizons_check_2027.json`. Retrieved
15 November 2026 (Horizons API version 1.2, source DE441).

## What this does and does not show

It shows that the engine's Sun and Earth directions agree with JPL's service to within about
0.006°, far inside the width of either disc. It says nothing about terrain: the skylines come
from LOLA elevation data and are checked separately (`backend/docs/SOURCES-horizon.md` and
`backend/app/physics/horizon/README.md`).

## Running it again

It needs network access to `ssd.jpl.nasa.gov`, the packages in `backend/requirements-tools.txt`
and the four NAIF kernels in a folder outside the repository.

    python backend/scripts/validate_against_horizons.py --kernel-dir /path/to/naif \
        --out backend/data/horizon_validation/horizons_check_2027.json

The tests in `backend/tests/horizon/test_horizons_check.py` read the stored result and need
neither the network nor the kernels.

## Source

Jet Propulsion Laboratory, Solar System Dynamics Group, Horizons System and its API:
<https://ssd.jpl.nasa.gov/horizons/>, <https://ssd-api.jpl.nasa.gov/doc/horizons.html>.
