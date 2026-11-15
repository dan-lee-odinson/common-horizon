"""Scalar horizon geometry: the smooth-sphere dip, elevation angles with curvature, directions."""

import math

import pytest

from app.physics.horizon.geometry import (
    MOON_RADIUS_M,
    bound_tangent_beyond,
    destination_unit,
    elevation_angle_deg,
    geometric_dip_deg,
    lat_lon_from_unit,
    local_frame,
    unit_from_lat_lon,
)

R = 1_737_400.0


def test_reference_radius_is_the_contract_sphere():
    assert MOON_RADIUS_M == 1_737_400.0


def test_geometric_dip_for_a_two_metre_observer():
    # -arccos(R / (R + h)). For small h this is -sqrt(2 h / R) radians:
    # sqrt(4 / 1737400) = 1.51733e-3 rad = 0.086937 degrees.
    dip = geometric_dip_deg(R + 2.0, R)
    assert dip == pytest.approx(-math.degrees(math.acos(R / (R + 2.0))), abs=1e-12)
    assert dip == pytest.approx(-0.086937, abs=1e-5)
    assert dip < 0


def test_geometric_dip_is_zero_on_the_surface_and_grows_with_height():
    assert geometric_dip_deg(R, R) == 0.0
    assert geometric_dip_deg(R + 100.0, R) < geometric_dip_deg(R + 2.0, R) < 0.0
    with pytest.raises(ValueError):
        geometric_dip_deg(R - 1.0, R)


def test_dip_equals_elevation_of_the_tangent_point():
    # The line of sight touches the sphere where cos(angle) = R / (R + h).
    observer = R + 2.0
    tangent_angle = math.acos(R / observer)
    assert elevation_angle_deg(observer, R, tangent_angle) == pytest.approx(geometric_dip_deg(observer, R), abs=1e-9)
    # Surface points nearer and farther than the tangent point both appear lower.
    assert elevation_angle_deg(observer, R, tangent_angle * 0.9) < geometric_dip_deg(observer, R)
    assert elevation_angle_deg(observer, R, tangent_angle * 1.1) < geometric_dip_deg(observer, R)


def test_elevation_of_a_peak_includes_curvature():
    # A 1000 m peak, 20 km away along the surface, seen from 2 m above a surface at height 0.
    #   central angle        20000 / 1737400            = 0.011511454 rad
    #   peak above the plane 1738400 * cos(angle) - 1737402 = 882.82 m
    #   peak along the plane 1738400 * sin(angle)           = 20011.07 m
    #   elevation            atan(882.82 / 20011.07)        = 2.5260 degrees
    # On a flat Moon it would be atan(998 / 20000) = 2.857 degrees: curvature hides 115 m of the peak.
    angle = 20_000.0 / R
    elevation = elevation_angle_deg(R + 2.0, R + 1000.0, angle)
    assert elevation == pytest.approx(2.5260, abs=2e-4)
    drop = 20_000.0**2 / (2 * R)  # 115.1 m
    assert elevation == pytest.approx(math.degrees(math.atan((1000.0 - drop - 2.0) / 20_000.0)), abs=5e-3)
    assert abs(elevation - math.degrees(math.atan(998.0 / 20_000.0))) > 0.3


def test_bound_falls_with_distance_and_never_undercuts_real_terrain():
    observer, highest = R + 1500.0, R + 7000.0
    angles = [0.0001 * step for step in range(1, 2000)]
    bounds = [bound_tangent_beyond(observer, highest, angle) for angle in angles]
    assert all(later <= earlier for earlier, later in zip(bounds, bounds[1:], strict=False))
    for angle, bound in zip(angles, bounds, strict=True):
        for terrain_height in (-9000.0, 0.0, 6999.0, 7000.0):
            tangent = math.tan(math.radians(elevation_angle_deg(observer, R + terrain_height, angle)))
            assert tangent <= bound + 1e-12


def test_bound_for_an_observer_above_all_terrain_is_the_dip_until_the_tangent_point():
    observer, highest = R + 10.0, R
    dip_tangent = math.tan(math.radians(geometric_dip_deg(observer, highest)))
    tangent_angle = math.acos(highest / observer)
    assert bound_tangent_beyond(observer, highest, tangent_angle * 0.5) == pytest.approx(dip_tangent, rel=1e-12)
    assert bound_tangent_beyond(observer, highest, tangent_angle * 2.0) < dip_tangent


def test_local_frame_is_right_handed_and_points_the_right_way():
    up, east, north = local_frame(20.0, 30.0)
    dot = lambda a, b: sum(x * y for x, y in zip(a, b, strict=True))  # noqa: E731
    cross = (
        east[1] * north[2] - east[2] * north[1],
        east[2] * north[0] - east[0] * north[2],
        east[0] * north[1] - east[1] * north[0],
    )
    assert up == pytest.approx(unit_from_lat_lon(20.0, 30.0))
    assert dot(up, east) == pytest.approx(0.0, abs=1e-15)
    assert dot(up, north) == pytest.approx(0.0, abs=1e-15)
    assert cross == pytest.approx(up)  # east x north = up
    assert north[2] > 0  # north has a component toward the north pole
    # East is the direction of growing east longitude.
    ahead = unit_from_lat_lon(20.0, 30.001)
    assert dot([a - b for a, b in zip(ahead, up, strict=True)], east) > 0


@pytest.mark.parametrize(
    ("azimuth", "expected_lat", "expected_lon"),
    [(0.0, 1.0, 30.0), (90.0, 0.0, 31.0), (180.0, -1.0, 30.0), (270.0, 0.0, 29.0)],
)
def test_destination_from_the_equator(azimuth, expected_lat, expected_lon):
    # From (0, 30 E), one degree of arc: north raises latitude, east raises east longitude.
    latitude, longitude = lat_lon_from_unit(destination_unit(0.0, 30.0, azimuth, math.radians(1.0)))
    assert latitude == pytest.approx(expected_lat, abs=1e-9)
    assert longitude == pytest.approx(expected_lon, abs=1e-9)


def test_destination_near_the_south_pole():
    # From 89 S, north leads away from the pole along the same meridian, south reaches the pole.
    latitude, longitude = lat_lon_from_unit(destination_unit(-89.0, 200.0, 0.0, math.radians(0.5)))
    assert (latitude, longitude) == pytest.approx((-88.5, 200.0), abs=1e-9)
    latitude, _ = lat_lon_from_unit(destination_unit(-89.0, 200.0, 180.0, math.radians(1.0)))
    assert latitude == pytest.approx(-90.0, abs=1e-6)
    # East of a site is at greater east longitude, also this close to the pole.
    latitude, longitude = lat_lon_from_unit(destination_unit(-89.0, 200.0, 90.0, math.radians(0.1)))
    assert 200.0 < longitude < 210.0
