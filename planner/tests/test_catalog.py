"""Catalog tests: shape of the data, and every figure pinned one by one."""

import json

import pytest

from planner import PlannerInputError, STATUS_LABELS, get_item, list_catalog, validate_catalog
from planner.catalog import _iter_figures

TBA = "source to add"
MK1 = "Blue Origin; Gunter's Space Page"
MK2 = "Blue Origin; Space.com"
HLS = "SpaceX HLS program manager, 2022"
GRIFFIN = "Astrobotic (now Voyager Lunar Systems)"
KALDON = "Kaldon et al., IAC 2024, NTRS 20240011694"
CSANK = "Csank 2023, NTRS 20230002896"
SCHUNK = (
    "Schunk, NTRS 20210026557 (conceptual thermal design based on NASA's "
    "Surface Habitat reference design)"
)
TILT = "NASA HLS-R-0071, through a secondary source"

# path -> (value, unit, status labels, source)
EXPECTED = {
    # Landers
    "landers/blue_moon_mk1/capacity/published": (3000, "kg", ["built", "company figure"], MK1),
    "landers/blue_moon_mk1/dimensions/height": (8.05, "m", ["built", "company figure"], MK1),
    "landers/blue_moon_mk1/dimensions/width": (3.08, "m", ["built", "company figure"], MK1),
    "landers/blue_moon_mk1/fueled_mass": (21350, "kg", ["built", "company figure"], MK1),
    "landers/blue_moon_mk2_cargo/capacity/one_way": (30000, "kg", ["company figure"], MK2),
    "landers/blue_moon_mk2_cargo/capacity/reusable": (20000, "kg", ["company figure"], MK2),
    "landers/blue_moon_mk2_cargo/dimensions/height": (16, "m", ["company figure"], MK2),
    "landers/starship_hls/capacity/company": (100000, "kg", ["company figure"], HLS),
    "landers/starship_hls/capacity/nasa_cargo_variants": (
        [12000, 15000], "kg", ["NASA figure"], "Creech, IAC 2025, NTRS 20250008728"),
    "landers/starship_hls/dimensions/height": (52, "m", ["company figure"], HLS),
    "landers/starship_hls/dimensions/width": (9, "m", ["company figure"], HLS),
    "landers/griffin/capacity/published": (625, "kg", ["built", "company figure"], GRIFFIN),
    "landers/griffin/dimensions/height": (2, "m", ["built", "company figure"], GRIFFIN),
    "landers/griffin/dimensions/width": (4.5, "m", ["built", "company figure"], GRIFFIN),
    # Payloads
    "payloads/astrolab_clv1/mass": (907, "kg", ["NASA figure"], TBA),
    "payloads/astrolab_clv1/dimensions/length": (4, "m", ["NASA figure"], TBA),
    "payloads/astrolab_clv1/dimensions/width": (2.3, "m", ["NASA figure"], TBA),
    "payloads/astrolab_clv1/dimensions/height": (2.6, "m", ["NASA figure"], TBA),
    "payloads/fsp_40kwe/mass": (6000, "kg", ["NASA goal"], KALDON),
    "payloads/fsp_40kwe/dimensions/stowed_size": ([4, 6], "m", ["NASA goal"], KALDON),
    "payloads/surface_habitat/mass": (
        12000, "kg", ["NASA study"], "Burke and Howard, AIAA ASCEND 2022"),
    "payloads/jaxa_pressurized_rover/mass": (None, "kg", [], "not published"),
    "payloads/jaxa_pressurized_rover/dimensions/length": (6.0, "m", [], TBA),
    "payloads/jaxa_pressurized_rover/dimensions/width": (5.2, "m", [], TBA),
    "payloads/jaxa_pressurized_rover/dimensions/height": (3.8, "m", [], TBA),
    "payloads/logistics/mass": (8000, "kg", ["NASA figure"], TBA),
    # Power loads
    "power_loads/hab_crewed/power": (20, "kW", ["NASA figure"], CSANK),
    "power_loads/hab_uncrewed/power": (2, "kW", ["NASA figure"], CSANK),
    "power_loads/crew_rover_recharge/power": (2, "kW", ["our estimate"], TBA),
    "power_loads/crew_rover_recharge/energy_per_drive_day": (16, "kWh", ["our estimate"], TBA),
    "power_loads/crew_rover_keep_warm/energy_per_night": (
        9.7, "kWh", ["NASA study"], "NTRS 20240004621"),
    "power_loads/science_rover_recharge/power": (500, "W", ["NASA figure"], "NTRS 20220005893"),
    "power_loads/pressurized_rover_recharge/power_options/peak": (
        9.5, "kW", ["university study"], "NTRS 19940021211"),
    "power_loads/pressurized_rover_recharge/power_options/average": (
        6.5, "kW", ["university study"], "NTRS 19940021211"),
    "power_loads/worksite_lighting/power": (1, "kW", ["our estimate"], TBA),
    "power_loads/keep_alive_heat/power": (140, "W", ["NASA study"], "NTRS 20220005798"),
    "power_loads/comms_relay/power": (200, "W", ["research estimate"], "arXiv 2508.10855"),
    "power_loads/isru_pilot/power": (20, "kW", ["NASA figure"], "NTRS 20190032521"),
    "power_loads/isru_full_plant/power": (60, "kW", ["NASA figure"], TBA),
    # Power sources
    "power_sources/fission_100kwe/power": (100, "kW", ["NASA goal"], TBA),
    "power_sources/fission_40kwe/power": (40, "kW", ["NASA goal"], TBA),
    "power_sources/vsat/power": (10, "kW", ["company figure"], TBA),
    "power_sources/vsat_xl/power": (50, "kW", ["company figure"], TBA),
    "power_sources/hab_array/power": ([10, 15], "kW", ["NASA study"], SCHUNK),
    "power_sources/regenerative_fuel_cell/power": (10, "kW", ["NASA goal"], TBA),
    # Heating
    "heating/heat_leak": (1550, "W", ["NASA study"], SCHUNK),
    "heating/radiator_protection_deployed": (3840, "W", ["NASA study"], SCHUNK),
    "heating/radiator_protection_stowed": (700, "W", ["NASA study"], SCHUNK),
    # Rule and constants
    "margin_rule/green_at_percent": (
        25, "%", ["NASA figure"], "GSFC-STD-1000 Rev I, Table 1.06-1"),
    "constants/lunar_month_hours": (708.73, "h", [], TBA),
    "constants/standard_gravity": (9.80665, "m/s^2", [], TBA),
    # Reference values
    "reference/dv_halo_to_surface_2018": (2850, "m/s", ["NASA figure"], "NASA 2018"),
    "reference/dv_halo_to_surface_2019": (2750, "m/s", ["NASA figure"], "NASA 2019"),
    "reference/dv_halo_to_surface_2023": (2700, "m/s", ["NASA figure"], "NASA 2023"),
    "reference/crew_lander_tilt_threshold": ([0, 8], "deg", ["NASA figure"], TILT),
    "reference/crew_lander_tilt_goal": ([0, 5], "deg", ["NASA goal"], TILT),
    "reference/griffin_slope": (10, "deg", ["company figure"], "Voyager"),
    "reference/apollo_sun_elevation": ([5, 25], "deg", ["NASA figure"], TBA),
    "reference/crew_rover_battery": (
        23.22, "kWh", ["NASA study"], "Venturi, NASA Aerospace Battery Workshop, Jan 2026"),
}

# Figures the brief gives with "about", "under" or "up to".
QUALIFIERS = {
    "landers/blue_moon_mk1/fueled_mass": "under",
    "landers/blue_moon_mk2_cargo/dimensions/height": "about",
    "landers/griffin/dimensions/height": "about",
    "landers/griffin/dimensions/width": "about",
    "payloads/astrolab_clv1/mass": "about",
    "payloads/astrolab_clv1/dimensions/length": "about",
    "payloads/astrolab_clv1/dimensions/width": "about",
    "payloads/astrolab_clv1/dimensions/height": "about",
    "payloads/fsp_40kwe/mass": "under",
    "payloads/logistics/mass": "up to",
    "power_loads/crew_rover_recharge/energy_per_drive_day": "about",
    "heating/radiator_protection_stowed": "about",
}


# Labels the team did not state for these figures; inferred, flagged, to confirm.
INFERRED = {
    "margin_rule/green_at_percent",
    "reference/dv_halo_to_surface_2018",
    "reference/dv_halo_to_surface_2019",
    "reference/dv_halo_to_surface_2023",
    "reference/crew_lander_tilt_threshold",
    "reference/crew_lander_tilt_goal",
    "reference/griffin_slope",
    "reference/apollo_sun_elevation",
}


def all_figures():
    return dict(_iter_figures(list_catalog()))


def test_catalog_is_well_formed():
    assert validate_catalog() == []


def test_status_labels_are_the_eight():
    assert list_catalog("status_labels") == list(STATUS_LABELS)
    assert len(STATUS_LABELS) == 8


def test_every_figure_is_pinned_and_none_is_extra():
    assert set(all_figures()) == set(EXPECTED)


@pytest.mark.parametrize("path", sorted(EXPECTED))
def test_figure_matches(path):
    value, unit, status, source = EXPECTED[path]
    fig = all_figures()[path]
    assert fig["value"] == value
    assert fig["unit"] == unit
    assert fig["status"] == status
    assert fig["source"] == source
    assert fig.get("qualifier") == QUALIFIERS.get(path)


def test_inferred_labels_are_flagged_and_explained():
    flagged = {path for path, fig in all_figures().items() if fig.get("status_inferred")}
    assert flagged == INFERRED
    for path in INFERRED:
        assert "confirm" in all_figures()[path]["status_note"].lower()


def test_validate_catalog_wants_a_note_for_an_inferred_label():
    broken = list_catalog()
    del broken["reference"][0]["figure"]["status_note"]
    assert any("inferred label needs a status_note" in p for p in validate_catalog(broken))


def test_range_defaults_take_the_harder_end():
    figs = all_figures()
    # A capacity and a power source: the bottom of the range.
    assert figs["landers/starship_hls/capacity/nasa_cargo_variants"]["default"] == 12000
    assert figs["power_sources/hab_array/power"]["default"] == 10
    # A load given as average and peak: the peak.
    assert get_item("power_loads", "pressurized_rover_recharge")["default_option"] == "peak"


def test_load_and_source_timing():
    runs = {load["id"]: load["runs"] for load in list_catalog("power_loads")}
    assert runs == {
        "hab_crewed": "always",
        "hab_uncrewed": "always",
        "crew_rover_recharge": "light",
        "crew_rover_keep_warm": "dark",
        "science_rover_recharge": "light",
        "pressurized_rover_recharge": "light",
        "worksite_lighting": "dark",
        "keep_alive_heat": "dark",
        "comms_relay": "always",
        "isru_pilot": "light",
        "isru_full_plant": "light",
    }
    works = {source["id"]: source["works"] for source in list_catalog("power_sources")}
    assert works == {
        "fission_100kwe": "always",
        "fission_40kwe": "always",
        "vsat": "light",
        "vsat_xl": "light",
        "hab_array": "light",
        "regenerative_fuel_cell": "dark",
    }


def test_list_catalog_returns_a_safe_copy():
    first = list_catalog()
    first["landers"][0]["capacity_options"][0]["value"] = 1
    assert list_catalog()["landers"][0]["capacity_options"][0]["value"] == 3000


def test_list_catalog_is_json_ready():
    text = json.dumps(list_catalog())
    assert "Blue Moon Mark 1" in text


def test_unknown_section_and_id_say_what_to_type():
    with pytest.raises(PlannerInputError, match="Choose one of"):
        list_catalog("rockets")
    with pytest.raises(PlannerInputError, match="Known ids"):
        get_item("landers", "eagle")


def test_validate_catalog_catches_a_bad_label():
    broken = list_catalog()
    broken["payloads"][0]["mass"]["status"] = ["NASA guess"]
    assert any("unknown status label" in p for p in validate_catalog(broken))


def test_validate_catalog_catches_a_missing_source():
    broken = list_catalog()
    broken["power_sources"][0]["power"]["source"] = ""
    assert any("no source" in p for p in validate_catalog(broken))
