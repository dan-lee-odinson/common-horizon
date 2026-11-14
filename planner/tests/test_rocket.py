"""Rocket equation tests."""

import math

import pytest

from planner import PlannerInputError, rocket_delta_v


def test_worked_example_is_about_7500_m_s():
    # 85 t dry, 1,200 t propellant, 100 t payload, 380 s.
    result = rocket_delta_v(380, 85, 1200, 100)
    assert result["start_mass"] == 1385
    assert result["final_mass"] == 185
    assert result["delta_v_m_s"] == pytest.approx(380 * 9.80665 * math.log(1385 / 185))
    assert result["delta_v_m_s"] == pytest.approx(7500, abs=10)
    assert "About 7,502 m/s" in result["message"]


def test_result_is_labelled_and_shows_its_inputs():
    result = rocket_delta_v(380, 85, 1200, 100)
    assert result["status"] == ["our estimate"]
    assert result["inputs"] == {
        "isp_s": 380.0, "dry_mass": 85.0, "propellant_mass": 1200.0,
        "payload_mass": 100.0, "mass_unit": "t", "g0_m_s2": 9.80665,
    }
    assert "9.80665" in result["formula"]


def test_mass_unit_does_not_change_the_answer():
    tonnes = rocket_delta_v(380, 85, 1200, 100)["delta_v_m_s"]
    kilograms = rocket_delta_v(380, 85000, 1200000, 100000, mass_unit="kg")["delta_v_m_s"]
    assert kilograms == pytest.approx(tonnes)


def test_no_propellant_means_no_delta_v():
    assert rocket_delta_v(450, 10, 0)["delta_v_m_s"] == 0


@pytest.mark.parametrize("args, text", [
    ((0, 85, 1200, 100), "more than 0"),
    ((380, -1, 1200, 100), "at least 0"),
    ((380, 0, 1200, 0), "Final mass"),
    (("fast", 85, 1200, 100), "must be a number"),
])
def test_bad_input_is_explained(args, text):
    with pytest.raises(PlannerInputError, match=text):
        rocket_delta_v(*args)
