"""POST /api/v1/missions/evaluate behaviour, independent of the engine's numbers."""

from datetime import datetime, timedelta

import pytest

from app.config import CONTRACT_VERSION
from app.models.results import MissionMetrics, SiteInfo
from app.physics.engine_adapter import PhysicsEngineAdapter
from app.physics.factory import get_physics_engine
from app.physics.interface import EngineInfo, SimulationRequest, SimulationResult
from app.physics.synthetic import SyntheticPhysicsEngine

URL = "/api/v1/missions/evaluate"


def _parse(ts: str) -> datetime:
    return datetime.fromisoformat(ts)


def test_evaluate_returns_labelled_synthetic_result(client, mission_payload):
    response = client.post(URL, json=mission_payload)

    assert response.status_code == 200
    body = response.json()
    assert body["contract_version"] == CONTRACT_VERSION
    assert body["provenance"]["source"] == "synthetic"
    assert body["provenance"]["is_synthetic"] is True
    assert "SYNTHETIC" in body["provenance"]["notice"]
    assert response.headers["X-Data-Source"] == "synthetic"
    assert any("SYNTHETIC" in warning for warning in body["warnings"])


def test_timeseries_covers_whole_stay_and_arrays_align(client, mission_payload):
    body = client.post(URL, json=mission_payload).json()
    series = body["timeseries"]
    timestamps = [_parse(t) for t in series["timestamps_utc"]]

    assert series["frame"] == "MOON_ME"
    assert len(timestamps) == 2 * 24 + 1  # 2 days at 1 h, end inclusive
    assert timestamps[0] == _parse(mission_payload["mission_start_utc"])
    assert timestamps[-1] - timestamps[0] == timedelta(days=2)
    assert all(t.utcoffset() == timedelta(0) for t in timestamps)
    for body_name in ("sun", "earth"):
        for key, values in series[body_name].items():
            assert len(values) == len(timestamps), f"{body_name}.{key}"


def test_timestamps_are_serialised_as_utc_z(client, mission_payload):
    body = client.post(URL, json=mission_payload).json()

    assert body["timeseries"]["timestamps_utc"][0] == "2027-01-15T00:00:00Z"
    assert body["mission"]["mission_start_utc"] == "2027-01-15T00:00:00Z"


def test_normalised_request_is_echoed(client, mission_payload):
    mission_payload["mission_start_utc"] = "2027-01-15T02:00:00+02:00"

    body = client.post(URL, json=mission_payload).json()

    assert body["mission"]["mission_start_utc"] == "2027-01-15T00:00:00Z"
    assert body["mission"]["landing_site"] == mission_payload["landing_site"]
    assert body["mission"]["launch_delay_days"] == 0


def test_metrics_are_consistent_with_stay_length(client, mission_payload):
    metrics = client.post(URL, json=mission_payload).json()["metrics"]
    stay_hours = mission_payload["stay_duration_days"] * 24

    assert 0 <= metrics["sunlight_hours"] <= stay_hours
    assert metrics["sunlight_percentage"] == pytest.approx(100 * metrics["sunlight_hours"] / stay_hours, abs=0.01)
    assert metrics["longest_sunlight_hours"] <= metrics["sunlight_hours"]
    assert metrics["longest_darkness_hours"] <= stay_hours - metrics["sunlight_hours"] + 1e-6


def test_no_requirements_means_no_verdict(client, mission_payload):
    body = client.post(URL, json=mission_payload).json()

    assert body["requirement_results"] == []
    assert body["requirements_passed"] is None


def test_requirements_are_reported_per_rule(client, mission_payload):
    mission_payload["hardware_requirements"] = {"min_sunlight_percentage": 0, "max_slope_deg": 0}

    body = client.post(URL, json=mission_payload).json()

    by_name = {r["requirement"]: r for r in body["requirement_results"]}
    assert set(by_name) == {"min_sunlight_percentage", "max_slope_deg"}
    assert by_name["min_sunlight_percentage"]["passed"] is True
    assert by_name["min_sunlight_percentage"]["actual"] == body["metrics"]["sunlight_percentage"]
    assert body["requirements_passed"] is True


def test_launch_delay_cases_include_baseline_and_shifted_starts(client, mission_payload):
    mission_payload["launch_delay_days"] = 4
    mission_payload["launch_delay_step_days"] = 2

    body = client.post(URL, json=mission_payload).json()

    cases = body["launch_delay_results"]
    assert [c["launch_delay_days"] for c in cases] == [0, 2, 4]
    start = _parse(mission_payload["mission_start_utc"])
    assert [_parse(c["mission_start_utc"]) for c in cases] == [start + timedelta(days=d) for d in (0, 2, 4)]
    assert cases[0]["metrics"] == body["metrics"]


def test_unavailable_engine_returns_503_not_synthetic_data(app, client, mission_payload):
    app.dependency_overrides[get_physics_engine] = PhysicsEngineAdapter

    response = client.post(URL, json=mission_payload)

    assert response.status_code == 503
    assert "not integrated" in response.json()["detail"]
    health = client.get("/health").json()["physics_engine"]
    assert health["available"] is False
    assert health["is_synthetic"] is False


class _BrokenEngine:
    """Returns time series whose Sun arrays are shorter than the timestamps."""

    info = EngineInfo(name="broken-test-engine", version="0", is_synthetic=False)

    def simulate(self, request: SimulationRequest) -> SimulationResult:
        good = SyntheticPhysicsEngine().simulate(request).model_dump()
        good["timeseries"]["sun"]["azimuth_deg"].pop()
        return SimulationResult.model_validate(good)


def test_engine_output_violating_contract_returns_502(app, client, mission_payload):
    app.dependency_overrides[get_physics_engine] = _BrokenEngine

    response = client.post(URL, json=mission_payload)

    assert response.status_code == 502
    assert "violates the API contract" in response.json()["detail"]


class _FakeRealEngine:
    """Stands in for the real engine to prove the seam works without synthetic data."""

    info = EngineInfo(name="fake-physics", version="9.9", is_synthetic=False)

    def simulate(self, request: SimulationRequest) -> SimulationResult:
        result = SyntheticPhysicsEngine().simulate(request)
        return result.model_copy(
            update={
                "site": SiteInfo(
                    latitude_deg=request.latitude_deg,
                    longitude_deg=request.longitude_deg,
                    elevation_m=123.0,
                    elevation_source="terrain_model",
                    slope_deg=4.5,
                ),
                "warnings": [],
            }
        )


def test_real_engine_results_are_labelled_as_physics(app, client, mission_payload):
    app.dependency_overrides[get_physics_engine] = _FakeRealEngine
    mission_payload["hardware_requirements"] = {"max_slope_deg": 3}

    response = client.post(URL, json=mission_payload)

    body = response.json()
    assert response.headers["X-Data-Source"] == "physics_engine"
    assert body["provenance"] == {
        "source": "physics_engine",
        "is_synthetic": False,
        "engine_name": "fake-physics",
        "engine_version": "9.9",
        "notice": "Values computed by the Common Horizon physics engine.",
    }
    assert body["site"]["slope_deg"] == 4.5
    assert body["requirements_passed"] is False


def test_engine_without_timeseries_returns_502(app, client, mission_payload):
    class _NoSeries(_FakeRealEngine):
        def simulate(self, request):
            return SimulationResult(
                site=SiteInfo(latitude_deg=0, longitude_deg=0, elevation_m=0, elevation_source="input"),
                timeseries=None,
                metrics=MissionMetrics(
                    sunlight_hours=0,
                    sunlight_percentage=0,
                    longest_sunlight_hours=0,
                    longest_darkness_hours=48,
                    earth_visibility_hours=0,
                    earth_visibility_percentage=0,
                ),
                communication_windows=[],
            )

    app.dependency_overrides[get_physics_engine] = _NoSeries

    assert client.post(URL, json=mission_payload).status_code == 502
