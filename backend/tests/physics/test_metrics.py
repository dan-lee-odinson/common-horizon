"""Metrics from a sampled visibility series (app.physics.metrics): pure arithmetic, no physics."""

from datetime import UTC, datetime, timedelta

import pytest

from app.physics.metrics import interval_runs, summarise

T0 = datetime(2027, 1, 1, tzinfo=UTC)


def _times(*offsets_h: float) -> list[datetime]:
    return [T0 + timedelta(hours=h) for h in offsets_h]


def test_sample_and_hold_weights_each_interval_by_its_duration():
    # Hourly samples plus a 30-minute final interval. The Sun is up for the first two intervals.
    times = _times(0, 1, 2, 3, 3.5)
    sun = [1.0, 0.4, 0.0, 0.0, 1.0]  # the last sample starts no interval, so its state never counts
    earth = [0.0, 0.0, 0.0, 1.0, 0.0]

    metrics, windows = summarise(times, sun, earth, sky_visibility_fraction=None)

    assert metrics.sunlight_hours == pytest.approx(2.0)
    assert metrics.sunlight_percentage == pytest.approx(100 * 2.0 / 3.5)
    assert metrics.longest_sunlight_hours == pytest.approx(2.0)
    assert metrics.longest_darkness_hours == pytest.approx(1.5)
    # Earth is up only for the short final interval, which counts 0.5 h, not a full step.
    assert metrics.earth_visibility_hours == pytest.approx(0.5)
    assert [(w.start_utc, w.end_utc, w.duration_hours) for w in windows] == [(times[3], times[4], 0.5)]
    assert metrics.sky_visibility_fraction is None


def test_partial_disc_counts_as_visible_and_zero_does_not():
    times = _times(0, 1, 2)
    metrics, _ = summarise(times, [1e-9, 0.0, 0.0], [0.0, 0.0, 0.0], None)
    assert metrics.sunlight_hours == pytest.approx(1.0)
    assert metrics.earth_visibility_hours == 0.0


def test_sunset_and_earthset_are_the_first_sample_after_a_body_visible_at_start():
    times = _times(0, 1, 2, 3)
    metrics, _ = summarise(times, [1.0, 1.0, 0.0, 1.0], [0.0, 1.0, 0.0, 0.0], 0.8)
    assert metrics.time_to_sunset_hours == pytest.approx(2.0)
    assert metrics.sunset_utc == times[2]
    # Earth is down at the start, so there is no "time to Earthset".
    assert metrics.time_to_earthset_hours is None
    assert metrics.earthset_utc is None
    assert metrics.sky_visibility_fraction == 0.8


def test_always_visible_gives_100_percent_exactly_and_no_set():
    times = [T0 + timedelta(seconds=7 * k) for k in range(1000)] + [T0 + timedelta(seconds=7 * 999 + 3)]
    ones = [1.0] * len(times)
    metrics, windows = summarise(times, ones, ones, 1.0)
    assert metrics.sunlight_percentage == 100.0
    assert metrics.earth_visibility_percentage == 100.0
    assert metrics.longest_darkness_hours == 0.0
    assert metrics.time_to_sunset_hours is None
    assert len(windows) == 1
    assert windows[0].start_utc == times[0]
    assert windows[0].end_utc == times[-1]


def test_interval_runs_close_at_the_first_false_flag():
    times = _times(0, 1, 2, 3, 4)
    assert interval_runs(times, [True, True, False, True, True]) == [(0, 2), (3, 4)]
    assert interval_runs(times, [False, False, False, False, True]) == []


@pytest.mark.parametrize(
    ("times", "sun", "earth"),
    [
        (_times(0), [1.0], [1.0]),  # a single sample has no interval
        (_times(0, 1), [1.0], [1.0, 1.0]),  # misaligned arrays
        (_times(1, 0), [1.0, 1.0], [1.0, 1.0]),  # time running backwards
    ],
)
def test_bad_series_are_rejected(times, sun, earth):
    with pytest.raises(ValueError):
        summarise(times, sun, earth, None)
