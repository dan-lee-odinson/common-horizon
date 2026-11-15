"""Checks that need the real LOLA elevation files, which live outside the repository.

Skipped unless numpy and rasterio are installed AND the environment variable CH_LOLA_DIR names a
folder holding LDEM_80S_40MPP_ADJ.TIF and LDEM_60S_240MPP_ADJ.TIF. They load about 1.2 GB into memory.
"""

import os
from pathlib import Path

import pytest

np = pytest.importorskip("numpy")
pytest.importorskip("rasterio")

from app.physics.horizon.compute import compute_profile  # noqa: E402
from app.physics.horizon.dem import CompositeTerrain, load_raster_terrain  # noqa: E402
from app.physics.horizon.profile import DEFAULT_PROFILE_DIR, load_profile  # noqa: E402
from scripts.compute_horizon_profiles import COARSE_MODEL, FINE_MODEL, check_georeferencing  # noqa: E402

LOLA_DIR = os.environ.get("CH_LOLA_DIR")
PATHS = [Path(LOLA_DIR) / name for name in (FINE_MODEL, COARSE_MODEL)] if LOLA_DIR else []

pytestmark = pytest.mark.skipif(
    not PATHS or not all(path.is_file() for path in PATHS),
    reason="set CH_LOLA_DIR to a folder holding the two LOLA elevation files to run the real-data checks",
)


@pytest.fixture(scope="module")
def terrains():
    return [load_raster_terrain(path) for path in PATHS]


def test_georeferencing_of_both_files(terrains, capsys):
    assert check_georeferencing(terrains, PATHS)
    assert "GEOREFERENCING CHECK: PASSED" in capsys.readouterr().out
    for terrain, pixel in zip(terrains, (40.0, 240.0), strict=True):
        assert terrain.pixel_size_m == pixel
        assert terrain.projection.pole == -1
        assert terrain.projection.radius_m == 1_737_400.0
        assert terrain.details["formula_vs_proj_max_difference_m"] < 1e-6


@pytest.mark.parametrize("site_id", ["shackleton-ridge", "nobile"])
def test_stored_profile_is_reproduced_from_the_files(terrains, site_id):
    stored = load_profile(DEFAULT_PROFILE_DIR / f"{site_id}.json")
    result = compute_profile(CompositeTerrain(terrains), stored.latitude_deg, stored.longitude_deg)
    assert result.site_height_m == pytest.approx(stored.site_height_m, abs=1e-3)
    assert np.max(np.abs(result.horizon_elevation_deg - np.array(stored.horizon_elevation_deg))) < 1e-4


def test_real_terrain_skyline_has_converged_in_the_near_field(terrains):
    # Halving the near-field steps must not move any ray of the two priority sites by 0.02 degrees.
    from app.physics.horizon.compute import SamplingSettings

    finer = SamplingSettings(near_step_fraction=0.0025, near_step_floor_m=0.25)
    for site_id in ("shackleton-ridge", "nobile"):
        stored = load_profile(DEFAULT_PROFILE_DIR / f"{site_id}.json")
        result = compute_profile(CompositeTerrain(terrains), stored.latitude_deg, stored.longitude_deg, settings=finer)
        difference = result.horizon_elevation_deg - np.array(stored.horizon_elevation_deg)
        assert np.max(np.abs(difference)) < 0.02
