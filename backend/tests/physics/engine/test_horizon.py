
import math
import pytest

from app.physics.engine.horizon import (
    HorizonConfig,
    destination_point,
    calculate_elevation_angle,
)


def test_default_horizon_config():
    config = HorizonConfig()

    assert config.azimuth_step_deg == 1.0
    assert config.sample_step_m == 80.0
    assert config.max_distance_m == 30_000.0


def test_invalid_horizon_config():
    with pytest.raises(ValueError):
        HorizonConfig(sample_step_m=0)

    with pytest.raises(ValueError):
        HorizonConfig(azimuth_step_deg=0)


def test_destination_north():
    lat, lon = destination_point(-85.0, 30.0, 0.0, 1000.0)

    assert lat > -85.0
    assert lon == pytest.approx(30.0)


def test_destination_east():
    lat, lon = destination_point(-85.0, 30.0, 90.0, 1000.0)

    assert lat == pytest.approx(-85.0, abs=0.001)
    assert lon > 30.0


def test_destination_south():
    lat, lon = destination_point(-85.0, 30.0, 180.0, 1000.0)

    assert lat < -85.0
    assert lon == pytest.approx(30.0)


def test_destination_west():
    lat, lon = destination_point(-85.0, 30.0, 270.0, 1000.0)

    assert lat == pytest.approx(-85.0, abs=0.001)
    assert lon < 30.0


def test_destination_longitude_wraps():
    lat, lon = destination_point(0.0, 359.9, 90.0, 50_000.0)

    assert 0.0 <= lon < 360.0


def test_flat_terrain_angle_is_negative():
    angle = calculate_elevation_angle(
        1000.0,
        terrain_elevation_m=0.0,
        observer_height_m=1.5,
    )

    assert angle < 0.0


def test_higher_terrain_has_higher_angle():
    low = calculate_elevation_angle(
        1000.0, 0.0, observer_height_m=1.5
    )
    high = calculate_elevation_angle(
        1000.0, 100.0, observer_height_m=1.5
    )

    assert high > low


def test_invalid_distance():
    with pytest.raises(ValueError):
        calculate_elevation_angle(0.0, 0.0)


def test_destination_rejects_invalid_latitude():
    with pytest.raises(ValueError):
        destination_point(95.0, 30.0, 0.0, 1000.0)
