"""Tests for Sun/Earth azimuth and elevation calculations."""

from datetime import datetime, timezone

import pytest

from app.physics.engine import ephemeris


def test_ephemeris_returns_expected_samples(monkeypatch):
    start = datetime(2026, 11, 14, 12, 0, tzinfo=timezone.utc)

    # Site at (0°, 0°): local up is +X and east is +Y.
    monkeypatch.setattr(
        ephemeris,
        "get_sun_position",
        lambda time: [ephemeris.MOON_RADIUS_KM + 1000, 0, 0],
    )
    monkeypatch.setattr(
        ephemeris,
        "get_earth_position",
        lambda time: [ephemeris.MOON_RADIUS_KM, 1000, 0],
    )

    results = ephemeris.compute_sun_earth_angles(
        latitude_deg=0,
        longitude_deg=0,
        start_time=start,
        duration_seconds=60,
        time_step_seconds=30,
    )

    assert len(results) == 3
    assert results[0]["timestamp"] == start.isoformat()
    assert results[-1]["timestamp"] == "2026-11-14T12:01:00+00:00"

    assert results[0]["sun_elevation_deg"] == pytest.approx(90)
    assert results[0]["earth_azimuth_deg"] == pytest.approx(90)
    assert results[0]["earth_elevation_deg"] == pytest.approx(0)


def test_ephemeris_includes_exact_end_time(monkeypatch):
    start = datetime(2026, 11, 14, 12, 0, tzinfo=timezone.utc)

    monkeypatch.setattr(
        ephemeris, "get_sun_position", lambda time: [1, 0, 0]
    )
    monkeypatch.setattr(
        ephemeris, "get_earth_position", lambda time: [0, 1, 0]
    )

    results = ephemeris.compute_sun_earth_angles(
        0, 0, start, 100, 30
    )

    assert len(results) == 5
    assert results[-1]["timestamp"] == "2026-11-14T12:01:40+00:00"


def test_ephemeris_rejects_naive_datetime():
    with pytest.raises(ValueError):
        ephemeris.compute_sun_earth_angles(
            0, 0, datetime(2026, 11, 14), 60, 10
        )


@pytest.mark.parametrize(
    "duration, step",
    [(-1, 10), (60, 0), (60, -1)],
)
def test_ephemeris_rejects_invalid_time_parameters(duration, step):
    start = datetime(2026, 11, 14, 12, 0, tzinfo=timezone.utc)

    with pytest.raises(ValueError):
        ephemeris.compute_sun_earth_angles(
            0, 0, start, duration, step
        )


def test_ephemeris_rejects_invalid_latitude():
    start = datetime(2026, 11, 14, 12, 0, tzinfo=timezone.utc)

    with pytest.raises(ValueError):
        ephemeris.compute_sun_earth_angles(
            95, 0, start, 60, 10
        )


def test_ephemeris_rejects_non_finite_position(monkeypatch):
    start = datetime(2026, 11, 14, 12, 0, tzinfo=timezone.utc)

    monkeypatch.setattr(
        ephemeris, "get_sun_position", lambda time: [float("nan"), 0, 0]
    )
    monkeypatch.setattr(
        ephemeris, "get_earth_position", lambda time: [1, 0, 0]
    )

    with pytest.raises(ValueError, match="non-finite"):
        ephemeris.compute_sun_earth_angles(
            0, 0, start, 0, 10
        )
