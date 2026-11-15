# Website API: endpoints, contract changes and open decisions

The backend now serves the endpoints the website's client (`web/src/api/client.ts`) calls, at the
root path: `GET /sites`, `GET /catalog`, `POST /check` and `POST /evaluate`. `GET /health` and
`POST /api/v1/missions/evaluate` are unchanged, except for one added field on `/health`. The full
schema is in `contract/openapi.json`.

**Production still runs the synthetic engine.** Every `/evaluate` and `/check` answer that uses
physics carries `provenance` (`is_synthetic`, engine name, notice) and the `X-Data-Source` header.

## Who computes what

| Part | Owner | Where |
|---|---|---|
| Sun/Earth positions, visibility, darkness, sunlight and Earth percentages, slope, skyline | Physics engine | through the existing `PhysicsEngine` interface and `evaluate_mission` |
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
| `slope_deg` | Null for every site from the real engine adapter (PR #14, not merged; the synthetic engine reports 0) | `score` is null. `score_min` (slope term 0) and `score_max` (slope term 100) bound it, and ranking uses `score_min`. The `landing slope` requirement is unknown, so the verdict is `unknown` unless something else fails. |
| Lander slope limit | Published only for Griffin (10°, `griffin_slope`) | Every other lander leaves `landing slope` unknown. |
| `clear_sky_percent` | Null without a stored terrain skyline (with the PR #14 adapter, 6 of the 17 presets have one) | Shown as unknown. It is not part of the score. |
| `geometry` | From the engine's positions at landing | Never invented; null only if an engine returned no positions. |
| `energy_added_kwh` | Always null | The planner has no net generation-minus-load figure. The planner's `site_energy` (night penalty plus heating penalty) is in `site_energy`. |
| `fits` / `hardware_fits` | Null when the planner answers "depends on capacity figure" or "mass needed" | `hardware fit` is unknown, not passed. |
| Mass, power or generation of a catalog item | Null when not published, and for fields that do not apply to the kind | The planner's own figure, with its unit, status and source, is in `figures`. |

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
     - `slope_deg`, `longest_darkness_hours` and `earth_visible_percent`;
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

`contract_version` stays at `0.1.0`: the existing `/api/v1` shapes did not change.

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

**Measured with real kernels** (laptop, not Lambda; this branch merged locally with PR #14, nothing committed):
- 17 presets × 14 days: 1.6–1.75 s;
- 17 presets × 365 days: 5.2 s;
- responses about 32 kB.

When both branches are merged, regenerate `contract/openapi.json`; `AI_USE_LOG.md` will conflict (both append a section).

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
   - The real engine has no slope yet: is a slope from the LOLA DEM planned (Isabella)?
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
4. `POST /horizon` is not implemented yet: the horizon plot and stage-3 scene still need it.
5. `POST /assistant` is not implemented (out of scope; `assistant_available` is `false`).
