# API contract v0.1.0 (draft)

Status: **draft for review** by the physics owner (Isabella) and the frontend owner (Dan).
Source of the field list: the team document *Physics Engine-to-website Integration*.
Machine-readable version: [`../contract/openapi.json`](../contract/openapi.json).

Conventions:

- Units are part of every field name: `_deg`, `_m`, `_km`, `_s`, `_hours`, `_days`, `_utc`.
- Timestamps are ISO 8601 strings. Responses always use UTC with a `Z` suffix.
- Vectors are `[x, y, z]` in the `MOON_ME` frame.
- Time series are column-oriented: one array per quantity, all aligned with `timestamps_utc`.
- Unknown request fields are rejected (HTTP 422), so typos fail loudly.
- `provenance.is_synthetic` (and the `X-Data-Source` header) says whether the numbers are
  placeholders (`synthetic`) or physics-engine results (`physics_engine`).

## Endpoints

| Method | Path | Success | Errors |
|---|---|---|---|
| GET | `/health` | 200 `HealthResponse` | none |
| POST | `/api/v1/missions/evaluate` | 200 `MissionEvaluation` | 422 invalid input, 502 engine output broke the contract, 503 engine unavailable |

422 bodies use FastAPI's standard shape: `{"detail": [{"loc": [...], "msg": "...", "type": "..."}]}`.
502/503 bodies are `{"detail": "..."}`.

## Inputs: website → engine (`MissionInput`)

| Integration-doc input | Field | Unit | Required | Validation (provisional) |
|---|---|---|---|---|
| Landing latitude | `landing_site.latitude_deg` | deg, north + | yes | -90 … 90 |
| Landing longitude | `landing_site.longitude_deg` | deg, east + | yes | -180 … 180 |
| Landing altitude | `landing_site.altitude_m` | m vs 1737.4 km sphere | no (null → from terrain) | -10 000 … 11 000 |
| Observer height | `observer_height_m` | m above surface | no (0) | 0 … 1 000 |
| Mission start | `mission_start_utc` | ISO 8601 with timezone | yes | 2000-01-01 ≤ start; end incl. max delay ≤ 2100-01-01; naive times, date-only strings and Unix numbers rejected; offsets normalised to UTC |
| Stay duration | `stay_duration_days` | days | yes | > 0 … 365 |
| Time step | `time_step_s` | s (integer) | yes | 60 … 86 400, ≤ stay duration |
| Launch delay | `launch_delay_days` | whole days | no (0 = off) | 0 … 30 |
| (backend addition) | `launch_delay_step_days` | whole days | no (1) | 1 … 30, ≤ `launch_delay_days` |
| Hardware ID | `hardware_id` | string | no | `^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$` |
| Hardware requirements | `hardware_requirements` | object | no | see below |

Additional rule: the number of samples, `ceil(stay / time_step) + 1`, must be ≤ 10 000. This keeps a
full response under the 6 MB AWS Lambda synchronous payload limit; a test checks it.

`hardware_requirements` (all optional, proposed schema): `min_sunlight_percentage` (0–100),
`min_sunlight_hours`, `max_darkness_hours`, `min_earth_visibility_percentage` (0–100),
`min_earth_visibility_hours`, `max_slope_deg` (0–90).

## Outputs: engine → website (`MissionEvaluation`)

| Integration-doc output | Field |
|---|---|
| UTC timestamp | `timeseries.timestamps_utc[]` |
| Sun / Earth position (3D, km) | `timeseries.sun.position_km[]`, `timeseries.earth.position_km[]` |
| Sun / Earth direction (unit, MOON_ME) | `timeseries.{sun,earth}.direction_unit[]` |
| Sun / Earth azimuth (deg) | `timeseries.{sun,earth}.azimuth_deg[]` (0 … 360, clockwise from north) |
| Sun / Earth elevation (deg) | `timeseries.{sun,earth}.elevation_deg[]` |
| Sun / Earth visibility (bool / fraction) | `timeseries.{sun,earth}.visibility_fraction[]` (0 … 1; visible ⇔ > 0) |
| Sun / Earth obstruction state | `timeseries.{sun,earth}.obstruction_state[]`: `visible`, `partial`, `terrain_blocked`, `below_horizon` |
| Solar-disc visibility | `timeseries.sun.visibility_fraction[]` with `obstruction_state = partial` |
| Terrain skyline | `terrain_skyline` (`azimuth_deg[]`, `horizon_elevation_deg[]`); nullable, not populated yet |
| Terrain elevation grid | not part of this endpoint (too large); planned as a separate endpoint |
| Landing-site elevation | `site.elevation_m` (+ `site.elevation_source`) |
| Landing-site slope | `site.slope_deg` |
| Sunlight duration / percentage | `metrics.sunlight_hours`, `metrics.sunlight_percentage` |
| Longest darkness / sunlight | `metrics.longest_darkness_hours`, `metrics.longest_sunlight_hours` |
| Earth visibility duration / percentage | `metrics.earth_visibility_hours`, `metrics.earth_visibility_percentage` |
| Communication windows | `communication_windows[]` (`start_utc`, `end_utc`, `duration_hours`) |
| Sky visibility | `metrics.sky_visibility_fraction` |
| Time to sunset | `metrics.time_to_sunset_hours`, `metrics.sunset_utc` |
| Time to Earthset | `metrics.time_to_earthset_hours`, `metrics.earthset_utc` |
| Requirement results | `requirement_results[]`, overall `requirements_passed` |
| Launch delay results | `launch_delay_results[]` (`launch_delay_days`, `mission_start_utc`, `metrics`, `requirements_passed`) |

Also returned: `contract_version`, `provenance`, the normalised request as `mission`, and `warnings[]`.

## Engine interface (backend ↔ physics code)

`app/physics/interface.py` defines the only seam:

```python
class PhysicsEngine(Protocol):
    info: EngineInfo                     # name, version, is_synthetic, available
    def simulate(self, request: SimulationRequest) -> SimulationResult: ...
```

- `SimulationRequest`: one site, one start time (lat/lon/alt, observer height, `start_utc`,
  `duration_s`, `time_step_s`, `include_timeseries`).
- `SimulationResult` (Pydantic): `site`, `timeseries`, `metrics`, `communication_windows`,
  `terrain_skyline`, `warnings`. Building it validates array alignment, angle ranges, unit vectors
  and metric ranges, so bad engine output becomes a 502 instead of reaching the website.
- The backend currently runs the launch-delay sweep (one `simulate` call per delay) and the
  requirement comparisons (threshold vs engine metric; no physics).

`app/physics/engine_adapter.py` is where the real engine will be wired in. Until then,
`CH_PHYSICS_ENGINE=physics` answers 503 and never silently falls back to synthetic data.

## Synthetic fixture

`app/physics/synthetic.py` is a deterministic toy model (idealised periodic Sun/Earth motion, a
smooth horizon, no terrain). It exists only so the frontend and tests can run before real results
exist. Its curves look plausible on purpose but **must not be presented as results**. A sample
counts as visible when any part of the disc is above the horizon. That definition is a placeholder.

## Open questions for physics (Isabella)

1. **Coordinates:** planetocentric latitude, east-positive longitude in -180…180, `MOON_ME` frame:
   correct? Which kernels (e.g. DE440, `moon_pa`/`moon_me` frame kernels)?
2. **Elevation reference:** is altitude relative to the 1737.4 km sphere? When the user gives an
   altitude, should it override the LOLA value, or should the input be removed?
3. **Position vectors:** origin at the Moon's centre or at the landing site? Which aberration
   correction (e.g. `LT+S`)?
4. **Visibility definitions:** is the Sun "visible" when any part of the disc is up, when the centre is
   up, or weighted by fraction? Is there an elevation mask for Earth communication?
5. **Obstruction states:** are `visible / partial / terrain_blocked / below_horizon` the right classes?
6. **Metric definitions:** how are sunlight hours and longest darkness computed (sample-and-hold vs
   interpolated crossings)? What do time-to-sunset and time-to-Earthset mean if the body is already
   down at mission start (currently null)?
7. **Launch delay:** a sweep up to a maximum slip (implemented) or one fixed slip? Whole days only?
8. **Limits:** supported date range (kernel coverage), maximum stay, minimum time step, and runtime
   per simulation. These decide whether launch-delay sweeps fit in one synchronous request
   (API Gateway ~29 s).
9. **Ownership:** should the requirements checker and the launch-delay sweep live in the engine
   or stay in the backend (current)? What requirement fields does your checker expect, and does
   `hardware_id` map to a catalogue?
10. **Python interface:** package/module name, function signatures, return types (numpy arrays,
    dicts?), dependencies (spiceypy, numpy, …), kernel/terrain data size and location (image vs S3).
11. **Terrain outputs:** skyline azimuth resolution; elevation-grid extent, resolution and format for
    the 3D view.
12. **Observer height:** how is it used (horizon dip, terrain line of sight), and what default?
