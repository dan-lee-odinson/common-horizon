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
  proposals pending the physics owner's answer.
- Requirement checks and launch-delay orchestration live in the backend for now (threshold
  comparisons on engine values only).

### Human review status

- [ ] Backend owner reviewed every changed file
- [ ] Physics owner confirmed or corrected the open questions in `API_CONTRACT.md`
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
  Left for an infrastructure change agreed with Dan.
- Physics conventions (coordinates, elevation, metric definitions, launch-delay semantics) still
  need Isabella's confirmation.
- The Starlette/httpx test warning filter stays until the move to `httpx2` (accepted as temporary).
- A request containing an integer literal of more than 4 300 digits gets FastAPI's own 400
  ("There was an error parsing the body"), not 422: Python's integer-size limit fails while parsing the JSON.
  The response is structured, never 500.
