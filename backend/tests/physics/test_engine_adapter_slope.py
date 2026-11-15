"""The engine adapter's site slope: stored values at preset sites, unknown elsewhere, said what it is.

MOCKED OUTPUT, NOT PHYSICS: Sun and Earth positions are fixed test vectors; only the slope plumbing
is checked. The slope values are the stored ones in ``backend/data/site_slopes.json``.
"""

import json
from datetime import UTC, datetime

import pytest

from app.physics.engine_adapter import PhysicsEngineAdapter
from app.physics.factory import get_physics_engine
from app.physics.interface import PhysicsEngineUnavailable, SimulationRequest
from app.physics.site_slopes import DEFAULT_SITE_SLOPES_FILE, SLOPE_DESCRIPTION
from tests.website_helpers import evaluate_body, site_ref

STORED = json.loads(DEFAULT_SITE_SLOPES_FILE.read_text(encoding="utf-8"))["sites"]
APOLLO_11 = STORED["apollo-11"]
START = datetime(2027, 1, 15, tzinfo=UTC)


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


def test_a_missing_slope_file_makes_the_engine_unavailable_without_leaking_the_path(tmp_path):
    adapter = _adapter(site_slopes_file=tmp_path / "secret" / "site_slopes.json")
    assert adapter.info.available is False
    with pytest.raises(PhysicsEngineUnavailable) as error:
        adapter.simulate(_request(0.0, 0.0))
    assert "site_slopes.json" in str(error.value)
    assert "secret" not in str(error.value)


def test_evaluate_route_scores_and_checks_the_stored_slope(app, client):
    app.dependency_overrides[get_physics_engine] = lambda: _adapter()
    sites = [
        site_ref("apollo-11", APOLLO_11["lat"], APOLLO_11["lon_east"]),
        site_ref("custom:0.70:23.47", 0.70, 23.47),
    ]
    data = client.post("/evaluate", json=evaluate_body(sites)).json()  # Griffin: published limit 10 deg
    by_id = {r["site_id"]: r for r in data["results"]}

    preset, custom = by_id["apollo-11"], by_id["custom:0.70:23.47"]
    assert preset["slope_deg"] == APOLLO_11["slope_deg"]
    assert preset["slope_source"] == SLOPE_DESCRIPTION
    assert preset["score"] is not None
    assert preset["score_components"]["slope"] == pytest.approx(100 * (1 - APOLLO_11["slope_deg"] / 10))
    [check] = [r for r in preset["requirements"] if r["requirement"] == "landing slope"]
    assert check["passed"] is (APOLLO_11["slope_deg"] <= 10)
    assert SLOPE_DESCRIPTION in check["detail"] and "Griffin" in check["detail"]

    assert custom["slope_deg"] is None and custom["slope_source"] is None
    assert custom["score"] is None
    assert any("Slope is unknown for 1 of 2" in w for w in data["warnings"])


def test_a_lander_without_a_published_limit_shows_the_slope_with_no_pass_or_fail(app, client):
    app.dependency_overrides[get_physics_engine] = lambda: _adapter()
    hardware = [{"id": "blue_moon_mk1", "count": 1}, {"id": "comms_relay", "count": 1}, {"id": "vsat", "count": 1}]
    sites = [site_ref("apollo-11", APOLLO_11["lat"], APOLLO_11["lon_east"])]
    [result] = client.post("/evaluate", json=evaluate_body(sites, hardware=hardware)).json()["results"]

    [check] = [r for r in result["requirements"] if r["requirement"] == "landing slope"]
    assert check["passed"] is None
    assert f"Slope {APOLLO_11['slope_deg']:g} deg ({SLOPE_DESCRIPTION})" in check["detail"]
    assert "no pass or fail" in check["detail"]
    assert result["score"] is not None  # the slope still counts in the score
    assert result["score_components"]["slope"] == pytest.approx(100 * (1 - APOLLO_11["slope_deg"] / 10))
