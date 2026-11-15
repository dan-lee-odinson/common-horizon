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

Measured cost of the adapter's own work (injected positions, no SPICE, local machine): 14 days
hourly with a 30-day launch-delay sweep 0.5 s; 365 days hourly 3 s; the largest allowed request
(10 000 samples at 60 s plus a 30-day sweep) 17 s, mostly disc integration near the skyline.
Launch-delay runs reuse the samples they share with earlier runs.

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
