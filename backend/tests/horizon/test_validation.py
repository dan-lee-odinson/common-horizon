"""The validation script's bookkeeping, its stored results, and (where the kernels are present) its SPICE use.

The SPICE tests need spiceypy and the four NAIF kernels in the folder named by the environment
variable CH_NAIF_DIR; they are skipped otherwise.
"""

import json
import math
import os
from pathlib import Path

import pytest

from app.physics.horizon.profile import DEFAULT_PROFILE_DIR, HorizonProfile, load_profile
from scripts.validate_horizon import (
    KERNELS,
    azimuth_elevation_deg,
    longest_run_hours,
    skyline_difference,
    summarise,
    track_difference,
    utc_moments,
)

VALIDATION_DIR = DEFAULT_PROFILE_DIR.parent / "horizon_validation"
RESULTS_FILE = VALIDATION_DIR / "results_2027.json"


def test_longest_run():
    assert longest_run_hours([], 1.0) == 0.0
    assert longest_run_hours([False, False], 1.0) == 0.0
    assert longest_run_hours([True, True, False, True, True, True], 1.0) == 3.0
    assert longest_run_hours([True, True, True, False, True], 0.5) == 1.5
    assert longest_run_hours([True] * 10, 2.0) == 20.0


def test_summary_of_a_short_series():
    sun = [0.0, 0.0, 0.5, 1.0, 0.0, 0.0, 0.0, 1.0]
    earth = [1.0, 1.0, 1.0, 0.25, 0.0, 0.0, 1.0, 1.0]
    summary = summarise(sun, earth, step_hours=1.0)
    assert summary["sun_any_part_visible_percent"] == 37.5  # 3 of 8 samples
    assert summary["sun_whole_disc_visible_percent"] == 25.0
    assert summary["sun_mean_disc_fraction_percent"] == pytest.approx(31.25)
    assert summary["longest_dark_period_hours"] == 3.0
    assert summary["earth_any_part_visible_percent"] == 75.0
    assert summary["earth_whole_disc_visible_percent"] == 62.5
    assert summary["longest_earth_outage_hours"] == 2.0


def test_summary_refuses_mismatched_series():
    with pytest.raises(ValueError):
        summarise([1.0], [1.0, 0.0], 1.0)
    with pytest.raises(ValueError):
        summarise([], [], 1.0)


def test_azimuth_and_elevation_in_a_local_frame():
    up, east, north = (0.0, 0.0, 1.0), (1.0, 0.0, 0.0), (0.0, 1.0, 0.0)
    assert azimuth_elevation_deg(north, up, east, north) == pytest.approx((0.0, 0.0))
    assert azimuth_elevation_deg(east, up, east, north) == pytest.approx((90.0, 0.0))
    assert azimuth_elevation_deg((0.0, -5.0, 0.0), up, east, north) == pytest.approx((180.0, 0.0))
    assert azimuth_elevation_deg((-2.0, 0.0, 0.0), up, east, north) == pytest.approx((270.0, 0.0))
    azimuth, elevation = azimuth_elevation_deg((1.0, 1.0, math.sqrt(2.0)), up, east, north)
    assert (azimuth, elevation) == pytest.approx((45.0, 45.0))
    assert azimuth_elevation_deg((1.0, 1.0, -math.sqrt(2.0)), up, east, north)[1] == pytest.approx(-45.0)
    assert 0.0 <= azimuth_elevation_deg((-1e-18, 1.0, 0.0), up, east, north)[0] < 360.0


def test_skyline_difference():
    first = HorizonProfile.smooth_sphere(site_height_m=0.0)
    same = skyline_difference(first, first)
    assert same == {"mean_deg": 0.0, "rms_deg": 0.0, "max_abs_deg": 0.0, "median_abs_deg": 0.0}
    raised = HorizonProfile(
        site_id="raised",
        latitude_deg=0.0,
        longitude_deg=0.0,
        site_height_m=0.0,
        observer_height_m=2.0,
        azimuth_deg=first.azimuth_deg,
        horizon_elevation_deg=tuple(value + 1.0 for value in first.horizon_elevation_deg),
    )
    difference = skyline_difference(raised, first)
    assert difference["mean_deg"] == pytest.approx(1.0)
    assert difference["rms_deg"] == pytest.approx(1.0)
    assert difference["max_abs_deg"] == pytest.approx(1.0)


def test_utc_moments_cover_the_year_in_even_steps():
    moments = utc_moments(2027, 1.0, 8760)
    assert moments[0].isoformat() == "2027-01-01T00:00:00+00:00"
    assert moments[-1].isoformat() == "2027-12-31T23:00:00+00:00"
    gaps = {(later - earlier).total_seconds() for earlier, later in zip(moments, moments[1:], strict=False)}
    assert gaps == {3600.0}
    assert utc_moments(2027, 0.5, 3)[2].isoformat() == "2027-01-01T01:00:00+00:00"


def test_track_difference_measures_azimuth_on_the_sky_and_wraps():
    first = [(359.9, 0.0, 0.27), (10.0, 60.0, 0.27)]
    second = [(0.1, 0.5, 0.27), (11.0, 60.0, 0.27)]
    difference = track_difference(first, second)
    assert difference["max_elevation_difference_deg"] == pytest.approx(0.5)
    # 1 degree of azimuth at 60 degrees elevation is 0.5 degrees on the sky; 359.9 to 0.1 is 0.2, not 359.8.
    assert difference["max_azimuth_difference_on_sky_deg"] == pytest.approx(0.5)


@pytest.mark.skipif(not RESULTS_FILE.is_file(), reason="no stored validation results")
def test_stored_validation_results_belong_to_the_stored_profiles():
    results = json.loads(RESULTS_FILE.read_text(encoding="utf-8"))
    assert results["frame"] == "MOON_ME"
    # Positions come either from the physics engine's functions (its own aberration setting) or from
    # this script's SPICE calls (LT+S); the file says which.
    assert results["aberration_correction"] in ("NONE", "LT+S")
    assert results["positions_source"]
    assert results["kernels"] == list(KERNELS)
    assert results["samples"] == 8760 and results["year"] == 2027
    assert results["sites"], "no sites in the results"
    for site_id, site in results["sites"].items():
        profile = load_profile(DEFAULT_PROFILE_DIR / f"{site_id}.json")
        # The results were made from the profile that is stored now, not from an older one.
        assert site["site_height_m"] == profile.site_height_m
        assert site["skyline_min_deg"] == pytest.approx(profile.min_elevation_deg, abs=1e-5)
        assert site["skyline_max_deg"] == pytest.approx(profile.max_elevation_deg, abs=1e-5)
        assert site["skyline_mean_deg"] == pytest.approx(profile.mean_elevation_deg, abs=1e-5)
        comparison = load_profile(VALIDATION_DIR / f"{site_id}.240m.json")
        assert comparison.metadata["coarse"] is True
        assert (comparison.latitude_deg, comparison.longitude_deg) == (profile.latitude_deg, profile.longitude_deg)
        assert site["comparison_site_height_m"] == comparison.site_height_m
        for row in site["results"].values():
            assert 0.0 <= row["sun_any_part_visible_percent"] <= 100.0
            assert row["sun_mean_disc_fraction_percent"] <= row["sun_any_part_visible_percent"]
            assert row["sun_whole_disc_visible_percent"] <= row["sun_mean_disc_fraction_percent"]
            assert row["earth_whole_disc_visible_percent"] <= row["earth_any_part_visible_percent"] <= 100.0
            assert 0.0 <= row["longest_dark_period_hours"] <= 8760.0


# --- with SPICE ----------------------------------------------------------------------------------------


@pytest.fixture(scope="module")
def spice():
    spiceypy = pytest.importorskip("spiceypy")  # noqa: F841
    kernel_dir = os.environ.get("CH_NAIF_DIR")
    if not kernel_dir or not all((Path(kernel_dir) / name).is_file() for name in KERNELS):
        pytest.skip("set CH_NAIF_DIR to a folder holding the four NAIF kernels to run the SPICE checks")
    from scripts.validate_horizon import load_kernels

    loaded = load_kernels(Path(kernel_dir))
    yield loaded
    loaded.kclear()


def test_the_real_sky_has_the_moons_known_seasons_and_librations(spice):
    from scripts.validate_horizon import hourly_epochs, sky_sanity

    epochs = hourly_epochs(spice, 2027, 1.0)
    assert len(epochs) == 8760
    assert epochs[1] - epochs[0] == 3600.0
    sanity = sky_sanity(spice, epochs)
    # The Moon's equator is tilted 1.54 degrees to the ecliptic: the Sun never strays further from it.
    assert -1.6 < sanity["subsolar_latitude_min_deg"] < -1.5
    assert 1.5 < sanity["subsolar_latitude_max_deg"] < 1.6
    # Libration: the Earth wanders about 7 degrees in latitude and 8 in longitude around (0, 0).
    assert 6.0 < sanity["subearth_latitude_max_deg"] < 7.0
    assert 6.5 < sanity["subearth_longitude_max_deg"] < 8.2


def test_sun_from_the_south_pole_circles_the_horizon_once_a_month(spice):
    from scripts.validate_horizon import SUN_RADIUS_KM, body_track, hourly_epochs

    pole = HorizonProfile.smooth_sphere(site_id="pole", latitude_deg=-90.0, longitude_deg=0.0)
    epochs = hourly_epochs(spice, 2027, 1.0)[: 24 * 60]
    track = body_track(spice, "SUN", SUN_RADIUS_KM, pole, epochs)
    elevations = [sample[1] for sample in track]
    assert -1.6 < min(elevations) and max(elevations) < 1.6
    assert all(0.25 < sample[2] < 0.28 for sample in track)  # the Sun's angular radius, about 0.27 degrees
    # With "north" along longitude 0 at the pole, the azimuth of a body equals its east longitude. The
    # Sun moves westward (as in Earth's southern hemisphere, right to left), so its azimuth falls,
    # by 360 degrees per synodic month (29.53 days).
    steps = [((b[0] - a[0] + 180.0) % 360.0) - 180.0 for a, b in zip(track, track[1:], strict=False)]
    assert all(step < 0 for step in steps)
    assert -sum(steps[: 24 * 29]) < 360.0 < -sum(steps[: 24 * 30])
