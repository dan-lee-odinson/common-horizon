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
| `CH_PHYSICS_ENGINE` | `synthetic` | `synthetic` (labelled fixture) or `physics` (real engine adapter; answers 503 until integrated). |
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

## Docker and AWS Lambda

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

The image runs as an unprivileged user (UID 10001) and has `.dockerignore` limiting the build
context to `requirements.txt` and `app/`. To update a pin, resolve the new digest
(`docker buildx imagetools inspect <image>:<tag>`) or package version, rebuild, and rerun the tests,
`pip-audit` against the image's site-packages and the container smoke test.

Nothing is deployed by this repository; deployment needs team authorisation.

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
      engine_adapter.py   seam for the real physics engine (not integrated yet)
      factory.py          picks the engine from CH_PHYSICS_ENGINE
    services/             evaluation orchestration, requirement checks
  contract/               committed OpenAPI schema and examples
  docs/                   API contract and AI-use log
  scripts/                contract export
  tests/
```
