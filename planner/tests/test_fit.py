"""Fit check tests, including the two worked examples from the brief."""

import pytest

from planner import PlannerInputError, fit_check


def test_reactor_on_mark_1_is_3000_kg_over():
    result = fit_check("blue_moon_mk1", ["fsp_40kwe"])
    assert result["fits"] is False
    assert result["verdict"] == "does not fit"
    assert result["spare_kg"] == pytest.approx(-3000)
    assert result["margin_percent"] == pytest.approx(-100.0)
    assert "3,000 kg over" in result["messages"][0]


def test_clv1_on_mark_1_fits_with_2093_kg_spare():
    result = fit_check("blue_moon_mk1", ["astrolab_clv1"])
    assert result["fits"] is True
    assert result["spare_kg"] == pytest.approx(2093)
    assert result["margin_percent"] == pytest.approx(2093 / 3000 * 100)
    # The mass is "about 907 kg": the qualifier travels with the result.
    assert result["payloads"][0]["mass_figure"]["qualifier"] == "about"


def test_masses_add_up_with_counts():
    result = fit_check("blue_moon_mk2_cargo",
                       [{"id": "astrolab_clv1", "count": 2}, "logistics"],
                       capacity_option="reusable")
    assert result["payload_total_kg"] == pytest.approx(2 * 907 + 8000)
    assert result["spare_kg"] == pytest.approx(20000 - 9814)


def test_hls_shows_both_figures_without_picking_one():
    result = fit_check("starship_hls", ["surface_habitat", "logistics"])
    capacities = [check["capacity_kg"] for check in result["checks"]]
    assert capacities == [100000, 12000]
    assert [check["fits"] for check in result["checks"]] == [True, False]
    assert result["fits"] is None
    assert result["verdict"] == "depends on capacity figure"
    assert result["spare_kg"] is None
    labels = [check["capacity_figure"]["status"] for check in result["checks"]]
    assert labels == [["company figure"], ["NASA figure"]]
    assert result["checks"][1]["capacity_figure"]["published_value"] == [12000, 15000]


def test_mark_2_checks_one_way_and_reusable():
    result = fit_check("blue_moon_mk2_cargo", [{"id": "surface_habitat", "count": 2}])
    assert [c["option"] for c in result["checks"]] == ["one_way", "reusable"]
    assert [c["fits"] for c in result["checks"]] == [True, False]
    assert result["verdict"] == "depends on capacity figure"


def test_unpublished_mass_asks_for_a_typed_value():
    result = fit_check("blue_moon_mk2_cargo", ["jaxa_pressurized_rover", "astrolab_clv1"])
    assert result["fits"] is None
    assert result["verdict"] == "mass needed"
    assert result["payload_total_kg"] is None
    assert result["known_payload_kg"] == pytest.approx(907)
    assert result["missing_masses"][0]["id"] == "jaxa_pressurized_rover"
    message = result["messages"][0]
    assert "not published" in message and "mass_kg" in message


def test_typed_mass_fills_the_gap_and_is_labelled():
    result = fit_check("blue_moon_mk2_cargo",
                       [{"id": "jaxa_pressurized_rover", "mass_kg": 10000}],
                       capacity_option="one_way")
    assert result["fits"] is True
    assert result["spare_kg"] == pytest.approx(20000)
    assert result["payloads"][0]["mass_figure"]["status"] == ["user value"]


def test_typed_mass_overrides_a_catalog_mass():
    result = fit_check("blue_moon_mk1", [{"id": "fsp_40kwe", "mass_kg": 2500}])
    assert result["fits"] is True
    assert result["spare_kg"] == pytest.approx(500)


def test_typed_capacity_overrides_the_lander():
    result = fit_check("griffin", ["astrolab_clv1"], capacity_kg=1000)
    assert result["fits"] is True
    assert result["checks"][0]["capacity_figure"]["status"] == ["user value"]
    custom = fit_check(None, [{"name": "Drill", "mass_kg": 300}], capacity_kg=250)
    assert custom["lander"]["name"] == "Custom lander (typed capacity 250 kg)"
    assert custom["spare_kg"] == pytest.approx(-50)


def test_messages_name_the_range_and_the_typed_capacity():
    hls = fit_check("starship_hls", ["surface_habitat", "logistics"])
    assert any("12,000 kg, the harder end of 12,000 to 15,000 kg" in m for m in hls["messages"])
    typed = fit_check("starship_hls", ["astrolab_clv1"], capacity_kg=1000)
    assert typed["messages"][0].startswith("Starship HLS (typed capacity 1,000 kg): fits")


def test_null_fields_count_as_not_typed():
    result = fit_check("griffin", [{"id": "astrolab_clv1", "mass_kg": None, "count": None}],
                       capacity_kg=None, capacity_option=None)
    assert result["payload_total_kg"] == pytest.approx(907)
    with pytest.raises(PlannerInputError, match="at least one payload"):
        fit_check("griffin", None)


def test_exactly_full_counts_as_a_fit():
    result = fit_check("starship_hls", ["surface_habitat"], capacity_option="nasa_cargo_variants")
    assert result["fits"] is True
    assert result["spare_kg"] == pytest.approx(0)


@pytest.mark.parametrize("kwargs, text", [
    ({"lander": "eagle", "payloads": ["logistics"]}, "Known ids"),
    ({"lander": "griffin", "payloads": []}, "at least one payload"),
    ({"lander": "griffin", "payloads": [{"name": "Box"}]}, "Mass not published"),
    ({"lander": "griffin", "payloads": [{"mass_kg": 5}]}, "needs a name"),
    ({"lander": "griffin", "payloads": [{"id": "logistics", "mass_kg": -1}]}, "at least 0"),
    ({"lander": "griffin", "payloads": [{"id": "logistics", "count": 0}]}, "whole number"),
    ({"lander": "griffin", "payloads": [{"id": "logistics", "weight": 5}]}, "Unknown payload"),
    ({"lander": "griffin", "payloads": ["logistics"], "capacity_kg": 0}, "more than 0"),
    ({"lander": "griffin", "payloads": ["logistics"], "capacity_option": "big"}, "Known options"),
    ({"lander": None, "payloads": ["logistics"]}, "Give a lander"),
])
def test_bad_input_is_explained(kwargs, text):
    try:
        result = fit_check(**kwargs)
    except PlannerInputError as error:
        assert text in str(error)
    else:
        assert any(text in message for message in result["messages"])
