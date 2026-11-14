"""Input validation: coordinates, dates, units, mission duration and launch delay."""

import copy
import json
from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from app.models import limits
from app.models.mission import MissionInput
from tests.conftest import VALID_MISSION


def _with(path: str, value):
    """Copy of VALID_MISSION with the dotted ``path`` set to ``value``."""
    payload = copy.deepcopy(VALID_MISSION)
    *parents, leaf = path.split(".")
    target = payload
    for key in parents:
        target = target.setdefault(key, {})
    target[leaf] = value
    return payload


def test_valid_mission_is_accepted():
    mission = MissionInput.model_validate(VALID_MISSION)

    assert mission.mission_start_utc == datetime(2027, 1, 15, tzinfo=UTC)
    assert mission.launch_delays() == []


@pytest.mark.parametrize(
    "path, value",
    [
        ("landing_site.latitude_deg", 90.0),
        ("landing_site.latitude_deg", -90.0),
        ("landing_site.longitude_deg", 180.0),
        ("landing_site.longitude_deg", -180.0),
        ("landing_site.altitude_m", None),
        ("landing_site.altitude_m", limits.ALTITUDE_MIN_M),
        ("observer_height_m", 0.0),
        ("stay_duration_days", 6.5),
        ("time_step_s", limits.TIME_STEP_MIN_S),
        ("hardware_id", "VIPER-like_rover.v2"),
    ],
)
def test_boundary_values_are_accepted(path, value):
    MissionInput.model_validate(_with(path, value))


@pytest.mark.parametrize(
    "path, value",
    [
        ("landing_site.latitude_deg", 90.01),
        ("landing_site.latitude_deg", -90.01),
        ("landing_site.longitude_deg", 180.01),
        ("landing_site.longitude_deg", -181),
        ("landing_site.latitude_deg", float("nan")),
        ("landing_site.longitude_deg", float("inf")),
        ("landing_site.latitude_deg", "south pole"),
        ("landing_site.altitude_m", limits.ALTITUDE_MAX_M + 1),
        ("landing_site.altitude_m", limits.ALTITUDE_MIN_M - 1),
        ("observer_height_m", -0.1),
        ("observer_height_m", limits.OBSERVER_HEIGHT_MAX_M + 1),
        ("stay_duration_days", 0),
        ("stay_duration_days", -1),
        ("stay_duration_days", limits.STAY_DURATION_MAX_DAYS + 1),
        ("time_step_s", limits.TIME_STEP_MIN_S - 1),
        ("time_step_s", limits.TIME_STEP_MAX_S + 1),
        ("time_step_s", 3600.5),
        ("launch_delay_days", -1),
        ("launch_delay_days", limits.LAUNCH_DELAY_MAX_DAYS + 1),
        ("launch_delay_days", 1.5),
        ("launch_delay_step_days", 0),
        ("hardware_id", ""),
        ("hardware_id", "lander with spaces"),
        ("hardware_id", "x" * 65),
        ("hardware_requirements.min_sunlight_percentage", 100.1),
        ("hardware_requirements.max_slope_deg", 91),
        ("hardware_requirements.max_darkness_hours", -1),
        ("hardware_requirements.unknown_rule", 1),
        ("unexpected_field", 1),
    ],
)
def test_out_of_range_or_malformed_values_are_rejected(path, value):
    with pytest.raises(ValidationError):
        MissionInput.model_validate(_with(path, value))


@pytest.mark.parametrize(
    "value",
    [
        "2027-01-15T00:00:00",  # no timezone: ambiguous
        "2027-01-15",  # date only
        "15/01/2027 00:00",  # not ISO 8601
        "1800000000",  # unix time as a string
        1800000000,  # unix time as a number
        "",
    ],
)
def test_mission_start_must_be_iso_8601_with_timezone(value):
    with pytest.raises(ValidationError):
        MissionInput.model_validate(_with("mission_start_utc", value))


def test_mission_start_with_offset_is_normalised_to_utc():
    mission = MissionInput.model_validate(_with("mission_start_utc", "2027-01-15T02:00:00+02:00"))

    assert mission.mission_start_utc == datetime(2027, 1, 15, tzinfo=UTC)
    assert mission.mission_start_utc.utcoffset().total_seconds() == 0


def test_mission_start_before_supported_window_is_rejected():
    with pytest.raises(ValidationError, match="on or after"):
        MissionInput.model_validate(_with("mission_start_utc", "1999-12-31T23:59:59Z"))


def test_mission_end_including_launch_delay_must_stay_in_window():
    payload = _with("mission_start_utc", "2099-12-20T00:00:00Z")
    payload["stay_duration_days"] = 5
    MissionInput.model_validate(payload)  # ends 2099-12-25: fine

    payload["launch_delay_days"] = 10
    with pytest.raises(ValidationError, match="must end on or before"):
        MissionInput.model_validate(payload)


def test_time_step_longer_than_stay_is_rejected():
    payload = _with("stay_duration_days", 0.5)
    payload["time_step_s"] = 86_400

    with pytest.raises(ValidationError, match="must not exceed the stay duration"):
        MissionInput.model_validate(payload)


def test_too_many_samples_is_rejected_with_guidance():
    payload = _with("stay_duration_days", 30)
    payload["time_step_s"] = 60  # 43 201 samples

    with pytest.raises(ValidationError, match="Increase time_step_s"):
        MissionInput.model_validate(payload)


def test_launch_delay_step_larger_than_delay_is_rejected():
    payload = _with("launch_delay_days", 2)
    payload["launch_delay_step_days"] = 3

    with pytest.raises(ValidationError, match="launch_delay_step_days"):
        MissionInput.model_validate(payload)


@pytest.mark.parametrize(
    "delay, step, expected",
    [(0, 1, []), (3, 1, [0, 1, 2, 3]), (7, 3, [0, 3, 6]), (30, 30, [0, 30])],
)
def test_launch_delays_are_expanded_inclusively(delay, step, expected):
    payload = _with("launch_delay_days", delay)
    payload["launch_delay_step_days"] = step

    assert MissionInput.model_validate(payload).launch_delays() == expected


def test_api_returns_422_with_field_location(client, mission_payload):
    mission_payload["landing_site"]["latitude_deg"] = 95

    response = client.post("/api/v1/missions/evaluate", json=mission_payload)

    assert response.status_code == 422
    locations = [error["loc"] for error in response.json()["detail"]]
    assert ["body", "landing_site", "latitude_deg"] in locations


def test_api_rejects_missing_required_fields(client):
    response = client.post("/api/v1/missions/evaluate", json={"landing_site": {"latitude_deg": 0}})

    assert response.status_code == 422
    missing = {tuple(e["loc"]) for e in response.json()["detail"] if e["type"] == "missing"}
    assert {
        ("body", "landing_site", "longitude_deg"),
        ("body", "mission_start_utc"),
        ("body", "stay_duration_days"),
        ("body", "time_step_s"),
    } <= missing


# --- Regression tests for the independent Codex review of c34f59e (PR #4) ---------------------

EXTREME_STARTS = [
    "9999-12-31T00:00:00Z",  # start + stay overflows datetime.max
    "9999-12-31T23:59:59-01:00",  # UTC normalisation overflows into year 10000
    "0001-01-01T00:00:00+01:00",  # UTC normalisation underflows into year 0
    "0001-01-01T00:00:00Z",
    "2100-01-01T00:00:00Z",  # first instant after the supported window
]


@pytest.mark.parametrize("value", EXTREME_STARTS)
def test_extreme_mission_start_raises_validation_error_not_overflow(value):
    with pytest.raises(ValidationError) as excinfo:
        MissionInput.model_validate(_with("mission_start_utc", value))

    assert [error["loc"] for error in excinfo.value.errors()] == [("mission_start_utc",)]


@pytest.mark.parametrize("value", EXTREME_STARTS)
def test_api_returns_422_for_extreme_mission_start(server_client, mission_payload, value):
    mission_payload["mission_start_utc"] = value

    response = server_client.post("/api/v1/missions/evaluate", json=mission_payload)

    assert response.status_code == 422
    assert ["body", "mission_start_utc"] in [error["loc"] for error in response.json()["detail"]]


def _reject_non_standard_json(token: str):
    raise AssertionError(f"response is not strict JSON: contains {token}")


def _raw_body(path: str, raw_token: str) -> str:
    """VALID_MISSION as JSON with ``path`` set to a raw (possibly non-standard) JSON number token."""
    return json.dumps(_with(path, "__RAW__")).replace('"__RAW__"', raw_token)


@pytest.mark.parametrize(
    "path, raw_token, encoded_input",
    [
        ("landing_site.latitude_deg", "1e999", "Infinity"),  # valid JSON syntax, overflows to inf
        ("landing_site.longitude_deg", "-1e999", "-Infinity"),
        ("landing_site.latitude_deg", "NaN", "NaN"),  # non-standard tokens Python's parser accepts
        ("landing_site.altitude_m", "Infinity", "Infinity"),
        ("observer_height_m", "-Infinity", "-Infinity"),
        ("stay_duration_days", "1e999", "Infinity"),
        ("time_step_s", "1e999", "Infinity"),
        ("hardware_requirements.max_darkness_hours", "1e999", "Infinity"),
    ],
)
def test_api_returns_strict_json_422_for_non_finite_numbers(server_client, path, raw_token, encoded_input):
    response = server_client.post(
        "/api/v1/missions/evaluate",
        content=_raw_body(path, raw_token),
        headers={"Content-Type": "application/json"},
    )

    assert response.status_code == 422
    errors = json.loads(response.text, parse_constant=_reject_non_standard_json)["detail"]
    by_loc = {tuple(error["loc"]): error for error in errors}
    error = by_loc[("body", *path.split("."))]
    assert error["input"] == encoded_input
    assert error["msg"]


def test_non_finite_numbers_nested_in_error_input_are_encoded(server_client):
    """Errors echo the rejected value as ``input``; non-finite numbers nested inside it must be encoded too."""
    response = server_client.post(
        "/api/v1/missions/evaluate",
        content=_raw_body("landing_site", '[1e999, NaN, {"x": -1e999}]'),
        headers={"Content-Type": "application/json"},
    )

    assert response.status_code == 422
    errors = json.loads(response.text, parse_constant=_reject_non_standard_json)["detail"]
    by_loc = {tuple(error["loc"]): error for error in errors}
    assert by_loc[("body", "landing_site")]["input"] == ["Infinity", "NaN", {"x": "-Infinity"}]
