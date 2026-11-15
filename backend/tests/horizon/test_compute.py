"""The ray walker on terrain given by formulas: smooth spheres, a ridge, peaks in known directions.

Needs numpy; skipped where it is not installed (the service's own requirements do not include it).
"""

import math

import pytest

np = pytest.importorskip("numpy")

from app.physics.horizon.compute import (  # noqa: E402
    NO_DATA,
    FunctionTerrain,
    SamplingSettings,
    SiteOutsideCoverage,
    bound_tangents,
    compute_profile,
    sample_distances,
)
from app.physics.horizon.geometry import bound_tangent_beyond, local_frame, unit_from_lat_lon  # noqa: E402

R = 1_737_400.0


def _dip_deg(surface_radius: float, observer_height: float) -> float:
    return -math.degrees(math.acos(surface_radius / (surface_radius + observer_height)))


def _flat(height_m: float = 0.0, pixel_size_m: float = 40.0) -> FunctionTerrain:
    return FunctionTerrain(lambda vectors: np.full(vectors.shape[:-1], height_m), pixel_size_m, height_m)


def _angle_from(vectors, latitude_deg: float, longitude_deg: float):
    """Great-circle angle, radians, between each vector and a point given by latitude and longitude."""
    point = np.asarray(unit_from_lat_lon(latitude_deg, longitude_deg))
    return np.arccos(np.clip(vectors @ point, -1.0, 1.0))


def _peak_at(latitude_deg: float, longitude_deg: float, height_m: float, radius_m: float) -> FunctionTerrain:
    """A flat-topped hill of the given radius centred on a latitude and longitude, on a sphere at height 0."""

    def height(vectors):
        return np.where(_angle_from(vectors, latitude_deg, longitude_deg) * R <= radius_m, height_m, 0.0)

    return FunctionTerrain(height, 40.0, height_m)


# --- smooth sphere ----------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("latitude", "longitude"),
    [(20.0, 30.0), (0.0, 0.0), (-45.0, 200.0), (-85.42088, 31.6218), (-89.684, 196.739), (-90.0, 0.0), (90.0, 10.0)],
)
def test_smooth_sphere_gives_the_geometric_dip_at_every_azimuth(latitude, longitude):
    result = compute_profile(_flat(), latitude, longitude, observer_height_m=2.0)
    expected = _dip_deg(R, 2.0)  # -arccos(R / (R + h)) = -0.086937 degrees
    assert expected == pytest.approx(-0.086937, abs=1e-5)
    assert result.horizon_elevation_deg.shape == (720,)
    assert np.max(np.abs(result.horizon_elevation_deg - expected)) < 1e-6
    assert result.site_height_m == 0.0
    # The skyline point is the tangent point, sqrt(2 R h) = 2636 m away, to within one 20 m step.
    assert np.all(np.abs(result.max_distance_m - math.sqrt(2 * R * 2.0)) <= 20.0)
    assert not result.ran_out_of_data.any()
    assert not result.reached_max_range.any()
    assert np.all(result.max_source == 0)


@pytest.mark.parametrize(
    ("site_height", "observer_height"), [(0.0, 2.0), (1500.0, 2.0), (-3000.0, 10.0), (6400.0, 0.5)]
)
def test_smooth_sphere_at_any_height_and_observer_height(site_height, observer_height):
    result = compute_profile(_flat(site_height), 20.0, 30.0, observer_height_m=observer_height)
    assert result.site_height_m == site_height
    # 20 m steps land within 10 m of the tangent point; for a 0.5 m observer that is worth 1.3e-6 degrees.
    assert np.max(np.abs(result.horizon_elevation_deg - _dip_deg(R + site_height, observer_height))) < 5e-6


def test_smooth_sphere_with_coarse_pixels():
    # 240 m pixels: first sample at 360 m, 120 m steps. The dip is still found to a fraction of a millidegree.
    result = compute_profile(_flat(pixel_size_m=240.0), 20.0, 30.0)
    assert result.sample_distances_m[0] == 360.0
    assert np.max(np.abs(result.horizon_elevation_deg - _dip_deg(R, 2.0))) < 5e-5


def test_azimuths_run_from_zero_in_half_degree_steps():
    result = compute_profile(_flat(), 20.0, 30.0)
    assert result.azimuth_deg[0] == 0.0
    assert result.azimuth_deg[-1] == 359.5
    assert np.allclose(np.diff(result.azimuth_deg), 0.5)


# --- a ridge of known height at a known distance ----------------------------------------------------


def _ridge(site_lat: float, site_lon: float, azimuth_deg: float, near_m: float, far_m: float, height_m: float):
    """A wall across the ray at ``azimuth_deg``: 1000-odd metres high, from ``near_m`` to ``far_m`` from the site."""
    up, east, north = (np.asarray(vector) for vector in local_frame(site_lat, site_lon))

    def height(vectors):
        distance = np.arccos(np.clip(vectors @ up, -1.0, 1.0)) * R
        bearing = np.degrees(np.arctan2(vectors @ east, vectors @ north)) % 360.0
        off_axis = np.abs((bearing - azimuth_deg + 180.0) % 360.0 - 180.0)
        return np.where((distance >= near_m) & (distance <= far_m) & (off_axis <= 2.0), height_m, 0.0)

    return FunctionTerrain(height, 40.0, height_m)


def test_ridge_at_known_distance_matches_the_angle_worked_out_by_hand():
    # A 1000 m ridge whose near face is 20 km from the site, seen from 2 m above a surface at height 0.
    # Worked by hand, with the Moon's curvature (R = 1737400 m):
    #   central angle        20000 / 1737400                 = 0.011511454 rad
    #   ridge above my plane 1738400 * cos(angle) - 1737402  = 882.82 m
    #   ridge along my plane 1738400 * sin(angle)            = 20011.07 m
    #   elevation            atan(882.82 / 20011.07)         = 2.5260 degrees
    # (Without curvature it would be atan(998 / 20000) = 2.857 degrees.)
    # Samples fall every 20 m from 60 m, so one lands on the face at exactly 20000 m.
    terrain = _ridge(20.0, 30.0, azimuth_deg=135.0, near_m=19_999.0, far_m=21_000.0, height_m=1000.0)
    result = compute_profile(terrain, 20.0, 30.0, observer_height_m=2.0)
    index = int(np.flatnonzero(result.azimuth_deg == 135.0)[0])

    assert result.horizon_elevation_deg[index] == pytest.approx(2.5260, abs=2e-4)
    angle = 20_000.0 / R
    exact = math.degrees(math.atan2((R + 1000.0) * math.cos(angle) - (R + 2.0), (R + 1000.0) * math.sin(angle)))
    assert result.horizon_elevation_deg[index] == pytest.approx(exact, abs=1e-7)
    assert result.max_distance_m[index] == pytest.approx(20_000.0, abs=1e-6)
    assert abs(result.horizon_elevation_deg[index] - 2.857) > 0.3  # not the flat-Moon answer

    # Away from the ridge the skyline is the smooth-sphere dip.
    away = np.abs((result.azimuth_deg - 135.0 + 180.0) % 360.0 - 180.0) > 2.5
    assert np.max(np.abs(result.horizon_elevation_deg[away] - _dip_deg(R, 2.0))) < 1e-6


def test_ridge_seen_from_a_raised_site():
    # Site surface at +500 m (a plateau around the site), ridge top at +1500 m, 30 km away.
    #   angle 30000 / 1737400 = 0.017267181 rad; observer radius 1737902; ridge radius 1738900
    #   above: 1738900 * cos(angle) - 1737902 = 738.77 m; along: 1738900 * sin(angle) = 30024.4 m
    #   elevation = atan(738.77 / 30024.4) = 1.4095 degrees
    up = np.asarray(unit_from_lat_lon(-60.0, 100.0))
    east, north = (np.asarray(vector) for vector in local_frame(-60.0, 100.0)[1:])

    def height(vectors):
        distance = np.arccos(np.clip(vectors @ up, -1.0, 1.0)) * R
        bearing = np.degrees(np.arctan2(vectors @ east, vectors @ north)) % 360.0
        ridge = (distance >= 29_999.0) & (distance <= 31_000.0) & (np.abs(bearing - 270.0) <= 2.0)
        return np.where(ridge, 1500.0, np.where(distance < 1000.0, 500.0, 0.0))

    result = compute_profile(FunctionTerrain(height, 40.0, 1500.0), -60.0, 100.0, observer_height_m=2.0)
    index = int(np.flatnonzero(result.azimuth_deg == 270.0)[0])
    assert result.site_height_m == 500.0
    assert result.horizon_elevation_deg[index] == pytest.approx(1.4095, abs=2e-4)
    assert result.max_distance_m[index] == pytest.approx(30_000.0, abs=1e-6)


# --- direction ---------------------------------------------------------------------------------------


def _azimuth_of_highest(result) -> float:
    return float(result.azimuth_deg[int(np.argmax(result.horizon_elevation_deg))])


def _centre_of_raised_azimuths(result, level_deg: float) -> float:
    """Middle of the run of azimuths whose skyline is clearly above the smooth-sphere dip."""
    raised = result.horizon_elevation_deg > level_deg
    angles = np.radians(result.azimuth_deg[raised])
    return math.degrees(math.atan2(np.sin(angles).mean(), np.cos(angles).mean())) % 360.0


@pytest.mark.parametrize(
    ("peak_lat", "peak_lon", "expected_azimuth"),
    [
        (0.5, 30.0, 0.0),  # greater latitude, same longitude: due north
        (0.0, 30.5, 90.0),  # same latitude, greater east longitude: due east
        (-0.5, 30.0, 180.0),  # due south
        (0.0, 29.5, 270.0),  # due west
    ],
)
def test_peak_direction_from_an_equatorial_site(peak_lat, peak_lon, expected_azimuth):
    # The peak is placed by latitude and longitude alone; nothing here uses the walker's own frame.
    terrain = _peak_at(peak_lat, peak_lon, height_m=3000.0, radius_m=600.0)
    result = compute_profile(terrain, 0.0, 30.0)
    centre = _centre_of_raised_azimuths(result, level_deg=1.0)
    assert abs((centre - expected_azimuth + 180.0) % 360.0 - 180.0) < 0.26
    assert abs((_azimuth_of_highest(result) - expected_azimuth + 180.0) % 360.0 - 180.0) <= 2.5
    # 0.5 degrees of arc is 15.16 km, so the hill's near edge is 14.56 km away, where curvature hides
    # 14562^2 / (2 R) = 61 m of its 3000 m: atan((3000 - 61 - 2) / 14562) = 11.40 degrees.
    assert result.horizon_elevation_deg.max() == pytest.approx(math.degrees(math.atan(2937.0 / 14_562.0)), abs=0.05)


def test_peak_due_north_and_due_east_from_a_southern_site():
    # From 85 S, 30 E. North: same meridian, nearer the equator. East: found with the textbook
    # initial-bearing formula from latitudes and longitudes, independent of the walker.
    north_peak = compute_profile(_peak_at(-84.5, 30.0, 3000.0, 600.0), -85.0, 30.0)
    assert abs((_centre_of_raised_azimuths(north_peak, 1.0) + 180.0) % 360.0 - 180.0) < 0.26

    peak_lat, peak_lon = -85.0, 36.0  # same latitude, 6 degrees further east (15.9 km away)
    lat1, lat2, delta = math.radians(-85.0), math.radians(peak_lat), math.radians(peak_lon - 30.0)
    bearing = math.degrees(
        math.atan2(
            math.sin(delta) * math.cos(lat2),
            math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(delta),
        )
    )
    assert 90.0 < bearing < 95.0  # east, leaning a little toward the pole side
    east_peak = compute_profile(_peak_at(peak_lat, peak_lon, 3000.0, 600.0), -85.0, 30.0)
    assert _centre_of_raised_azimuths(east_peak, 1.0) == pytest.approx(bearing, abs=0.26)

    # Toward the south pole is azimuth 180.
    pole_peak = compute_profile(_peak_at(-85.5, 30.0, 3000.0, 600.0), -85.0, 30.0)
    assert _centre_of_raised_azimuths(pole_peak, 1.0) == pytest.approx(180.0, abs=0.26)


# --- sampling, stopping rule and coverage flags ------------------------------------------------------


def test_sample_distances_skip_a_pixel_and_a_half_then_grow():
    settings = SamplingSettings()
    distances = sample_distances(40.0, settings)
    assert distances[0] == 60.0  # 1.5 pixels: the observer's own cell is skipped
    steps = np.diff(distances)
    assert np.all(steps > 0)
    assert np.all(np.diff(steps) >= -1e-9)  # steps never shrink with distance
    # Close to the site: no step longer than 0.5 % of the distance, and none split finer than 0.5 m.
    near = distances[:-1] < 4000.0
    assert steps[0] == pytest.approx(0.5)
    assert np.all(steps[near] <= np.maximum(0.5, 0.005 * distances[:-1][near]) + 1e-9)
    assert steps[near].min() >= 0.5 - 1e-9
    # From 4 km to 80 km: half a pixel.
    middle = (distances[:-1] >= 4000.0) & (distances[:-1] <= 80_000.0)
    assert np.all(np.abs(steps[middle] - 20.0) < 1e-9)
    # Beyond: 25 m per 100 km, so 100 m at 400 km.
    assert steps.max() == pytest.approx(0.00025 * distances[-2], rel=1e-9)
    assert steps.max() <= 100.0
    assert distances[-1] <= 400_000.0 < distances[-1] + steps[-1] * 1.001
    # Every point of the plain half-pixel sequence is still a sample: the near field only gains points.
    plain = sample_distances(40.0, SamplingSettings(near_step_fraction=1.0))
    assert plain[0] == 60.0 and np.diff(plain).min() == pytest.approx(20.0)
    assert np.isin(plain, distances).all()

    coarse = sample_distances(240.0, settings)
    assert coarse[0] == 360.0
    assert np.diff(coarse)[0] == pytest.approx(120.0 / 67)  # 120 m split so no part exceeds 0.5 % of 360 m
    assert np.diff(coarse).max() == pytest.approx(120.0)


def test_sample_distances_refuse_bad_settings():
    with pytest.raises(ValueError):
        sample_distances(0.0, SamplingSettings())
    with pytest.raises(ValueError):
        sample_distances(40.0, SamplingSettings(max_range_m=10.0))
    with pytest.raises(ValueError):
        sample_distances(40.0, SamplingSettings(step_growth=-1.0))
    with pytest.raises(ValueError):
        sample_distances(40.0, SamplingSettings(near_step_fraction=0.0))
    with pytest.raises(ValueError):
        sample_distances(40.0, SamplingSettings(near_step_floor_m=0.0))


def _rolling_ground(latitude_deg: float, longitude_deg: float) -> FunctionTerrain:
    """Gentle bumps 8 m high and a few hundred metres across, the kind of ground that sets a near skyline."""
    up, east, north = (np.asarray(vector) for vector in local_frame(latitude_deg, longitude_deg))

    def height(vectors):
        x, y = (vectors @ east) * R, (vectors @ north) * R
        near = np.arccos(np.clip(vectors @ up, -1.0, 1.0)) * R < 20_000.0
        bumps = 8.0 * (np.sin(x / 35.0) * np.cos(y / 45.0) + np.sin((x + y) / 60.0))
        return np.where(near, bumps, 0.0)

    return FunctionTerrain(height, 40.0, 16.0)


def test_near_field_steps_are_fine_enough_to_have_converged():
    # For an observer 2 m up, the elevation of ground 60 to 300 m away changes by about half a degree
    # in 20 m. The skyline must not depend on where the samples happen to fall.
    terrain = _rolling_ground(-85.0, 30.0)
    stored_settings = compute_profile(terrain, -85.0, 30.0)
    twice_as_fine = compute_profile(
        terrain, -85.0, 30.0, settings=SamplingSettings(near_step_fraction=0.0025, near_step_floor_m=0.25)
    )
    half_pixel_only = compute_profile(terrain, -85.0, 30.0, settings=SamplingSettings(near_step_fraction=1.0))

    change = np.abs(twice_as_fine.horizon_elevation_deg - stored_settings.horizon_elevation_deg)
    assert change.max() < 0.005  # converged: halving the steps moves no ray by 0.005 degrees
    # The split keeps every point of the plain half-pixel sequence, so it can only raise a maximum.
    assert np.all(stored_settings.horizon_elevation_deg >= half_pixel_only.horizon_elevation_deg - 1e-12)
    assert np.all(twice_as_fine.horizon_elevation_deg >= half_pixel_only.horizon_elevation_deg - 1e-12)
    # Plain half-pixel steps would have been visibly too low on this ground.
    assert (stored_settings.horizon_elevation_deg - half_pixel_only.horizon_elevation_deg).max() > 0.05


def test_array_bound_matches_the_scalar_bound():
    angles = np.linspace(1e-5, 0.23, 500)
    for observer, highest in ((R + 1500.0, R + 7000.0), (R + 10.0, R), (R + 7002.0, R + 7000.0)):
        expected = [bound_tangent_beyond(observer, highest, float(angle)) for angle in angles]
        assert np.allclose(bound_tangents(observer, highest, angles), expected, rtol=1e-12, atol=1e-15)


def test_rays_stop_early_on_a_smooth_sphere():
    result = compute_profile(_flat(), 20.0, 30.0)
    # Past the tangent point (2636 m) nothing at height 0 can beat the dip, so the walk ends there.
    assert np.all(result.stop_distance_m > 2636.0)
    assert np.all(result.stop_distance_m < 2700.0)


def test_ray_walks_on_while_higher_terrain_could_still_appear():
    # The model's highest value is 5000 m (a far peak), so every ray must keep going until terrain at
    # 5000 m could no longer rise above the dip: sqrt(2 R * 5000) + sqrt(2 R * 2) = 134.4 km.
    terrain = _peak_at(0.0, 40.0, height_m=5000.0, radius_m=2000.0)
    result = compute_profile(terrain, 0.0, 30.0)
    west = int(np.flatnonzero(result.azimuth_deg == 270.0)[0])
    assert result.horizon_elevation_deg[west] == pytest.approx(_dip_deg(R, 2.0), abs=1e-6)
    grazing_reach = R * (math.acos(R / (R + 2.0)) + math.acos(R / (R + 5000.0)))  # 134.3 km
    assert grazing_reach == pytest.approx(134_300.0, abs=100.0)
    assert 0.0 <= result.stop_distance_m[west] - grazing_reach <= 40.0  # the first sample past it
    assert not result.reached_max_range.any()


def test_data_that_ends_after_the_stopping_rule_is_met_is_not_flagged():
    # Data only within 5 km of the site. On a smooth sphere each ray is decided by 2.7 km.
    site = np.asarray(unit_from_lat_lon(20.0, 30.0))

    def height(vectors):
        return np.where(np.arccos(np.clip(vectors @ site, -1.0, 1.0)) * R <= 5000.0, 0.0, np.nan)

    result = compute_profile(FunctionTerrain(height, 40.0, 0.0), 20.0, 30.0)
    assert not result.ran_out_of_data.any()
    assert np.max(np.abs(result.horizon_elevation_deg - _dip_deg(R, 2.0))) < 1e-6


def test_data_that_ends_before_the_stopping_rule_is_met_is_flagged():
    # Data only within 1 km, east half only beyond that out to 5 km. West rays run out before the
    # tangent point: their value is the best of the data they had, and they are flagged.
    site = np.asarray(unit_from_lat_lon(20.0, 30.0))
    east = np.asarray(local_frame(20.0, 30.0)[1])

    def height(vectors):
        distance = np.arccos(np.clip(vectors @ site, -1.0, 1.0)) * R
        has_data = (distance <= 1002.0) | ((distance <= 5000.0) & (vectors @ east > 0))
        return np.where(has_data, 0.0, np.nan)

    result = compute_profile(FunctionTerrain(height, 40.0, 0.0), 20.0, 30.0)
    east_rays = (result.azimuth_deg > 5.0) & (result.azimuth_deg < 175.0)
    west_rays = (result.azimuth_deg > 185.0) & (result.azimuth_deg < 355.0)
    assert not result.ran_out_of_data[east_rays].any()
    assert result.ran_out_of_data[west_rays].all()
    # They still stop: past the tangent point the surface sinks again, and beyond 6950 m nothing at the
    # model's highest value (0 m) can appear above the last point they saw. Solve 2/d + d/(2R) = the
    # same sum at d = 1000 m: d = 2 R * 2 / 1000 = 6950 m.
    assert not result.reached_max_range[west_rays].any()
    assert np.all((result.stop_distance_m[west_rays] > 6950.0) & (result.stop_distance_m[west_rays] < 6990.0))
    # Flagged rays hold the elevation of the last surface point they could see (1 km away, below the dip).
    last_seen = math.degrees(math.atan2(R * math.cos(1000.0 / R) - (R + 2.0), R * math.sin(1000.0 / R)))
    assert np.max(np.abs(result.horizon_elevation_deg[west_rays] - last_seen)) < 1e-6
    assert np.all(result.max_distance_m[west_rays] == pytest.approx(1000.0, abs=1e-6))


def test_ray_without_any_data_gets_the_dip_and_is_flagged():
    # Data only on the east side of the site's meridian plane (and at the site itself).
    site = np.asarray(unit_from_lat_lon(20.0, 30.0))
    east = np.asarray(local_frame(20.0, 30.0)[1])

    def height(vectors):
        at_site = np.arccos(np.clip(vectors @ site, -1.0, 1.0)) * R < 30.0
        return np.where(at_site | (vectors @ east > 0), 0.0, np.nan)

    result = compute_profile(FunctionTerrain(height, 40.0, 0.0), 20.0, 30.0)
    west = int(np.flatnonzero(result.azimuth_deg == 270.0)[0])
    assert result.max_source[west] == NO_DATA
    assert np.isnan(result.max_distance_m[west])
    assert result.ran_out_of_data[west] and result.reached_max_range[west]
    assert result.horizon_elevation_deg[west] == pytest.approx(_dip_deg(R, 2.0), abs=1e-9)
    east_ray = int(np.flatnonzero(result.azimuth_deg == 90.0)[0])
    assert result.max_source[east_ray] == 0 and not result.ran_out_of_data[east_ray]


def test_site_without_data_is_an_error():
    terrain = FunctionTerrain(lambda vectors: np.full(vectors.shape[:-1], np.nan), 40.0, 0.0)
    with pytest.raises(SiteOutsideCoverage):
        compute_profile(terrain, 20.0, 30.0)


def test_terrain_inside_the_skipped_near_field_is_not_seen():
    # A 50 m wall 30 to 50 m from the site lies inside the first 60 m, which the walk skips by design.
    site = np.asarray(unit_from_lat_lon(20.0, 30.0))

    def near_wall(vectors):
        distance = np.arccos(np.clip(vectors @ site, -1.0, 1.0)) * R
        return np.where((distance > 30.0) & (distance < 50.0), 50.0, 0.0)

    hidden = compute_profile(FunctionTerrain(near_wall, 40.0, 50.0), 20.0, 30.0)
    assert np.max(np.abs(hidden.horizon_elevation_deg - _dip_deg(R, 2.0))) < 1e-6

    def wall_at_first_sample(vectors):
        distance = np.arccos(np.clip(vectors @ site, -1.0, 1.0)) * R
        return np.where((distance > 55.0) & (distance < 65.0), 50.0, 0.0)

    seen = compute_profile(FunctionTerrain(wall_at_first_sample, 40.0, 50.0), 20.0, 30.0)
    assert np.all(seen.max_distance_m == pytest.approx(60.0, abs=1e-6))
    assert np.all(seen.horizon_elevation_deg == pytest.approx(math.degrees(math.atan2(48.0, 60.0)), abs=5e-3))


def test_result_does_not_depend_on_the_chunk_size():
    terrain = _peak_at(0.3, 30.4, height_m=2500.0, radius_m=900.0)
    reference = compute_profile(terrain, 0.0, 30.0, settings=SamplingSettings(chunk_steps=256))
    for chunk_steps in (1, 7, 100, 100_000):
        other = compute_profile(terrain, 0.0, 30.0, settings=SamplingSettings(chunk_steps=chunk_steps))
        assert np.allclose(other.horizon_elevation_deg, reference.horizon_elevation_deg, rtol=0, atol=1e-10)
        assert np.allclose(other.max_distance_m, reference.max_distance_m, rtol=0, atol=1e-6)
        assert np.allclose(other.stop_distance_m, reference.stop_distance_m, rtol=0, atol=1e-6)
        assert np.array_equal(other.ran_out_of_data, reference.ran_out_of_data)
        assert np.array_equal(other.reached_max_range, reference.reached_max_range)


def test_bad_arguments_are_refused():
    with pytest.raises(ValueError):
        compute_profile(_flat(), 91.0, 0.0)
    with pytest.raises(ValueError):
        compute_profile(_flat(), 0.0, 0.0, observer_height_m=-1.0)
    with pytest.raises(ValueError):
        compute_profile(_flat(), 0.0, 0.0, settings=SamplingSettings(azimuth_step_deg=0.7))
