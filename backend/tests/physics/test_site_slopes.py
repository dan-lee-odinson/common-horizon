"""Preset-site slopes from NASA Moon Trek LOLA patches: the fit, the stored file and the kept patches.

No network: the slopes are recomputed from the patches kept in ``backend/data/site_slopes/``.
"""

import hashlib
import json
import math
from pathlib import Path

import pytest

from app.physics.site_slopes import (
    DEFAULT_SITE_SLOPES_FILE,
    FIT_RADIUS_M,
    SLOPE_DESCRIPTION,
    SiteSlopes,
    SiteSlopesError,
)
from scripts.site_slopes_from_moon_trek import (
    GLOBAL,
    PIXEL_SIZE_M,
    SPOLE_5M,
    SPOLE_30M,
    PatchUnusable,
    fit_plane,
    heights_in_circle,
    layers_for,
    local_east_north,
    polar_lat_lon,
    polar_xy,
    request_box,
    request_url,
    slope_from_patch,
)

np = pytest.importorskip("numpy")

BACKEND = Path(__file__).resolve().parents[2]
REPO = BACKEND.parent
PRESETS = json.loads((BACKEND / "app" / "data" / "preset_sites.json").read_text(encoding="utf-8"))["sites"]
STORED = json.loads(DEFAULT_SITE_SLOPES_FILE.read_text(encoding="utf-8"))


# ------------------------------------------------------------------------------------- the fit


@pytest.mark.parametrize(("tilt_deg", "toward_deg"), [(0.0, 0.0), (5.0, 0.0), (12.5, 90.0), (30.0, 225.0)])
def test_plane_fit_recovers_a_known_tilt_in_any_direction(tilt_deg, toward_deg):
    east, north = np.meshgrid(np.linspace(-500, 500, 21), np.linspace(-500, 500, 21))
    rise = math.tan(math.radians(tilt_deg))
    height = 1000.0 + rise * (east * math.sin(math.radians(toward_deg)) + north * math.cos(math.radians(toward_deg)))
    fit = fit_plane(east, north, height)
    assert fit.slope_deg == pytest.approx(tilt_deg, abs=1e-9)
    assert fit.heights_fitted == 21 * 21


def test_plane_fit_ignores_noise_that_averages_out():
    rng = np.random.default_rng(7)
    east, north = rng.uniform(-500, 500, 4000), rng.uniform(-500, 500, 4000)
    height = math.tan(math.radians(4.0)) * east + rng.normal(0.0, 2.0, east.size)
    assert fit_plane(east, north, height).slope_deg == pytest.approx(4.0, abs=0.05)


def test_plane_fit_needs_three_heights_off_one_line():
    with pytest.raises(PatchUnusable, match="needs 3"):
        fit_plane([0.0, 1.0], [0.0, 1.0], [0.0, 1.0])
    with pytest.raises(PatchUnusable, match="one line"):
        fit_plane([0.0, 1.0, 2.0], [0.0, 1.0, 2.0], [5.0, 6.0, 7.0])


# ------------------------------------------------------------------------------- geometry


@pytest.mark.parametrize(("lat", "lon"), [(-89.684, 196.739), (-85.42088, 31.6218), (-75.0, 132.4), (-87.5, 359.0)])
def test_polar_stereographic_round_trip(lat, lon):
    x, y = polar_xy(lat, lon)
    back_lat, back_lon = polar_lat_lon(np.array(x), np.array(y))
    assert float(back_lat) == pytest.approx(lat, abs=1e-10)
    assert float(back_lon) % 360.0 == pytest.approx(lon % 360.0, abs=1e-9)


def test_polar_stereographic_matches_the_formula_in_the_layer_description():
    # r = 2 R tan(45 + lat/2), x = r sin(lon), y = r cos(lon) on the 1,737,400 m sphere.
    r = 2 * 1_737_400 * math.tan(math.radians(45 + (-87.5) / 2))
    assert polar_xy(-87.5, 90.0) == pytest.approx((r, 0.0), abs=1e-6)
    assert polar_xy(-87.5, 180.0) == pytest.approx((0.0, -r), abs=1e-6)


def test_local_east_north_measures_metres_on_the_sphere():
    one_degree = math.radians(1.0) * 1_737_400
    e, n = local_east_north(0.0, 10.0, np.array([0.0, 0.001]), np.array([10.001, 10.0]))
    assert e == pytest.approx([one_degree / 1000, 0.0], abs=1e-6)
    assert n == pytest.approx([0.0, one_degree / 1000], abs=1e-6)


# --------------------------------------------------------------------------------- requests


@pytest.mark.parametrize(
    ("lat", "layers"),
    [
        (-89.684, [SPOLE_5M, GLOBAL]),
        (-87.5, [SPOLE_30M, GLOBAL]),
        (-85.42088, [SPOLE_30M, GLOBAL]),
        (-75.0, [SPOLE_30M, GLOBAL]),
        (-69.373, [GLOBAL]),
        (0.67416, [GLOBAL]),
    ],
)
def test_the_polar_model_is_tried_first_where_the_site_lies_in_it(lat, layers):
    assert layers_for(lat) == layers


def test_global_box_is_whole_degrees_with_signed_longitude():
    # A box in 0..360 comes back as no-data from Moon Trek; -180..180 works.
    assert request_box(GLOBAL, 0.67416, 23.47314) == {"ulx": 23, "uly": 1, "lrx": 24, "lry": 0}
    assert request_box(GLOBAL, -3.0128, 336.5781) == {"ulx": -24, "uly": -2, "lrx": -23, "lry": -4}
    assert "src=LRO_LOLA_DEM_Global_128ppd_v04&ulx=23&uly=1&lrx=24&lry=0" in request_url(GLOBAL, 0.67416, 23.47314)


def test_polar_box_is_1100_m_around_the_site_in_map_metres():
    x, y = polar_xy(-89.684, 196.739)
    box = request_box(SPOLE_5M, -89.684, 196.739)
    assert box["lrx"] - box["ulx"] == pytest.approx(1100.0, abs=0.002)
    assert box["uly"] - box["lry"] == pytest.approx(1100.0, abs=0.002)
    assert (box["ulx"] + box["lrx"]) / 2 == pytest.approx(x, abs=0.002)
    assert (box["uly"] + box["lry"]) / 2 == pytest.approx(y, abs=0.002)


def test_no_data_inside_the_circle_makes_the_patch_unusable():
    from affine import Affine

    x, y = polar_xy(-85.0, 30.0)
    transform = Affine(30.0, 0.0, x - 555.0, 0.0, -30.0, y + 555.0)
    values = np.full((37, 37), 1000.0)
    east, north, height = heights_in_circle(values, -3.4e38, transform, SPOLE_30M, -85.0, 30.0)
    assert east.size == height.size > 800
    assert np.hypot(east, north).max() <= FIT_RADIUS_M

    values[18, 18] = -3.4e38  # the centre pixel
    with pytest.raises(PatchUnusable, match="no-data"):
        heights_in_circle(values, -3.4e38, transform, SPOLE_30M, -85.0, 30.0)
    values[18, 18], values[0, 0] = 1000.0, -3.4e38  # a corner, outside the circle: still usable
    assert heights_in_circle(values, -3.4e38, transform, SPOLE_30M, -85.0, 30.0)[2].size == height.size


# ----------------------------------------------------------------------- the stored file


def test_every_preset_site_has_a_stored_slope_at_its_own_point():
    assert STORED["format"] == "common-horizon/site-slopes"
    assert SLOPE_DESCRIPTION in STORED["what"]
    assert set(STORED["sites"]) == {site["id"] for site in PRESETS}
    for site in PRESETS:
        entry = STORED["sites"][site["id"]]
        assert (entry["lat"], entry["lon_east"]) == (site["lat"], site["lon_east"])
        assert entry["fit_radius_m"] == 500
        assert 0 <= entry["slope_deg"] < 90
        assert entry["pixel_size_m"] == PIXEL_SIZE_M[entry["layer"]]
        assert entry["heights_fitted"] >= 3
        assert len(entry["fetch_date"]) == 10 and entry["fetch_date"].startswith("20")


def test_the_layer_used_is_the_first_that_has_no_gap_inside_the_circle():
    for site_id, entry in STORED["sites"].items():
        tried = layers_for(entry["lat"])
        not_used = entry.get("layers_not_used", [])
        assert [skip["layer"] for skip in not_used] + [entry["layer"]] == tried[: len(not_used) + 1], site_id
        for skip in not_used:
            assert "no-data" in skip["reason"], site_id


@pytest.mark.parametrize("site_id", sorted(STORED["sites"]))
def test_stored_slope_is_reproduced_from_the_kept_patch(site_id):
    pytest.importorskip("rasterio")
    entry = STORED["sites"][site_id]
    patch = REPO / entry["patch_file"]
    meta = json.loads(patch.with_suffix(".meta.json").read_text(encoding="utf-8"))
    assert hashlib.sha256(patch.read_bytes()).hexdigest() == meta["sha256"]
    assert meta["url"] == entry["request"] == request_url(entry["layer"], entry["lat"], entry["lon_east"])
    assert meta["retrieved_utc"].startswith(entry["fetch_date"])

    fit = slope_from_patch(patch, entry["layer"], entry["lat"], entry["lon_east"])
    assert round(fit.slope_deg, 3) == entry["slope_deg"]
    assert fit.heights_fitted == entry["heights_fitted"]
    for skip in entry.get("layers_not_used", []):
        with pytest.raises(PatchUnusable, match="no-data"):
            slope_from_patch(REPO / skip["patch_file"], skip["layer"], entry["lat"], entry["lon_east"])


# ------------------------------------------------------------------------------ the loader


def test_loader_finds_a_preset_by_its_coordinates_in_either_longitude_range():
    slopes = SiteSlopes.load(DEFAULT_SITE_SLOPES_FILE)
    apollo_12 = STORED["sites"]["apollo-12"]
    assert slopes.at(apollo_12["lat"], apollo_12["lon_east"]).slope_deg == apollo_12["slope_deg"]
    assert slopes.at(apollo_12["lat"], apollo_12["lon_east"] - 360.0).site_id == "apollo-12"
    # 0.001 degree away (about 30 m) is a custom point: no slope.
    assert slopes.at(apollo_12["lat"] + 0.001, apollo_12["lon_east"]) is None


@pytest.mark.parametrize(
    ("change", "message"),
    [
        ({"format_version": 2}, "version"),
        ({"sites": {}}, "no sites"),
        ({"sites": {"x": {"lat": 0, "lon_east": 0, "slope_deg": 95, "fit_radius_m": 500, "layer": "L",
                          "pixel_size_m": 5, "heights_fitted": 9, "fetch_date": "2026-11-15"}}}, "slope_deg"),
        ({"sites": {"x": {"lat": 0, "lon_east": 0, "slope_deg": 1, "fit_radius_m": 500, "layer": "L",
                          "pixel_size_m": 5, "heights_fitted": 2, "fetch_date": "2026-11-15"}}}, "heights_fitted"),
    ],
)
def test_loader_refuses_an_invalid_file(change, message):
    with pytest.raises(SiteSlopesError, match=message):
        SiteSlopes.from_json({**STORED, **change})
