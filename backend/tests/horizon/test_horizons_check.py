"""The JPL Horizons comparison: its small helpers and the stored result. No network, no kernels."""

import json
from datetime import UTC, datetime
from pathlib import Path

import pytest

from scripts.validate_against_horizons import parse_horizons, separation_deg, summarize

RESULT = Path(__file__).resolve().parents[2] / "data" / "horizon_validation" / "horizons_check_2027.json"

SAMPLE = """
 Date__(UT)__HR:MN, , , Azi____(a-app), Elev____(a-app),
$$SOE
 2027-Feb-15 00:00, , ,  238.850800,  -0.279800,
 2027-Feb-15 01:00,*,m,  239.359100,  -0.281200,
$$EOE
"""


def test_parse_horizons_reads_time_and_angles():
    rows = parse_horizons(SAMPLE)
    assert rows[0] == (datetime(2027, 2, 15, 0, 0, tzinfo=UTC), 238.8508, -0.2798)
    assert rows[1][0].hour == 1 and rows[1][1] == pytest.approx(239.3591)


def test_parse_horizons_refuses_an_answer_with_no_table():
    with pytest.raises(RuntimeError):
        parse_horizons("No ephemeris for target")


def test_separation_is_the_angle_between_directions():
    assert separation_deg((10.0, 20.0), (10.0, 20.0)) == pytest.approx(0.0, abs=1e-9)
    assert separation_deg((0.0, 0.0), (90.0, 0.0)) == pytest.approx(90.0)
    assert separation_deg((0.0, 10.0), (0.0, 11.0)) == pytest.approx(1.0)
    # Near the zenith a large azimuth difference is a small angle on the sky.
    assert separation_deg((0.0, 89.9), (180.0, 89.9)) == pytest.approx(0.2, abs=1e-6)


def test_summarize_reports_max_p95_and_mean():
    out = summarize([0.0, 1.0, 2.0, 3.0])
    assert out["max_deg"] == 3.0 and out["mean_deg"] == 1.5 and out["p95_deg"] == 2.0


def test_stored_result_is_complete_and_within_tolerance():
    data = json.loads(RESULT.read_text(encoding="utf-8"))
    assert data["format"] == "common-horizon/horizons-check"
    assert data["service"]["api"].startswith("https://ssd.jpl.nasa.gov/")
    assert set(data["sites"]) == {"shackleton-ridge", "nobile", "apollo-11"}
    for site in data["sites"].values():
        assert set(site["bodies"]) == {"sun", "earth"}
        for body in site["bodies"].values():
            assert body["samples"] >= 700
            # The engine's positions are geometric and Horizons' are apparent, so the Sun differs
            # by the aberration of light, about 0.006 degrees. Anything near 0.02 would be a fault.
            assert body["angle_between_directions"]["max_deg"] < 0.02
            assert body["elevation_difference"]["max_deg"] < 0.02
