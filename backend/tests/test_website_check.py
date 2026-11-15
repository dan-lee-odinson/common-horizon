"""POST /check: validation and faithful use of the planner's functions."""

import pytest

from app.physics.factory import get_physics_engine
from app.planner_bridge import planner
from tests.website_helpers import LAUNCH, ScriptedEngine, site_ref

URL = "/check"
SITE = site_ref("nobile", -85.42088, 31.6218)


def _body(**overrides):
    body = {
        "site": SITE,
        "landing_utc": LAUNCH,
        "stay_days": 14,
        "hardware": [
            {"id": "griffin", "count": 1},
            {"id": "hab_crewed", "count": 1},
            {"id": "fission_40kwe", "count": 1},
        ],
        "storage_kwh": 0,
    }
    body.update(overrides)
    return body


@pytest.fixture
def dark_72h(app):
    engine = ScriptedEngine(lambda lat, lon, start: {"sunlight_percentage": 70, "longest_darkness_hours": 72})
    app.dependency_overrides[get_physics_engine] = lambda: engine
    return engine


@pytest.mark.parametrize(
    ("change", "fragment"),
    [
        ({"hardware": [{"id": "eagle", "count": 1}]}, "Unknown hardware id 'eagle'"),
        ({"hardware": [{"id": "griffin", "count": 1}, {"id": "starship_hls", "count": 1}]}, "Choose one lander"),
        ({"hardware": [{"id": "griffin", "count": 2}]}, "over its maximum of 1"),
    ],
)
def test_hardware_the_planner_cannot_use_is_422(client, change, fragment):
    response = client.post(URL, json=_body(**change))
    assert response.status_code == 422
    assert fragment in response.json()["detail"]


@pytest.mark.parametrize(
    "change",
    [
        {"hardware": [{"id": "vsat", "count": 1}, {"id": "vsat", "count": 2}]},
        {"hardware": [{"id": "vsat", "count": -1}]},
        {"hardware": [{"id": "vsat", "count": 11}]},
        {"hardware": [{"id": "vsat", "count": 1.5}]},
        {"storage_kwh": -1},
        {"storage_kwh": 1_000_001},
        {"storage_kwh": "lots"},
        {"stay_days": 0.5},
        {"stay_days": 366},
        {"landing_utc": "2027-02-10T15:00:00"},
        {"landing_utc": "1999-12-31T00:00:00Z"},
        {"site": {**SITE, "lon_east": 400}},
        {"site": {**SITE, "extra": 1}},
    ],
)
def test_invalid_requests_are_422(client, change):
    assert client.post(URL, json=_body(**change)).status_code == 422


def test_numbers_are_the_planners_own(client, dark_72h):
    response = client.post(URL, json=_body(storage_kwh=100))

    assert response.status_code == 200
    data = response.json()
    expected = planner.power_check(
        [{"id": "hab_crewed", "count": 1}],
        [{"id": "fission_40kwe", "count": 1}],
        storage_kwh=100,
        longest_darkness_h=72,
    )
    assert data["night"]["longest_darkness_h"] == 72
    assert data["night"]["margin_percent"] == expected["night"]["margin_percent"]
    assert data["day"]["margin_percent"] == expected["day"]["margin_percent"]
    assert data["balance"] == {k: expected["balance"][k] for k in ("margin_percent", "status", "limiting")}
    assert data["night"]["basis"] == "power"  # fission carries the night on its own
    # site_energy over the stay's dark hours (30 % of 14 days), one dark spell or more
    energy = planner.site_energy(
        [{"id": "hab_crewed", "count": 1}], dark_hours=0.3 * 14 * 24, nights=max(1, data["site_energy"]["nights"])
    )
    assert data["site_energy"]["total_kwh"] == pytest.approx(energy["total_kwh"])
    assert data["energy_added_kwh"] is None  # the planner has no net generation-minus-load figure
    assert data["provenance"]["engine_name"] == "scripted-test-engine"


def test_without_a_site_the_night_check_compares_power_only(client):
    response = client.post(URL, json=_body(site=None, storage_kwh=500))

    assert response.status_code == 200
    data = response.json()
    assert data["night"]["basis"] == "power only"
    assert data["night"]["longest_darkness_h"] is None
    assert data["site_energy"] is None and data["provenance"] is None
    assert any("not counted" in note for note in data["power_notes"])  # the planner's own note


@pytest.mark.parametrize(
    ("hardware", "fits", "verdict"),
    [
        ([{"id": "griffin", "count": 1}, {"id": "astrolab_clv1", "count": 1}], False, "does not fit"),
        ([{"id": "blue_moon_mk1", "count": 1}, {"id": "astrolab_clv1", "count": 1}], True, "fits"),
        (
            [
                {"id": "starship_hls", "count": 1},
                {"id": "surface_habitat", "count": 1},
                {"id": "logistics", "count": 1},
            ],
            None,
            "depends on capacity figure",
        ),
        ([{"id": "griffin", "count": 1}, {"id": "jaxa_pressurized_rover", "count": 1}], None, "mass needed"),
        ([{"id": "surface_habitat", "count": 1}], False, "no lander"),
        ([{"id": "griffin", "count": 1}], True, "nothing to fit"),
    ],
)
def test_fit_keeps_the_planners_undecided_answers(client, dark_72h, hardware, fits, verdict):
    data = client.post(URL, json=_body(hardware=hardware)).json()
    assert (data["fits"], data["fit_verdict"]) == (fits, verdict)
    assert data["fit_notes"]


def test_count_zero_means_not_chosen(client, dark_72h):
    data = client.post(
        URL, json=_body(hardware=[{"id": "griffin", "count": 1}, {"id": "surface_habitat", "count": 0}])
    ).json()
    assert data["fit_verdict"] == "nothing to fit"


def test_storage_is_passed_to_the_planner(client, app):
    engine = ScriptedEngine(lambda lat, lon, start: {"sunlight_percentage": 70, "longest_darkness_hours": 100})
    app.dependency_overrides[get_physics_engine] = lambda: engine
    hardware = [{"id": "griffin", "count": 1}, {"id": "comms_relay", "count": 1}, {"id": "vsat", "count": 1}]
    short = client.post(URL, json=_body(hardware=hardware, storage_kwh=0)).json()
    enough = client.post(URL, json=_body(hardware=hardware, storage_kwh=20)).json()
    assert short["night"]["passes"] is False and short["night"]["storage_needed_kwh"] == pytest.approx(20)
    assert enough["night"]["passes"] is True and enough["night"]["storage_kwh"] == 20
