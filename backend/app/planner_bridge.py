"""Imports the team's planner module (``planner/`` at the repository root) for the backend.

The Docker image is built from ``backend/`` only (``COPY app ./app``), so the repository's
``planner/planner`` package cannot be reached at run time. An exact copy lives in
``app/vendor/planner``; ``tests/test_shared_data_copies.py`` fails as soon as the copy and the
original differ, and ``scripts/sync_shared_data.py`` refreshes it. Never edit the copy by hand.

The planner reads its catalog with ``importlib.resources.files("planner")``, so it must be importable
under its own top-level name: the vendor folder is put first on ``sys.path``.
"""

import sys
from pathlib import Path

VENDOR_DIR = Path(__file__).resolve().parent / "vendor"

if str(VENDOR_DIR) not in sys.path:
    sys.path.insert(0, str(VENDOR_DIR))

import planner

__all__ = ["planner"]
