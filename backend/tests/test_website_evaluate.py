"""POST /evaluate: ranking through the API, missing data, launch delay, labelling and website contract."""

import json
import re
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from app.models import limits
from app.physics.factory import get_physics_engine
from app.services.website_evaluation import choose_time_step
from app.timegrid import SECONDS_PER_DAY, count_samples
from tests.website_helpers import LAUNCH, ScriptedEngine, evaluate_body, site_ref

URL = "/evaluate"
WEB_TYPES = Path(__file__).resolve().parents[2] / "web" / "src" / "api" / "types.ts"

GOOD = {"sunlight_percentage": 90, "longest_darkness_hours": 10, "earth_visibility_percentage": 100, "slope_deg": 2.0}


def _use(app, script, synthetic=False):
    engine = ScriptedEngine(script, synthetic=synthetic)
    app.dependency_overrides[get_physics_engine] = lambda: engine
    return engine


def _by_latitude(table):
    return lambda lat, lon, start: table[round(lat, 3)]


def test_all_17_presets_are_evaluated_and_ranked(client):
    presets = client.get("/sites").json()["sites"]
    refs = [site_ref(s["id"], s["lat"], s["lon_east"], s["name"]) for s in presets]

    response = client.post(URL, json=evaluate_body(refs, stay_days=14))

    assert response.status_code == 200
    results = response.json()["results"]
    assert sorted(r["site_id"] for r in results) == sorted(s["id"] for s in presets)
    assert [r["rank"] for r in results] == list(range(1, 18))


def test_order_follows_dans_rules_through_the_api(app, client):
    table = {
        1.0: {**GOOD, "sunlight_percentage": 50},  # passes, lower score
        2.0: GOOD,  # passes, best
        3.0: {**GOOD, "earth_visibility_percentage": 0},  # higher score than site 1 but fails Earth contact
        4.0: {**GOOD, "slope_deg": None},  # slope unknown: verdict unknown
    }
    _use(app, _by_latitude(table))
    sites = [site_ref(f"s{int(lat)}", lat, 10.0) for lat in table]

    data = client.post(URL, json=evaluate_body(sites)).json()

    order = [(r["site_id"], r["verdict"]["result"], r["verdict"]["requirement"]) for r in data["results"]]
    assert order == [
        ("s2", "pass", None),
        ("s1", "pass", None),
        ("s4", "unknown", "landing slope"),
        ("s3", "fail", "Earth contact"),
    ]
    best = data["results"][0]
    assert best["score"] == pytest.approx(0.40 * 90 + 0.25 * 100 * (1 - 10 / 354) + 0.20 * 100 + 0.15 * 80)
    assert data["results"][3]["earth_link"] == "none"


def test_first_failed_requirement_through_the_api(app, client):
    _use(app, lambda lat, lon, start: {**GOOD, "earth_visibility_percentage": 0})
    sites = [site_ref("a", 1.0, 10.0)]

    no_lander = client.post(URL, json=evaluate_body(sites, hardware=[{"id": "vsat", "count": 1}])).json()
    assert no_lander["results"][0]["verdict"]["requirement"] == "hardware fit"

    steep = {**GOOD, "slope_deg": 12.0}
    _use(app, lambda lat, lon, start: steep)
    data = client.post(URL, json=evaluate_body(sites)).json()
    assert data["results"][0]["verdict"] == {
        "result": "fail",
        "requirement": "landing slope",
        "unknown_requirements": [],
    }

    _use(app, lambda lat, lon, start: GOOD)
    no_power = [{"id": "griffin", "count": 1}, {"id": "hab_crewed", "count": 1}]
    data = client.post(URL, json=evaluate_body(sites, hardware=no_power, storage_kwh=0)).json()
    assert data["results"][0]["verdict"]["requirement"] == "night power"


def test_missing_slope_and_terrain_are_reported_not_invented(app, client):
    _use(app, lambda lat, lon, start: {**GOOD, "slope_deg": None, "sky_visibility_fraction": None})

    data = client.post(URL, json=evaluate_body([site_ref("a", 1.0, 10.0)])).json()

    result = data["results"][0]
    assert result["slope_deg"] is None
    assert result["score"] is None
    assert result["score_components"]["slope"] is None
    assert result["score_max"] - result["score_min"] == pytest.approx(15)
    assert result["clear_sky_percent"] is None
    assert result["verdict"] == {
        "result": "unknown",
        "requirement": "landing slope",
        "unknown_requirements": ["landing slope"],
    }
    assert any("Slope is unknown for 1 of 1" in w for w in data["warnings"])


def test_a_lander_without_a_published_slope_limit_leaves_slope_unknown(app, client):
    _use(app, lambda lat, lon, start: GOOD)
    hardware = [{"id": "blue_moon_mk1", "count": 1}, {"id": "comms_relay", "count": 1}, {"id": "vsat", "count": 1}]
    result = client.post(URL, json=evaluate_body([site_ref("a", 1.0, 10.0)], hardware=hardware)).json()["results"][0]
    assert result["verdict"]["result"] == "unknown"
    assert result["score"] is not None  # the slope itself is known, only the lander's limit is not


def test_launch_delay_changes_the_ranking(app, client):
    launch = datetime(2027, 2, 10, 15, tzinfo=UTC)

    def script(lat, lon, start):
        early = start < launch + timedelta(days=5)
        better = (lat == 1.0) == early
        return {**GOOD, "sunlight_percentage": 90 if better else 40}

    _use(app, script)
    sites = [site_ref("a", 1.0, 10.0), site_ref("b", 2.0, 10.0)]

    planned = client.post(URL, json=evaluate_body(sites, slip_days=0)).json()
    slipped = client.post(URL, json=evaluate_body(sites, slip_days=10)).json()

    assert [r["site_id"] for r in planned["results"]] == ["a", "b"]
    assert [r["site_id"] for r in slipped["results"]] == ["b", "a"]
    assert slipped["landing_utc"] == "2027-02-20T15:00:00Z"


def test_landing_time_and_transit(app, client):
    engine = _use(app, lambda lat, lon, start: GOOD)
    sites = [site_ref("a", 1.0, 10.0)]

    unstated = client.post(URL, json=evaluate_body(sites, slip_days=3)).json()
    assert unstated["landing_utc"] == "2027-02-13T15:00:00Z"
    assert unstated["transit_days"] is None
    assert any("transit_days was not given" in w for w in unstated["warnings"])

    stated = client.post(URL, json=evaluate_body(sites, slip_days=3, transit_days=4.5)).json()
    assert stated["landing_utc"] == "2027-02-18T03:00:00Z"
    assert not any("transit_days" in w for w in stated["warnings"])
    assert engine.calls[-1].start_utc == datetime(2027, 2, 18, 3, tzinfo=UTC)


def test_synthetic_data_is_labelled(client):
    response = client.post(URL, json=evaluate_body([site_ref("a", -85.42088, 31.6218)]))

    assert response.headers["X-Data-Source"] == "synthetic"
    provenance = response.json()["provenance"]
    assert provenance["is_synthetic"] is True
    assert provenance["source"] == "synthetic"
    assert "SYNTHETIC" in provenance["notice"]


def test_engine_results_are_labelled_as_physics(app, client):
    _use(app, lambda lat, lon, start: GOOD, synthetic=False)
    response = client.post(URL, json=evaluate_body([site_ref("a", 1.0, 10.0)]))
    assert response.headers["X-Data-Source"] == "physics_engine"
    assert response.json()["provenance"]["is_synthetic"] is False


def test_geometry_comes_from_the_engines_positions(client):
    data = client.post(URL, json=evaluate_body([site_ref("a", 1.0, 10.0)])).json()
    geometry = data["geometry"]
    assert -2 < geometry["subsolar_lat"] < 2  # the Sun stays near the lunar equator
    assert 0 <= geometry["subsolar_lon_east"] < 360
    assert -8 < geometry["subearth_lat"] < 8  # libration
    assert geometry["subearth_lon_east"] < 10 or geometry["subearth_lon_east"] > 350


@pytest.mark.parametrize(("sites", "stay"), [(1, 14), (17, 14), (17, 365), (25, 365)])
def test_time_step_keeps_the_whole_request_in_budget(sites, stay):
    step = choose_time_step(stay, sites)
    assert step >= 3600 and step % 60 == 0
    assert sites * count_samples(stay * SECONDS_PER_DAY, step) <= limits.WEBSITE_MAX_TOTAL_SAMPLES
    if step > 3600:  # the smallest such step
        assert sites * count_samples(stay * SECONDS_PER_DAY, step - 60) > limits.WEBSITE_MAX_TOTAL_SAMPLES


def test_long_stays_with_many_sites_report_the_coarser_step(app, client):
    engine = _use(app, lambda lat, lon, start: GOOD)
    sites = [site_ref(f"s{i}", float(i), 10.0) for i in range(17)]
    data = client.post(URL, json=evaluate_body(sites, stay_days=365)).json()
    assert data["time_step_s"] > 3600
    assert all(call.time_step_s == data["time_step_s"] for call in engine.calls)
    assert any(f"Sampled every {data['time_step_s']} s" in w for w in data["warnings"])


@pytest.mark.parametrize(
    "change",
    [
        {"sites": []},
        {"sites": [site_ref(f"s{i}", 0.0, float(i)) for i in range(26)]},
        {"sites": [site_ref("a", 0.0, 1.0), site_ref("a", 0.0, 2.0)]},
        {"slip_days": 31},
        {"slip_days": -1},
        {"stay_days": 0.9},
        {"stay_days": 366},
        {"launch_utc": "2027-02-10 15:00"},
        {"launch_utc": "2027-02-10T15:00:00"},
        {"launch_utc": "2099-12-25T00:00:00Z", "stay_days": 14},  # the stay would end after 2100
        {"transit_days": -1},
        {"storage_kwh": float("inf")},
        {"hardware": [{"id": "griffin", "count": 1}, {"id": "griffin", "count": 1}]},
        {"hardware": [{"id": "griffin", "count": 1}, {"id": "nope", "count": 1}]},
    ],
)
def test_invalid_requests_are_422(client, change):
    body = {**evaluate_body([site_ref("a", 1.0, 10.0)]), **change}
    # json.dumps writes inf as Infinity, which the backend must refuse (allow_inf_nan=False).
    response = client.post(URL, content=json.dumps(body), headers={"Content-Type": "application/json"})
    assert response.status_code == 422


# ---------------------------------------------------------------- website contract


def _interface_fields(source: str, name: str) -> set[str]:
    match = re.search(rf"export interface {name} \{{(.*?)\n\}}", source, re.DOTALL)
    assert match, name
    fields = set()
    for line in match.group(1).splitlines():
        found = re.match(r"\s{2}(\w+)\??:", line)
        if found:
            fields.add(found.group(1))
    return fields


@pytest.fixture
def web_types():
    if not WEB_TYPES.exists():
        pytest.skip("web/ is not in this checkout")
    return WEB_TYPES.read_text(encoding="utf-8")


def test_responses_carry_every_field_the_website_reads(client, web_types):
    sites = client.get("/sites").json()
    catalog = client.get("/catalog").json()
    evaluation = client.post(URL, json=evaluate_body([site_ref("a", 1.0, 10.0)])).json()
    check = client.post(
        "/check",
        json={
            "site": site_ref("a", 1.0, 10.0),
            "landing_utc": LAUNCH,
            "stay_days": 2,
            "hardware": [],
            "storage_kwh": 0,
        },
    ).json()
    health = client.get("/health").json()

    shapes = {
        "SiteListResponse": sites,
        "Site": sites["sites"][0],
        "CatalogResponse": catalog,
        "CatalogItem": catalog["items"][0],
        "EvaluateResponse": evaluation,
        "SiteEvaluation": evaluation["results"][0],
        "Verdict": evaluation["results"][0]["verdict"],
        "Geometry": evaluation["geometry"],
        "CheckResponse": check,
        "DayCheck": check["day"],
        "NightCheck": check["night"],
        "PowerBalance": check["balance"],
        "HealthResponse": health,
    }
    optional_in_web = {"note", "default_hardware", "capacity_kg", "max_slope_deg", "energy_per_night_kwh"}
    for name, payload in shapes.items():
        missing = _interface_fields(web_types, name) - set(payload) - optional_in_web
        assert not missing, f"{name} lacks {sorted(missing)}"


def test_the_website_request_shapes_are_accepted(client, web_types):
    for name in ("EvaluateRequest", "CheckRequest", "SiteRef", "HardwareChoice"):
        assert _interface_fields(web_types, name)  # the interfaces still exist where the test reads them
    body = {
        "sites": [{"id": "custom:-89.6840:196.7390", "name": "Typed point", "lat": -89.684, "lon_east": 196.739}],
        "launch_utc": "2027-02-10T15:00:00.000Z",  # what toIsoUtc() sends
        "slip_days": 0,
        "stay_days": 14.25,  # the website's quarter-day steps
        "hardware": [{"id": "griffin", "count": 1}],
        "storage_kwh": 0,
    }
    assert set(body) == _interface_fields(web_types, "EvaluateRequest")
    assert client.post(URL, json=body).status_code == 200
