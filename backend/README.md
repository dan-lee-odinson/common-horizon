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
| GET | `/sites` | The 17 approved preset sites (website API). |
| GET | `/catalog` | The planner's hardware catalog in the website's shape. |
| POST | `/check` | The planner's fit, power and site-energy checks for one site. |
| POST | `/evaluate` | Evaluate several sites and rank them by Dan's rules. |

See [docs/API_CONTRACT.md](docs/API_CONTRACT.md) for every field, its unit, its validation
bounds and how it maps to the physics engine integration document. The website endpoints,
their contract changes against `web/src/api/types.ts`, the ranking rules and the open team
decisions are in [docs/WEBSITE_API.md](docs/WEBSITE_API.md). They use copies of `planner/` and
the preset site list; refresh them with `python backend/scripts/sync_shared_data.py`.

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
| `CH_SPICE_KERNEL_DIR` | `app/physics/data/datasets/spice` (image: `/opt/common-horizon/spice`) | Folder holding the four NAIF kernels, lowercase names: `naif0012.tls`, `de440s.bsp`, `moon_pa_de440_200625.bpc`, `moon_de440_250416.tf`. Only read with `CH_PHYSICS_ENGINE=physics`. |
| `CH_HORIZON_PROFILE_DIR` | `data/horizon` (image: `/var/task/data/horizon`) | Folder of the stored terrain horizon profiles. Only read with `CH_PHYSICS_ENGINE=physics`. |
| `CH_MAX_TOTAL_SAMPLES` | `20000` | Work budget of one evaluation: distinct sample timestamps over the baseline and all launch-delay cases. Larger requests get 422. |
| `CH_CORS_ORIGINS` | `https://commonhorizon.study,https://www.commonhorizon.study,http://localhost:5173` | Comma-separated browser origins allowed to call the API. Setting it **replaces** the defaults. |
| `CH_CORS_EXTRA_ORIGINS` | *(empty)* | Comma-separated origins **added** to the list above, e.g. the Amplify branch URL `https://main.<app-id>.amplifyapp.com`. |
| `AWS_LWA_PORT` | `8080` (Docker) | Port uvicorn listens on and the Lambda Web Adapter forwards to. |

CORS origins are normalised to the exact form browsers send (`scheme://host[:port]`, lowercase,
no trailing slash, no default port), so `https://commonhorizon.study/` and
`https://commonhorizon.study` are the same entry. Wildcards (`*`), paths, and plain `http` for
anything other than `localhost` / `127.0.0.1` / `[::1]` are refused: the app fails at startup
rather than run with a broken or open CORS policy. Credentials are not allowed cross-origin.

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

**Packaged in the container image** (which still defaults to `CH_PHYSICS_ENGINE=synthetic`):

1. the four kernels, downloaded from NAIF during the build (`ADD --checksum`, the SHA-256 values in
   the table below; any mismatch fails the build), read-only at `/opt/common-horizon/spice`, with
   `CH_SPICE_KERNEL_DIR` set to that folder. Kernels and DEMs are never committed, and the
   developer's local `app/physics/data/` is excluded from the build context;
2. `data/horizon/` (six JSON files, about 290 kB) at `/var/task/data/horizon`, with
   `CH_HORIZON_PROFILE_DIR` set to it;
3. switching production to real physics is then only `CH_PHYSICS_ENGINE=physics` on the Lambda
   function, a configuration change that needs explicit team authorisation and a measurement on
   Lambda first (below).

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
get 422 before any engine work, naming the settings to reduce. Two cases share timestamps when the
delay between them is a whole number of time steps (always when `time_step_s` divides 86 400 s;
also, for example, 6 000 s steps with a 5-day delay step), so a 61 s step with a 30-day sweep needs 310 000 samples while
60 s needs 53 200 (both rejected). The count is exact: it equals the samples the adapter computes, because each evaluation gets its
own sample cache (shared by its baseline and delayed cases, dropped afterwards), so earlier requests
can neither evict its samples nor add work.

Measured with these kernels on a local laptop through the HTTP endpoint (**not on Lambda**): 14 days
hourly 0.13 s, with a 30-day sweep 0.39 to 0.43 s; 365 days hourly with a 30-day sweep (9 481 samples)
4.2 s; the largest accepted request (20 000 samples: 10 000 at 60 s with a 7-day delay) 6.9 to 7.4 s,
mostly disc integration near the skyline. The deployment is a Lambda Function URL (512 MB, 60 s
timeout); at 512 MB Lambda gets about a third of a vCPU, so these figures must be measured on Lambda
before `CH_PHYSICS_ENGINE=physics` is enabled, and `CH_MAX_TOTAL_SAMPLES` lowered if needed.

## Docker and AWS Lambda

Measured on the linux/amd64 image locally with Docker limited to **512 MB and 0.29 CPU** (Lambda's
share of a vCPU at 512 MB), read-only root filesystem, all capabilities dropped, an arbitrary
non-root user, `CH_PHYSICS_ENGINE=physics`. **This approximates Lambda; it is not a Lambda
measurement.** Container start to `/health` 200: about 4.0-4.6 s. First physics evaluation (loads
the kernels): 0.6 s for 14 days hourly; warm repeats 0.5-0.6 s; 14 days with a 30-day sweep 1.9 s;
365.25 days hourly 14.8-15.1 s; the largest accepted request (exactly 20 000 samples) 30.5-32.8 s,
against the 60 s timeout; 20 001 samples get 422 in 70 ms. Peak memory 88 MiB.

The same image runs locally and on Lambda through the
[AWS Lambda Web Adapter](https://github.com/aws/aws-lambda-web-adapter):

```bash
docker build -t common-horizon-backend backend/
docker run --rm -p 8080:8080 common-horizon-backend
```

- The adapter extension (1.1.0) is copied to `/opt/extensions/lambda-adapter`.
- `AWS_LWA_READINESS_CHECK_PATH=/health`; `/health` never runs the engine, so it stays fast.
- The app writes nothing to disk, so it runs on Lambda's read-only filesystem.
- Responses are capped (`MAX_SAMPLES`) to stay under Lambda's 6 MB synchronous payload limit.
- **CORS belongs to FastAPI.** Leave CORS unconfigured on the Lambda Function URL (or any proxy in
  front of it); configuring both produces duplicate `Access-Control-Allow-Origin` headers, which
  browsers reject. Add the Amplify origin with `CH_CORS_EXTRA_ORIGINS`.

### Reproducible build

| Component | Pin |
|---|---|
| Base image | `python:3.12.16-slim-trixie@sha256:5e2bdb1b0d542d5039cffb8181c65930093949194a65c365dfb1b0fe13a4fa5b` (multi-arch index: amd64 + arm64) |
| Lambda Web Adapter | `public.ecr.aws/awsguru/aws-lambda-adapter:1.1.0@sha256:17cfd08eff1dfea3f6a9a1e9c65fdac80aa4919b6085e746615530f43f57d2f1` (multi-arch index) |
| pip (build tool) | `26.3`, replacing the base image's `pip 25.0.1`, which has known advisories |
| Python packages | `requirements.txt` pins every runtime package, transitive ones included; installed with `--no-deps`, then `pip check` |
| NAIF kernels | Official NAIF URLs, SHA-256 pinned in the Dockerfile (`ADD --checksum`) |

The image runs as an unprivileged user (UID 10001) and has `.dockerignore` limiting the build
context to `requirements.txt`, `app/` and `data/horizon/`. Debian's `libexpat1` is the one system
package added: rasterio's wheel needs it, and the build fails if `numpy`, `spiceypy` or `rasterio`
cannot be imported. To update a pin, resolve the new digest
(`docker buildx imagetools inspect <image>:<tag>`) or package version, rebuild, and rerun the tests,
`pip-audit` against the image's site-packages and the container smoke test.

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
