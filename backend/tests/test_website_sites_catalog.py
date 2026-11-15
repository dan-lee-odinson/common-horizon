"""GET /sites, GET /catalog and longitude normalisation."""

import json

import pytest

from app.models.website import SiteRef, lon_east_to_signed, normalize_lon_east
from app.planner_bridge import planner
from app.services.sites import PRESET_SITES_FILE


def test_sites_serves_the_17_presets_unchanged(client):
    response = client.get("/sites")

    assert response.status_code == 200
    sites = response.json()["sites"]
    source = json.loads(PRESET_SITES_FILE.read_text(encoding="utf-8"))["sites"]
    assert len(sites) == 17
    for served, original in zip(sites, source, strict=True):
        assert served["id"] == original["id"]
        assert served["name"] == original["name"]
        assert served["lat"] == original["lat"]
        assert served["lon_east"] == original["lon_east"]
        assert served["note"] == original["note"]
        assert served["default_hardware"] == original.get("default_hardware", [])
        assert 0 <= served["lon_east"] < 360


def test_preset_default_hardware_ids_exist_in_the_catalog(client):
    catalog_ids = {item["id"] for item in client.get("/catalog").json()["items"]}
    for site in client.get("/sites").json()["sites"]:
        assert set(site["default_hardware"]) <= catalog_ids, site["id"]


@pytest.mark.parametrize(
    ("given", "east", "signed"),
    [
        (196.739, 196.739, -163.261),
        (-163.261, 196.739, -163.261),
        (0.0, 0.0, 0.0),
        (-0.0, 0.0, 0.0),
        (360.0, 0.0, 0.0),
        (-180.0, 180.0, 180.0),
        (180.0, 180.0, 180.0),
        (359.999, 359.999, -0.001),
    ],
)
def test_longitude_is_normalised_east_positive(given, east, signed):
    ref = SiteRef(id="x", name="x", lat=0.0, lon_east=given)
    assert ref.lon_east == pytest.approx(east)
    assert str(ref.lon_east) != "-0.0"
    assert lon_east_to_signed(normalize_lon_east(given)) == pytest.approx(signed)


@pytest.mark.parametrize("lon", [-180.01, 360.01, float("nan")])
def test_longitude_outside_the_accepted_range_is_rejected(lon):
    with pytest.raises(ValueError):
        SiteRef(id="x", name="x", lat=0.0, lon_east=lon)


def test_custom_site_ids_from_the_website_are_accepted():
    SiteRef(id="custom:-89.6840:196.7390", name="Typed point", lat=-89.684, lon_east=196.739)


# ---------------------------------------------------------------- catalog


@pytest.fixture
def items(client):
    response = client.get("/catalog")
    assert response.status_code == 200
    return {item["id"]: item for item in response.json()["items"]}


def test_catalog_has_every_planner_item_once(items):
    data = planner.list_catalog()
    expected = {
        "lander": [e["id"] for e in data["landers"]],
        "cargo": [e["id"] for e in data["payloads"]],
        "power": [e["id"] for e in data["power_sources"]],
        "load": [e["id"] for e in data["power_loads"]],
    }
    for kind, ids in expected.items():
        assert sorted(i for i, item in items.items() if item["kind"] == kind) == sorted(ids)
    assert len(items) == sum(len(ids) for ids in expected.values())


def test_landers_keep_every_published_capacity_figure(items):
    griffin = items["griffin"]
    assert griffin["capacity_kg"] == 625
    assert griffin["max_slope_deg"] == 10
    assert griffin["figures"]["max_slope"]["status"] == ["company figure"]
    assert griffin["mass_kg"] is None  # a lander's own mass is not payload, and none is published here
    starship = items["starship_hls"]
    assert starship["capacity_kg"] is None  # two published figures: neither is chosen for the visitor
    assert {o["option"]: o["capacity_kg"] for o in starship["capacity_options"]} == {
        "company": 100000,
        "nasa_cargo_variants": 12000,
    }
    assert starship["max_slope_deg"] is None  # no published slope limit mapped (tilt is not slope)
    assert items["blue_moon_mk1"]["max_slope_deg"] is None
    assert all(not items[i]["countable"] and items[i]["max_count"] == 1 for i in items if items[i]["kind"] == "lander")


def test_missing_masses_stay_missing(items):
    assert items["jaxa_pressurized_rover"]["mass_kg"] is None
    assert items["jaxa_pressurized_rover"]["figures"]["mass"]["value"] is None
    assert items["surface_habitat"]["mass_kg"] == 12000
    assert items["fsp_40kwe"]["mass_kg"] == 6000


def test_power_figures_are_converted_to_kw_without_losing_the_original(items):
    keep_alive = items["keep_alive_heat"]  # published as 140 W, in darkness
    assert keep_alive["load_day_kw"] == 0
    assert keep_alive["load_night_kw"] == pytest.approx(0.14)
    assert keep_alive["figures"]["power"]["value"] == 140
    assert keep_alive["figures"]["power"]["unit"] == "W"

    rover = items["pressurized_rover_recharge"]  # peak 9.5 kW is the default, in sunlight
    assert (rover["load_day_kw"], rover["load_night_kw"]) == (9.5, 0)
    assert set(rover["figures"]) == {"power_peak", "power_average"}

    hab = items["hab_crewed"]
    assert (hab["load_day_kw"], hab["load_night_kw"]) == (20, 20)
    warm = items["crew_rover_keep_warm"]
    assert warm["energy_per_night_kwh"] == 9.7

    array = items["hab_array"]  # published range 10-15 kW: the low end, as in the planner
    assert array["gen_kw"] == 10 and array["gen_needs_sun"] is True
    assert array["figures"]["power"]["value"] == [10, 15]
    assert items["regenerative_fuel_cell"]["gen_needs_sun"] is False
    assert items["fission_40kwe"]["gen_kw"] == 40


def test_fields_that_do_not_apply_are_null_not_zero(items):
    assert items["vsat"]["load_day_kw"] is None and items["vsat"]["mass_kg"] is None
    assert items["hab_crewed"]["gen_kw"] is None and items["hab_crewed"]["gen_needs_sun"] is None
    assert items["logistics"]["gen_kw"] is None and items["logistics"]["load_night_kw"] is None


def test_status_labels_and_sources_are_carried(items, client):
    assert client.get("/catalog").json()["status_labels"] == list(planner.STATUS_LABELS)
    assert items["fsp_40kwe"]["figures"]["mass"]["status"] == ["NASA goal"]
    assert items["fsp_40kwe"]["figures"]["mass"]["source"].startswith("Kaldon")
    assert items["comms_relay"]["figures"]["power"]["status"] == ["research estimate"]
