"""The synthetic fixture must be deterministic, self-consistent and clearly labelled.

These tests do NOT validate physics. They only check that the placeholder data
has the right shape and behaves sensibly enough for frontend development.
"""

from datetime import UTC, datetime

import pytest

from app.physics.interface import SimulationRequest
from app.physics.synthetic import SyntheticPhysicsEngine, _disc_fraction
from app.timegrid import build_time_grid, count_samples

START = datetime(2027, 1, 15, tzinfo=UTC)


def _request(lat=0.0, lon=0.0, days=30.0, step=3600, **overrides) -> SimulationRequest:
    return SimulationRequest(
        latitude_deg=lat,
        longitude_deg=lon,
        altitude_m=None,
        observer_height_m=0.0,
        start_utc=START,
        duration_s=days * 86_400,
        time_step_s=step,
        **overrides,
    )


@pytest.mark.parametrize(
    "duration_s, step_s, expected", [(86_400, 3600, 25), (90_000, 3600, 26), (3600, 3600, 2), (100, 60, 3)]
)
def test_time_grid_includes_end_and_matches_count(duration_s, step_s, expected):
    grid = build_time_grid(START, duration_s, step_s)

    assert len(grid) == count_samples(duration_s, step_s) == expected
    assert (grid[-1] - grid[0]).total_seconds() == duration_s


def test_engine_is_flagged_synthetic():
    assert SyntheticPhysicsEngine.info.is_synthetic is True


def test_output_is_deterministic():
    engine = SyntheticPhysicsEngine()

    assert engine.simulate(_request()) == engine.simulate(_request())


def test_near_side_sees_earth_far_side_does_not():
    engine = SyntheticPhysicsEngine()

    near = engine.simulate(_request(lat=0, lon=0)).metrics
    far = engine.simulate(_request(lat=0, lon=180)).metrics

    assert near.earth_visibility_percentage == 100
    assert far.earth_visibility_percentage == 0
    assert far.time_to_earthset_hours is None


def test_equatorial_site_has_day_and_night_over_a_lunation():
    metrics = SyntheticPhysicsEngine().simulate(_request(lat=0, lon=0, days=30)).metrics

    assert 40 < metrics.sunlight_percentage < 60
    assert metrics.longest_darkness_hours > 0


def test_metrics_only_mode_skips_timeseries():
    result = SyntheticPhysicsEngine().simulate(_request(days=2, include_timeseries=False))

    assert result.timeseries is None
    assert result.metrics.sunlight_hours >= 0


@pytest.mark.parametrize("elevation, expected", [(1.0, 1.0), (-1.0, 0.0), (0.0, 0.5)])
def test_disc_fraction(elevation, expected):
    assert _disc_fraction(elevation, horizon_deg=0.0, radius_deg=0.25) == pytest.approx(expected)
