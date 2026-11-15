# AI-use log: backend (FastAPI / Pydantic)

Concise record of AI-assisted development for the Common Horizon project disclosure.
No session transcripts or credentials are stored here. Timestamps were read from the system
clock during the session. Times marked "~" come from file-modification times, not a direct
clock reading.

## Principles

- **The physics engine calculates; AI only assists with software.** No physical value shown by
  the app comes from an AI model.
- The synthetic fixture (`app/physics/synthetic.py`) is a deliberately labelled placeholder
  (`provenance.is_synthetic = true`), not a physics result.
- AI-drafted code is the backend owner's responsibility. It needs human review, and independent
  review by a teammate, before merging into `main`.

## Tools

| Tool | Version | Use |
|---|---|---|
| Claude Code (desktop app), model Claude Opus 5.5 | `claude-opus-5-5` | Drafted backend code, tests and docs; ran git, tests and Docker locally |
| Python | 3.11.9 (local), 3.12-slim (Docker image) | Runtime |
| FastAPI / Pydantic / Uvicorn | 0.162.7 / 2.14.3 / 0.54.0 | API framework and validation |
| pytest / httpx / openapi-spec-validator | 9.2.0 / 0.28.1 / 0.9.0 | Tests and OpenAPI validation |
| ruff | latest at install time (local lint only, not a project dependency) | Lint |
| Docker / AWS Lambda Web Adapter | 29.5.2 / 0.9.1 | Container build and Lambda compatibility |
| OpenAI Codex | not stated in the review | Independent review of `c34f59e`, posted on PR #4; no code changes |

## Phase 1: backend contract and minimal FastAPI implementation (2026-11-14)

| UTC | Europe/Bucharest (UTC+02:00) | Activity | Result |
|---|---|---|---|
| 14:17:00 | 16:17:00 | Inspected repository and branch `feat/backend-contract` | Clean tree; only the initial commit |
| 14:17–14:23 | 16:17–16:23 | Read the team's *Physics Engine-to-website Integration* document (input/output tables) | Field list and units used as the contract source |
| 14:23:42 | 16:23:42 | Started implementation: Pydantic models, validation limits, `/health`, `POST /api/v1/missions/evaluate`, physics-engine interface, synthetic fixture, real-engine adapter stub | Code drafted by Claude Code |
| ~14:28 | ~16:28 | Exported OpenAPI schema and examples; first full test run | 103 passed |
| ~14:29 | ~16:29 | Built Docker image; ran it with a read-only filesystem (Lambda-like) | `/health` 200, evaluate 200 with `X-Data-Source: synthetic`, invalid input 422 |
| 14:30:54 | 16:30:54 | Docker verification recorded | Pass |
| 14:32:55 | 16:32:55 | Lint (ruff) fixes; contract regenerated; full test run | Lint clean; 103 passed |
| 14:33:14 | 16:33:14 | Rebuilt image after lint fixes; re-checked `/health` and evaluate | Both 200 |

### Decisions made with AI assistance (provisional, need team confirmation)

- Column-oriented time series and a 10 000-sample cap, chosen so responses stay under Lambda's
  6 MB limit (enforced by a test).
- Validation bounds in `app/models/limits.py` (date window 2000–2100, stay ≤ 365 days,
  time step 60–86 400 s, launch delay ≤ 30 days).
- Launch delay read as a sweep (0, step, … max) and `hardware_requirements` schema: both are
  provisional (see "Provisional technical assumptions" in `API_CONTRACT.md`).
- Requirement checks and launch-delay orchestration live in the backend for now (threshold
  comparisons on engine values only).

### Human review status

- [ ] Backend owner reviewed every changed file
- [ ] Provisional technical assumptions in `API_CONTRACT.md` validated against the physics engine
- [ ] Independent teammate review before merge

## Phase 1 review fixes: Codex review of `c34f59e` on PR #4 (2026-11-14)

Fixes drafted by Claude Code (Claude Opus 5.5); findings from the independent OpenAI Codex review.
Times after 15:03 are not split per step: a `git stash` round-trip used to compare performance reset
the source files' modification times.

| UTC | Europe/Bucharest (UTC+02:00) | Activity | Result |
|---|---|---|---|
| 14:52:27 | 16:52:27 | Codex review posted on PR #4 (GitHub timestamp) | 3 blocking findings, 1 nonblocking settings issue |
| by 15:01:07 | by 17:01:07 | Read the review, inspected the cited files, reproduced every finding with in-memory probes | All reproduced: NaN/Infinity output gave 200 with `null`; extreme dates and `1e999` gave 500; `+02:00` output timestamps; supplied `Settings` ignored |
| ~15:02:16 | ~17:02:16 | Wrote 40 regression tests and ran them before any fix | 40 failed for the reported reasons |
| ~15:03:47 onward | ~17:03:47 onward | Fixes: UTC timestamp type, finite-only output models, engine-boundary re-validation, JSON-safe 422 handler, engine bound to the app's own settings | 143 passed |
| by 15:08:06 | by 17:08:06 | ruff, OpenAPI drift, `pip check`, Docker build and read-only smoke test | All passed; regenerated contract artefacts byte-identical (no contract change) |

### Not addressed here (nonblocking review items)

- Docker build tooling: bundled `pip` advisories, unpinned transitive dependencies and image digest.
  Left for a separate, team-approved infrastructure change.
- Physics conventions (coordinates, elevation, metric definitions, launch-delay semantics) remain
  provisional (see "Provisional technical assumptions" in `API_CONTRACT.md`).
- The Starlette/httpx test warning filter stays until the move to `httpx2` (accepted as temporary).
- A request containing an integer literal of more than 4 300 digits gets FastAPI's own 400
  ("There was an error parsing the body"), not 422: Python's integer-size limit fails while parsing the JSON.
  The response is structured, never 500.

## Documentation organization (2026-11-14)

| UTC | Europe/Bucharest (UTC+02:00) | Activity | Result |
|---|---|---|---|
| 15:28:19 | 17:28:19 | Drafted with Claude Code: open coordination questions in `API_CONTRACT.md` restated as neutral provisional technical assumptions and engine integration requirements; private working notes moved to a git-ignored `.local-notes/` directory | No change to the API, code behaviour or OpenAPI contract |

## Physics adapter: real engine behind the API (2026-11-15)

Drafted with Claude Code (Claude Opus 5.5) on branch `feat/physics-adapter` from `main` at `2d4bbd9`
(after PRs #10, #12 and #13). Tests ran in a local Python 3.12.10 virtual environment with the pinned
`requirements-dev.txt` (numpy 2.5.4 needs Python 3.12, the Docker image's version) and ruff 0.17.5.

| UTC | Europe/Bucharest (UTC+02:00) | Activity | Result |
|---|---|---|---|
| 10:18:46 | 12:18:46 | `main` fast-forwarded to `2d4bbd9`; `feat/physics-adapter` created (git reflog) | Clean tree; PR #6 branch untouched |
| by 10:24:15 | by 12:24:15 | Read the interface, evaluation service, engine (`ephemeris`, `positions`, `frames`, `kernel_loader`), horizon package and their tests; baseline run | 338 passed, 14 skipped; 60 pre-existing ruff findings, none in files changed here |
| ~10:27:07 onward | ~12:27:07 onward | Adapter, metrics module, `provenance.sources`, kernel/profile settings | Implemented |
| ~10:34:07 onward | ~12:34:07 onward | Adapter and metrics regression tests (injected positions, fixture profile) | 380 passed, 15 skipped (real-kernel check skipped: no kernels on this machine) |

What the AI did and did not decide:

- The adapter calls the physics engine's own SPICE position and frame functions; it computes no
  ephemeris itself. `compute_sun_earth_angles` is not called: it returns angles only and puts the
  observer on the 1737.4 km sphere, while the contract also needs position vectors and disc radii.
- Terrain comes from the stored horizon profiles; sites without one get a smooth sphere with an
  explicit warning. Slope stays null; elevation without a profile or input is a labelled placeholder.
- Matching tolerances (50 m, 0.5 m site height, 0.01 m observer height), the sky-visibility definition
  and the transport rounding are proposals in code and docs for the physics owner to confirm.
- All numbers in the new unit tests come from injected positions and a fixture profile (mocked, not
  physics). Only the opt-in real-kernel test (`CH_SPICE_KERNEL_DIR`) produces physical output; it has
  not been run yet.
- Not done: Docker image changes for kernels and profiles (kept apart from the open PR #6), production
  switch to the real engine, deployment.

### Real-kernel validation (2026-11-15)

Kernels downloaded with the backend owner's authorisation from `naif.jpl.nasa.gov` into the git-ignored
`backend/app/physics/data/datasets/spice/` (checksums in `backend/README.md`; not committed).

| UTC | Europe/Bucharest (UTC+02:00) | Activity | Result |
|---|---|---|---|
| ~10:48 | ~12:48 | Downloaded the four kernels; sizes checked against `Content-Length`, SHA-256 computed | `de440s.bsp` MD5 matches NAIF's `aa_checksums.txt`; no published checksum for the other three |
| ~10:49 | ~12:49 | Ran the previously skipped real-kernel test | Passed; no skip |
| by 10:53:21 | by 12:53:21 | Real-kernel tests for `shackleton-ridge` and `nobile` (2027, hourly), API run, runtime measurements; full suite | 9 real-kernel tests passed; suite 394 passed, 9 skipped (LOLA DEM tests only) |

Physical results (adapter vs the stored independent 2027 check, `results_2027.json`): Sun visible
82.669% vs 82.671% (Shackleton ridge) and 49.058% vs 49.053% (Nobile); Earth visible 50.234% vs
50.240% and 63.363% vs 63.368%; longest dark period 155 h and 532 h in both. Against the engine's
`compute_sun_earth_angles`: largest elevation difference 1.2e-6 degree (Sun) and 2.8e-4 / 1.0e-3 degree
(Earth, the parallax of the 1.7 km / 6.4 km site height that function leaves out); azimuth differences
5e-7 degree (transport rounding). Bug found and fixed: the provenance text printed Earth's radius as
6378.14 km (`:g` format) instead of the 6378.1366 km used.

### Fixes for the independent Codex review of `fd7c5de` (2026-11-15)

Review by Codex by OpenAI, posted on PR #14 at 11:19:02 UTC (GitHub timestamp). Fixes drafted by
Claude Code (Claude Opus 5.5). Correction to the earlier entry: the real-kernel run counted 9 tests, of
which 8 use the kernels; the ninth (the radius-text regression) does not.

| UTC | Europe/Bucharest (UTC+02:00) | Activity | Result |
|---|---|---|---|
| 11:19:02 | 13:19:02 | Codex review posted (GitHub timestamp) | 1 blocker (unbounded launch-delay work), 3 nonblocking defects |
| by 11:30:10 | by 13:30:10 | Work budget (exact distinct-sample count, 422), elevation kept for incompatible skylines, sanitised profile errors, strict position validation; regression tests | 434 passed, 9 skipped with kernels (LOLA DEM tests only); 424 passed, 19 skipped without |

- Review counts reproduced exactly by the new estimate: 310 000 samples (61 s step) and 53 200 (60 s).
- During the work an over-broad `ruff format app/` reformatted 12 files, including the physics engine
  modules; they were restored from Git before any commit and are not part of this change.
- Local timings are not Lambda measurements (see `backend/README.md`, "Work budget").
