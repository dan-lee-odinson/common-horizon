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
- The Mission Assistant (`POST /assistant`) is the one place a language model runs in the product. It
  only words an answer from the engine's results and is told never to state a number that is not in
  them. That is an instruction to the model, not a check: its answers are not verified number by number.
- AI-drafted code is the backend owner's responsibility. It needs human review, and independent
  review by a teammate, before merging into `main`.

## Tools

| Tool | Version | Use |
|---|---|---|
| Claude Code (desktop app), model Claude Opus 5.5 | `claude-opus-5-5` | Drafted backend code, tests and docs; ran git, tests and Docker locally |
| Python | 3.11.9 (local), 3.12-slim → 3.12.16-slim-trixie pinned by digest (Docker image) | Runtime |
| FastAPI / Pydantic / Uvicorn | 0.162.7 / 2.14.3 / 0.54.0 | API framework and validation |
| pytest / httpx / openapi-spec-validator | 9.2.0 / 0.28.1 / 0.9.0 | Tests and OpenAPI validation |
| ruff | 0.17.5 (local lint only, not a project dependency) | Lint |
| pip-audit | latest at run time, in a throwaway container (not in the image) | Dependency advisory scan |
| Docker / AWS Lambda Web Adapter | 29.5.2 / 0.9.1 → 1.1.0 | Container build and Lambda compatibility |
| OpenAI Codex | not stated in the review | Independent review of `c34f59e`, posted on PR #4; no code changes |
| OpenAI gpt-oss-120b on Amazon Bedrock | `openai.gpt-oss-120b-1:0`, `us-east-1`, as served by Bedrock | Runtime, not development: words the Mission Assistant's plain-text answers (`POST /assistant`) from the evaluation results it is sent. Off by default (`CH_ASSISTANT_ENABLED=false`); not used to write code or produce any physical value. Switched on in production on 15 November 2026 after the checks under "Real model checks". This repository's tests use a fake client |

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

## Deployment readiness (2026-11-14)

Branch `feat/backend-deploy-readiness`, created from `main` after PR #4 was merged (GitHub:
19:27:13 UTC). Drafted by Claude Code (Claude Opus 5.5). Times marked "~" are file-modification times.

| UTC | Europe/Bucharest (UTC+02:00) | Activity | Result |
|---|---|---|---|
| 19:22 | 21:22 | Checked Git state before branching | PR #4 still an open draft; stopped and reported |
| 19:28:02 | 21:28:02 | PR #4 merge verified; `main` fast-forwarded; branch created (git reflog) | Baseline: 143 passed |
| between 19:28:02 and 19:32:44 | between 21:28:02 and 21:32:44 | Audited the existing image in a throwaway container with `pip-audit` | 12 advisories, all in the base image's bundled `pip 25.0.1`; adapter 0.9.1 predates the v1.0.1 fix for 4 Rust dependency advisories |
| ~19:32:44 | ~21:32:44 | Wrote CORS and stay-duration tests before the code | New tests failed for the expected reasons |
| ~19:33:19–19:33:40 | ~21:33:19–21:33:40 | CORS origin normalisation and env config; stay limit 365 → 365.25 d; contract regenerated; full runtime dependency pin set | First run: 197 passed, contract drift test failed on the stale schema; after export 198 passed; only `stay_duration_days.maximum` changed |
| 19:34:49 | 21:34:49 | Rebuilt the image (digest-pinned base and adapter, pip 26.3, `--no-deps` + `pip check`, non-root user, `.dockerignore`) | Build OK; `pip check` clean; `pip-audit`: no known vulnerabilities |
| ~19:35–19:36 | ~21:35–21:36 | Read-only container smoke test with all capabilities dropped | `/health` 200; evaluate 200; 365.25 d → 367 samples; 365.26 d → 422; preflight 200 for production, localhost:5173 and the env-added Amplify origin, 400 for foreign origins; wildcard config exits 1 at startup |
| ~19:36:21 | ~21:36:21 | ruff 0.17.5 lint fixes | Lint clean; 198 passed |

### Decisions made with AI assistance

- Stay duration widened to 365.25 days (the website's limit). Widening an input bound is not a breaking
  change, so `contract_version` stays `0.1.0`; the sample cap and payload test are unchanged.
- `CH_CORS_ORIGINS` keeps replacing the defaults; the new `CH_CORS_EXTRA_ORIGINS` appends (for the
  Amplify URL) so the production domains cannot be dropped by accident.
- Lambda Web Adapter upgraded to 1.1.0 for the security fixes. Its 1.0 breaking changes (removed
  `AWS_LWA_READINESS_CHECK_MIN_UNHEALTHY_STATUS`; non-prefixed variables deprecated) are handled by
  switching `PORT` to `AWS_LWA_PORT`. The adapter only runs inside Lambda, so it is not exercised by
  the local smoke test.
- `# noqa: TRY004` on the timestamp-type check in `mission.py`: Pydantic only turns `ValueError` into a
  422, so the suggested `TypeError` would surface as a 500.

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

### Fixes for the Codex re-review of `51c4cf0` (2026-11-15)

Re-review by Codex by OpenAI posted on PR #14 at 11:44:56 UTC (GitHub timestamp): one remaining blocker
(the adapter-wide sample cache, filled by earlier requests, was cleared mid-sweep, so an evaluation
validated at 20 000 samples computed 27 120) and one minor defect (an integer too large for a float gave
500). Fixes drafted by Claude Code (Claude Opus 5.5): one `EvaluationCache` per evaluation, passed
explicitly with each `SimulationRequest`; no engine-wide cache; overflow mapped to the 502 contract error.
While writing the fix, a new test caught that an empty cache is falsy (`cache or new_cache` silently
discarded it); fixed with an explicit `is None` check before any commit. The warm-process regression
reproduces 27 120 extra samples against `51c4cf0` and passes on the fix.

| UTC | Europe/Bucharest (UTC+02:00) | Activity | Result |
|---|---|---|---|
| 11:44:56 | 13:44:56 | Codex re-review posted (GitHub timestamp) | 1 blocker, 1 minor defect |
| by 11:59:20 | by 13:59:20 | Per-evaluation cache, overflow handling, regressions, real-kernel HTTP probe | 447 passed, 9 skipped with kernels (LOLA DEM tests only); warm exact-20 000 evaluation computes 20 000 samples (6.9 s locally, not Lambda) |

## Website API and multi-site ranking (2026-11-15)

Drafted with Claude Code (Claude Opus 5.5) on `feat/website-api` (from `main` at `2d4bbd9`). Times are
from the branch reflog, file modification times and the clock at each step.

| UTC | Europe/Bucharest (UTC+02:00) | Activity | Result |
|---|---|---|---|
| before 13:30:13 | before 15:30:13 | Read `web/src/api` (client, types, examples, mock model), `web/README.md`, the planner README and code, the backend services, models and API, and PRs #6, #11 and #14 | Website expects root paths; mock catalog ids and fields differ from the planner's; slope and full skylines are not available from the engine |
| 13:30:13 | 15:30:13 | Branch created from `origin/main`; planner package and preset site list copied into `backend/app` | Docker build context is `backend/` only, so copies plus a drift test |
| 13:30–13:38 | 15:30–15:38 | Website models, sites, catalog mapping, planner calls, ranking module, `/check` and `/evaluate` orchestration, router, `assistant_available` on `/health`; tests | 98 new tests; smoke test of all four endpoints on the synthetic engine |
| 13:37:56 | 15:37:56 | OpenAPI regenerated | Additive only: new paths and schemas, one new `/health` field |
| by 13:40:38 | by 15:40:39 | Ruff on the changed files, full backend and planner suites, `docs/WEBSITE_API.md` | 439 passed, 11 skipped (backend); 166 passed (planner); repo-wide Ruff count unchanged at 60 |
| ~13:41–13:43 | ~15:41–15:43 | Controlled real-kernel check in a throwaway worktree (this branch merged with PR #14's adapter, never committed): merged-tree pytest with kernels, then all 17 presets through `/evaluate` and `/check` with `CH_PHYSICS_ENGINE=physics` | Found and fixed one bug: per-site `provenance.sources` (one terrain profile per site) made the one-engine check refuse the request; now only the engine identity is compared and sources are merged. Then 540 passed, 14 skipped (merged tree); 17 sites x 14 d in 1.6-1.75 s, 17 x 365 d in 5.2 s (laptop); 445 passed on this branch |
| by 13:57:03 | by 15:57:03 | Merged `origin/main` at `86ee0b1` (PRs #14 and #15) into `feat/website-api`; the only conflict was this log (both sides appended a section; both kept, in time order); OpenAPI regenerated (identical to the auto-merged file) | Backend 546 passed, 19 skipped without kernels; 556 passed, 9 skipped with `CH_SPICE_KERNEL_DIR` and `CH_NAIF_DIR` (only LOLA DEM tests skip); planner 166 passed; all website endpoints checked on the real engine (17 x 14 d in 1.5 s, 17 x 365 d in 5.2 s, laptop) |

**Not decided here (listed in `WEBSITE_API.md`):** transit time, Earth-link thresholds, ranking of
unknown verdicts, slope source and lander slope limits, empty-payload and no-lander fit, observer
height, refill window and catalog item linking. No physics was added: every physical number comes
from the configured engine (synthetic in production), every hardware number from the planner.

## Physics packaging and PR #6 reconciliation (2026-11-15)

Drafted with Claude Code (Claude Opus 5.5) on `feat/backend-deploy-readiness` (PR #6), updated in place by
merging `origin/main` at `86ee0b1` (PRs #14 and #15) rather than replacing the branch.

| UTC | Europe/Bucharest (UTC+02:00) | Activity | Result |
|---|---|---|---|
| 14:10:50 | 16:10:50 | Switched to PR #6's branch; merged `origin/main` | Conflicts in `config.py`, `requirements.txt`, `README.md`, this log. Also found: the merge silently moved `Settings.__post_init__` (CORS normalisation of code-built settings) into `_optional_path` after its `return`; restored |
| ~14:12 | ~16:12 | Complete runtime pin set resolved in the pinned linux/amd64 base image | Adds spiceypy, numpy, rasterio and rasterio's affine, attrs, certifi, pyparsing; same versions as `requirements-tools.txt` |
| 14:14:45-14:15:27 | 16:14:45-16:15:27 | Dockerfile: kernels from the official NAIF URLs with `ADD --checksum` (SHA-256), `data/horizon`, `CH_SPICE_KERNEL_DIR` / `CH_HORIZON_PROFILE_DIR`; `.dockerignore` allows `data/horizon/` and excludes local `app/physics/data/` | Built. Found: `ADD --chmod=0444` also made the kernel folder 0444 (not enterable by non-root); folder now created 0755 first |
| ~14:16-14:21 | ~16:16-16:21 | Container checks at 512 MB / 0.29 CPU, read-only, caps dropped, arbitrary UID; error cases; pip check, pip-audit | All pass; pip-audit: no known vulnerabilities (runtime set, pip 26.3). Docker Scout OS scan not run (needs a Docker Hub sign-in) |
| ~14:22-14:26 | ~16:22-16:26 | Workflow-style build (`--provenance=false --sbom=false`) | Found: `import rasterio` failed in the image (`libexpat.so.1` missing; latent on `main` too, since the service never imports rasterio). Added Debian `libexpat1` and an import check to the build; all container checks rerun and pass |
| by 14:27:12 | by 16:27:12 | Backend and planner suites; README and this log | Backend 497 passed, 19 skipped (no kernels); 507 passed, 9 skipped (kernels); planner 166 passed |

**Not done:** Lambda invocation and timing (local Docker with CPU and memory limits is an approximation),
OS-package vulnerability scan, production switch to `CH_PHYSICS_ENGINE=physics` (needs authorisation).

## Mission Assistant route (2026-11-15)

Drafted with Claude Code (Claude Opus 5.5) on `feat/assistant`, from `origin/main` at `185b15e`. Backend only;
`web/`, the physics engine, the planner and the ranking are unchanged.

| UTC | Europe/Bucharest (UTC+02:00) | Activity | Result |
|---|---|---|---|
| 20:01:24 | 22:01:24 | Read the website's `AskRequest`, `AskResponse`, `api.ask` error handling and `Assistant.tsx` | Shapes matchable as they are; `AskRequest` has no `transit_days`, and a custom site comes only as its id `custom:<lat>:<lon_east>` |
| ~20:02-20:08 | ~22:02-22:08 | `POST /assistant`: settings, models, service (reuses `evaluate_sites`), Bedrock Converse call, daily cap, `/health` switch; tests with a fake Bedrock client | 28 assistant tests pass |
| ~20:08 | ~22:08 | Broke the "only text blocks" rule on purpose (reasoning text let through) | 2 tests failed (`test_only_text_blocks_come_back`, `test_the_answer_shape_matches_the_website`); reverted, all pass |
| ~20:08-20:09 | ~22:08-22:09 | Full suite; OpenAPI regenerated | Found a failure already on `main`: `test_the_website_request_shapes_are_accepted` did not send the website's `transit_days`; test body fixed. 754 passed, 23 skipped (no kernels) |
| 20:09-20:10 | 22:09-22:10 | boto3 1.44.3 and its transitive set pinned; the image's install step (`--no-deps`, `pip check`, import) repeated in a fresh venv (Python 3.13, not the image's 3.12) | `pip check` clean; imports pass. No Docker daemon here, so the image was not built |
| by 20:13:24 | by 22:13:24 | Bedrock timeouts cut to one attempt, 5 s connect and 20 s read (the Lambda's timeout is 60 s); a test that the client gets no keys; Ruff format on the new files; OpenAPI regenerated; full suite | 755 passed, 23 skipped (no kernels); Ruff clean on the changed files (repo-wide count unchanged) |

### Addition: the page's landing date, and room for the answer (2026-11-15)

| UTC | Europe/Bucharest (UTC+02:00) | Activity | Result |
|---|---|---|---|
| 21:10 | 23:10 | `context.transit_days` (optional) added; when it is left out the backend uses `WEBSITE_TRANSIT_DAYS` (5), the website's `TRANSIT_DAYS`; `maxTokens` 500 → 1500; read timeout 20 → 30 s, one attempt | Tests: the constant against `web/src/util/transit.ts`; the model's landing date and Nobile's sunlight against `evaluate_sites` for the website's own body |
| ~21:12 | ~23:12 | Set the constant to 4 on purpose | 2 tests failed (the constant check and the landing/sunlight check); reverted, all pass |

**Not done:** no call to the real Bedrock model (no AWS access here): the prompt, the 1500-token limit with
gpt-oss's reasoning, and the answers themselves are untested against the live model. Image not built.
Both were done later the same day: see "Real model checks" below.

### Real model checks (2026-11-15)

The local test was run by Alexandru. The production checks were run for the team owner by Claude
(Anthropic, Claude Fable 5.2, in the Claude app), which sent the questions and compared each answer
with the engine's results.

| UTC | Europe/Bucharest (UTC+02:00) | Activity | Result |
|---|---|---|---|
| by 21:33 | by 23:33 | PR #29 at `26c3376` run locally against the real model through Bedrock Converse | HTTP 200 in 3.18 s; 4,538 input and 180 output tokens |
| 21:44 | 23:44 | PR #29 merged; the deployment workflow built and deployed the image | Workflow succeeded |
| 21:59 | 23:59 | `CH_ASSISTANT_ENABLED=true` set on the deployed Lambda. Its role already allowed `bedrock:InvokeModel` on this one model | `/health` reports `assistant_available: true` |
| 22:00-22:10 | 00:00-00:10 | Seven questions sent to the deployed `POST /assistant` with `CH_PHYSICS_ENGINE=physics`; each answer compared with `POST /evaluate` for the same mission | Every figure in the answers was the engine's (two rounded to two decimals). A question outside the data ("what radiation dose"), an instruction to state a false figure, and an off-topic request were each declined. 2.7 to 8.3 s per answer |
