# Common Horizon backend

FastAPI service between the Common Horizon website and the lunar physics engine.

> **The physics engine calculates; the backend validates and passes results through.**
> Until the real engine is integrated, `/api/v1/missions/evaluate` returns data from a
> **synthetic fixture**. Every response says so in `provenance.is_synthetic` and the
> `X-Data-Source` header. Synthetic numbers are placeholders, not physics results.

## Quick start (local)

Requires Python 3.11+.

```bash
cd backend
python -m venv .venv
.venv/Scripts/activate        # Windows (Git Bash: source .venv/Scripts/activate)
# source .venv/bin/activate   # macOS / Linux
pip install -r requirements-dev.txt
uvicorn app.main:app --reload --port 8000
```

- Interactive docs: http://localhost:8000/docs
- OpenAPI schema: http://localhost:8000/openapi.json (also committed at `contract/openapi.json`)

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Liveness, contract version, active physics engine. Lambda readiness check. |
| POST | `/api/v1/missions/evaluate` | Evaluate one landing site and mission window. |

See [docs/API_CONTRACT.md](docs/API_CONTRACT.md) for every field, its unit, its validation
bounds and how it maps to the physics engine integration document.

## Tests

```bash
cd backend
python -m pytest
```

Covers input validation (coordinates, dates, units, duration, launch delay), endpoint
behaviour, requirement checks, the synthetic fixture's labelling, OpenAPI validity, contract
drift and the Lambda response-size limit.

## Contract artefacts for the frontend

`contract/openapi.json` is the source for generated frontend types. `contract/examples/` has an
example request and a **synthetic** example response. After changing any model, regenerate them
and commit the result:

```bash
cd backend
python -m scripts.export_contract
```

`tests/test_openapi.py` fails when the committed schema is stale.

## Configuration (environment variables)

| Variable | Default | Meaning |
|---|---|---|
| `CH_PHYSICS_ENGINE` | `synthetic` | `synthetic` (labelled fixture) or `physics` (real engine: SPICE + stored terrain profiles; answers 503 while its data is missing, never falls back to synthetic). |
| `CH_SPICE_KERNEL_DIR` | `app/physics/data/datasets/spice` | Folder holding the four NAIF kernels, lowercase names: `naif0012.tls`, `de440s.bsp`, `moon_pa_de440_200625.bpc`, `moon_de440_250416.tf`. Only read with `CH_PHYSICS_ENGINE=physics`. |
| `CH_HORIZON_PROFILE_DIR` | `data/horizon` | Folder of the stored terrain horizon profiles. Only read with `CH_PHYSICS_ENGINE=physics`. |
| `CH_MAX_TOTAL_SAMPLES` | `20000` | Work budget of one evaluation: distinct sample timestamps over the baseline and all launch-delay cases. Larger requests get 422. |
| `CH_CORS_ORIGINS` | `http://localhost:3000,http://localhost:5173` | Comma-separated origins allowed to call the API from a browser. |
| `PORT` | `8080` (Docker) | Port uvicorn listens on inside the container. |

No secrets are needed or stored. Later AWS access (Bedrock) must use the standard AWS
credential chain (an IAM role on Lambda, a local profile in development), never values in this
repository or in `.env` files committed to git.

## Real physics engine (`CH_PHYSICS_ENGINE=physics`)

`app/physics/engine_adapter.py` connects the physics engine to the API:

- Sun and Earth positions from the engine's SPICE functions (`app.physics.engine.positions`):
  Moon-centred, MOON_ME, km, geometric (no aberration correction). Azimuth and elevation from
  `app.physics.engine.frames`, with the observer at 1737.4 km + site height + observer height.
- Terrain from the stored horizon profile of the site (`data/horizon/<site_id>.json`) when the
  request is within 50 m of it, for the same observer height (2 m) and, if `altitude_m` is given,
  the same site height (within 0.5 m). Otherwise a smooth sphere, with a warning that local
  terrain is not included.
- Disc fractions and obstruction states from `app.physics.horizon.body_visibility`; metrics by
  sample-and-hold (`app/physics/metrics.py`). Each response lists its data in `provenance.sources`.
- Unknown values stay unknown: `slope_deg` is always null; without a stored profile there is no
  `terrain_skyline` or `sky_visibility_fraction`; without a profile or `altitude_m`, `elevation_m`
  is a 0 m placeholder labelled `elevation_source = "synthetic_default"`, with a warning.
- Missing kernels or profiles answer 503 with the missing file names (no server paths).

Run it locally (after downloading the kernels listed in the repository README):

```bash
CH_PHYSICS_ENGINE=physics CH_SPICE_KERNEL_DIR=/path/to/naif uvicorn app.main:app --reload
CH_SPICE_KERNEL_DIR=/path/to/naif python -m pytest tests/physics/test_engine_adapter.py   # adds the real-sky check
```

The runtime needs `spiceypy` and `numpy` only. `rasterio` and the LOLA elevation models are used
by offline tools (`scripts/compute_horizon_profiles.py`, `app/physics/engine/terrain.py`), never by
the service; a test checks that the adapter does not import them.

**Not in the container image yet** (the Docker image still defaults to `synthetic`): the image
copies only `app/`, so serving real physics needs

1. `data/horizon/` in the image (six JSON files, about 280 kB) at `/var/task/data/horizon`, or
   `CH_HORIZON_PROFILE_DIR` pointing at them;
2. the four kernels (tens of MB; `de440s.bsp` alone is about 32 MB), for example downloaded from
   NAIF during the build with pinned SHA-256 checksums, and `CH_SPICE_KERNEL_DIR` set to their folder.
   Kernels and DEMs are never committed;
3. `CH_PHYSICS_ENGINE=physics` on the Lambda function, only after the real-sky check passes.

`/health` reports `physics_engine.available` from a file check only, so the Lambda readiness
check stays fast; kernels and profiles load on the first evaluation. SPICE is not thread-safe:
all SPICE work in a process runs under one lock.

Kernels used for validation (downloaded from `https://naif.jpl.nasa.gov/pub/naif/generic_kernels/`
on 2026-11-15; sizes equal the server's `Content-Length`; NAIF publishes an MD5 only for `de440s.bsp`
in `spk/planets/aa_checksums.txt`, and it matches):

| File | Bytes | SHA-256 |
|---|---|---|
| `naif0012.tls` | 5 257 | `678e32bdb5a744117a467cd9601cd6b373f0e9bc9bbde1371d5eee39600a039b` |
| `de440s.bsp` | 32 726 016 | `c1c7feeab882263fc493a9d5a5b2ddd71b54826cdf65d8d17a76126b260a49f2` (MD5 `3917ee56769db332790c751e2168843d`) |
| `moon_pa_de440_200625.bpc` | 12 863 488 | `60cd55aa401ea2ea97360636f567554bfe4e37bb829f901b4460a455dfaf783f` |
| `moon_de440_250416.tf` | 19 478 | `a47c71e9c9f33796bdafb2c9d69a7ee447b6016ecad80f71cd6f3e479f9cf768` |

**Work budget.** One evaluation may compute at most `CH_MAX_TOTAL_SAMPLES` (default 20 000)
distinct sample timestamps over the baseline and all launch-delay cases together; larger requests
get 422 before any engine work, naming the settings to reduce. Delayed cases share timestamps only
when `time_step_s` divides 86 400 s, so a 61 s step with a 30-day sweep needs 310 000 samples while
60 s needs 53 200 (both rejected). The count is exact: it equals the samples the adapter computes.

Measured with these kernels on a local laptop through the HTTP endpoint (**not on Lambda**): 14 days
hourly 0.13 s, with a 30-day sweep 0.39 to 0.43 s; 365 days hourly with a 30-day sweep (9 481 samples)
4.2 s; the largest accepted request (20 000 samples: 10 000 at 60 s with a 7-day delay) 6.9 to 7.4 s,
mostly disc integration near the skyline. The deployment is a Lambda Function URL (512 MB, 60 s
timeout); at 512 MB Lambda gets about a third of a vCPU, so these figures must be measured on Lambda
before `CH_PHYSICS_ENGINE=physics` is enabled, and `CH_MAX_TOTAL_SAMPLES` lowered if needed.

## Docker and AWS Lambda

The same image runs locally and on Lambda through the
[AWS Lambda Web Adapter](https://github.com/awslabs/aws-lambda-web-adapter):

```bash
docker build -t common-horizon-backend backend/
docker run --rm -p 8080:8080 common-horizon-backend
```

- The adapter extension is copied to `/opt/extensions/lambda-adapter`.
- `AWS_LWA_READINESS_CHECK_PATH=/health`; `/health` never runs the engine, so it stays fast.
- The app writes nothing to disk, so it runs on Lambda's read-only filesystem.
- Responses are capped (`MAX_SAMPLES`) to stay under Lambda's 6 MB synchronous payload limit.

Every merge to `main` that changes `backend/`, `planner/` or the workflow itself deploys this
image: `.github/workflows/deploy-backend.yml` first runs the backend and planner tests and, only
if they pass, builds the image, pushes it to the ECR repository `common-horizon-backend` (tagged
with the commit SHA) and, if the Lambda function `common-horizon-backend` exists, updates the
function to it and waits until Lambda has applied it. The workflow signs in to AWS through the
OIDC role `common-horizon-deploy`; no AWS keys are stored. Changes to that workflow or to the
AWS setup need team authorisation.

## Layout

```
backend/
  app/
    main.py               FastAPI app factory, CORS, routers
    config.py             environment settings, service and contract versions
    timegrid.py           shared sample-count / time-grid rules
    api/                  /health and /api/v1/missions/evaluate
    models/               Pydantic contract: mission inputs, physics outputs, limits
    physics/
      interface.py        PhysicsEngine protocol + SimulationRequest/SimulationResult
      synthetic.py        SYNTHETIC placeholder engine (toy model, clearly labelled)
      engine_adapter.py   real physics engine: SPICE positions + stored terrain profiles
      metrics.py          sunlight / darkness / Earth metrics and windows from a sampled series
      engine/             physics engine (SPICE kernels, positions, frames; LOLA tools offline)
      horizon/            stored terrain horizon profiles and disc visibility
      factory.py          picks the engine from CH_PHYSICS_ENGINE
    services/             evaluation orchestration, requirement checks
  contract/               committed OpenAPI schema and examples
  docs/                   API contract and AI-use log
  scripts/                contract export
  tests/
```
