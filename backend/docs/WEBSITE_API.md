# Website API: endpoints, contract changes and open decisions

The backend now serves the endpoints the website's client (`web/src/api/client.ts`) calls, at the
root path: `GET /sites`, `GET /catalog`, `POST /check`, `POST /evaluate` and `POST /horizon`. `GET /health` and
`POST /api/v1/missions/evaluate` are unchanged, except for one added field on `/health`. The full
schema is in `contract/openapi.json`.

**Production still runs the synthetic engine.** Every `/evaluate` and `/check` answer that uses
physics carries `provenance` (`is_synthetic`, engine name, notice) and the `X-Data-Source` header.

## Who computes what

| Part | Owner | Where |
|---|---|---|
| Sun/Earth positions, visibility, darkness, sunlight and Earth percentages, slope, skyline | Physics engine | through the existing `PhysicsEngine` interface and `evaluate_mission`; the slope of a preset site is a stored value (see "Slope" below) |
| Fit, power and site-energy arithmetic | Planner module | `planner.fit_check`, `power_check`, `site_energy` (unchanged copy) |
| Score, requirement order, ranking, launch-delay orchestration | Backend | `app/services/ranking.py`, `app/services/website_evaluation.py` |

The backend does only three small things to engine output: it converts the Sun and Earth position
vectors at landing to sub-solar and sub-Earth points, counts the dark spells in the sampled
series (for `site_energy`'s `nights`), and classifies the Earth link.

## Ranking (Dan's rules)

All weights and scales are in `DAN_RANKING_RULES` (`app/services/ranking.py`):

    score = 0.40 * sunlight + 0.25 * darkness + 0.20 * earth + 0.15 * slope
    darkness = max(0, 100 * (1 - longest_darkness_hours / 354))
    slope    = max(0, 100 * (1 - slope_deg / 10))

Requirements are checked in this order, and the first one that fails is reported in `verdict.requirement`:

1. `hardware fit`
2. `night power`
3. `day power`
4. `landing slope`
5. `Earth contact`

These names match the website's `FIX_HINT` keys; `landing slope` is new.

Sort order:
1. passing sites;
2. then `unknown` sites;
3. then failing sites.

Within each group the order is by score, highest first, with ties broken by the higher `score_max`, then by site id, then by request order. `rank` (1 = best) is part of each result.

## Missing data: what is null and why

| Quantity | Today | Effect |
|---|---|---|
| `slope_deg` | Known for the 17 preset sites with the real engine (stored, see "Slope" below); null for custom points (the synthetic engine reports 0) | Where it is null: `score` is null. `score_min` (slope term 0) and `score_max` (slope term 100) bound it, and ranking uses `score_min`. The `landing slope` requirement is unknown, so the verdict is `unknown` unless something else fails. |
| Lander slope limit | Published only for Griffin (10°, `griffin_slope`) | Griffin: `landing slope` passes or fails on the site's slope. Every other lander: the slope is shown in the requirement's `detail` and counts in the score, but `landing slope` has no pass or fail (`passed: null`), so it is listed in `unknown_requirements`. |
| `clear_sky_percent` | Null without a stored terrain skyline (6 of the 17 presets have one) | Shown as unknown. It is not part of the score. |
| `geometry` | From the engine's positions at landing | Never invented; null only if an engine returned no positions. |
| `energy_added_kwh` | Always null | The planner has no net generation-minus-load figure. The planner's `site_energy` (night penalty plus heating penalty) is in `site_energy`. |
| `fits` / `hardware_fits` | Null when the planner answers "depends on capacity figure" or "mass needed" | `hardware fit` is unknown, not passed. |
| Mass, power or generation of a catalog item | Null when not published, and for fields that do not apply to the kind | The planner's own figure, with its unit, status and source, is in `figures`. |

## Slope

With the real engine, each of the 17 preset sites has a stored slope, `backend/data/site_slopes.json`, built
by `backend/scripts/site_slopes_from_moon_trek.py`. It reaches the website through the existing path: the
engine adapter puts it in the site's `slope_deg`, and `/evaluate` scores and checks it as before (the score
formula is unchanged).

- **What it is:** the slope of the best-fit plane to LOLA heights within 500 m (NASA Moon Trek). Every
  answer that carries the slope says so:
  - `slope_source` holds that text;
  - the site's `warnings` add the layer, the number of heights fitted and the fetch date;
  - the `landing slope` requirement's `detail` repeats it.
- **It is regional, wider than a lander.** The plane is fitted over a circle 1 km across, so the ground under
  a lander's feet can be steeper or flatter. Griffin's 10° limit is checked against this regional figure.
- **How it is made:**
  - Moon Trek's subset service returns a LOLA elevation patch around the site (GeoTIFF, metres above the
    1737.4 km sphere).
  - Each pixel centre becomes east/north metres in the site's tangent plane.
  - The heights within 500 m are fitted with a least-squares plane; the slope is that plane's tilt.
- **Layers:**
  - south of 87.5° S, the 5 m south polar model;
  - from 75° S to 87.5° S, the 30 m south polar model;
  - elsewhere, the global model at 128 pixels per degree (about 237 m pixels, so only a dozen or so heights
    fall inside the circle; `heights_fitted` gives the count per site);
  - a polar patch with no-data inside the circle falls back to the global model (`layers_not_used` says so).
- **Where it applies:** only at a preset site's own coordinates (within 1 m). A custom point keeps
  `slope_deg: null` and `slope_source: null`.
- **Checks:**
  - Griffin (published limit 10°): `landing slope` passes or fails;
  - every other lander: the slope is shown in `detail` and counts in the score, with no pass or fail.
- **Production** still runs the synthetic engine, which reports 0 with
  `slope_source: "synthetic engine: terrain is not modelled, 0 is a placeholder, not a measured slope"`.

The stored values (all fetched 2026-11-15; pixel size of the global layer along a meridian):

| Site | Position | Slope | Layer | Pixel | Heights fitted |
|---|---|---|---|---|---|
| Shackleton Connecting Ridge (`shackleton-ridge`) | 89.684° S, 196.739° E | 6.580° | `LRO_LOLA_DEM_SPole875_5mp_v04` | 5 m | 31423 |
| Nobile region (`nobile`) | 85.42088° S, 31.6218° E | 7.629° | `LRO_LOLA_DEM_SPole75_30mp_v04` | 30 m | 877 |
| Apollo 11 (`apollo-11`) | 0.67416° N, 23.47314° E | 1.175° | `LRO_LOLA_DEM_Global_128ppd_v04` | 236.9 m | 15 |
| Apollo 12 (`apollo-12`) | 3.0128° S, 336.5781° E | 1.126° | `LRO_LOLA_DEM_Global_128ppd_v04` | 236.9 m | 14 |
| Apollo 14 (`apollo-14`) | 3.64589° S, 342.52806° E | 0.616° | `LRO_LOLA_DEM_Global_128ppd_v04` | 236.9 m | 14 |
| Apollo 15 (`apollo-15`) | 26.13239° N, 3.6333° E | 1.031° | `LRO_LOLA_DEM_Global_128ppd_v04` | 236.9 m | 16 |
| Apollo 16 (`apollo-16`) | 8.9734° S, 15.5011° E | 1.968° | `LRO_LOLA_DEM_Global_128ppd_v04` | 236.9 m | 14 |
| Apollo 17 (`apollo-17`) | 20.1911° N, 30.7723° E | 1.091° | `LRO_LOLA_DEM_Global_128ppd_v04` | 236.9 m | 15 |
| IM-1 Odysseus (`im-1-odysseus`) | 80.13° S, 1.44° E | 11.819° | `LRO_LOLA_DEM_SPole75_30mp_v04` | 30 m | 889 |
| IM-2 Athena (`im-2-athena`) | 84.7906° S, 29.1957° E | 2.264° | `LRO_LOLA_DEM_SPole75_30mp_v04` | 30 m | 875 |
| Blue Ghost Mission 1 (`blue-ghost-m1`) | 18.562° N, 61.81° E | 0.294° | `LRO_LOLA_DEM_Global_128ppd_v04` | 236.9 m | 14 |
| IM-3 (planned) (`im-3-reiner-gamma`) | 7.585° N, 301.275° E | 0.658° | `LRO_LOLA_DEM_Global_128ppd_v04` | 236.9 m | 14 |
| Blue Ghost Mission 2 (planned) (`blue-ghost-m2`) | 24.9° S, 177.4° E | 1.782° | `LRO_LOLA_DEM_Global_128ppd_v04` | 236.9 m | 16 |
| Blue Ghost Mission 3 (planned) (`blue-ghost-m3`) | 36.56° N, 319.28° E | 3.658° | `LRO_LOLA_DEM_Global_128ppd_v04` | 236.9 m | 16 |
| Draper SERIES-2 (planned) (`draper-cp12`) | 75.0° S, 132.4° E | 0.187° | `LRO_LOLA_DEM_SPole75_30mp_v04` | 30 m | 901 |
| Chandrayaan-3 (`chandrayaan-3`) | 69.373° S, 32.319° E | 0.435° | `LRO_LOLA_DEM_Global_128ppd_v04` | 236.9 m | 39 |
| SLIM (`slim`) | 13.316° S, 25.251° E | 7.086° | `LRO_LOLA_DEM_Global_128ppd_v04` | 236.9 m | 15 |

- With Griffin, IM-1 Odysseus (11.819°) now fails `landing slope`; every other preset passes it.
- No polar patch had no-data inside its circle, so no site fell back to the global layer. Draper SERIES-2
  lies exactly on 75° S and was covered by the 30 m model.
- Where the global layer is used, the plane rests on 14 to 39 heights about 237 m apart, so it says
  little about anything smaller than a few hundred metres.

The patches are kept in `backend/data/site_slopes/` (with each request's address, retrieval time and
checksum), and `backend/tests/physics/test_site_slopes.py` recomputes every slope from them without the
network. The Docker image gets `site_slopes.json` only.

## Contract changes the website needs (smallest set)

These are differences from `web/src/api/types.ts`. All other fields match it by name and meaning.

1. **Verdict:**
   - `result` can be `'unknown'`;
   - new `unknown_requirements: string[]`;
   - `requirement` names the first unknown requirement when the result is `unknown`.
2. **SiteEvaluation:**
   - `score: number | null`;
   - new fields:
     - `rank`, `score_min`, `score_max` and `score_components`;
     - `slope_deg`, `slope_source`, `longest_darkness_hours` and `earth_visible_percent`;
     - `requirements` (one line per requirement), `site_energy`, `elevation_m`, `elevation_source` and `warnings`;
   - `clear_sky_percent`, `hardware_fits` and `energy_added_kwh` are nullable.

   **The website must keep the backend's order** (or sort by `rank`). `util/ranking.ts:sortByScore` re-sorts by score, which breaks with null scores and ignores the pass/fail grouping.
3. **EvaluateResponse:**
   - `geometry` is nullable;
   - new fields: `provenance`, `warnings`, `time_step_s` and `transit_days`.
4. **EvaluateRequest:** optional `transit_days` (see the decisions below).
5. **CatalogItem:**
   - `kind` can be `'load'` (power loads; `power` stays for sources);
   - nullable fields: `mass_kg`, `load_day_kw`, `load_night_kw`, `gen_kw` and `gen_needs_sun`;
   - new fields: `capacity_options` (Starship HLS and Blue Moon Mark 2 cargo each have two published figures, so `capacity_kg` is null for them) and `figures`.

   **The catalog ids are the planner's** (`griffin`, `starship_hls`, `fission_40kwe`, ...), not the mock ids (`starship`, `hab`, `nuclear`, `solar`, ...). Hardware choices saved under mock ids will be rejected with 422.
6. **CatalogResponse:** new `status_labels`.
7. **CheckResponse:**
   - `fits` is nullable;
   - new fields: `fit_verdict`, `site_energy`, `provenance` and `warnings`;
   - `energy_added_kwh` is null.
8. **HealthResponse:** `assistant_available` is now sent (always `false`). The backend's `status` is always `"ok"`, and the extra fields (`service`, `contract_version`, `physics_engine`) are additive.
9. **HorizonResponse** (`POST /horizon`, see below):
   - `sun_path[].state` is `"above"` when **any part of the Sun's disc** is visible above the terrain, the rule `/evaluate` uses for sunlight. The comment in `types.ts` says "the Sun's centre". The difference is deliberate: there is one definition of "lit" across the product.
   - new fields: `provenance`, `warnings`, `time_step_s` and `skyline_source` (`stored_profile` or `smooth_sphere`).
   - `skyline` comes at the stored profile's own spacing (0.5° for the stored profiles, 720 points), not every 10° as in the sample. A site without a stored profile gets the engine's smooth-sphere skyline (the same dip at every azimuth) and a warning.
   - `earth_box` covers the Earth's sampled directions with elevation above 0°.
   - **HorizonRequest:** `step_hours` is rounded to whole minutes and may be coarsened (see `time_step_s`).

10. **Slope** (see "Slope" below): new `slope_source` beside `slope_deg` in each `SiteEvaluation`, and in
    `site` of `/api/v1/missions/evaluate`. The `landing slope` requirement's `detail` names the slope and
    what it is.

`contract_version` stays at `0.1.0`: the only change to the `/api/v1` shapes is one added output field,
`site.slope_source`.

## Inputs and validation

**Sites:**
- `lat` runs from −90 to 90.
- `lon_east` is accepted from −180 to 360 and normalised to the range 0–360 (east-positive).
- Site ids may contain `:` because of the website's custom ids (`custom:<lat>:<lon>`).
- A request can have 1 to 25 sites, with no repeated ids.

**Dates and durations:**
- `launch_utc` and `landing_utc` need an explicit timezone.
- The stay must lie between 2000 and 2100.
- `slip_days` runs from 0 to 30 (whole days).
- `stay_days` runs from 1 to 365. The website allows 365.25; `STAY_DURATION_MAX_DAYS` changes to 365.25 with PR #6.

**Hardware:**
- Ids must be in the catalog.
- No id may be repeated.
- Counts run from 0 to 10, and 0 means not chosen.
- One lander at most, with a count of 1.

**Storage:** `storage_kwh` runs from 0 to 1,000,000. NaN and Infinity are refused.

**Planner errors** (`PlannerInputError`) come back as 422 with the planner's own message. In `/evaluate`, a power check the planner cannot run (for example, darkness longer than a lunar month leaves no sunlit hours to refill storage) turns `night power` and `day power` into unknown and adds a warning.

**Work bound:**
- All sites of one `/evaluate` together use at most `WEBSITE_MAX_TOTAL_SAMPLES` = 20,000 samples.
- The step is hourly, coarsened in whole minutes only when needed. For example, 17 sites × 365 days are sampled every 26,880 s.
- `time_step_s` and a warning say so.
- A coarser step coarsens the darkness and crossing times by up to one step. At 26,880 s (about 7.5 h), a 354 h night reads as 358 h.

**Measured with real kernels** (laptop, not Lambda; this branch with `main` at `86ee0b1`):
- 17 presets × 14 days: 1.5–1.75 s;
- 17 presets × 365 days: 5.2 s;
- responses about 32 kB.

## POST /horizon

What the website's Site stage draws: the terrain skyline, the Sun's path against it and the part of the
sky the Earth moves through. One physics run through the same `PhysicsEngine` interface as `/evaluate`
(observer 2 m above the ground), so it works on the synthetic fixture and on the real engine. Code:
`app/api/website_horizon.py`, `app/models/website_horizon.py`, `app/services/website_horizon.py`.

**Request** (`HorizonRequest`):
- `site` is `{id, name, lat, lon_east}`, with the same limits as `/evaluate` (`lon_east` normalised to 0–360).
- `start_utc` and `end_utc` need an explicit timezone. `start_utc` must be before `end_utc`.
- The window is at most 395.25 days, between 2000-01-01 and 2100-01-01. That is the longest stay `/evaluate` accepts (365.25 days) plus the longest launch delay (30 days), because the website asks from the planned landing to the end of the delayed stay.
- `step_hours` runs from one minute to 24 hours and is rounded to whole minutes.

**Response** (`HorizonResponse`):
- `site_id`.
- `skyline`: `{az, el}` in degrees, sorted by azimuth, evenly spaced.
  - With a stored horizon profile it is that profile, at its own spacing (`skyline_source: "stored_profile"`).
  - Otherwise it is the smooth sphere through the site that the engine uses: the geometric dip for a 2 m observer at every 0.5° (`skyline_source: "smooth_sphere"`). The engine's warning that local terrain is not included is passed on.
  - Built by the engine's horizon model (`HorizonProfile.smooth_sphere`, the call the engine adapter makes), from the site elevation the engine reports. The interface returns no skyline for such sites.
- `sun_path`: `{t, az, el, state}`, where `az` and `el` are the Sun's centre as the engine gives it.
  - `state` is `"above"` when the engine's visible fraction of the disc is above 0, otherwise `"hidden"`. This is the rule `/evaluate` counts as sunlight, so the share of `"above"` points matches `sunlight_percent` to within one sample.
- `earth_box`: `{az_min, az_max, el_min, el_max}` around the Earth's sampled directions with elevation above 0°.
  - The azimuth range is the shortest arc holding them, so `az_min > az_max` when it wraps past north.
  - It is `null` (with a warning) when the Earth never rises above level during the window.
- Added beside the website's fields, as on `/evaluate`: `time_step_s` (the step used), `skyline_source`, `provenance` and `warnings`. The `X-Data-Source` header is set too.

**Work bound:**
- At most 4,000 Sun path samples per request. The website asks for up to 3,600 steps in one request (150 days at one hour), so its requests keep the spacing they ask for.
- A finer `step_hours` is coarsened in whole minutes, and `time_step_s` and a warning say so.
- For example, a 366-day window asked for at one minute gets a 7,920 s step (3,994 samples).

**Errors:**
- 422: invalid input, with the same error shape as `/evaluate`.
- 503: physics engine unavailable.
- 502: engine output that breaks the contract.


## Decisions for Dan and Isabella

1. **Transit time.** The website computes `landing = launch + 5 days (mock TRANSIT_DAYS) + slip`. The 5 days are a mock-model input, not a team decision. The backend therefore:
   - takes an optional `transit_days`;
   - when it is absent, counts the transit as 0, so the stay starts at `launch_utc + slip_days`;
   - says so in `warnings` and returns `transit_days: null`.

   **Decision needed:** a transit time (or a per-lander value), and whether the website sends it.
2. **Earth link classes.** The backend uses:
   - `none` when Earth is visible 0 % of the stay;
   - `clear` at 100 %;
   - `intermittent` otherwise.

   The website mock used ≤ 2 % and ≥ 98 %. Confirm which.
3. **Unknown verdicts.** A site with an unchecked requirement and no failure ranks between passing and failing sites, by its worst-case score. Confirm the grouping, and that ranking by `score_min` is right.
4. **Slope.**
   - The preset sites now have a stored regional slope (see "Slope"). Custom points still have none: is a
     run-time slope from the LOLA DEM planned (Isabella)?
   - A lander without a published slope limit leaves `landing slope` without pass or fail, so its verdict
     is still `unknown` at best, even where the slope is known. Confirm that this is wanted.
   - Should Starship HLS use the crew-lander *tilt* threshold (HLS-R-0071, 0–8°) as its slope limit? Tilt is not ground slope, so it is not mapped.
5. **No lander chosen** fails `hardware fit`. **A lander with no payload** passes it ("nothing to fit"), because `fit_check` needs at least one payload.
6. **Observer height** for website requests is 2 m, the height the stored horizon profiles were computed for.
7. **Darkness and nights.** `site_energy` uses:
   - dark hours = stay hours − sunlight hours;
   - `nights` = the number of separate dark spells in the sampled series (at least 1, as the planner requires);
   - the planner's default refill window (labelled `our estimate`).

   The physics engine could supply a refill window instead.
8. **Catalog design.** A power source (`fission_40kwe`) and its payload mass (`fsp_40kwe`) are separate planner items, so choosing one does not add the other. The same applies to habitat loads and the `surface_habitat` payload. The website should show this, or the planner should link them.

## Shared data copies

The Docker image is built from `backend/` only, so it cannot read `planner/` or `web/`. Two exact copies are kept:

| Source | Copy |
|---|---|
| `planner/planner/` | `backend/app/vendor/planner/` |
| `web/src/api/examples/sites.json` | `backend/app/data/preset_sites.json` |

- `tests/test_shared_data_copies.py` fails if either copy drifts. The deploy workflow runs it on a full checkout.
- After changing a source, run `python backend/scripts/sync_shared_data.py`.
- The Dockerfile is unchanged: both copies sit under `app/`, which it already copies.

## What the website still has to do to go live

1. Set `VITE_API_BASE` to the backend address, and add the website origin to `CH_CORS_ORIGINS` (PR #6).
2. Apply the contract changes above, in `types.ts` and in the panels that read them:
   - null score, unknown verdict, `rank` order;
   - nullable catalog fields, the `load` kind and planner ids;
   - null `energy_added_kwh`;
   - `provenance` labelling.
3. Use the response's `landing_utc` everywhere. Do not add a local transit time. Send `transit_days` once the team fixes one.
4. ~~`POST /horizon` is not implemented yet: the horizon plot and stage-3 scene still need it.~~ Done: see
   "POST /horizon" above. The website still has to read its added fields and the "any part of the disc" rule.
5. `POST /assistant` is not implemented (out of scope; `assistant_available` is `false`).
