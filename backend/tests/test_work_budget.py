"""Aggregate work budget of one evaluation (limits.MAX_TOTAL_SAMPLES).

Regression tests for the independent Codex review of fd7c5de (PR #14): a 61 s step with a
30-day launch-delay sweep was accepted and computed about 310 000 ephemeris samples (109 s
locally), because delayed cases share no timestamps when the step does not divide a day.
"""

import pytest

from app.models import limits
from app.physics.factory import get_physics_engine
from app.timegrid import count_distinct_samples, count_samples

URL = "/api/v1/missions/evaluate"
DAY_S = 86_400.0

# The two requests from the review (Shackleton ridge, observer 2 m).
REVIEW_BASE = {
    "landing_site": {"latitude_deg": -89.684, "longitude_deg": -163.261},
    "observer_height_m": 2.0,
    "mission_start_utc": "2027-01-15T00:00:00Z",
    "launch_delay_days": 30,
    "launch_delay_step_days": 1,
}
PATHOLOGICAL_61S = {**REVIEW_BASE, "stay_duration_days": 9999 * 61 / DAY_S, "time_step_s": 61}
REUSING_60S = {**REVIEW_BASE, "stay_duration_days": 9999 * 60 / DAY_S, "time_step_s": 60}


class _MustNotRun:
    from app.physics.interface import EngineInfo

    info = EngineInfo(name="must-not-run", version="0", is_synthetic=False)

    def simulate(self, request):
        raise AssertionError("a rejected request must not reach the engine")


def test_count_without_delays_equals_the_single_grid():
    for duration, step in ((14 * DAY_S, 3600), (1000.0, 300), (3600.0000005, 3600)):
        assert count_distinct_samples(duration, step, [0.0]) == count_samples(duration, step)


def test_shared_timestamps_are_counted_once_only_when_the_step_divides_a_day():
    one_day_at_60 = count_samples(DAY_S, 60)  # 1441
    assert count_distinct_samples(DAY_S, 60, [0.0, DAY_S, 2 * DAY_S]) == one_day_at_60 + 2 * 1440
    # At 61 s only the end of one case (exactly one day) coincides with the start of the next.
    assert count_distinct_samples(DAY_S, 61, [0.0, DAY_S, 2 * DAY_S]) == 3 * count_samples(DAY_S, 61) - 2


def test_review_counts_are_reproduced():
    delays = [d * DAY_S for d in range(31)]
    assert count_distinct_samples(PATHOLOGICAL_61S["stay_duration_days"] * DAY_S, 61, delays) == 310_000
    assert count_distinct_samples(REUSING_60S["stay_duration_days"] * DAY_S, 60, delays) == 53_200


@pytest.mark.parametrize(("payload", "needed"), [(PATHOLOGICAL_61S, 310_000), (REUSING_60S, 53_200)])
def test_over_budget_sweeps_get_422_before_any_engine_work(app, client, payload, needed):
    app.dependency_overrides[get_physics_engine] = _MustNotRun

    response = client.post(URL, json=payload)

    assert response.status_code == 422
    message = response.json()["detail"][0]["msg"]
    assert f"needs {needed} distinct samples over 31 cases" in message
    assert f"the maximum is {limits.MAX_TOTAL_SAMPLES}" in message
    for setting in ("launch_delay_days", "launch_delay_step_days", "stay_duration_days", "time_step_s"):
        assert setting in message


def test_typical_missions_with_launch_delays_stay_accepted(client):
    for stay_days, step in ((14, 3600), (14, 600), (365, 3600)):
        payload = {**REVIEW_BASE, "stay_duration_days": stay_days, "time_step_s": step}
        response = client.post(URL, json=payload)
        assert response.status_code == 200, (stay_days, step, response.text)
        assert len(response.json()["launch_delay_results"]) == 31


def test_the_budget_boundary_is_inclusive(client, monkeypatch):
    payload = {**REVIEW_BASE, "stay_duration_days": 2, "time_step_s": 3600, "launch_delay_days": 3}
    needed = count_distinct_samples(2 * DAY_S, 3600, [d * DAY_S for d in range(4)])  # 49 + 3 * 24
    assert needed == 121

    monkeypatch.setattr(limits, "MAX_TOTAL_SAMPLES", needed)
    assert client.post(URL, json=payload).status_code == 200
    monkeypatch.setattr(limits, "MAX_TOTAL_SAMPLES", needed - 1)
    assert client.post(URL, json=payload).status_code == 422


def test_requests_without_launch_delay_are_bounded_by_max_samples_only(client):
    payload = {**REVIEW_BASE, "launch_delay_days": 0, "stay_duration_days": 9999 * 61 / DAY_S, "time_step_s": 61}
    assert client.post(URL, json=payload).status_code == 200


@pytest.mark.parametrize("raw", ["0", "-5", "lots"])
def test_a_malformed_budget_setting_fails_loudly(monkeypatch, raw):
    monkeypatch.setenv("CH_TEST_BUDGET", raw)
    with pytest.raises(ValueError):
        limits._positive_int_from_env("CH_TEST_BUDGET", 20_000)


def test_budget_setting_is_read_from_the_environment(monkeypatch):
    monkeypatch.setenv("CH_TEST_BUDGET", "12345")
    assert limits._positive_int_from_env("CH_TEST_BUDGET", 20_000) == 12345
    monkeypatch.delenv("CH_TEST_BUDGET")
    assert limits._positive_int_from_env("CH_TEST_BUDGET", 20_000) == 20_000
