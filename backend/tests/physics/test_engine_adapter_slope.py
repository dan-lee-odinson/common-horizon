"""The engine adapter's site slope: stored values at preset sites, unknown elsewhere, said what it is.

MOCKED OUTPUT, NOT PHYSICS: Sun and Earth positions are fixed test vectors; only the slope plumbing
is checked. The slope values are the stored ones in ``backend/data/site_slopes.json``.
"""

import json
import logging
from datetime import UTC, datetime

import pytest

from app.physics.engine_adapter import PhysicsEngineAdapter
from app.physics.factory import get_physics_engine
from app.physics.interface import PhysicsEngineUnavailable, SimulationRequest
from app.physics.site_slopes import (
    DEFAULT_SITE_SLOPES_FILE,
    SCREENING_NOTE,
    SLOPE_DESCRIPTION,
    SLOPES_NOT_INSTALLED_WARNING,
)
from tests.website_helpers import ScriptedEngine, evaluate_body, site_ref

STORED = json.loads(DEFAULT_SITE_SLOPES_FILE.read_text(encoding="utf-8"))["sites"]
APOLLO_11 = STORED["apollo-11"]
IM_1 = STORED["im-1-odysseus"]
START = datetime(2027, 1, 15, tzinfo=UTC)
NOT_INSTALLED = "Stored site slopes are not installed, so slope_deg is null."
BLUE_MOON = [{"id": "blue_moon_mk1", "count": 1}, {"id": "comms_relay", "count": 1}, {"id": "vsat", "count": 1}]


def _fixed_sky(_moment):
    return (149_597_870.7, 0.0, 0.0), (0.0, 384_400.0, 0.0)


def _adapter(**kwargs) -> PhysicsEngineAdapter:
    return PhysicsEngineAdapter(body_positions=_fixed_sky, **kwargs)


def _request(lat: float, lon: float) -> SimulationRequest:
    return SimulationRequest(
        latitude_deg=lat,
        longitude_deg=lon,
        altitude_m=None,
        observer_height_m=2.0,
        start_utc=START,
        duration_s=7200,
        time_step_s=3600,
    )


def _slope_check(result: dict) -> dict:
    [check] = [r for r in result["requirements"] if r["requirement"] == "landing slope"]
    return check


# ------------------------------------------------------------------------------- the adapter


def test_a_preset_site_carries_its_stored_slope_and_says_what_it_is():
    result = _adapter().simulate(_request(APOLLO_11["lat"], APOLLO_11["lon_east"]))

    assert result.site.slope_deg == APOLLO_11["slope_deg"]
    assert result.site.slope_source == SLOPE_DESCRIPTION
    assert SLOPE_DESCRIPTION == "slope of the best-fit plane to LOLA heights within 500 m (NASA Moon Trek)"
    [note] = [w for w in result.warnings if w.startswith("Slope ")]
    assert SLOPE_DESCRIPTION in note and "wider than a lander" in note and APOLLO_11["layer"] in note
    assert any("site_slopes.json" in s and "'apollo-11'" in s for s in result.sources)


def test_a_preset_given_with_a_signed_longitude_is_still_the_preset():
    apollo_12 = STORED["apollo-12"]
    result = _adapter().simulate(_request(apollo_12["lat"], apollo_12["lon_east"] - 360.0))
    assert result.site.slope_deg == apollo_12["slope_deg"]


def test_a_custom_point_keeps_an_unknown_slope():
    result = _adapter().simulate(_request(APOLLO_11["lat"] + 0.01, APOLLO_11["lon_east"]))

    assert result.site.slope_deg is None
    assert result.site.slope_source is None
    assert any(w.startswith("Site slope is unknown") and "slope_deg is null" in w for w in result.warnings)
    assert not any("site_slopes.json" in s for s in result.sources)


# ------------------------------------------------------------------ slope file not installed


def test_a_missing_slope_file_leaves_every_slope_null_says_so_and_logs_it_once(tmp_path, caplog):
    assert SLOPES_NOT_INSTALLED_WARNING == NOT_INSTALLED
    adapter = _adapter(site_slopes_file=tmp_path / "secret" / "site_slopes.json")
    assert adapter.info.available is True  # slopes are optional: the engine is not unavailable

    with caplog.at_level(logging.WARNING, logger="app.physics.engine_adapter"):
        results = [
            adapter.simulate(_request(APOLLO_11["lat"], APOLLO_11["lon_east"])),  # a preset
            adapter.simulate(_request(IM_1["lat"], IM_1["lon_east"])),  # another preset
            adapter.simulate(_request(0.7, 23.47)),  # a custom point
        ]

    for result in results:
        assert result.site.slope_deg is None and result.site.slope_source is None
        assert NOT_INSTALLED in result.warnings
        assert not any(w.startswith(("Slope ", "Site slope is unknown")) for w in result.warnings)
        assert not any("site_slopes.json" in s for s in result.sources)
    logged = [r for r in caplog.records if "not installed" in r.getMessage()]
    assert len(logged) == 1 and logged[0].levelno == logging.WARNING


@pytest.mark.parametrize(
    "content",
    ["{not json", json.dumps({"format": "something-else", "format_version": 1, "sites": {}}), "DIRECTORY"],
)
def test_a_slope_file_that_exists_but_is_unreadable_or_invalid_is_a_configuration_error(tmp_path, content):
    path = tmp_path / "secret" / "site_slopes.json"
    path.parent.mkdir()
    if content == "DIRECTORY":
        path.mkdir()  # exists, but cannot be read as a file
    else:
        path.write_text(content, encoding="utf-8")

    with pytest.raises(PhysicsEngineUnavailable) as error:
        _adapter(site_slopes_file=path).simulate(_request(APOLLO_11["lat"], APOLLO_11["lon_east"]))
    assert "site_slopes.json" in str(error.value) and "unreadable or invalid" in str(error.value)
    assert "secret" not in str(error.value)


def test_evaluate_answers_without_the_slope_file(app, client, tmp_path):
    missing = tmp_path / "site_slopes.json"
    app.dependency_overrides[get_physics_engine] = lambda: _adapter(site_slopes_file=missing)
    sites = [site_ref("apollo-11", APOLLO_11["lat"], APOLLO_11["lon_east"]), site_ref("custom:0.70:23.47", 0.70, 23.47)]
    response = client.post("/evaluate", json=evaluate_body(sites))

    assert response.status_code == 200
    for result in response.json()["results"]:
        assert result["slope_deg"] is None and result["slope_source"] is None
        assert NOT_INSTALLED in result["warnings"]
        assert _slope_check(result) == {
            "requirement": "landing slope",
            "passed": None,
            "detail": "Site slope is unknown; Griffin accepts up to 10 deg.",
        }


# ------------------------------------------------------------------ the website's slope check


def test_evaluate_scores_the_stored_slope_and_labels_griffins_check_as_screening(app, client):
    app.dependency_overrides[get_physics_engine] = lambda: _adapter()
    sites = [
        site_ref("apollo-11", APOLLO_11["lat"], APOLLO_11["lon_east"]),
        site_ref("im-1-odysseus", IM_1["lat"], IM_1["lon_east"]),
        site_ref("custom:0.70:23.47", 0.70, 23.47),
    ]
    data = client.post("/evaluate", json=evaluate_body(sites)).json()  # Griffin: published limit 10 deg
    by_id = {r["site_id"]: r for r in data["results"]}

    apollo, odysseus, custom = by_id["apollo-11"], by_id["im-1-odysseus"], by_id["custom:0.70:23.47"]
    assert IM_1["slope_deg"] == 11.819
    assert _slope_check(odysseus) == {
        "requirement": "landing slope",
        "passed": False,
        "detail": (
            "Regional slope 11.819 deg (slope of the best-fit plane to LOLA heights within 500 m, "
            "NASA Moon Trek); Griffin accepts up to 10 deg. Regional terrain screening over a circle "
            "1 km across, not a touchdown safety assessment."
        ),
    }
    assert odysseus["verdict"]["requirement"] == "landing slope"
    assert _slope_check(apollo)["passed"] is True
    assert _slope_check(apollo)["detail"].startswith(f"Regional slope {APOLLO_11['slope_deg']:g} deg (")
    assert _slope_check(apollo)["detail"].endswith(SCREENING_NOTE)

    for preset, stored in ((apollo, APOLLO_11), (odysseus, IM_1)):
        assert preset["slope_deg"] == stored["slope_deg"]
        assert preset["slope_source"] == SLOPE_DESCRIPTION
        assert preset["score"] is not None
        assert preset["score_components"]["slope"] == pytest.approx(max(0.0, 100 * (1 - stored["slope_deg"] / 10)))

    assert custom["slope_deg"] is None and custom["slope_source"] is None
    assert custom["score"] is None
    assert _slope_check(custom)["detail"] == "Site slope is unknown; Griffin accepts up to 10 deg."
    assert any("Slope is unknown for 1 of 3" in w for w in data["warnings"])


def test_a_lander_without_a_published_limit_shows_the_slope_with_no_pass_or_fail(app, client):
    app.dependency_overrides[get_physics_engine] = lambda: _adapter()
    sites = [site_ref("apollo-11", APOLLO_11["lat"], APOLLO_11["lon_east"])]
    [result] = client.post("/evaluate", json=evaluate_body(sites, hardware=BLUE_MOON)).json()["results"]

    assert _slope_check(result) == {
        "requirement": "landing slope",
        "passed": None,
        "detail": (
            f"Regional slope {APOLLO_11['slope_deg']:g} deg (slope of the best-fit plane to LOLA heights within "
            "500 m, NASA Moon Trek); no published slope limit for Blue Moon Mark 1, so no pass or fail."
        ),
    }
    assert result["score"] is not None  # the slope still counts in the score
    assert result["score_components"]["slope"] == pytest.approx(100 * (1 - APOLLO_11["slope_deg"] / 10))


def test_a_slope_from_another_source_is_not_called_regional_screening(app, client):
    synthetic = "synthetic engine: terrain is not modelled, 0 is a placeholder, not a measured slope"
    engine = ScriptedEngine(lambda lat, lon, start: {"slope_deg": 12.0, "slope_source": synthetic})
    app.dependency_overrides[get_physics_engine] = lambda: engine
    [result] = client.post("/evaluate", json=evaluate_body([site_ref("a", 1.0, 10.0)])).json()["results"]

    assert _slope_check(result) == {
        "requirement": "landing slope",
        "passed": False,
        "detail": f"Slope 12 deg ({synthetic}); Griffin accepts up to 10 deg.",
    }
