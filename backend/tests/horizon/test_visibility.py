"""Disc fraction above a skyline and the four obstruction states (pure Python)."""

import math

import pytest

from app.models.results import ObstructionState
from app.physics.horizon.profile import HorizonProfile
from app.physics.horizon.visibility import (
    body_visibility,
    disc_fraction_above_skyline,
    obstruction_state,
)

SUN_RADIUS_DEG = 0.2666
EARTH_RADIUS_DEG = 0.95


def _level(elevation_deg: float):
    return lambda azimuth_deg: elevation_deg


def _segment_fraction(x: float) -> float:
    """Area fraction of a unit disc above a horizontal line ``x`` radii below its centre (exact)."""
    return (math.pi - math.acos(x) + x * math.sqrt(1.0 - x * x)) / math.pi


def _profile(elevations, step=None) -> HorizonProfile:
    count = len(elevations)
    return HorizonProfile(
        site_id="test",
        latitude_deg=-89.0,
        longitude_deg=0.0,
        site_height_m=0.0,
        observer_height_m=2.0,
        azimuth_deg=tuple(index * 360.0 / count for index in range(count)),
        horizon_elevation_deg=tuple(elevations),
    )


def test_disc_well_above_the_skyline_is_fully_visible():
    assert disc_fraction_above_skyline(_level(1.0), 40.0, 5.0, SUN_RADIUS_DEG) == 1.0


def test_disc_well_below_the_skyline_is_hidden():
    assert disc_fraction_above_skyline(_level(1.0), 40.0, -3.0, SUN_RADIUS_DEG) == 0.0


def test_disc_centred_on_a_level_skyline_is_half_visible():
    assert disc_fraction_above_skyline(_level(1.0), 40.0, 1.0, SUN_RADIUS_DEG) == pytest.approx(0.5, abs=1e-12)
    assert disc_fraction_above_skyline(_level(-0.087), 300.0, -0.087, EARTH_RADIUS_DEG) == pytest.approx(0.5, abs=1e-12)


def test_disc_just_touching_the_skyline():
    assert disc_fraction_above_skyline(_level(1.0), 0.0, 1.0 + SUN_RADIUS_DEG, SUN_RADIUS_DEG) == 1.0
    assert disc_fraction_above_skyline(_level(1.0), 0.0, 1.0 - SUN_RADIUS_DEG, SUN_RADIUS_DEG) == 0.0


@pytest.mark.parametrize("x", [-0.9, -0.5, -0.1, 0.25, 0.5, 0.8])
def test_partial_fraction_matches_the_circular_segment(x):
    # Centre x radii above a level skyline: the visible part is a circular segment with a closed form.
    elevation = 2.0 + x * SUN_RADIUS_DEG
    assert disc_fraction_above_skyline(_level(2.0), 10.0, elevation, SUN_RADIUS_DEG) == pytest.approx(
        _segment_fraction(x), abs=2e-3
    )
    assert disc_fraction_above_skyline(_level(2.0), 10.0, elevation, SUN_RADIUS_DEG, strips=4000) == pytest.approx(
        _segment_fraction(x), abs=1e-5
    )


def test_fraction_rises_steadily_as_the_disc_rises():
    fractions = [
        disc_fraction_above_skyline(_level(0.0), 0.0, -0.3 + 0.01 * step, SUN_RADIUS_DEG) for step in range(61)
    ]
    assert fractions[0] == 0.0 and fractions[-1] == 1.0
    assert all(later >= earlier for earlier, later in zip(fractions, fractions[1:], strict=False))


def test_each_strip_is_compared_with_the_skyline_at_its_own_azimuth():
    # A cliff edge exactly under the disc's centre: everything at lower azimuth is blocked.
    cliff = lambda azimuth_deg: 30.0 if azimuth_deg < 100.0 else -30.0  # noqa: E731
    assert disc_fraction_above_skyline(cliff, 100.0, 0.0, SUN_RADIUS_DEG) == pytest.approx(0.5, abs=1e-12)
    # The same cliff a quarter of the disc's width to the left hides only the segment beyond x = -r/2.
    assert disc_fraction_above_skyline(cliff, 100.0 + SUN_RADIUS_DEG / 2, 0.0, SUN_RADIUS_DEG) == pytest.approx(
        _segment_fraction(0.5), abs=2e-3
    )


def test_disc_width_in_azimuth_grows_as_one_over_cos_elevation():
    # A wall that begins exactly one disc radius of AZIMUTH to the right of the disc's centre.
    wall = lambda azimuth_deg: 90.0 if azimuth_deg >= 50.0 + EARTH_RADIUS_DEG else -90.0  # noqa: E731
    # Low in the sky the disc is one radius of azimuth wide on each side: it just clears the wall.
    assert disc_fraction_above_skyline(wall, 50.0, 0.0, EARTH_RADIUS_DEG) == 1.0
    # At 60 degrees elevation, cos = 0.5: the disc spans two radii of azimuth on each side, so the wall
    # starts half a radius of sky from the centre and hides the segment beyond it.
    assert disc_fraction_above_skyline(wall, 50.0, 60.0, EARTH_RADIUS_DEG) == pytest.approx(
        _segment_fraction(0.5), abs=2e-3
    )
    # The same happens below the horizontal: cos(-60) = cos(60).
    assert disc_fraction_above_skyline(wall, 50.0, -60.0, EARTH_RADIUS_DEG) == pytest.approx(
        _segment_fraction(0.5), abs=2e-3
    )


def test_disc_at_the_zenith_does_not_fail():
    assert disc_fraction_above_skyline(_level(1.0), 0.0, 90.0, SUN_RADIUS_DEG) == 1.0
    assert disc_fraction_above_skyline(_level(1.0), 0.0, -90.0, SUN_RADIUS_DEG) == 0.0


def test_disc_straddling_north_uses_the_wrapped_skyline():
    # Skyline high from 0 to 180, low from 180 to 360; the disc sits on azimuth 0 = 360.
    elevations = [10.0 if index < 360 else -10.0 for index in range(720)]
    profile = _profile(elevations)
    result = body_visibility(profile, 0.0, 0.0, EARTH_RADIUS_DEG)
    # Left half (azimuth just below 360) is clear, right half is blocked; the half-degree ramp between
    # the last and first samples is not symmetric about 0, so allow for it.
    assert 0.25 < result.fraction < 0.6
    assert result.state is ObstructionState.PARTIAL
    assert body_visibility(profile, 360.0, 0.0, EARTH_RADIUS_DEG).fraction == pytest.approx(result.fraction)
    assert body_visibility(profile, -360.0, 0.0, EARTH_RADIUS_DEG).fraction == pytest.approx(result.fraction)


@pytest.mark.parametrize(
    ("arguments", "message"),
    [
        ((_level(0.0), 0.0, 0.0, 0.0), "angular_radius_deg"),
        ((_level(0.0), 0.0, 0.0, -1.0), "angular_radius_deg"),
        ((_level(0.0), math.nan, 0.0, 0.3), "finite"),
        ((_level(0.0), 0.0, math.inf, 0.3), "finite"),
    ],
)
def test_bad_inputs_are_refused(arguments, message):
    with pytest.raises(ValueError, match=message):
        disc_fraction_above_skyline(*arguments)
    with pytest.raises(ValueError, match="strips"):
        disc_fraction_above_skyline(_level(0.0), 0.0, 0.0, 0.3, strips=0)


# --- the four states --------------------------------------------------------------------------------


def test_state_visible_when_the_whole_disc_clears_the_skyline():
    profile = _profile([1.0] * 720)
    result = body_visibility(profile, 200.0, 3.0, SUN_RADIUS_DEG)
    assert (result.fraction, result.state) == (1.0, ObstructionState.VISIBLE)


def test_state_partial_when_the_skyline_cuts_the_disc():
    profile = _profile([1.0] * 720)
    result = body_visibility(profile, 200.0, 1.1, SUN_RADIUS_DEG)
    assert 0.5 < result.fraction < 1.0
    assert result.state is ObstructionState.PARTIAL


def test_state_terrain_blocked_when_above_the_horizontal_but_behind_terrain():
    profile = _profile([5.0] * 720)
    result = body_visibility(profile, 200.0, 2.0, SUN_RADIUS_DEG)
    assert (result.fraction, result.state) == (0.0, ObstructionState.TERRAIN_BLOCKED)


def test_state_below_horizon_when_under_the_horizontal_and_hidden():
    profile = _profile([-0.0869] * 720)
    result = body_visibility(profile, 200.0, -2.0, SUN_RADIUS_DEG)
    assert (result.fraction, result.state) == (0.0, ObstructionState.BELOW_HORIZON)


def test_body_below_zero_elevation_is_visible_where_the_skyline_dips_lower():
    # From a summit the skyline lies below the horizontal, so a body at negative elevation still shows.
    profile = _profile([-3.0] * 720)
    result = body_visibility(profile, 10.0, -1.0, SUN_RADIUS_DEG)
    assert (result.fraction, result.state) == (1.0, ObstructionState.VISIBLE)
    partial = body_visibility(profile, 10.0, -3.0, SUN_RADIUS_DEG)
    assert partial.fraction == pytest.approx(0.5, abs=1e-12)
    assert partial.state is ObstructionState.PARTIAL


def test_the_fraction_decides_before_the_elevation_does():
    assert obstruction_state(1.0, -5.0, 0.27) is ObstructionState.VISIBLE
    assert obstruction_state(0.4, -5.0, 0.27) is ObstructionState.PARTIAL
    assert obstruction_state(1e-9, 5.0, 0.27) is ObstructionState.PARTIAL
    assert obstruction_state(0.0, 5.0, 0.27) is ObstructionState.TERRAIN_BLOCKED
    assert obstruction_state(0.0, -5.0, 0.27) is ObstructionState.BELOW_HORIZON


def test_hidden_disc_with_its_upper_limb_above_the_horizontal_is_terrain_blocked():
    # Centre just below 0 but the upper limb above it: part of the disc is above the horizontal plane.
    assert obstruction_state(0.0, -0.1, 0.27) is ObstructionState.TERRAIN_BLOCKED
    assert obstruction_state(0.0, -0.27, 0.27) is ObstructionState.BELOW_HORIZON
    assert obstruction_state(0.0, -0.3, 0.27) is ObstructionState.BELOW_HORIZON


def test_states_are_the_contracts_four_values():
    assert {state.value for state in ObstructionState} == {"visible", "partial", "terrain_blocked", "below_horizon"}


def test_shortcut_for_clear_and_hidden_discs_agrees_with_the_strip_sum():
    elevations = [2.0 * math.sin(math.radians(index * 0.5 * 3)) for index in range(720)]
    profile = _profile(elevations)
    for azimuth in (0.0, 33.3, 90.0, 181.25, 359.9):
        for elevation in (-4.0, -2.3, -1.0, 0.0, 0.7, 1.9, 2.2, 2.3, 4.0):
            for radius in (SUN_RADIUS_DEG, EARTH_RADIUS_DEG):
                direct = disc_fraction_above_skyline(profile.elevation_at, azimuth, elevation, radius)
                assert body_visibility(profile, azimuth, elevation, radius).fraction == pytest.approx(direct, abs=1e-15)


def test_body_visibility_refuses_a_bad_radius():
    with pytest.raises(ValueError):
        body_visibility(_profile([0.0] * 4), 0.0, 0.0, 0.0)
