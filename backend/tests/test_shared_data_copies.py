"""The backend's copies of team data must match their sources (the Docker image cannot reach them).

Fix a failure with ``python backend/scripts/sync_shared_data.py`` from the repository root.
"""

from pathlib import Path

import pytest

from scripts.sync_shared_data import PLANNER_COPY, PLANNER_SOURCE, SITES_COPY, SITES_SOURCE, planner_files


def _text(path: Path) -> str:
    # Compare text, not bytes: a Windows checkout may store CRLF line endings.
    return path.read_text(encoding="utf-8").replace("\r\n", "\n")


@pytest.mark.skipif(not SITES_SOURCE.exists(), reason="web/ is not in this checkout (e.g. inside the image)")
def test_preset_sites_copy_matches_the_website_list():
    assert _text(SITES_COPY) == _text(SITES_SOURCE)


@pytest.mark.skipif(not PLANNER_SOURCE.exists(), reason="planner/ is not in this checkout (e.g. inside the image)")
def test_planner_copy_matches_the_planner_package():
    assert planner_files(PLANNER_COPY) == planner_files(PLANNER_SOURCE)
    for relative in planner_files(PLANNER_SOURCE):
        assert _text(PLANNER_COPY / relative) == _text(PLANNER_SOURCE / relative), relative


def test_the_backend_imports_the_vendored_planner():
    from app.planner_bridge import VENDOR_DIR, planner

    assert Path(planner.__file__).resolve().is_relative_to(VENDOR_DIR)
    assert planner.validate_catalog() == []
