"""Stored horizon profiles: checks on load, interpolation with wrap, and the files in backend/data/horizon."""

import json
import math

import pytest

from app.models.results import TerrainSkyline
from app.physics.horizon.geometry import geometric_dip_deg
from app.physics.horizon.profile import (
    DEFAULT_PROFILE_DIR,
    HorizonProfile,
    ProfileError,
    interpolate_skyline,
    load_profile,
    load_site_profile,
)

STORED_PROFILES = sorted(DEFAULT_PROFILE_DIR.glob("*.json")) if DEFAULT_PROFILE_DIR.is_dir() else []


def _profile(azimuths, elevations, **overrides) -> HorizonProfile:
    fields = {
        "site_id": "test",
        "latitude_deg": -85.0,
        "longitude_deg": 30.0,
        "site_height_m": 100.0,
        "observer_height_m": 2.0,
        "azimuth_deg": tuple(azimuths),
        "horizon_elevation_deg": tuple(elevations),
    }
    fields.update(overrides)
    return HorizonProfile(**fields)


def test_interpolation_between_samples_and_at_samples():
    profile = _profile([0.0, 90.0, 180.0, 270.0], [1.0, 3.0, -1.0, 5.0])
    assert profile.elevation_at(0.0) == 1.0
    assert profile.elevation_at(90.0) == 3.0
    assert profile.elevation_at(45.0) == pytest.approx(2.0)
    assert profile.elevation_at(135.0) == pytest.approx(1.0)
    assert profile.elevation_at(22.5) == pytest.approx(1.5)


def test_interpolation_wraps_across_north():
    profile = _profile([0.0, 90.0, 180.0, 270.0], [1.0, 3.0, -1.0, 5.0])
    # Between the last sample (270 -> 5.0) and the first (360 = 0 -> 1.0).
    assert profile.elevation_at(315.0) == pytest.approx(3.0)
    assert profile.elevation_at(359.0) == pytest.approx(1.0 + 4.0 / 90.0)
    assert profile.elevation_at(360.0) == profile.elevation_at(0.0)
    assert profile.elevation_at(405.0) == pytest.approx(profile.elevation_at(45.0))
    assert profile.elevation_at(-45.0) == pytest.approx(profile.elevation_at(315.0))
    assert profile.elevation_at(-1e-20) == pytest.approx(1.0)


def test_interpolation_on_half_degree_grid_matches_unevenly_spaced_copy():
    count = 720
    azimuths = [index * 0.5 for index in range(count)]
    elevations = [math.sin(math.radians(azimuth)) * 3.0 + math.cos(math.radians(7 * azimuth)) for azimuth in azimuths]
    even = _profile(azimuths, elevations)
    # The same skyline with the sample at 50.0 removed takes the general (search) path. Away from the
    # gap that leaves (49.5 to 50.5) both must give the same values.
    uneven = _profile(azimuths[:100] + azimuths[101:], elevations[:100] + elevations[101:])
    assert even._uniform_step_deg == pytest.approx(0.5)
    assert uneven._uniform_step_deg is None
    for azimuth in (0.0, 0.25, 10.1, 49.49, 50.51, 179.75, 271.3, 359.5, 359.75, 359.999):
        assert even.elevation_at(azimuth) == pytest.approx(uneven.elevation_at(azimuth), abs=1e-12)
    assert even.elevation_at(359.75) == pytest.approx((elevations[-1] + elevations[0]) / 2)


def test_unevenly_spaced_profile_that_does_not_start_at_zero():
    profile = _profile([10.0, 100.0, 350.0], [0.0, 9.0, 2.0])
    assert profile.elevation_at(55.0) == pytest.approx(4.5)
    # The gap across north runs from 350 (2.0) to 370 = 10 (0.0).
    assert profile.elevation_at(0.0) == pytest.approx(1.0)
    assert profile.elevation_at(355.0) == pytest.approx(1.5)
    assert profile.elevation_at(5.0) == pytest.approx(0.5)


def test_single_sample_profile_is_level():
    assert _profile([0.0], [-0.1]).elevation_at(123.0) == -0.1


def test_interpolate_skyline_from_bare_arrays():
    assert interpolate_skyline([0.0, 180.0], [0.0, 2.0], 270.0) == pytest.approx(1.0)


@pytest.mark.parametrize(
    ("azimuths", "elevations"),
    [
        ([0.0, 90.0], [1.0]),  # lengths differ
        ([], []),  # empty
        ([0.0, 360.0], [1.0, 1.0]),  # 360 is outside [0, 360)
        ([-1.0, 90.0], [1.0, 1.0]),  # negative azimuth
        ([90.0, 0.0], [1.0, 1.0]),  # not increasing
        ([0.0, 0.0], [1.0, 1.0]),  # repeated azimuth
        ([0.0, 90.0], [1.0, 91.0]),  # elevation above 90
        ([0.0, 90.0], [1.0, math.nan]),  # NaN
        ([0.0, 90.0], [1.0, math.inf]),  # infinity
    ],
)
def test_profiles_outside_the_conventions_are_refused(azimuths, elevations):
    with pytest.raises(ProfileError):
        _profile(azimuths, elevations)


@pytest.mark.parametrize(
    "override",
    [
        {"latitude_deg": math.nan},
        {"latitude_deg": 91.0},
        {"longitude_deg": math.inf},
        {"site_height_m": math.nan},
        {"observer_height_m": -1.0},
        {"observer_height_m": math.inf},
        {"max_distance_m": (math.nan, 10.0)},
    ],
)
def test_site_fields_outside_the_conventions_are_refused(override):
    with pytest.raises(ProfileError):
        _profile([0.0, 90.0], [1.0, 1.0], **override)


def test_max_distance_must_match_the_azimuths():
    with pytest.raises(ProfileError):
        _profile([0.0, 90.0], [1.0, 1.0], max_distance_m=(100.0,))


def test_non_finite_azimuth_lookup_is_refused():
    with pytest.raises(ValueError):
        _profile([0.0, 90.0], [1.0, 1.0]).elevation_at(math.nan)


def test_json_round_trip(tmp_path):
    profile = _profile(
        [0.0, 120.0, 240.0],
        [0.5, -0.25, 2.0],
        max_distance_m=(100.0, None, 5000.0),
        metadata={"citation": "test", "coverage": {"ran_out_of_data": [False, True, False]}},
    )
    path = tmp_path / "test.json"
    path.write_text(json.dumps(profile.to_json_dict()), encoding="utf-8")
    loaded = load_profile(path)
    assert loaded == profile
    assert loaded.metadata == profile.metadata
    assert load_site_profile("test", tmp_path) == profile


@pytest.mark.parametrize("site_id", ["../secret", "a/b", "a\\b", "", " x", "x.json", "C:zz", "Nobile", "a b", "-x"])
def test_site_ids_that_are_not_plain_names_are_refused(site_id, tmp_path):
    with pytest.raises(ProfileError):
        load_site_profile(site_id, tmp_path)


@pytest.mark.parametrize(
    "change",
    [
        lambda document: document.update(format="something-else"),
        lambda document: document.update(format_version=99),
        lambda document: document.pop("horizon_elevation_deg"),
        lambda document: document.pop("site_height_m"),
        lambda document: document.update(azimuth_deg=None),
        lambda document: document.update(horizon_elevation_deg=["high", 2.0]),
        lambda document: document.update(site_height_m="unknown"),
        lambda document: document.update(max_distance_m=[100.0, -5.0]),
    ],
)
def test_broken_profile_files_are_refused(change, tmp_path):
    document = _profile([0.0, 180.0], [1.0, 2.0]).to_json_dict()
    change(document)
    path = tmp_path / "broken.json"
    path.write_text(json.dumps(document), encoding="utf-8")
    with pytest.raises(ProfileError):
        load_profile(path)


def test_a_json_array_is_not_a_profile(tmp_path):
    path = tmp_path / "list.json"
    path.write_text("[1, 2, 3]", encoding="utf-8")
    with pytest.raises(ProfileError):
        load_profile(path)


def test_smooth_sphere_reference_is_the_geometric_dip_everywhere():
    profile = HorizonProfile.smooth_sphere(site_height_m=1500.0, observer_height_m=2.0)
    radius = 1_737_400.0 + 1500.0
    expected = -math.degrees(math.acos(radius / (radius + 2.0)))
    assert len(profile.azimuth_deg) == 720
    assert profile.azimuth_deg[0] == 0.0 and profile.azimuth_deg[-1] == 359.5
    assert set(profile.horizon_elevation_deg) == {geometric_dip_deg(radius + 2.0, radius)}
    assert profile.min_elevation_deg == pytest.approx(expected, abs=1e-12)
    assert profile.elevation_at(123.456) == pytest.approx(expected, abs=1e-12)


def test_profile_converts_to_the_contract_skyline():
    skyline = _profile([0.0, 90.0, 180.0, 270.0], [1.0, 3.0, -1.0, 5.0]).to_terrain_skyline()
    assert isinstance(skyline, TerrainSkyline)
    assert skyline.azimuth_deg == [0.0, 90.0, 180.0, 270.0]
    assert skyline.horizon_elevation_deg == [1.0, 3.0, -1.0, 5.0]


def test_summary_properties():
    profile = _profile([0.0, 90.0, 180.0, 270.0], [1.0, 3.0, -1.0, 5.0])
    assert (profile.min_elevation_deg, profile.max_elevation_deg, profile.mean_elevation_deg) == (-1.0, 5.0, 2.0)


def test_the_six_site_profiles_are_stored():
    # Without this, an empty folder would leave the per-file checks below with nothing to check.
    stored = {path.stem for path in STORED_PROFILES}
    expected = {"shackleton-ridge", "nobile", "im-2-athena", "im-1-odysseus", "draper-cp12", "chandrayaan-3"}
    assert expected <= stored


def test_far_skyline_from_shackleton_ridge_is_mons_mouton():
    # Mons Mouton (IAU gazetteer: 84.6 S, 31 E) rises 6 km above the datum some 173 km from the site.
    # On the polar map (x = rho sin(lon), y = rho cos(lon)) its bearing from the site works out to about
    # 193 degrees. The only skyline points farther than 150 km must lie in that direction. This uses the
    # stored profile alone, so it checks the direction of the real terrain wherever the tests run.
    stored = load_site_profile("shackleton-ridge")

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


@pytest.mark.parametrize("path", STORED_PROFILES, ids=lambda path: path.stem)
def test_stored_profile_follows_the_contract_and_names_its_sources(path):
    profile = load_profile(path)
    document = json.loads(path.read_text(encoding="utf-8"))

    assert profile.site_id == path.stem
    assert len(profile.azimuth_deg) == 720
    assert profile.azimuth_deg == tuple(index * 0.5 for index in range(720))
    assert profile.observer_height_m == 2.0
    assert -90.0 <= profile.latitude_deg <= -60.0  # the elevation models cover 60 S to the pole
    # The contract's TerrainSkyline accepts it (azimuth 0..360, elevation -90..90, equal lengths).
    assert len(profile.to_terrain_skyline().azimuth_deg) == 720

    # Every skyline point is beyond the skipped near field and within the walk's range.
    sampling = document["sampling"]
    coverage = document["coverage"]
    assert sampling["near_skip_pixels"] == 1.5
    for distance, source in zip(profile.max_distance_m, coverage["max_source"], strict=True):
        if source == -1:
            assert distance is None
        else:
            assert sampling["first_sample_m"] <= distance <= sampling["max_range_m"]
    for key in ("ran_out_of_data", "reached_max_range", "max_source", "at_first_sample", "stop_distance_m"):
        assert len(coverage[key]) == 720
    # The skyline points that sit on the edge of the skipped near field are flagged and counted.
    at_edge = [distance == sampling["first_sample_m"] for distance in profile.max_distance_m]
    assert coverage["at_first_sample"] == at_edge
    assert document["summary"]["rays_with_skyline_at_first_sample"] == sum(at_edge)
    assert sampling["near_step_fraction"] == 0.005 and sampling["near_step_floor_m"] == 0.5

    # Provenance: NASA LOLA files of PGDA product 90 with their citation, and nothing machine-specific.
    assert "10.3847/PSJ/acf3e1" in document["citation"]
    assert "pgda.gsfc.nasa.gov/products/90" in document["citation"]
    files = [model["file"] for model in document["elevation_models"]]
    assert files and set(files) <= {"LDEM_80S_40MPP_ADJ.TIF", "LDEM_60S_240MPP_ADJ.TIF"}
    assert all(len(model["sha256"]) == 64 for model in document["elevation_models"])
    assert document["coarse"] == (files == ["LDEM_60S_240MPP_ADJ.TIF"])
    assert document["reference_radius_m"] == 1_737_400.0
    assert document["computed_utc"].endswith("Z")
    text = path.read_text(encoding="utf-8")
    assert "D:" not in text and "\\\\" not in text and "Users" not in text
