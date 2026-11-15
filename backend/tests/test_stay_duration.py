"""Stay duration: up to 365.25 days (one Julian year, as the website allows), still bounded by MAX_SAMPLES."""

from datetime import datetime, timedelta

import pytest
from pydantic import ValidationError

from app.models import limits
from app.models.mission import MissionInput
from app.timegrid import SECONDS_PER_DAY, count_samples
from tests.conftest import VALID_MISSION

URL = "/api/v1/missions/evaluate"
JULIAN_YEAR_DAYS = 365.25


def _mission(days: float, step_s: int) -> dict:
    return {**VALID_MISSION, "stay_duration_days": days, "time_step_s": step_s}


def test_maximum_is_one_julian_year():
    assert limits.STAY_DURATION_MAX_DAYS == JULIAN_YEAR_DAYS
    assert limits.MAX_SAMPLES == 10_000  # unchanged


@pytest.mark.parametrize("days", [365.0, 365.2, JULIAN_YEAR_DAYS])
def test_durations_up_to_maximum_are_accepted(days):
    MissionInput.model_validate(_mission(days, 3600))


@pytest.mark.parametrize("days", [365.2500001, 365.26, 366])
def test_durations_above_maximum_are_rejected(days):
    with pytest.raises(ValidationError, match="stay_duration_days"):
        MissionInput.model_validate(_mission(days, 3600))


def test_maximum_duration_still_obeys_sample_cap():
    # 365.25 d at 3000 s steps would need 10 521 samples.
    assert count_samples(JULIAN_YEAR_DAYS * SECONDS_PER_DAY, 3000) > limits.MAX_SAMPLES

    with pytest.raises(ValidationError, match="samples; the maximum is 10000"):
        MissionInput.model_validate(_mission(JULIAN_YEAR_DAYS, 3000))


def test_finest_step_allowed_at_maximum_duration_is_accepted():
    # Smallest whole-second step that keeps 365.25 days within MAX_SAMPLES.
    duration_s = JULIAN_YEAR_DAYS * SECONDS_PER_DAY
    step_s = next(s for s in range(3000, 4000) if count_samples(duration_s, s) <= limits.MAX_SAMPLES)

    assert count_samples(duration_s, step_s - 1) > limits.MAX_SAMPLES
    MissionInput.model_validate(_mission(JULIAN_YEAR_DAYS, step_s))


def test_maximum_duration_with_maximum_launch_delay_fits_mission_window():
    mission = MissionInput.model_validate(
        {**_mission(JULIAN_YEAR_DAYS, 86_400), "launch_delay_days": limits.LAUNCH_DELAY_MAX_DAYS}
    )
    assert mission.launch_delays()[-1] == limits.LAUNCH_DELAY_MAX_DAYS


def test_maximum_duration_near_window_end_is_rejected():
    start = limits.MISSION_WINDOW_END_UTC - timedelta(days=365)
    payload = {**_mission(JULIAN_YEAR_DAYS, 86_400), "mission_start_utc": start.isoformat()}

    with pytest.raises(ValidationError, match="must end on or before"):
        MissionInput.model_validate(payload)


def test_endpoint_evaluates_maximum_duration_and_includes_final_partial_step(client):
    response = client.post(URL, json=_mission(JULIAN_YEAR_DAYS, 86_400))

    assert response.status_code == 200
    timestamps = response.json()["timeseries"]["timestamps_utc"]
    assert len(timestamps) == 367  # 365 whole days + start + the final quarter-day sample
    first, last = (datetime.fromisoformat(t) for t in (timestamps[0], timestamps[-1]))
    assert last - first == timedelta(days=JULIAN_YEAR_DAYS)


def test_endpoint_rejects_just_above_maximum(client):
    response = client.post(URL, json=_mission(365.2500001, 86_400))

    assert response.status_code == 422
