
"""Tests for LOLA terrain elevation lookups."""

from pathlib import Path

import pytest

from app.physics.engine.terrain import (
    LOLA_DIR,
    get_elevation,
    get_elevation_from_dem,
)


DATASETS_AVAILABLE = all(
    (LOLA_DIR / filename).is_file()
    for _, filename in [
        ("80 m polar", "LDEM_80S_80MPP_ADJ.tiff"),
        ("240 m polar", "LDEM_60S_240MPP_ADJ.tiff"),
        ("118 m global", "Lunar_LRO_LOLA_Global_LDEM_118m_Mar2014.tif"),
    ]
)

requires_datasets = pytest.mark.skipif(
    not DATASETS_AVAILABLE,
    reason="Local LOLA datasets are not installed.",
)


@requires_datasets
@pytest.mark.parametrize(
    "latitude, longitude, expected_elevation, expected_dem",
    [
        (-89.684, 196.739, 1727.625, "80 m polar"),
        (-85.42088, 31.6218, 6415.264, "80 m polar"),
        (-84.7906, 29.1957, 5323.716, "80 m polar"),
        (0.67416, 23.47314, -1927.5, "118 m global"),
    ],
)
def test_get_elevation(
    latitude,
    longitude,
    expected_elevation,
    expected_dem,
):
    result = get_elevation(latitude, longitude)

    assert result is not None

    elevation, dem_name = result

    assert elevation == pytest.approx(expected_elevation, abs=0.01)
    assert dem_name == expected_dem


@requires_datasets
def test_polar_dem_returns_none_outside_coverage():
    dem_path = LOLA_DIR / "LDEM_80S_80MPP_ADJ.tiff"

    result = get_elevation_from_dem(
        0.67416,
        23.47314,
        dem_path,
    )

    assert result is None


def test_invalid_latitude_raises_error():
    with pytest.raises(ValueError):
        get_elevation(95.0, 0.0)


def test_non_finite_longitude_raises_error():
    with pytest.raises(ValueError):
        get_elevation(0.0, float("nan"))
