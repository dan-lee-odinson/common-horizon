
import math
import pytest

from app.physics.engine.horizon import (
    HorizonConfig,
    destination_point,
    calculate_elevation_angle,
    _generate_sampling_distances,
)

def test_default_horizon_config():
    config = HorizonConfig()

    assert config.azimuth_step_deg == 1.0
    assert config.sample_step_m == 80.0
    assert config.coarse_start_m == 30_000.0
    assert config.coarse_sample_step_m == 1_000.0
    assert config.max_distance_m == 250_000.0
    assert config.observer_height_m == 2.0

def test_horizon_sampling_distances():
    config = HorizonConfig()
    distances = _generate_sampling_distances(config)

    assert distances[0] == 80.0
    assert 29_920.0 in distances
    assert 30_000.0 in distances
    assert 31_000.0 in distances
    assert distances[-1] == 250_000.0

    # No duplicate distances.
    assert len(distances) == len(set(distances))

    # Fine sampling before 30 km; coarse sampling thereafter.
    assert all(
        step == pytest.approx(80.0)
        for step in distances[1:374] - distances[:373]
    )
    assert all(
        step == pytest.approx(1_000.0)
        for step in distances[375:] - distances[374:-1]
    )

def test_invalid_horizon_config():
    with pytest.raises(ValueError):
        HorizonConfig(sample_step_m=0)

    with pytest.raises(ValueError):
        HorizonConfig(azimuth_step_deg=0)


def test_invalid_coarse_sampling_config():
    with pytest.raises(ValueError):
        HorizonConfig(coarse_start_m=0)

    with pytest.raises(ValueError):
        HorizonConfig(coarse_sample_step_m=0)

    with pytest.raises(ValueError):
        HorizonConfig(coarse_start_m=250_000.0)


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

def test_elevation_angle_defaults_to_two_metre_observer():
    default = calculate_elevation_angle(1000.0, 0.0)
    explicit = calculate_elevation_angle(
        1000.0, 0.0, observer_height_m=2.0
    )

    assert default == pytest.approx(explicit)
