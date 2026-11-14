"""Engine output must be finite and in UTC before it reaches the website.

Regression tests for the independent Codex review of c34f59e (PR #4): NaN/Infinity
in engine output used to be serialised as JSON ``null`` with HTTP 200, and engine
timestamps with a non-UTC offset were passed through unchanged.
"""

import math
from collections.abc import Callable
from datetime import UTC, datetime, timedelta, timezone

import pytest

from app.models.results import MissionMetrics
from app.physics.factory import get_physics_engine
from app.physics.interface import EngineInfo, SimulationRequest, SimulationResult
from app.physics.synthetic import SyntheticPhysicsEngine

URL = "/api/v1/missions/evaluate"
PLUS_TWO = timezone(timedelta(hours=2))
MINUS_FIVE = timezone(timedelta(hours=-5))


def _engine_returning(mutate: Callable[[dict], None]):
    """Engine that builds a *validated* ``SimulationResult`` from mutated synthetic data."""

    class _Engine:
        info = EngineInfo(name="mutated-test-engine", version="0", is_synthetic=False)

        def simulate(self, request: SimulationRequest) -> SimulationResult:
            data = SyntheticPhysicsEngine().simulate(request).model_dump()
            mutate(data)
            return SimulationResult.model_validate(data)

    return _Engine


def _set(path: str, value) -> Callable[[dict], None]:
    """Mutation setting a dotted path; integer segments index into lists."""

    def mutate(data: dict) -> None:
        *parents, leaf = path.split(".")
        target = data
        for key in parents:
            target = target[int(key)] if key.isdigit() else target[key]
        target[int(leaf) if leaf.isdigit() else leaf] = value

    return mutate


def _add_window(duration_hours: float) -> Callable[[dict], None]:
    def mutate(data: dict) -> None:
        times = data["timeseries"]["timestamps_utc"]
        data["communication_windows"] = [{"start_utc": times[0], "end_utc": times[1], "duration_hours": duration_hours}]

    return mutate


@pytest.mark.parametrize(
    "mutate",
    [
        pytest.param(_set("metrics.sunlight_hours", math.inf), id="metrics-inf"),
        pytest.param(_set("metrics.longest_darkness_hours", math.inf), id="metrics-darkness-inf"),
        pytest.param(_set("timeseries.sun.position_km.0.0", math.nan), id="vector-nan"),
        pytest.param(_set("timeseries.earth.position_km.3.2", -math.inf), id="vector-neg-inf"),
        pytest.param(_set("timeseries.sun.direction_unit.0.1", math.nan), id="unit-vector-nan"),
        pytest.param(_set("site.elevation_m", math.inf), id="site-inf"),
        pytest.param(_set("site.latitude_deg", math.nan), id="site-nan"),
        pytest.param(_add_window(math.inf), id="window-duration-inf"),
    ],
)
def test_non_finite_engine_output_returns_502(app, client, mission_payload, mutate):
    app.dependency_overrides[get_physics_engine] = _engine_returning(mutate)

    response = client.post(URL, json=mission_payload)

    assert response.status_code == 502
    assert "violates the API contract" in response.json()["detail"]


def test_infinite_sunlight_does_not_pass_requirements(app, client, mission_payload):
    """Reviewer's case: infinite sunlight used to give requirements_passed=true with actual=null."""
    app.dependency_overrides[get_physics_engine] = _engine_returning(_set("metrics.sunlight_hours", math.inf))
    mission_payload["hardware_requirements"] = {"min_sunlight_hours": 1}

    response = client.post(URL, json=mission_payload)

    assert response.status_code == 502


def test_non_finite_value_in_launch_delay_run_returns_502(app, client, mission_payload):
    class _BadDelayedRun:
        info = EngineInfo(name="bad-delay-engine", version="0", is_synthetic=False)

        def simulate(self, request: SimulationRequest) -> SimulationResult:
            data = SyntheticPhysicsEngine().simulate(request).model_dump()
            if not request.include_timeseries:
                data["metrics"]["earth_visibility_hours"] = math.inf
            return SimulationResult.model_validate(data)

    app.dependency_overrides[get_physics_engine] = _BadDelayedRun
    mission_payload["launch_delay_days"] = 1

    assert client.post(URL, json=mission_payload).status_code == 502


def test_unvalidated_engine_result_is_revalidated_at_the_boundary(app, client, mission_payload):
    """``model_copy(update=...)`` skips validation; the backend must still catch the bad value."""

    class _CopyingEngine:
        info = EngineInfo(name="copying-engine", version="0", is_synthetic=False)

        def simulate(self, request: SimulationRequest) -> SimulationResult:
            result = SyntheticPhysicsEngine().simulate(request)
            bad_metrics = result.metrics.model_copy(update={"sunlight_percentage": math.inf})
            return result.model_copy(update={"metrics": bad_metrics})

    app.dependency_overrides[get_physics_engine] = _CopyingEngine

    assert client.post(URL, json=mission_payload).status_code == 502


def test_engine_returning_wrong_type_returns_502(app, client, mission_payload):
    class _DictEngine:
        info = EngineInfo(name="dict-engine", version="0", is_synthetic=False)

        def simulate(self, request: SimulationRequest):
            return SyntheticPhysicsEngine().simulate(request).model_dump()

    app.dependency_overrides[get_physics_engine] = _DictEngine

    assert client.post(URL, json=mission_payload).status_code == 502


@pytest.mark.parametrize("value", [math.nan, math.inf, -math.inf])
def test_output_models_reject_non_finite_numbers(value):
    with pytest.raises(ValueError, match="finite"):
        MissionMetrics(
            sunlight_hours=value,
            sunlight_percentage=0,
            longest_sunlight_hours=0,
            longest_darkness_hours=0,
            earth_visibility_hours=0,
            earth_visibility_percentage=0,
        )


def _shift_all_timestamps(data: dict) -> None:
    data["timeseries"]["timestamps_utc"] = [t.astimezone(PLUS_TWO) for t in data["timeseries"]["timestamps_utc"]]
    times = data["timeseries"]["timestamps_utc"]
    data["communication_windows"] = [{"start_utc": times[0], "end_utc": times[2], "duration_hours": 2.0}]
    data["metrics"]["sunset_utc"] = times[1].astimezone(MINUS_FIVE)
    data["metrics"]["time_to_sunset_hours"] = 1.0
    data["metrics"]["earthset_utc"] = times[2].astimezone(PLUS_TWO)
    data["metrics"]["time_to_earthset_hours"] = 2.0


def test_engine_timestamps_with_offsets_are_returned_in_utc(app, client, mission_payload):
    app.dependency_overrides[get_physics_engine] = _engine_returning(_shift_all_timestamps)

    response = client.post(URL, json=mission_payload)

    assert response.status_code == 200
    body = response.json()
    series = body["timeseries"]["timestamps_utc"]
    assert series[0] == "2027-01-15T00:00:00Z"
    assert all(ts.endswith("Z") for ts in series)
    assert body["communication_windows"] == [
        {"start_utc": "2027-01-15T00:00:00Z", "end_utc": "2027-01-15T02:00:00Z", "duration_hours": 2.0}
    ]
    assert body["metrics"]["sunset_utc"] == "2027-01-15T01:00:00Z"
    assert body["metrics"]["earthset_utc"] == "2027-01-15T02:00:00Z"


def test_engine_timestamps_with_offsets_are_normalised_in_launch_delay_cases(app, client, mission_payload):
    class _OffsetMetricsEngine:
        """Reports sunset/Earthset with non-UTC offsets on every run, including metrics-only delay runs."""

        info = EngineInfo(name="offset-metrics-engine", version="0", is_synthetic=False)

        def simulate(self, request: SimulationRequest) -> SimulationResult:
            data = SyntheticPhysicsEngine().simulate(request).model_dump()
            data["metrics"]["sunset_utc"] = (request.start_utc + timedelta(hours=1)).astimezone(MINUS_FIVE)
            data["metrics"]["time_to_sunset_hours"] = 1.0
            data["metrics"]["earthset_utc"] = (request.start_utc + timedelta(hours=2)).astimezone(PLUS_TWO)
            data["metrics"]["time_to_earthset_hours"] = 2.0
            return SimulationResult.model_validate(data)

    app.dependency_overrides[get_physics_engine] = _OffsetMetricsEngine
    mission_payload["launch_delay_days"] = 1

    body = client.post(URL, json=mission_payload).json()

    for case in body["launch_delay_results"]:
        assert case["mission_start_utc"].endswith("Z")
        assert case["metrics"]["sunset_utc"].endswith("Z")
        assert case["metrics"]["earthset_utc"].endswith("Z")


def test_engine_timestamp_that_overflows_in_utc_returns_502_not_500(app, client, mission_payload):
    year_one = datetime(1, 1, 1, tzinfo=timezone(timedelta(hours=1)))  # 0000-12-31T23:00Z does not exist
    app.dependency_overrides[get_physics_engine] = _engine_returning(_set("metrics.sunset_utc", year_one))

    response = client.post(URL, json=mission_payload)

    assert response.status_code == 502


def test_utc_normalisation_keeps_the_instant():
    local = datetime(2027, 1, 15, 2, 0, tzinfo=PLUS_TWO)

    metrics = MissionMetrics(
        sunlight_hours=0,
        sunlight_percentage=0,
        longest_sunlight_hours=0,
        longest_darkness_hours=0,
        earth_visibility_hours=0,
        earth_visibility_percentage=0,
        sunset_utc=local,
    )

    assert metrics.sunset_utc == local
    assert metrics.sunset_utc.utcoffset() == timedelta(0)
    assert metrics.sunset_utc.tzinfo is UTC
