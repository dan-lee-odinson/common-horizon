"""Power check tests, built on the worked examples in the brief.

Worked example: night load 21.34 kW (habitat crewed 20 + lighting 1 +
comms 0.2 + one keep-alive 0.14) and one crew rover parked.
"""

import pytest

from planner import (
    LUNAR_MONTH_HOURS,
    PlannerInputError,
    margin_percent,
    margin_status,
    power_check,
)

NIGHT_LOADS = ["hab_crewed", "worksite_lighting", "comms_relay", "keep_alive_heat"]
ROVER = ["crew_rover_recharge", "crew_rover_keep_warm"]
SITE = NIGHT_LOADS + ROVER
SITE_WITH_ISRU = SITE + ["isru_pilot"]


def test_night_load_is_21_34_kw():
    result = power_check(SITE, ["fission_40kwe"])
    assert result["night"]["load_kw"] == pytest.approx(21.34)
    assert result["night"]["per_night_kwh"] == pytest.approx(9.7)


def test_fission_40_night_margin_is_46_7_percent():
    night = power_check(SITE, ["fission_40kwe"])["night"]
    # 46.65 exactly, shown as 46.7 in the worked example.
    assert night["margin_percent"] == pytest.approx(46.65)
    assert night["status"] == "green"
    assert night["passes"] is True


def test_fission_100_night_margin_is_78_7_percent():
    night = power_check(SITE, ["fission_100kwe"])["night"]
    assert night["margin_percent"] == pytest.approx(78.66)
    assert night["status"] == "green"


def test_day_load_with_isru_pilot_is_42_2_kw():
    day = power_check(SITE_WITH_ISRU, ["fission_100kwe"])["day"]
    assert day["load_kw"] == pytest.approx(42.2)


def test_isru_day_on_fission_100_is_57_8_percent():
    result = power_check(SITE_WITH_ISRU, ["fission_100kwe"])
    assert result["day"]["margin_percent"] == pytest.approx(57.8)
    assert result["day"]["status"] == "green"
    assert result["balance"]["margin_percent"] == pytest.approx(57.8)
    assert result["balance"]["limiting"] == "day"


def test_isru_day_on_fission_40_is_2_2_kw_over():
    result = power_check(SITE_WITH_ISRU, ["fission_40kwe"])
    assert result["day"]["surplus"] == pytest.approx(-2.2)
    assert result["day"]["status"] == "red"
    assert result["day"]["passes"] is False
    assert result["passes"] is False
    assert result["balance"]["status"] == "red"
    assert result["balance"]["limiting"] == "day"


@pytest.mark.parametrize("darkness_h, storage_kwh", [(72, 1546), (120, 2571)])
def test_storage_needed_without_fission(darkness_h, storage_kwh):
    night = power_check(SITE, ["vsat_xl"], longest_darkness_h=darkness_h)["night"]
    # (21.34 kW x darkness) + 9.7 kWh rover keep-warm.
    assert night["storage_needed_kwh"] == pytest.approx(21.34 * darkness_h + 9.7)
    assert night["storage_needed_kwh"] == pytest.approx(storage_kwh, abs=0.5)
    assert night["passes"] is False
    assert night["status"] == "red"


def test_enough_storage_passes_and_is_refilled_by_day():
    result = power_check(SITE, ["vsat_xl"], storage_kwh=2000, longest_darkness_h=72)
    night = result["night"]
    assert night["passes"] is True
    assert night["margin_percent"] == pytest.approx((2000 - 1546.18) / 2000 * 100)
    assert night["status"] == "yellow"
    day = result["day"]
    assert day["refill_hours"] == pytest.approx(LUNAR_MONTH_HOURS - 72)
    assert day["refill_hours_figure"]["status"] == ["our estimate"]
    assert day["refill_kw"] == pytest.approx(1546.18 / (LUNAR_MONTH_HOURS - 72))
    assert day["load"] == pytest.approx(22.2 + day["refill_kw"])
    assert result["balance"]["limiting"] == "night"


def test_typed_refill_hours_are_used():
    day = power_check(SITE, ["vsat_xl"], storage_kwh=2000, longest_darkness_h=72,
                      refill_hours=100)["day"]
    assert day["refill_kw"] == pytest.approx(15.4618)
    assert day["refill_hours_figure"]["status"] == ["user value"]


def test_with_darkness_the_night_check_counts_per_night_items():
    night = power_check(SITE, ["fission_40kwe"], longest_darkness_h=72)["night"]
    assert night["storage_needed_kwh"] == 0
    assert night["margin_percent"] == pytest.approx((40 * 72 - 1546.18) / (40 * 72) * 100)
    # The power-only figure stays available.
    assert night["power_margin_percent"] == pytest.approx(46.65)


def test_regenerative_fuel_cell_covers_night_and_is_refilled():
    result = power_check(SITE, ["vsat_xl", "regenerative_fuel_cell"], storage_kwh=1000,
                         longest_darkness_h=72)
    night = result["night"]
    assert night["night_only_sources_used_kwh"] == pytest.approx(720)
    assert night["storage_needed_kwh"] == pytest.approx(1546.18 - 720)
    assert night["passes"] is True
    assert result["day"]["refill_kwh"] == pytest.approx(1546.18)
    # The fuel cell works through the night only: daytime power is the mast alone.
    assert result["day"]["available"] == pytest.approx(50)


def test_hab_array_uses_low_end_and_sunlight_only():
    result = power_check(["hab_crewed"], ["hab_array"])
    assert result["day"]["available"] == pytest.approx(10)
    assert result["night"]["available"] == 0
    assert result["night"]["status"] == "red"
    assert result["night"]["margin_percent"] is None


def test_overrides_and_custom_items_are_labelled():
    result = power_check(
        [{"id": "hab_crewed", "power_kw": 15},
         {"id": "keep_alive_heat", "count": 3},
         {"name": "Drill", "power_kw": 4, "runs": "light"}],
        [{"id": "fission_40kwe", "power_kw": 30},
         {"name": "Spare reactor", "power_kw": 5, "works": "always"}],
    )
    assert result["loads"][0]["power_figure"]["status"] == ["user value"]
    assert result["night"]["load_kw"] == pytest.approx(15 + 3 * 0.14)
    assert result["day"]["load_kw"] == pytest.approx(19)
    assert result["day"]["available"] == pytest.approx(35)


def test_pressurized_rover_defaults_to_peak():
    peak = power_check(["pressurized_rover_recharge"], ["vsat"])
    average = power_check([{"id": "pressurized_rover_recharge", "use": "average"}], ["vsat"])
    assert peak["day"]["load_kw"] == pytest.approx(9.5)
    assert average["day"]["load_kw"] == pytest.approx(6.5)


def test_charging_can_be_moved_to_the_night():
    result = power_check([{"id": "crew_rover_recharge", "runs": "dark"}], ["fission_40kwe"])
    assert result["night"]["load_kw"] == pytest.approx(2)
    assert result["day"]["load_kw"] == 0


@pytest.mark.parametrize("margin, status", [
    (25.0, "green"), (80.0, "green"), (24.99, "yellow"), (0.5, "yellow"),
    (0.0, "yellow"), (-0.01, "red"),
])
def test_margin_colours(margin, status):
    assert margin_status(margin, 1.0, 1.0) == status


def test_margin_percent_formula():
    assert margin_percent(40, 21.34) == pytest.approx(46.65)
    assert margin_percent(0, 5) is None
    assert margin_status(None, 0, 5) == "red"
    assert margin_status(None, 0, 0) == "none"


@pytest.mark.parametrize("kwargs, text", [
    ({"loads": ["toaster"]}, "Known ids"),
    ({"loads": [{"name": "Drill", "power_kw": 1}]}, "needs runs"),
    ({"loads": [{"name": "Drill", "runs": "light"}]}, "power_kw or energy_per_night_kwh"),
    ({"loads": [{"id": "hab_crewed", "runs": "noon"}]}, "must be one of"),
    ({"loads": [{"id": "hab_crewed", "use": "peak"}]}, "only one power figure"),
    ({"loads": [{"id": "pressurized_rover_recharge", "use": "max"}]}, "Known options"),
    ({"sources": [{"name": "Panel", "power_kw": 1}]}, "needs works"),
    ({"sources": [{"id": "vsat", "power": 3}]}, "Unknown power source"),
    ({"storage_kwh": -5}, "at least 0"),
    ({"loads": ["hab_crewed"], "longest_darkness_h": 800}, "type refill_hours"),
])
def test_bad_input_is_explained(kwargs, text):
    with pytest.raises(PlannerInputError, match=text):
        power_check(**kwargs)
