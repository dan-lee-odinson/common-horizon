"""The NASA Moon Trek Sun check: its helpers, the stored result and the website's copy. No network, no kernels."""

import json
from datetime import UTC, datetime
from pathlib import Path

import pytest

from scripts.validate_against_horizons import SITES
from scripts.validate_against_moon_trek import (
    TOLERANCE_DEG,
    MoonTrekError,
    compare,
    expected_times,
    month_ranges,
    moon_trek_url,
    parse_moon_trek,
    web_summary,
)

BACKEND = Path(__file__).resolve().parents[2]
RESULT = BACKEND / "data" / "horizon_validation" / "moon_trek_sun_check_2027.json"
WEB_COPY = BACKEND.parent / "web" / "public" / "data" / "moon-trek-sun-check.json"

# Moon Trek's answer for Apollo 11, 2027-02-17 12:00 to 13:00 UTC (retrieved 2026-11-15), shortened.
SAMPLE = """<?xml version="1.0" encoding="ISO-8859-1"?>
<MPG><ltd>
  <inputs>
    <transmitter naif_id="301" lat="0.674160" lon="23.473140" altKm="0.000">LTD002</transmitter>
    <transponder  naif_id="10">Sun</transponder>
    <t1utc>2027-02-17T12:00:00</t1utc>
  </inputs>
  <samples>
    <sample><time>2027-048T12:00:00.000000</time><Az id="0">91.141082</Az><El id="0">68.258447</El></sample>
    <sample><time>2027-048T13:00:00.000000</time><Az id="0">91.168718</Az><El id="0">68.764336</El></sample>
  </samples>
</ltd></MPG>
"""


def test_parse_reads_day_of_year_times_and_angles():
    rows = parse_moon_trek(SAMPLE)
    assert rows == [
        (datetime(2027, 2, 17, 12, tzinfo=UTC), 91.141082, 68.258447),
        (datetime(2027, 2, 17, 13, tzinfo=UTC), 91.168718, 68.764336),
    ]


@pytest.mark.parametrize("text", ["not xml", "<MPG><ltd><samples></samples></ltd></MPG>"])
def test_parse_refuses_an_answer_without_samples(text):
    with pytest.raises(MoonTrekError):
        parse_moon_trek(text)


def test_one_request_per_month_covering_every_hour_of_the_year_once():
    months = month_ranges(2027)
    assert len(months) == 12
    assert months[0] == (datetime(2027, 1, 1, tzinfo=UTC), datetime(2027, 1, 31, 23, tzinfo=UTC))
    assert months[-1][1] == datetime(2028, 1, 1, tzinfo=UTC)  # the same period as the Horizons check
    hours = [t for first, last in months for t in expected_times(first, last)]
    assert len(hours) == len(set(hours)) == 8761


def test_url_asks_for_the_sun_at_the_site_hourly():
    site = {"latitude_deg": 0.67416, "longitude_deg": 23.47314, "site_height_m": 0.0, "observer_height_m": 2.0}
    url = moon_trek_url(site, datetime(2027, 1, 1, tzinfo=UTC), datetime(2027, 1, 31, 23, tzinfo=UTC))
    assert url == (
        "https://trek.nasa.gov/getAzElfromT1/LTD002=Moon,0.674160,23.473140,0.002000,0.674160,23.473140,1,1"
        "/Sun/2027-01-01T00:00:00/2027-01-31T23:00:00/3600"
    )


def test_compare_measures_the_angle_on_the_sky():
    site = {"latitude_deg": 0.0, "longitude_deg": 0.0, "site_height_m": 0.0, "observer_height_m": 2.0}
    rows = [(datetime(2027, 1, 1, h, tzinfo=UTC), 90.0, 10.0 + 0.001 * h) for h in range(3)]
    entry = compare(site, rows, engine=lambda body, s, when: (90.0, 10.0))
    assert entry["samples"] == 3
    assert entry["angle_between_directions"]["max_deg"] == pytest.approx(0.002)
    assert entry["weekly_samples"]["rows"][0][0] == "2027-01-01T00:00Z"


def test_stored_result_covers_all_17_sites_every_hour_within_tolerance():
    result = json.loads(RESULT.read_text(encoding="utf-8"))
    assert result["format"] == "common-horizon/moon-trek-sun-check"
    assert result["period"] == {"start_utc": "2027-01-01T00:00Z", "stop_utc": "2028-01-01T00:00Z", "step_minutes": 60,
                                "samples_per_site": 8761}
    assert list(result["sites"]) == [site_id for site_id, _, _ in SITES]
    for site_id, entry in result["sites"].items():
        assert entry["sun"]["samples"] == 8761, site_id
        assert entry["sun"]["angle_between_directions"]["max_deg"] <= TOLERANCE_DEG, site_id
        assert [r["month"] for r in entry["requests"]] == [f"2027-{m:02d}" for m in range(1, 13)], site_id
        assert sum(r["samples"] for r in entry["requests"]) == 8761, site_id
        assert all(len(r["sha256"]) == 64 and r["url"].startswith("https://trek.nasa.gov/") for r in entry["requests"])


def test_website_copy_matches_the_stored_result():
    result = json.loads(RESULT.read_text(encoding="utf-8"))
    web = json.loads(WEB_COPY.read_text(encoding="utf-8"))
    assert web == web_summary(result, "backend/data/horizon_validation/moon_trek_sun_check_2027.json")
