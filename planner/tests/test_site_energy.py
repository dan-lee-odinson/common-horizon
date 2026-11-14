"""Site energy tests: night penalty and heating penalty."""

import pytest

from planner import LUNAR_MONTH_HOURS, PlannerInputError, dark_hours_from_percent, site_energy

NIGHT_LOADS = ["hab_crewed", "worksite_lighting", "comms_relay", "keep_alive_heat"]


def test_one_lunar_month_is_708_73_hours():
    assert LUNAR_MONTH_HOURS == 708.73


def test_night_penalty_at_7_73_percent_dark_is_about_1169_kwh():
    result = site_energy(NIGHT_LOADS, dark_percent=7.73)
    assert result["dark_hours"] == pytest.approx(0.0773 * 708.73)
    assert result["night_penalty_kwh"] == pytest.approx(1169, abs=0.5)
    assert result["heating_penalty_kwh"] == 0
    assert result["total_kwh"] == pytest.approx(result["night_penalty_kwh"])


def test_rover_keep_warm_adds_9_7_kwh_per_night():
    without = site_energy(NIGHT_LOADS, dark_percent=7.73)["night_penalty_kwh"]
    with_rover = site_energy(NIGHT_LOADS + ["crew_rover_keep_warm"], dark_percent=7.73)
    assert with_rover["night_penalty_kwh"] == pytest.approx(without + 9.7)
    two_nights = site_energy(["crew_rover_keep_warm"], dark_hours=10, nights=2)
    assert two_nights["night_penalty_kwh"] == pytest.approx(19.4)
    no_night = site_energy(["crew_rover_keep_warm"], dark_hours=0, nights=2)
    assert no_night["night_penalty_kwh"] == 0


def test_daytime_loads_add_nothing_at_night():
    result = site_energy(["isru_pilot", "crew_rover_recharge"], dark_hours=100)
    assert result["total_kwh"] == 0


def test_heating_100_dark_hours_deployed_is_539_kwh():
    result = site_energy(["hab_uncrewed"], dark_hours=100)
    assert result["heating_penalty_kwh"] == pytest.approx(539)
    # The heating model replaces the flat 2 kW.
    assert result["night_penalty_kwh"] == 0
    assert result["total_kwh"] == pytest.approx(539)
    assert result["heating"]["heat_leak_figure"]["source"] == "Schunk, NTRS 20210026557"


def test_heating_100_dark_hours_stowed_is_225_kwh():
    result = site_energy(["hab_uncrewed"], dark_hours=100, radiator="stowed")
    assert result["heating_penalty_kwh"] == pytest.approx(225)
    assert result["heating"]["radiator_protection_figure"]["qualifier"] == "about"


def test_flat_2_kw_is_kept_when_heating_is_off():
    result = site_energy(["hab_uncrewed"], dark_hours=100, uncrewed_hab_heating=False)
    assert result["heating_penalty_kwh"] == 0
    assert result["night_penalty_kwh"] == pytest.approx(200)


def test_typed_hab_power_or_timing_is_respected():
    typed = site_energy([{"id": "hab_uncrewed", "power_kw": 3}], dark_hours=100)
    assert typed["heating"]["applied"] is False
    assert typed["total_kwh"] == pytest.approx(300)
    daylight = site_energy([{"id": "hab_uncrewed", "runs": "light"}], dark_hours=100)
    assert daylight["total_kwh"] == 0


def test_dark_hours_are_labelled_as_given_by_the_caller():
    figure = site_energy(["hab_crewed"], dark_hours=10)["dark_hours_figure"]
    assert figure["source"] == "given by the caller, such as the physics engine"


def test_heating_can_be_forced_and_overridden():
    result = site_energy([], dark_hours=10, uncrewed_hab_heating=True,
                         heat_leak_w=1000, radiator_protection_w=0)
    assert result["heating_penalty_kwh"] == pytest.approx(10)
    assert result["heating"]["heat_leak_figure"]["status"] == ["user value"]


def test_energy_a_site_adds_is_night_plus_heating():
    loads = ["hab_uncrewed", "comms_relay", "keep_alive_heat", "crew_rover_keep_warm"]
    result = site_energy(loads, dark_hours=100)
    night = (0.2 + 0.14) * 100 + 9.7
    assert result["night_penalty_kwh"] == pytest.approx(night)
    assert result["total_kwh"] == pytest.approx(night + 539)


def test_dark_percent_over_several_months():
    assert dark_hours_from_percent(50, months=2) == pytest.approx(708.73)


@pytest.mark.parametrize("kwargs, text", [
    ({}, "exactly one"),
    ({"dark_hours": 10, "dark_percent": 5}, "exactly one"),
    ({"dark_percent": 120}, "100 or less"),
    ({"dark_hours": -1}, "at least 0"),
    ({"dark_hours": 10, "radiator": "folded"}, "deployed"),
    ({"dark_hours": 10, "nights": 0}, "whole number"),
])
def test_bad_input_is_explained(kwargs, text):
    with pytest.raises(PlannerInputError, match=text):
        site_energy(["hab_crewed"], **kwargs)
