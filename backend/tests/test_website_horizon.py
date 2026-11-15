"""POST /horizon. No network, no kernels, no data files, except the last test, which skips without kernels."""

import json
import os
import re
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.models.results import TerrainSkyline
from app.models import limits
from app.models.website_horizon import HORIZON_MAX_SAMPLES, HORIZON_MAX_WINDOW_DAYS
from app.physics.factory import get_physics_engine
from app.physics.horizon.profile import HorizonProfile
from app.physics.interface import EngineInfo, PhysicsEngineUnavailable, SimulationRequest, SimulationResult
from app.physics.synthetic import SyntheticPhysicsEngine
from app.services.website_horizon import SMOOTH_SPHERE_WARNING, azimuth_range, earth_box
from app.timegrid import count_samples

URL = "/horizon"
WEB_API = Path(__file__).resolve().parents[2] / "web" / "src" / "api"
SHACKLETON = {"id": "shackleton-ridge", "name": "Shackleton Connecting Ridge", "lat": -89.684, "lon_east": 196.739}
START, END = "2027-02-15T15:00:00Z", "2027-03-01T15:00:00Z"  # 14 days


def iso(moment: datetime) -> str:
    return moment.strftime("%Y-%m-%dT%H:%M:%SZ")


def body(**changes):
    return {"site": dict(SHACKLETON), "start_utc": START, "end_utc": END, "step_hours": 1, **changes}


class Engine:
    """The synthetic engine's answer, changed by ``edit(result) -> result``; records each request."""

    def __init__(self, edit=None, *, fail: Exception | None = None):
        self.edit, self.fail = edit, fail
        self.calls: list[SimulationRequest] = []

    @property
    def info(self) -> EngineInfo:
        return EngineInfo(name="test-engine", version="0", is_synthetic=True)

    def simulate(self, request: SimulationRequest) -> SimulationResult:
        self.calls.append(request)
        if self.fail is not None:
            raise self.fail
        result = SyntheticPhysicsEngine().simulate(request)
        return self.edit(result) if self.edit else result


def use(app, engine):
    app.dependency_overrides[get_physics_engine] = lambda: engine
    return engine


def with_earth(azimuths, elevations):
    """Replace the Earth's azimuth and elevation by repeating the given values over the series."""

    def edit(result):
        earth = result.timeseries.earth
        n = len(earth.azimuth_deg)
        new = earth.model_copy(update={
            "azimuth_deg": [azimuths[i % len(azimuths)] for i in range(n)],
            "elevation_deg": [elevations[i % len(elevations)] for i in range(n)],
        })
        return result.model_copy(update={"timeseries": result.timeseries.model_copy(update={"earth": new})})

    return edit


# ---------------------------------------------------------------- the website's contract


def _interface_fields(source: str, name: str) -> set[str]:
    match = re.search(rf"export interface {name} \{{(.*?)\n\}}", source, re.DOTALL)
    assert match, name
    return {found.group(1) for line in match.group(1).splitlines() if (found := re.match(r"\s{2}(\w+)\??:", line))}


def _kind(value):
    return {bool: "boolean", int: "number", float: "number", str: "string", dict: "object", list: "array"}[type(value)]


def test_answer_has_the_keys_and_types_of_the_websites_sample(client):
    sample_path = WEB_API / "examples" / "horizon.sample.json"
    if not sample_path.exists():
        pytest.skip("web/ is not in this checkout")
    sample = json.loads(sample_path.read_text(encoding="utf-8"))
    types_ts = (WEB_API / "types.ts").read_text(encoding="utf-8")

    answer = client.post(URL, json=body()).json()

    added = {"provenance", "warnings", "time_step_s", "skyline_source"}
    assert set(answer) == set(sample) | added
    assert set(sample) == _interface_fields(types_ts, "HorizonResponse")
    assert set(body()) == _interface_fields(types_ts, "HorizonRequest")
    for key in sample:
        assert _kind(answer[key]) == _kind(sample[key]), key
    for name, ours, theirs in (("SkyPoint", answer["skyline"][0], sample["skyline"][0]),
                               ("SunPathPoint", answer["sun_path"][0], sample["sun_path"][0]),
                               ("SkyBox", answer["earth_box"], sample["earth_box"])):
        assert set(ours) == set(theirs) == _interface_fields(types_ts, name), name
        assert {k: _kind(v) for k, v in ours.items()} == {k: _kind(v) for k, v in theirs.items()}, name
    assert {p["state"] for p in answer["sun_path"]} <= {"above", "hidden"}
    assert re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ", answer["sun_path"][0]["t"])


# ---------------------------------------------------------------- the synthetic engine


def test_synthetic_engine_answer_comes_from_the_engine_and_is_labelled(client):
    apollo_11 = {"id": "apollo-11", "name": "Apollo 11", "lat": 0.67416, "lon_east": 23.47314}
    response = client.post(URL, json=body(site=apollo_11))

    assert response.status_code == 200
    assert response.headers["X-Data-Source"] == "synthetic"
    answer = response.json()
    assert answer["provenance"]["is_synthetic"] is True and answer["site_id"] == "apollo-11"
    assert answer["time_step_s"] == 3600
    assert len(answer["sun_path"]) == count_samples(14 * 86400, 3600) == 337

    # Every Sun point is the engine's own sample, and "above" means some of the disc is visible.
    engine_run = SyntheticPhysicsEngine().simulate(SimulationRequest(
        latitude_deg=0.67416, longitude_deg=23.47314, altitude_m=None, observer_height_m=2.0,
        start_utc=datetime(2027, 2, 15, 15, tzinfo=UTC), duration_s=14 * 86400, time_step_s=3600))
    sun = engine_run.timeseries.sun
    assert [p["az"] for p in answer["sun_path"]] == sun.azimuth_deg
    assert [p["el"] for p in answer["sun_path"]] == sun.elevation_deg
    assert [p["state"] == "above" for p in answer["sun_path"]] == [f > 0 for f in sun.visibility_fraction]
    assert "hidden" in {p["state"] for p in answer["sun_path"]} and "above" in {p["state"] for p in answer["sun_path"]}


def test_share_above_matches_evaluate_sunlight_on_the_synthetic_engine(client):
    path = client.post(URL, json=body()).json()["sun_path"]
    evaluation = client.post("/evaluate", json={"sites": [SHACKLETON], "launch_utc": START, "slip_days": 0,
                                                "stay_days": 14, "hardware": [], "storage_kwh": 0}).json()

    share = 100 * sum(p["state"] == "above" for p in path) / len(path)
    assert abs(share - evaluation["results"][0]["sunlight_percent"]) <= 100 / len(path)


def test_west_longitudes_are_normalised_and_sent_signed(app, client):
    engine = use(app, Engine())

    response = client.post(URL, json=body(site={**SHACKLETON, "lon_east": -10.0}))

    assert response.status_code == 200
    assert engine.calls[0].longitude_deg == -10.0
    assert engine.calls[0].observer_height_m == 2.0


# ---------------------------------------------------------------- validation


@pytest.mark.parametrize(
    "change, where",
    [
        ({"start_utc": "2027-02-15T15:00:00"}, "start_utc"),  # no timezone
        ({"end_utc": "2027-03-01"}, "end_utc"),  # no timezone
        ({"start_utc": "not a time"}, "start_utc"),
        ({"end_utc": START}, "body"),  # start not before end
        ({"end_utc": "2027-02-14T15:00:00Z"}, "body"),
        ({"end_utc": "2028-03-17T21:00:01Z"}, "body"),  # one second over 395.25 days
        ({"start_utc": "1999-12-31T00:00:00Z", "end_utc": "2000-01-02T00:00:00Z"}, "body"),
        ({"start_utc": "2099-12-31T00:00:00Z", "end_utc": "2100-01-01T00:00:01Z"}, "body"),
        ({"step_hours": 0}, "step_hours"),
        ({"step_hours": 1 / 120}, "step_hours"),  # under a minute
        ({"step_hours": 24.5}, "step_hours"),
        ({"step_hours": "NaN"}, "step_hours"),
        ({"site": {**SHACKLETON, "lat": 90.5}}, "lat"),
        ({"site": {**SHACKLETON, "lon_east": 360.5}}, "lon_east"),
        ({"site": {**SHACKLETON, "lon_east": -180.5}}, "lon_east"),
        ({"site": {**SHACKLETON, "id": "bad id"}}, "id"),
        ({"site": {**SHACKLETON, "name": ""}}, "name"),
        ({"site": {**SHACKLETON, "elevation": 1}}, "elevation"),
        ({"extra": 1}, "extra"),
    ],
)
def test_each_validation_error_is_a_422_in_the_evaluate_shape(app, client, change, where):
    engine = use(app, Engine())

    response = client.post(URL, json=body(**change))

    assert response.status_code == 422
    detail = response.json()["detail"]
    assert isinstance(detail, list) and all({"loc", "msg", "type"} <= set(error) for error in detail)
    assert any(where in [str(part) for part in error["loc"]] for error in detail), detail
    assert engine.calls == []


def test_missing_site_is_a_422(client):
    request = body()
    del request["site"]
    assert client.post(URL, json=request).status_code == 422


def test_the_longest_window_up_to_the_last_allowed_instant_is_accepted(client):
    # 395.25 days (the longest stay plus the longest launch delay), ending at the last allowed instant.
    response = client.post(URL, json=body(start_utc="2098-12-01T18:00:00Z", end_utc="2100-01-01T00:00:00Z"))
    assert response.status_code == 200


def test_the_window_limit_is_the_longest_stay_plus_the_longest_launch_delay():
    assert HORIZON_MAX_WINDOW_DAYS == limits.STAY_DURATION_MAX_DAYS + limits.LAUNCH_DELAY_MAX_DAYS == 395.25


@pytest.mark.parametrize("slip_days", [1, 30])
def test_the_website_window_for_the_longest_stay_with_a_launch_delay_is_accepted(client, slip_days):
    """Regression (review of PR #19): the website asks from the planned landing to the end of the
    delayed stay (web/src/state/data.tsx), so a 365.25-day stay with a one-day delay is a 366.25-day
    window. It was refused with 422 while /evaluate accepted the same mission."""
    planned_landing = datetime(2027, 1, 1, tzinfo=UTC)
    end = planned_landing + timedelta(days=slip_days) + timedelta(days=limits.STAY_DURATION_MAX_DAYS)
    request = body(start_utc=iso(planned_landing), end_utc=iso(end), step_hours=14.75)

    response = client.post(URL, json=request)

    assert response.status_code == 200
    answer = response.json()
    assert len(answer["sun_path"]) <= HORIZON_MAX_SAMPLES
    assert answer["sun_path"][0]["t"] == iso(planned_landing)


def test_a_window_one_minute_over_the_limit_is_a_422(client):
    start = datetime(2027, 1, 1, tzinfo=UTC)
    end = start + timedelta(days=HORIZON_MAX_WINDOW_DAYS, minutes=1)
    assert client.post(URL, json=body(start_utc=iso(start), end_utc=iso(end))).status_code == 422


def test_engine_unavailable_is_503_and_broken_engine_output_is_502(app, client):
    use(app, Engine(fail=PhysicsEngineUnavailable("kernels missing")))
    assert client.post(URL, json=body()).status_code == 503

    use(app, Engine(lambda result: result.model_copy(update={"timeseries": None})))
    assert client.post(URL, json=body()).status_code == 502


# ---------------------------------------------------------------- work bound


def test_the_website_largest_request_keeps_the_spacing_it_asked_for(app, client):
    """The website asks for at most 3,600 steps in one request (150 days at one hour, see
    web/src/state/horizonLoad.ts). That must come back at the spacing asked for, not coarsened."""
    engine = use(app, Engine())
    start = datetime(2027, 1, 1, tzinfo=UTC)

    answer = client.post(URL, json=body(start_utc=iso(start), end_utc=iso(start + timedelta(days=150)), step_hours=1)).json()

    assert answer["time_step_s"] == 3600 and engine.calls[0].time_step_s == 3600
    assert len(answer["sun_path"]) == 3601 <= HORIZON_MAX_SAMPLES
    assert not any("Sampled every" in w for w in answer["warnings"])


def test_more_samples_than_the_bound_are_coarsened_in_whole_minutes_with_a_warning(app, client):
    engine = use(app, Engine())

    answer = client.post(URL, json=body(start_utc="2027-01-01T00:00:00Z", end_utc="2028-01-02T00:00:00Z")).json()

    step, duration = answer["time_step_s"], 366 * 86400
    assert step % 60 == 0 and step > 3600
    assert count_samples(duration, step) <= HORIZON_MAX_SAMPLES < count_samples(duration, step - 60)
    assert len(answer["sun_path"]) == count_samples(duration, step) and engine.calls[0].time_step_s == step
    assert any(f"Sampled every {step} s" in w for w in answer["warnings"])


def test_a_fine_step_within_the_bound_is_kept_and_rounded_to_whole_minutes(client):
    answer = client.post(URL, json=body(step_hours=0.2501)).json()  # 15.006 minutes

    assert answer["time_step_s"] == 900
    assert len(answer["sun_path"]) == count_samples(14 * 86400, 900)
    assert not any("Sampled every" in w for w in answer["warnings"])


# ---------------------------------------------------------------- skyline


def test_a_site_with_no_stored_profile_gets_the_engines_smooth_sphere_and_a_warning(client):
    answer = client.post(URL, json=body()).json()

    sphere = HorizonProfile.smooth_sphere(site_height_m=0.0, observer_height_m=2.0)
    assert answer["skyline_source"] == "smooth_sphere"
    assert [p["az"] for p in answer["skyline"]] == list(sphere.azimuth_deg)
    assert [p["el"] for p in answer["skyline"]] == list(sphere.horizon_elevation_deg)
    assert SMOOTH_SPHERE_WARNING in answer["warnings"]


def test_a_stored_skyline_from_the_engine_is_used_as_it_is_sorted_by_azimuth(app, client):
    stored = TerrainSkyline(azimuth_deg=[180.0, 0.0, 90.0, 270.0], horizon_elevation_deg=[3.0, 1.0, 2.0, 4.0])
    use(app, Engine(lambda result: result.model_copy(update={"terrain_skyline": stored})))

    answer = client.post(URL, json=body()).json()

    assert answer["skyline_source"] == "stored_profile"
    assert answer["skyline"] == [{"az": 0.0, "el": 1.0}, {"az": 90.0, "el": 2.0}, {"az": 180.0, "el": 3.0},
                                 {"az": 270.0, "el": 4.0}]
    assert SMOOTH_SPHERE_WARNING not in answer["warnings"]


# ---------------------------------------------------------------- Earth box


def test_earth_box_is_null_when_the_earth_never_rises_above_level(app, client):
    use(app, Engine(with_earth([100.0, 110.0], [-3.0, 0.0])))

    answer = client.post(URL, json=body()).json()

    assert answer["earth_box"] is None
    assert any("earth_box is null" in w for w in answer["warnings"])


def test_earth_box_wraps_past_north(app, client):
    use(app, Engine(with_earth([358.0, 359.5, 1.0, 2.5, 120.0], [1.0, 2.0, 3.0, 4.0, -5.0])))

    answer = client.post(URL, json=body()).json()

    assert answer["earth_box"] == {"az_min": 358.0, "az_max": 2.5, "el_min": 1.0, "el_max": 4.0}


def test_azimuth_range_is_the_shortest_arc():
    assert azimuth_range([10.0, 30.0, 20.0]) == (10.0, 30.0)
    assert azimuth_range([350.0, 5.0, 355.0]) == (350.0, 5.0)  # wraps: start > end
    assert azimuth_range([42.0]) == (42.0, 42.0)
    assert earth_box([10.0, 20.0], [-1.0, -2.0]) is None


# ---------------------------------------------------------------- real engine (skips without kernels)

KERNEL_DIR = os.environ.get("CH_SPICE_KERNEL_DIR") or os.environ.get("CH_NAIF_DIR")


@pytest.mark.skipif(not KERNEL_DIR, reason="set CH_SPICE_KERNEL_DIR to the four NAIF kernels to run the real-sky check")
def test_real_engine_share_above_matches_evaluate_sunlight_at_shackleton():
    app = create_app(Settings(physics_engine="physics", cors_origins=(), spice_kernel_dir=KERNEL_DIR))
    with TestClient(app) as client:
        answer = client.post(URL, json=body())
        evaluation = client.post("/evaluate", json={"sites": [SHACKLETON], "launch_utc": START, "slip_days": 0,
                                                    "stay_days": 14, "hardware": [], "storage_kwh": 0})

    assert answer.status_code == 200 and evaluation.status_code == 200
    data = answer.json()
    assert data["provenance"]["is_synthetic"] is False and data["skyline_source"] == "stored_profile"
    path = data["sun_path"]
    assert len(path) == 337 and data["time_step_s"] == 3600
    share = 100 * sum(p["state"] == "above" for p in path) / len(path)
    assert abs(share - evaluation.json()["results"][0]["sunlight_percent"]) <= 100 / len(path)
    assert datetime.fromisoformat(path[-1]["t"]) - datetime.fromisoformat(path[0]["t"]) == timedelta(days=14)
