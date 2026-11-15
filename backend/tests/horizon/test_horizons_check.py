"""The JPL Horizons comparison: its helpers, the stored result and the website's copy. No network, no kernels."""

import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from app.physics.horizons_client import (
    HorizonsError,
    api_version,
    parse_horizons,
    query_parameters,
    separation_deg,
)
from scripts.validate_against_horizons import (
    SITES,
    TOLERANCE_DEG,
    compare_rows,
    dumps_compact_rows,
    load_sites,
    summarize,
    web_summary,
)

BACKEND = Path(__file__).resolve().parents[2]
RESULT = BACKEND / "data" / "horizon_validation" / "horizons_check_2027.json"
WEB_COPY = BACKEND.parent / "web" / "public" / "data" / "horizons-check.json"
PROFILE_DIR = BACKEND / "data" / "horizon"

SAMPLE = """
API VERSION: 1.2
API SOURCE: NASA/JPL Horizons API
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
    assert api_version(SAMPLE) == "1.2"


def test_parse_horizons_refuses_an_answer_with_no_table():
    with pytest.raises(HorizonsError):
        parse_horizons("No ephemeris for target")


def test_query_asks_for_apparent_airless_azimuth_and_elevation_at_the_site():
    site = {"latitude_deg": -85.42088, "longitude_deg": 31.6218, "site_height_m": 6416.081, "observer_height_m": 2.0}
    params = query_parameters("earth", site, datetime(2027, 1, 1, tzinfo=UTC), datetime(2028, 1, 1, tzinfo=UTC), 60)
    assert params["COMMAND"] == "'399'"
    assert params["CENTER"] == "'coord@301'"
    assert params["SITE_COORD"] == "'31.621800,-85.420880,6.418081'"
    assert (params["QUANTITIES"], params["APPARENT"]) == ("'4'", "'AIRLESS'")
    assert (params["START_TIME"], params["STOP_TIME"], params["STEP_SIZE"]) == (
        "'2027-01-01 00:00'", "'2028-01-01 00:00'", "'60 m'")


def test_separation_is_the_angle_between_directions():
    assert separation_deg((10.0, 20.0), (10.0, 20.0)) == pytest.approx(0.0, abs=1e-9)
    assert separation_deg((0.0, 0.0), (90.0, 0.0)) == pytest.approx(90.0)
    assert separation_deg((0.0, 10.0), (0.0, 11.0)) == pytest.approx(1.0)
    # Near the zenith a large azimuth difference is a small angle on the sky.
    assert separation_deg((0.0, 89.9), (180.0, 89.9)) == pytest.approx(0.2, abs=1e-6)


def test_summarize_reports_max_p95_and_mean():
    out = summarize([0.0, 1.0, 2.0, 3.0])
    assert out["max_deg"] == 3.0 and out["mean_deg"] == 1.5 and out["p95_deg"] == 2.0


def test_heights_come_from_stored_profiles_or_the_stated_default():
    sites = {site["id"]: site for site in load_sites()}
    assert len(sites) == 17
    for site_id, site in sites.items():
        profile = PROFILE_DIR / f"{site_id}.json"
        if profile.is_file():
            stored = json.loads(profile.read_text(encoding="utf-8"))
            assert site["site_height_m"] == stored["site_height_m"]
            assert site["height_source"] == f"backend/data/horizon/{site_id}.json"
        else:
            assert (site["site_height_m"], site["observer_height_m"]) == (0.0, 2.0)
            assert site["height_source"].startswith("no stored horizon profile")
    with pytest.raises(ValueError):
        load_sites(["not-a-preset"])


def test_compare_rows_keeps_one_row_per_week_and_the_statistics():
    start = datetime(2027, 1, 1, tzinfo=UTC)
    rows = [(start + timedelta(hours=i), 100.0, 10.0) for i in range(24 * 15 + 1)]

    def engine(body, site, when):  # 0.5 degree higher in the second week only
        return (100.0, 10.5) if when >= start + timedelta(days=7) else (100.0, 10.0)

    out = compare_rows("sun", {}, rows, 60, engine=engine)

    assert out["samples"] == 361
    assert [row[0] for row in out["weekly_samples"]["rows"]] == [
        "2027-01-01T00:00Z", "2027-01-08T00:00Z", "2027-01-15T00:00Z"]
    assert out["angle_between_directions"]["max_deg"] == pytest.approx(0.5)
    assert out["elevation_difference"]["max_deg"] == pytest.approx(0.5)
    assert out["angle_between_directions"]["mean_deg"] == pytest.approx(0.5 * 193 / 361, abs=1e-6)


def test_compact_writer_keeps_each_weekly_row_on_one_line_and_the_data_unchanged():
    data = {"a": {"rows": [["2027-01-01T00:00Z", 1.5, -2.25], ["x", 0.0, 3.0]]}, "b": ["c", 1]}
    text = dumps_compact_rows(data)
    assert json.loads(text) == data
    assert '["2027-01-01T00:00Z", 1.5, -2.25]' in text.splitlines()[3]


def stored():
    return json.loads(RESULT.read_text(encoding="utf-8"))


def test_stored_result_covers_17_sites_every_hour_of_2027_within_tolerance():
    assert RESULT.stat().st_size < 400_000
    data = stored()
    assert (data["format"], data["format_version"]) == ("common-horizon/horizons-check", 2)
    assert data["service"]["api"].startswith("https://ssd.jpl.nasa.gov/")
    assert data["period"] == {"start_utc": "2027-01-01T00:00Z", "stop_utc": "2028-01-01T00:00Z",
                              "step_minutes": 60, "samples_per_site_and_body": 8761}
    assert list(data["sites"]) == [site_id for site_id, _, _ in SITES]
    for site in data["sites"].values():
        assert set(site["bodies"]) == {"sun", "earth"}
        for body in site["bodies"].values():
            assert body["samples"] == 8761
            assert len(body["weekly_samples"]["rows"]) == 53
            assert body["horizons_query"]["START_TIME"] == "2027-01-01 00:00"
            # The engine's positions are geometric and Horizons' are apparent, so the Sun differs
            # by the aberration of light. Anything near 0.02 degrees would be a fault.
            assert body["angle_between_directions"]["max_deg"] < TOLERANCE_DEG
            assert body["elevation_difference"]["max_deg"] < TOLERANCE_DEG


def test_stored_result_used_the_heights_of_the_stored_profiles():
    for site_id, site in stored()["sites"].items():
        query = site["bodies"]["sun"]["horizons_query"]
        lon, lat, alt_km = (float(x) for x in query["SITE_COORD"].split(","))
        assert alt_km == pytest.approx((site["site"]["site_height_m"] + site["site"]["observer_height_m"]) / 1000)
        assert (lat, lon) == (site["site"]["latitude_deg"], site["site"]["longitude_deg"])
        assert site["site"]["height_source"] == load_sites([site_id])[0]["height_source"]


def test_website_copy_matches_the_stored_result():
    data = stored()
    web = json.loads(WEB_COPY.read_text(encoding="utf-8"))
    assert web == web_summary(data, "backend/data/horizon_validation/horizons_check_2027.json")
    assert web["sites"]["shackleton-ridge"]["horizons_url"] == "https://ssd.jpl.nasa.gov/api/horizons.api"
