# SI/AI use log: website, planner, hardware models, stored skylines and the Horizons check

A record of the AI tools used on Dan's parts of Common Horizon, for the project's SI/AI
disclosure. The backend service has its own log in `backend/docs/AI_USE_LOG.md`. No session
transcripts or credentials are stored here. The commit history is the detailed record: each
commit message carries an `SI/AI:` line naming the tool and model.

## Principles

- **The engine and the planner calculate.** No figure shown by the app comes from an AI model.
- **The team sets the direction.** The challenge, the idea, the scope and each decision came
  from the team. The tools wrote and reviewed code and text under that direction.
- **AI-assisted work is reviewed before it merges.** Each pull request was read, and its tests
  run, before it went into `main`.

## Tools

| Tool | Model | Used for |
|---|---|---|
| Claude Code (Anthropic), cloud sessions | Claude Opus 5.5 | The first website, the planner module and the hardware model scripts (Saturday 14 November) |
| Claude Code (Anthropic), cloud session | Claude Fable 5.2 | The rebuild of the website as a three-stage view (Saturday 14 and Sunday 15 November) |
| Claude Code (Anthropic), on the team owner's computer | Claude Fable 5.2 | The terrain skyline tool, the stored skylines and their 2027 validation |
| Claude Code (Anthropic), on the team owner's computer | Claude Opus 5.5 | The deployment workflow, the 17-site JPL Horizons check and the live comparison route |
| Claude (Anthropic), in the Claude app | Claude Fable 5.2 | Planning, the written instructions given to each coding session, review of pull requests, the first JPL Horizons check, preparation of the Moon textures, and drafts of the README and the submission text |
| Design skills loaded into Claude Code | Impeccable; Emil Kowalski's design engineering skills; the GSAP skills | Review of layout, type and motion in the website. Each website commit names the skills it used |

## What was made with AI assistance, by part

| Part | Folder | Pull requests | What the tool did |
|---|---|---|---|
| Planner module | `planner/` | #1, #5 | Wrote the catalog loader, the fit check, the power arithmetic and their tests from the team's figures and rules |
| Hardware models | `tools/models/`, `web/public/models/` | #2 | Wrote the scripts that build each model from published dimensions, and the checks on the output files |
| Website | `web/` | #3, #8, #10, #11 | Wrote the interface, its example-data mode, and its unit and browser tests |
| Deployment | `.github/workflows/` | #7, #9 | Wrote the workflow that tests and then deploys the backend |
| Stored skylines | `backend/app/physics/horizon/`, `backend/scripts/`, `backend/data/horizon/` | #12 | Wrote the skyline tool and the disc-visibility comparison, ran them on the NASA LOLA files, and wrote the 2027 validation |
| JPL Horizons check | `backend/scripts/`, `backend/docs/HORIZONS-CHECK.md` | #15 | Wrote and ran the comparison between the engine and NASA's JPL Horizons System |
| Moon surface | `web/public/textures/moon/` | #11 | Resized NASA's CGI Moon Kit color map and derived normal maps from its elevation map, with a script |

## Generated media

- **Images and video:** none. The Moon's surface is NASA imagery. Icons and line drawings are
  drawn by the website's own code.
- **3D models:** built by scripts from published dimensions. No image generator made them.
- **Audio:** none in the app.

## Checks on AI-assisted work

- Pull requests report their test results. New checks were broken once on purpose to confirm
  they can fail, and those results are in the pull request descriptions.
- Physical results were compared with independent sources: NASA's JPL Horizons System for Sun
  and Earth directions, and a second, separately written horizon calculation for the skylines.
- Each dependency a part adds directly is listed with its maintainer and license in that part's
  sources file.
