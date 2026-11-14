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
