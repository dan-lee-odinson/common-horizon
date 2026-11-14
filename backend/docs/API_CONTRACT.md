# API contract v0.1.0 (draft)

Status: **draft**. The items under [Provisional technical assumptions](#provisional-technical-assumptions)
have not yet been validated against the physics engine.
Source of the field list: the team document *Physics Engine-to-website Integration*.
Machine-readable version: [`../contract/openapi.json`](../contract/openapi.json).

Conventions:

- Units are part of every field name: `_deg`, `_m`, `_km`, `_s`, `_hours`, `_days`, `_utc`.
- Timestamps are ISO 8601 strings. Responses always use UTC with a `Z` suffix: every output
  timestamp (time series, metrics, communication windows, launch-delay cases) is normalised to
  UTC, whatever offset the engine used.
- Numbers are always finite. `NaN` and `Infinity` are rejected in requests (HTTP 422) and in
  engine output (HTTP 502); they never appear as `null` in a 200 response.
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
A rejected non-finite number (e.g. `1e999`, which overflows, or the non-standard `NaN` / `Infinity`
tokens) is echoed in `input` as the string `"NaN"`, `"Infinity"` or `"-Infinity"`, so the body is
always strict JSON.
502/503 bodies are `{"detail": "..."}`.

## Inputs: website → engine (`MissionInput`)

| Integration-doc input | Field | Unit | Required | Validation (provisional) |
|---|---|---|---|---|
| Landing latitude | `landing_site.latitude_deg` | deg, north + | yes | -90 … 90 |
| Landing longitude | `landing_site.longitude_deg` | deg, east + | yes | -180 … 180 |
| Landing altitude | `landing_site.altitude_m` | m vs 1737.4 km sphere | no (null → from terrain) | -10 000 … 11 000 |
| Observer height | `observer_height_m` | m above surface | no (0) | 0 … 1 000 |
| Mission start | `mission_start_utc` | ISO 8601 with timezone | yes | 2000-01-01 ≤ start < 2100-01-01 (error on `mission_start_utc`); end incl. max delay ≤ 2100-01-01; naive times, date-only strings, Unix numbers and offsets with no UTC equivalent (e.g. `0001-01-01T00:00:00+01:00`) rejected; offsets normalised to UTC |
| Stay duration | `stay_duration_days` | days | yes | > 0 … 365.25 (one Julian year); still subject to the 10 000-sample cap |
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
  `terrain_skyline`, `warnings`. Building it validates array alignment, angle ranges, unit vectors,
  metric ranges and finiteness, and normalises timestamps to UTC. The backend validates every
  returned result again (results built with `model_copy(update=...)` skip validation), so bad
  engine output becomes a 502 instead of reaching the website.
- The backend currently runs the launch-delay sweep (one `simulate` call per delay) and the
  requirement comparisons (threshold vs engine metric; no physics).

`app/physics/engine_adapter.py` is where the real engine will be wired in. Until then,
`CH_PHYSICS_ENGINE=physics` answers 503 and never silently falls back to synthetic data.

## Synthetic fixture

`app/physics/synthetic.py` is a deterministic toy model (idealised periodic Sun/Earth motion, a
smooth horizon, no terrain). It exists only so the frontend and tests can run before real results
exist. Its curves look plausible on purpose but **must not be presented as results**. A sample
counts as visible when any part of the disc is above the horizon. That definition is a placeholder.

## Provisional technical assumptions

The backend implements the assumptions below so the contract and the frontend can be built now. They
have not yet been validated against the physics engine and may change. A breaking change to request or
response shapes bumps `contract_version`.

| Area | Current assumption (implemented) | Not yet defined |
|---|---|---|
| Coordinates | Planetocentric latitude, east-positive longitude in -180 … 180, `MOON_ME` frame | Kernel set (e.g. DE440, `moon_pa` / `moon_me` frame kernels) |
| Elevation reference | `altitude_m` and `site.elevation_m` are relative to the 1737.4 km sphere. A supplied altitude is passed to the engine; `null` means the engine derives it from terrain. `site.elevation_source` reports which applied | Precedence between a supplied altitude and the terrain-model (LOLA) value |
| Position vectors | `position_km` from the Moon's centre; `direction_unit` from the observer to the body; both in `MOON_ME` | Aberration correction (e.g. `LT+S`) |
| Visibility | A body counts as visible when any part of its disc is above the horizon (`visibility_fraction > 0`) | Centre-of-disc or fraction-weighted definitions; elevation mask for Earth communication |
| Obstruction states | `visible`, `partial`, `terrain_blocked`, `below_horizon` | Whether these four classes are sufficient |
| Metrics | Sample-and-hold: each interval takes the state sampled at its start. `time_to_sunset_hours` / `time_to_earthset_hours` are `null` when the body is already down at mission start or does not set | Interpolated crossings; meaning of time-to-set when the body starts below the horizon |
| Launch delay | Sweep of whole-day delays 0, step, 2·step, … up to `launch_delay_days` | Whether a single fixed slip is needed instead |
| Limits | Values in `app/models/limits.py` (see [Inputs](#inputs-website--engine-missioninput)) | Kernel coverage and per-simulation runtime, which bound the date window and whether a launch-delay sweep fits one synchronous request (API Gateway ~29 s) |
| Requirement checks, launch-delay sweep | Run in the backend as threshold comparisons on engine values. `hardware_id` is echoed in the response, not passed to the engine, and not mapped to a catalogue | Whether these move into the engine; which requirement fields the engine uses |
| Observer height | Default 0 m. The synthetic model applies it only as horizon dip | Its role in terrain line-of-sight |

## Physics engine integration requirements

To replace the stub in `app/physics/engine_adapter.py`, the engine integration needs:

- A Python entry point: package/module name, function signatures and return types (e.g. numpy arrays or
  dicts), which the adapter converts into `SimulationResult`.
- Runtime dependencies (e.g. spiceypy, numpy) and their size, since they ship in the Lambda container image.
- Location and size of kernel and terrain data (container image or S3).
- Per-simulation runtime for the largest allowed request.
- Terrain outputs: skyline azimuth resolution; extent, resolution and format of the elevation grid
  (planned as a separate endpoint).
