"""Refresh the backend's copies of team data that the Docker image cannot reach.

The image is built from ``backend/`` only, so two sources are copied into ``backend/app``:

* ``planner/planner``                    -> ``backend/app/vendor/planner``   (code and catalog)
* ``web/src/api/examples/sites.json``    -> ``backend/app/data/preset_sites.json``

Run from the repository root after either source changes::

    python backend/scripts/sync_shared_data.py

``backend/tests/test_shared_data_copies.py`` fails while a copy differs from its source.
"""

import shutil
from pathlib import Path

REPOSITORY_DIR = Path(__file__).resolve().parents[2]
BACKEND_DIR = REPOSITORY_DIR / "backend"

PLANNER_SOURCE = REPOSITORY_DIR / "planner" / "planner"
PLANNER_COPY = BACKEND_DIR / "app" / "vendor" / "planner"
SITES_SOURCE = REPOSITORY_DIR / "web" / "src" / "api" / "examples" / "sites.json"
SITES_COPY = BACKEND_DIR / "app" / "data" / "preset_sites.json"


def planner_files(root: Path) -> list[Path]:
    """The files that make up the planner package (no caches), relative to ``root``."""
    return sorted(
        path.relative_to(root)
        for path in root.rglob("*")
        if path.is_file() and "__pycache__" not in path.parts and path.suffix in {".py", ".json"}
    )


def main() -> None:
    if PLANNER_COPY.exists():
        shutil.rmtree(PLANNER_COPY)
    for relative in planner_files(PLANNER_SOURCE):
        target = PLANNER_COPY / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(PLANNER_SOURCE / relative, target)
    SITES_COPY.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(SITES_SOURCE, SITES_COPY)
    print(f"Copied {len(planner_files(PLANNER_SOURCE))} planner files and the preset site list.")


if __name__ == "__main__":
    main()
