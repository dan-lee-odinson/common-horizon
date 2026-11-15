# Check against NASA's JPL Horizons System

The physics engine works out where the Sun and the Earth are in a landing site's sky from NASA
NAIF SPICE kernels. NASA's JPL Horizons System (<https://ssd.jpl.nasa.gov/horizons/>), one of
the NASA resources listed for this challenge, answers the same question from JPL's own service.
This check asks both for the same sites and the same hours and measures how far apart the two
answers are. There are two parts:

* a **stored check**: all 17 preset sites, every hour of 2027, kept in the repository;
* a **live comparison route**, `GET /api/v1/horizons/compare`, that asks both for any place and
  minute.

## Result: 17 preset sites, every hour of 2027

Hourly from 1 January 2027 00:00 to 1 January 2028 00:00 UTC: 8761 samples per site and body.
The figures are the angle on the sky between the engine's direction and Horizons' direction
(largest, 95th percentile and mean over the year).

"Height used" is the ground height above the 1737.4 km sphere plus the observer's height.
"(profile)": taken from the site's stored horizon profile, `backend/data/horizon/<id>.json`.
"(default)": the site has no stored profile, so the check uses 0 m (the sphere itself) and a 2 m
observer; the stored file records this for each site (`height_source`).

| Site | Position | Height used | Sun, largest | Sun, 95th pct | Sun, mean | Earth, largest | Earth, 95th pct | Earth, mean |
|---|---|---|---|---|---|---|---|---|
| Shackleton Connecting Ridge (`shackleton-ridge`) | 89.684° S, 196.739° E | 1726.649 m + 2.0 m (profile) | 0.005991° | 0.005940° | 0.005688° | 0.000211° | 0.000207° | 0.000195° |
| Nobile region (`nobile`) | 85.42088° S, 31.6218° E | 6416.081 m + 2.0 m (profile) | 0.005991° | 0.005940° | 0.005688° | 0.000211° | 0.000207° | 0.000195° |
| Apollo 11 (`apollo-11`) | 0.67416° N, 23.47314° E | 0.0 m + 2.0 m (default) | 0.005990° | 0.005940° | 0.005688° | 0.000210° | 0.000207° | 0.000194° |
| Apollo 12 (`apollo-12`) | 3.0128° S, 336.5781° E | 0.0 m + 2.0 m (default) | 0.005990° | 0.005940° | 0.005688° | 0.000210° | 0.000207° | 0.000194° |
| Apollo 14 (`apollo-14`) | 3.64589° S, 342.52806° E | 0.0 m + 2.0 m (default) | 0.005990° | 0.005940° | 0.005688° | 0.000210° | 0.000207° | 0.000194° |
| Apollo 15 (`apollo-15`) | 26.13239° N, 3.6333° E | 0.0 m + 2.0 m (default) | 0.005990° | 0.005940° | 0.005688° | 0.000210° | 0.000207° | 0.000194° |
| Apollo 16 (`apollo-16`) | 8.9734° S, 15.5011° E | 0.0 m + 2.0 m (default) | 0.005990° | 0.005940° | 0.005688° | 0.000210° | 0.000207° | 0.000194° |
| Apollo 17 (`apollo-17`) | 20.1911° N, 30.7723° E | 0.0 m + 2.0 m (default) | 0.005990° | 0.005940° | 0.005688° | 0.000210° | 0.000207° | 0.000194° |
| IM-1 Odysseus (`im-1-odysseus`) | 80.13° S, 1.44° E | 2592.106 m + 2.0 m (profile) | 0.005991° | 0.005940° | 0.005688° | 0.000210° | 0.000207° | 0.000195° |
| IM-2 Athena (`im-2-athena`) | 84.7906° S, 29.1957° E | 5321.835 m + 2.0 m (profile) | 0.005991° | 0.005940° | 0.005688° | 0.000211° | 0.000207° | 0.000195° |
| Blue Ghost Mission 1 (`blue-ghost-m1`) | 18.562° N, 61.81° E | 0.0 m + 2.0 m (default) | 0.005990° | 0.005940° | 0.005688° | 0.000210° | 0.000207° | 0.000194° |
| IM-3 (planned) (`im-3-reiner-gamma`) | 7.585° N, 301.275° E | 0.0 m + 2.0 m (default) | 0.005990° | 0.005940° | 0.005688° | 0.000210° | 0.000207° | 0.000194° |
| Blue Ghost Mission 2 (planned) (`blue-ghost-m2`) | 24.9° S, 177.4° E | 0.0 m + 2.0 m (default) | 0.005991° | 0.005941° | 0.005688° | 0.000211° | 0.000208° | 0.000196° |
| Blue Ghost Mission 3 (planned) (`blue-ghost-m3`) | 36.56° N, 319.28° E | 0.0 m + 2.0 m (default) | 0.005990° | 0.005940° | 0.005688° | 0.000210° | 0.000207° | 0.000194° |
| Draper SERIES-2 (planned) (`draper-cp12`) | 75.0° S, 132.4° E | -4639.725 m + 2.0 m (profile) | 0.005991° | 0.005941° | 0.005688° | 0.000211° | 0.000208° | 0.000195° |
| Chandrayaan-3 (`chandrayaan-3`) | 69.373° S, 32.319° E | 529.298 m + 2.0 m (profile) | 0.005990° | 0.005940° | 0.005688° | 0.000210° | 0.000207° | 0.000194° |
| SLIM (`slim`) | 13.316° S, 25.251° E | 0.0 m + 2.0 m (default) | 0.005990° | 0.005940° | 0.005688° | 0.000210° | 0.000207° | 0.000194° |

Across all 17 sites the largest Sun angle is 0.005991° and the largest Earth angle is
0.000211°. The largest difference in elevation alone is 0.005988°. No site comes near the
0.02° tolerance. For scale, the Sun's disc is about 0.53° wide from the Moon and the Earth's
about 1.9°.

The differences are the size expected from two known causes. Horizons reports apparent
directions, corrected for the time light takes to arrive and for the aberration of light; the
engine's positions are geometric. For the Sun that shows as an almost constant angle (mean
0.005688° at every site). Horizons places the observer in its own mean-Earth frame for the
Moon (`MEAN_ME`), and the engine uses the MOON_ME frame from the NAIF kernels. The Earth, much
closer and moving slowly across the Moon's sky, differs by far less.

The full record is in `backend/data/horizon_validation/horizons_check_2027.json`: for each site
and body the number of samples; the largest, 95th percentile and mean of the angle and of the
elevation difference; one sample per week with both answers side by side; the query sent to
Horizons and when it was answered. Retrieved 2026-11-15, 14:01 to 14:02 UTC (Horizons API version
1.2, source DE441).

The website reads a small copy, `web/public/data/horizons-check.json`: for each site id the largest
Sun and Earth angles, the sample counts, the period, the retrieval time and the Horizons address.

## What changed

Format version 2 of `horizons_check_2027.json` replaces version 1:

* 17 preset sites instead of 3 (the same points as the website's preset list,
  `web/src/api/examples/sites.json`);
* every hour of 2027 instead of 30 days from 15 February 2027;
* heights recorded per site with their source; sites without a stored profile use 0 m and 2 m;
* one sample per week, stored as rows under fixed column names, instead of every 120th sample;
* statistics to 1e-6 degree instead of 1e-5; the query and retrieval time kept for each site and body.

The code that builds, sends and reads the Horizons query moved from the script into
`backend/app/physics/horizons_client.py` (standard library only), which the script and the live
route share. The engine side is one function, `app.api.horizons.engine_az_el`, also shared.

## Live comparison route

`GET /api/v1/horizons/compare` asks Horizons and the engine for the Sun's and the Earth's direction
at one place and one minute.

| Query field | Meaning | Allowed |
|---|---|---|
| `latitude_deg` | planetocentric latitude, degrees | -90 to 90 |
| `longitude_deg` | east longitude, degrees | 0 to 360 |
| `time_utc` | ISO 8601 with a timezone, e.g. `2027-06-01T12:00:00Z` | years 1950 to 2100 |
| `site_height_m` | ground height above the 1737.4 km sphere, metres; default 0 | -10 000 to 11 000 |
| `observer_height_m` | observer above the ground, metres; default 2 | 0 to 1000 |

The time is rounded to the nearest minute (`time_utc` in the answer) and both sides use that
minute. For the Sun and the Earth the answer gives Horizons' azimuth and elevation, the engine's,
and the angle between them; `provenance` names the Horizons address, its API version, the query
sent and the kernels. A real answer (Shackleton Connecting Ridge with its stored height,
2027-06-01 12:00 UTC, the four NAIF kernels, retrieved 15 November 2026), shortened:

```json
{
 "time_utc": "2027-06-01T12:00:00Z",
 "sun":   {"horizons": {"azimuth_deg": 20.54751, "elevation_deg": -1.087997},
           "engine":   {"azimuth_deg": 20.552974, "elevation_deg": -1.087942},
           "angle_between_deg": 0.005463},
 "earth": {"horizons": {"azimuth_deg": 156.478955, "elevation_deg": 5.766362},
           "engine":   {"azimuth_deg": 156.479153, "elevation_deg": 5.766368},
           "angle_between_deg": 0.000197},
 "engine_unavailable_reason": null,
 "provenance": {"horizons": {"api_url": "https://ssd.jpl.nasa.gov/api/horizons.api", "api_version": "1.2",
                             "from_cache": false, "...": "..."},
                "engine": {"kernels": ["naif0012.tls", "de440s.bsp", "moon_pa_de440_200625.bpc",
                                       "moon_de440_250416.tf"], "...": "..."}}
}
```

* **Engine.** The kernels are loaded from the folder named by the environment variable
  `CH_SPICE_KERNEL_DIR`. If it is unset, or the kernels are missing or do not load, the answer
  still carries Horizons' figures, with `"engine": null`, `"angle_between_deg": null` and a plain
  reason in `engine_unavailable_reason`. No number is filled in.
* **Horizons.** Both requests together get 10 seconds. The last 256 answers are kept in memory,
  keyed by the query sent (place to 1e-6 degree and 1 mm, time to the minute); a repeat is marked
  `"from_cache": true`. Failed answers are not kept.
* **Errors.** A field out of range or missing: HTTP 422. Horizons does not answer, or answers
  without a table: HTTP 502 with
  `{"error": "horizons_unavailable", "reason": "...", "horizons_api": "...", "stored_check": "web/public/data/horizons-check.json"}`,
  so the website can show the stored check instead.

The route is not in the exported API contract (`backend/contract/openapi.json`): it is registered
with `include_in_schema=False` so the shared contract files stay as they are. Adding it to the
contract is a follow-up for the backend owner.

## What this does and does not show

It shows that the engine's Sun and Earth directions agree with JPL's service to within about
0.006°, far inside the width of either disc, at all 17 preset sites through 2027. It says nothing
about terrain: the skylines come from LOLA elevation data and are checked separately
(`backend/docs/SOURCES-horizon.md` and `backend/app/physics/horizon/README.md`).

## Running it again

The stored check needs network access to `ssd.jpl.nasa.gov`, the packages in
`backend/requirements.txt` and the four NAIF kernels in a folder outside the repository. It sends
one request per site and body, one at a time, with a one second pause between requests, and exits
with status 1 if any angle is larger than 0.02° (the files are still written).

    python backend/scripts/validate_against_horizons.py --kernel-dir /path/to/naif --year 2027 \
        --out backend/data/horizon_validation/horizons_check_2027.json \
        --web-out web/public/data/horizons-check.json

`--sites apollo-11,slim` limits a run to some of the preset sites; `--kernel-dir` can be left out
when `CH_SPICE_KERNEL_DIR` is set.

The live route runs with the backend (`uvicorn app.main:app` from `backend/`) once
`CH_SPICE_KERNEL_DIR` names the kernel folder:

    curl "http://localhost:8000/api/v1/horizons/compare?latitude_deg=-89.684&longitude_deg=196.739&time_utc=2027-06-01T12:00:00Z&site_height_m=1726.649"

The tests in `backend/tests/horizon/test_horizons_check.py` (stored result, website copy, helpers)
and `backend/tests/test_horizons_compare.py` (the route, with stand-ins for Horizons and the
engine) need neither the network nor the kernels.

## Sun check against NASA Moon Trek

NASA Moon Trek (<https://trek.nasa.gov/moon/>) has its own service for the Sun's azimuth and
elevation seen from a point on the Moon. It answers for the Sun only (it refuses the Earth). This
check does with it what the Horizons check does: all 17 preset sites, every hour from 1 January
2027 00:00 to 1 January 2028 00:00 UTC (8761 samples per site), the engine against Moon Trek, and
the angle on the sky between the two directions. The engine side and the heights are the same as
in the Horizons check (`app.api.horizons.engine_az_el`, heights from `load_sites`).

| Site | Position | Sun, largest | Sun, 95th pct | Sun, mean | Elevation, largest | Horizons Sun, largest |
|---|---|---|---|---|---|---|
| Shackleton Connecting Ridge (`shackleton-ridge`) | 89.684° S, 196.739° E | 0.006048° | 0.005991° | 0.005727° | 0.000874° | 0.005991° |
| Nobile region (`nobile`) | 85.42088° S, 31.6218° E | 0.006025° | 0.005966° | 0.005727° | 0.001272° | 0.005991° |
| Apollo 11 (`apollo-11`) | 0.67416° N, 23.47314° E | 0.006400° | 0.006325° | 0.005689° | 0.006396° | 0.005990° |
| Apollo 12 (`apollo-12`) | 3.0128° S, 336.5781° E | 0.006555° | 0.006466° | 0.005677° | 0.006553° | 0.005990° |
| Apollo 14 (`apollo-14`) | 3.64589° S, 342.52806° E | 0.006536° | 0.006450° | 0.005679° | 0.006532° | 0.005990° |
| Apollo 15 (`apollo-15`) | 26.13239° N, 3.6333° E | 0.006400° | 0.006328° | 0.005691° | 0.005819° | 0.005990° |
| Apollo 16 (`apollo-16`) | 8.9734° S, 15.5011° E | 0.006421° | 0.006345° | 0.005688° | 0.006372° | 0.005990° |
| Apollo 17 (`apollo-17`) | 20.1911° N, 30.7723° E | 0.006338° | 0.006267° | 0.005695° | 0.005985° | 0.005990° |
| IM-1 Odysseus (`im-1-odysseus`) | 80.13° S, 1.44° E | 0.006070° | 0.006006° | 0.005725° | 0.001812° | 0.005991° |
| IM-2 Athena (`im-2-athena`) | 84.7906° S, 29.1957° E | 0.006025° | 0.005967° | 0.005727° | 0.001335° | 0.005991° |
| Blue Ghost Mission 1 (`blue-ghost-m1`) | 18.562° N, 61.81° E | 0.006276° | 0.006208° | 0.005702° | 0.005974° | 0.005990° |
| IM-3 (planned) (`im-3-reiner-gamma`) | 7.585° N, 301.275° E | 0.006633° | 0.006532° | 0.005673° | 0.006563° | 0.005990° |
| Blue Ghost Mission 2 (planned) (`blue-ghost-m2`) | 24.9° S, 177.4° E | 0.006426° | 0.006349° | 0.005700° | 0.005973° | 0.005991° |
| Blue Ghost Mission 3 (planned) (`blue-ghost-m3`) | 36.56° N, 319.28° E | 0.006477° | 0.006392° | 0.005690° | 0.005384° | 0.005990° |
| Draper SERIES-2 (planned) (`draper-cp12`) | 75.0° S, 132.4° E | 0.005971° | 0.005930° | 0.005728° | 0.002271° | 0.005991° |
| Chandrayaan-3 (`chandrayaan-3`) | 69.373° S, 32.319° E | 0.006035° | 0.005989° | 0.005724° | 0.002801° | 0.005990° |
| SLIM (`slim`) | 13.316° S, 25.251° E | 0.006382° | 0.006308° | 0.005692° | 0.006264° | 0.005990° |

"Elevation, largest" is the largest difference in elevation alone. The last column repeats the
Horizons check's largest Sun angle for the same site, for comparison.

Across all 17 sites the largest angle is 0.006633° (IM-3) and the largest difference in
elevation 0.006563°, against a stop line of 0.05°. The mean is nearly the same at every site
(0.005673° to 0.005728°) and close to the Horizons check's (0.005688°). Moon Trek's answer does not
say whether its directions are apparent or geometric, so this check does not say where the
difference comes from. The known answer for Apollo 11 at 2027-02-17 12:00 UTC (azimuth 91.141082°,
elevation 68.258447°) is what the kept answer for that hour says.

How it was asked:

    GET https://trek.nasa.gov/getAzElfromT1/LTD002=Moon,<lat>,<lon>,<altKm>,<lat>,<lon>,1,1/Sun/<start>/<end>/3600

* one month per request (12 per site, 204 in all), one request at a time, with a one second pause;
  retrieved 2026-11-15, 16:33 to 16:41 UTC;
* `altKm` is the same height as in the Horizons check (site height plus observer height above the
  1737.4 km sphere). For the Sun a few kilometres move the direction by less than 1e-6°;
* times as `2027-01-01T00:00:00`; the answers give them as day of year (`2027-001T00:00:00.000000`),
  and the script checks that every month has exactly the hours asked for.

Moon Trek's answers (204 XML files, 20.3 MB) are kept unchanged outside the repository.
`backend/data/horizon_validation/moon_trek_sun_check_2027.json` records
for each site the statistics, one sample per week with both answers side by side, and for each
request its address, retrieval time, size and SHA-256. The website gets a small copy,
`web/public/data/moon-trek-sun-check.json`: per site the largest Sun angle, the sample count, the
period, the retrieval time and the Moon Trek address.

To run it again (the kernels as for the Horizons check; answers already kept are read instead of
being asked again; exit status 1 if any angle is above 0.05°):

    python backend/scripts/validate_against_moon_trek.py --kernel-dir /path/to/naif --year 2027 \
        --answers-dir /path/outside/the/repo/moon-trek-sun-2027 \
        --out backend/data/horizon_validation/moon_trek_sun_check_2027.json \
        --web-out web/public/data/moon-trek-sun-check.json

`backend/tests/horizon/test_moon_trek_check.py` checks the helpers, the stored result and the
website copy without the network or the kernels.

## Source

Jet Propulsion Laboratory, Solar System Dynamics Group, Horizons System and its API:
<https://ssd.jpl.nasa.gov/horizons/>, <https://ssd-api.jpl.nasa.gov/doc/horizons.html>.

NASA Moon Trek (NASA Solar System Treks), Sun azimuth and elevation service:
<https://trek.nasa.gov/moon/>.
