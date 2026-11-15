"""Checks that need the real LOLA elevation files, which live outside the repository.

Skipped unless numpy and rasterio are installed AND the environment variable CH_LOLA_DIR names a
folder holding LDEM_80S_40MPP_ADJ.TIF and LDEM_60S_240MPP_ADJ.TIF. They load about 1.2 GB into memory.
"""

import math
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


def test_far_skyline_from_shackleton_ridge_is_mons_mouton(terrains):
    # Mons Mouton (about 84.6 S, 31 E) rises 6 km above the datum some 173 km from the site. On the
    # polar map (x = rho sin(lon), y = rho cos(lon)) its bearing from the site works out to about 193
    # degrees. The only skyline points farther than 150 km must lie in that direction.
    stored = load_profile(DEFAULT_PROFILE_DIR / "shackleton-ridge.json")

    def map_xy(latitude, longitude):
        rho = 2.0 * 1737.4 * math.tan(math.radians(90.0 + latitude) / 2.0)
        return rho * math.sin(math.radians(longitude)), rho * math.cos(math.radians(longitude))

    site_x, site_y = map_xy(stored.latitude_deg, stored.longitude_deg)
    peak_x, peak_y = map_xy(-84.6, 31.0)
    longitude = math.radians(stored.longitude_deg)
    north = (math.sin(longitude), math.cos(longitude))  # away from the pole
    east = (math.cos(longitude), -math.sin(longitude))  # toward growing east longitude
    dx, dy = peak_x - site_x, peak_y - site_y
    bearing = math.degrees(math.atan2(dx * east[0] + dy * east[1], dx * north[0] + dy * north[1])) % 360.0
    assert bearing == pytest.approx(193.5, abs=1.0)

    far = [
        azimuth
        for azimuth, distance in zip(stored.azimuth_deg, stored.max_distance_m, strict=True)
        if distance is not None and distance > 150_000.0
    ]
    assert far, "expected some skyline points beyond 150 km"
    assert all(abs(azimuth - bearing) < 15.0 for azimuth in far)
