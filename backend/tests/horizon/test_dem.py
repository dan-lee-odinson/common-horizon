"""Elevation grids on a polar stereographic map: projection, sampling, GeoTIFF reading, orientation.

Needs numpy and rasterio; skipped where they are not installed. All grids here are synthetic and
small. No elevation file from outside the repository is used.
"""

import math

import pytest

np = pytest.importorskip("numpy")
rasterio = pytest.importorskip("rasterio")

from rasterio.crs import CRS  # noqa: E402
from rasterio.transform import from_origin  # noqa: E402

from app.physics.horizon.compute import NO_DATA, compute_profile  # noqa: E402
from app.physics.horizon.dem import (  # noqa: E402
    CompositeTerrain,
    GeoreferencingError,
    PolarStereographic,
    RasterTerrain,
    check_projection_against_proj,
    load_raster_terrain,
    projection_from_crs,
    read_georeferencing,
    sha256_of_file,
)
from app.physics.horizon.geometry import unit_from_lat_lon  # noqa: E402

R = 1_737_400.0
SOUTH_POLAR = "+proj=stere +lat_0=-90 +lat_ts=-90 +lon_0=0 +x_0=0 +y_0=0 +R=1737400 +units=m +no_defs"
SOUTH = PolarStereographic(
    pole=-1, radius_m=R, central_longitude_deg=0.0, scale=1.0, false_easting_m=0.0, false_northing_m=0.0
)


def _xy_by_hand(latitude_deg: float, longitude_deg: float) -> tuple[float, float]:
    """South polar stereographic, textbook form: rho = 2 R tan(colatitude / 2), x = rho sin(lon), y = rho cos(lon)."""
    rho = 2.0 * R * math.tan(math.radians(90.0 + latitude_deg) / 2.0)
    return rho * math.sin(math.radians(longitude_deg)), rho * math.cos(math.radians(longitude_deg))


def _grid(centre_lat: float, centre_lon: float, pixels: int, pixel_size: float, fill: float = 0.0):
    """A square grid of ``pixels`` x ``pixels`` centred on a point, as (heights, x_origin, y_origin)."""
    x, y = _xy_by_hand(centre_lat, centre_lon)
    half = pixels * pixel_size / 2.0
    # Snap the origin to whole pixels so pixel edges fall on round coordinates, like the real files.
    x_origin = math.floor((x - half) / pixel_size) * pixel_size
    y_origin = math.ceil((y + half) / pixel_size) * pixel_size
    return np.full((pixels, pixels), fill, dtype=np.float32), x_origin, y_origin


def _raise_block(heights, x_origin, y_origin, pixel_size, latitude, longitude, height, half_width_pixels=3):
    """Raise a small square of pixels around a latitude and longitude."""
    x, y = _xy_by_hand(latitude, longitude)
    column = int((x - x_origin) / pixel_size)
    row = int((y_origin - y) / pixel_size)  # rows count downward from the top edge: y falls as the row grows
    rows = slice(row - half_width_pixels, row + half_width_pixels + 1)
    columns = slice(column - half_width_pixels, column + half_width_pixels + 1)
    heights[rows, columns] = height


def _terrain(heights, x_origin, y_origin, pixel_size) -> RasterTerrain:
    return RasterTerrain(heights, SOUTH, x_origin, y_origin, pixel_size, -pixel_size, name="synthetic")


def _centre_of_raised_azimuths(result, level_deg: float) -> float:
    raised = result.horizon_elevation_deg > level_deg
    angles = np.radians(result.azimuth_deg[raised])
    return math.degrees(math.atan2(np.sin(angles).mean(), np.cos(angles).mean())) % 360.0


# --- projection ---------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("latitude", "longitude", "x", "y"),
    [
        (-90.0, 0.0, 0.0, 0.0),  # the pole is the map's origin
        (-80.0, 0.0, 0.0, 304_005.6),  # longitude 0 points up the map (+y): 2 R tan(5 deg)
        (-80.0, 90.0, 304_005.6, 0.0),  # longitude 90 E points right (+x)
        (-80.0, 180.0, 0.0, -304_005.6),
        (-80.0, 270.0, -304_005.6, 0.0),
        (-60.0, 0.0, 0.0, 931_069.8),  # 2 R tan(15 deg): the 60 S limit of the coarse model
    ],
)
def test_south_polar_stereographic_known_points(latitude, longitude, x, y):
    got_x, got_y = SOUTH.forward(np.array(latitude), np.array(longitude))
    assert float(got_x) == pytest.approx(x, abs=0.1)
    assert float(got_y) == pytest.approx(y, abs=0.1)
    by_hand = _xy_by_hand(latitude, longitude)
    assert (float(got_x), float(got_y)) == pytest.approx(by_hand, abs=1e-6)


def test_projection_formula_agrees_with_proj_for_the_same_crs():
    crs = CRS.from_proj4(SOUTH_POLAR)
    projection = projection_from_crs(crs)
    assert projection == SOUTH
    assert check_projection_against_proj(projection, crs) < 1e-6


def test_north_polar_and_shifted_projections_agree_with_proj():
    for proj4 in (
        "+proj=stere +lat_0=90 +lat_ts=90 +lon_0=0 +x_0=0 +y_0=0 +R=1737400 +units=m +no_defs",
        "+proj=stere +lat_0=-90 +lat_ts=-90 +lon_0=45 +x_0=1000 +y_0=-2000 +R=1737400 +units=m +no_defs",
        "+proj=stere +lat_0=-90 +lat_ts=-71 +lon_0=0 +x_0=0 +y_0=0 +R=1737400 +units=m +no_defs",
        "+proj=stere +lat_0=90 +lon_0=-30 +k=0.994 +x_0=0 +y_0=0 +R=1737400 +units=m +no_defs",
    ):
        crs = CRS.from_proj4(proj4)
        assert check_projection_against_proj(projection_from_crs(crs), crs) < 1e-6


def test_inverse_undoes_forward():
    latitudes = np.array([-89.99, -89.684, -85.42088, -80.13, -60.5])
    longitudes = np.array([0.5, 196.739, 31.6218, 1.44, 359.5])
    back_latitude, back_longitude = SOUTH.inverse(*SOUTH.forward(latitudes, longitudes))
    assert np.allclose(back_latitude, latitudes, atol=1e-10)
    assert np.allclose(back_longitude, longitudes, atol=1e-8)


@pytest.mark.parametrize(
    "proj4",
    [
        "+proj=longlat +R=1737400 +no_defs",  # not projected
        "+proj=eqc +lat_ts=0 +lon_0=0 +R=1737400 +units=m +no_defs",  # wrong projection
        "+proj=stere +lat_0=-45 +lon_0=0 +R=1737400 +units=m +no_defs",  # stereographic but not polar
        "+proj=stere +lat_0=-90 +lat_ts=-90 +lon_0=0 +a=1737400 +b=1736000 +units=m +no_defs",  # not a sphere
    ],
)
def test_coordinate_systems_the_reader_cannot_interpret_are_refused(proj4):
    with pytest.raises(GeoreferencingError):
        projection_from_crs(CRS.from_proj4(proj4))
    with pytest.raises(GeoreferencingError):
        projection_from_crs(None)


# --- sampling -----------------------------------------------------------------------------------------


def test_bilinear_sampling_between_pixel_centres():
    heights = np.array([[0.0, 10.0, 20.0], [100.0, 110.0, 120.0], [200.0, 210.0, 220.0]], dtype=np.float32)
    terrain = RasterTerrain(heights, SOUTH, x_origin_m=1000.0, y_origin_m=5000.0, dx_m=40.0, dy_m=-40.0)
    # Pixel (row 0, column 0) is centred at x = 1020, y = 4980; rows go down (y falls), columns go right.
    cases = [
        ((1020.0, 4980.0), 0.0),
        ((1060.0, 4980.0), 10.0),
        ((1020.0, 4940.0), 100.0),
        ((1040.0, 4980.0), 5.0),  # halfway between two columns
        ((1020.0, 4960.0), 50.0),  # halfway between two rows
        ((1040.0, 4960.0), 55.0),  # centre of four pixels
        ((1100.0, 4900.0), 220.0),  # the last pixel centre
    ]
    for (x, y), expected in cases:
        values, valid = terrain.sample_xy(np.array([x]), np.array([y]))
        assert valid[0], (x, y)
        assert values[0] == pytest.approx(expected, abs=1e-4)
    # Outside the ring of pixel centres there are not four neighbours to interpolate between.
    for x, y in [(1010.0, 4980.0), (1020.0, 4990.0), (1101.0, 4900.0), (1100.0, 4899.0), (0.0, 0.0)]:
        assert not terrain.sample_xy(np.array([x]), np.array([y]))[1][0]


def test_sample_next_to_missing_data_is_invalid():
    heights = np.zeros((4, 4), dtype=np.float32)
    heights[1, 2] = np.nan
    terrain = RasterTerrain(heights, SOUTH, 0.0, 160.0, 40.0, -40.0)
    assert terrain.max_height_m == 0.0  # NaN is ignored for the highest value
    assert not terrain.sample_xy(np.array([90.0]), np.array([110.0]))[1][0]  # uses the NaN pixel
    assert terrain.sample_xy(np.array([30.0]), np.array([30.0]))[1][0]  # far corner, no NaN involved


def test_points_on_the_far_hemisphere_have_no_data():
    heights, x_origin, y_origin = _grid(-89.0, 0.0, 200, 240.0)
    terrain = _terrain(heights, x_origin, y_origin, 240.0)
    north_pole = np.array([[0.0, 0.0, 1.0], [1.0, 0.0, 0.0]])
    assert np.all(terrain.sample(north_pole)[1] == NO_DATA)


def test_composite_prefers_the_first_grid_and_falls_back_to_the_second():
    fine_heights, fx, fy = _grid(-89.0, 0.0, 100, 40.0, fill=10.0)  # 4 km square
    coarse_heights, cx, cy = _grid(-89.0, 0.0, 200, 240.0, fill=20.0)  # 48 km square
    composite = CompositeTerrain([_terrain(fine_heights, fx, fy, 40.0), _terrain(coarse_heights, cx, cy, 240.0)])
    assert composite.pixel_size_m == 40.0
    assert composite.max_height_m == 20.0

    inside = np.asarray(unit_from_lat_lon(-89.0, 0.0))
    beyond = np.asarray(unit_from_lat_lon(-89.5, 0.0))  # 15 km away: off the fine grid, on the coarse one
    nowhere = np.asarray(unit_from_lat_lon(-80.0, 0.0))
    heights, sources = composite.sample(np.stack([inside, beyond, nowhere]))
    assert sources.tolist() == [0, 1, NO_DATA]
    assert heights[0] == 10.0 and heights[1] == 20.0 and np.isnan(heights[2])
    # Shapes with more than one leading dimension come back in the same shape.
    grid_heights, grid_sources = composite.sample(np.stack([inside, beyond, nowhere, inside]).reshape(2, 2, 3))
    assert grid_sources.tolist() == [[0, 1], [NO_DATA, 0]]
    assert grid_heights.shape == (2, 2)


# --- orientation: a peak placed by latitude and longitude appears in the right direction -------------


@pytest.mark.parametrize(
    ("site", "peak", "expected_azimuth"),
    [
        ((-85.0, 30.0), (-84.5, 30.0), 0.0),  # same meridian, nearer the equator: north
        ((-85.0, 30.0), (-85.5, 30.0), 180.0),  # toward the pole: south
        ((-85.0, 30.0), (-85.0, 36.0), 92.99),  # 6 degrees more east longitude: east (bearing worked below)
        ((-85.0, 30.0), (-85.0, 24.0), 267.01),  # west
        ((-89.0, 200.0), (-88.5, 200.0), 0.0),
        ((-89.0, 200.0), (-89.0, 230.0), 105.0),  # 30 degrees more east longitude, close to the pole
    ],
)
def test_peak_on_a_polar_grid_appears_at_the_right_azimuth(site, peak, expected_azimuth):
    # Independent of the walker: the bearing from site to peak by the textbook formula.
    lat1, lat2 = math.radians(site[0]), math.radians(peak[0])
    delta = math.radians(peak[1] - site[1])
    bearing = math.degrees(
        math.atan2(
            math.sin(delta) * math.cos(lat2),
            math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(delta),
        )
    ) % 360.0
    assert bearing == pytest.approx(expected_azimuth, abs=0.01)

    heights, x_origin, y_origin = _grid(site[0], site[1], 500, 120.0)  # 60 km square around the site
    _raise_block(heights, x_origin, y_origin, 120.0, peak[0], peak[1], 3000.0, half_width_pixels=4)
    result = compute_profile(_terrain(heights, x_origin, y_origin, 120.0), site[0], site[1])

    centre = _centre_of_raised_azimuths(result, level_deg=1.0)
    assert abs((centre - bearing + 180.0) % 360.0 - 180.0) < 0.75
    assert result.site_height_m == 0.0


def test_constant_grid_gives_the_dip_of_its_own_sphere():
    heights, x_origin, y_origin = _grid(-85.0, 30.0, 400, 40.0, fill=1500.0)  # 16 km square
    result = compute_profile(_terrain(heights, x_origin, y_origin, 40.0), -85.0, 30.0)
    radius = R + 1500.0
    assert result.site_height_m == pytest.approx(1500.0)
    assert np.max(np.abs(result.horizon_elevation_deg + math.degrees(math.acos(radius / (radius + 2.0))))) < 1e-6
    assert not result.ran_out_of_data.any()  # every ray is decided within 2.7 km, well inside the grid


# --- GeoTIFF files ------------------------------------------------------------------------------------


def _write_geotiff(path, heights, x_origin, y_origin, pixel_size, crs=SOUTH_POLAR, nodata=float("nan"), **extra):
    profile = {
        "driver": "GTiff",
        "height": heights.shape[0],
        "width": heights.shape[1],
        "count": 1,
        "dtype": heights.dtype,
        "crs": CRS.from_proj4(crs),
        "transform": from_origin(x_origin, y_origin, pixel_size, pixel_size),
        "nodata": nodata,
    }
    with rasterio.open(path, "w", **profile) as dataset:
        dataset.write(heights, 1)
        for key, value in extra.items():
            setattr(dataset, key, value)


def _hilly_grid():
    heights, x_origin, y_origin = _grid(-85.0, 30.0, 300, 240.0)  # 72 km square
    rows, columns = np.indices(heights.shape)
    heights += (1500.0 + 80.0 * np.sin(rows / 17.0) + 60.0 * np.cos(columns / 23.0)).astype(np.float32)
    _raise_block(heights, x_origin, y_origin, 240.0, -84.7, 30.0, 6000.0)
    return heights, x_origin, y_origin


def test_geotiff_is_read_with_its_own_georeferencing(tmp_path):
    heights, x_origin, y_origin = _hilly_grid()
    path = tmp_path / "synthetic_240m.tif"
    _write_geotiff(path, heights, x_origin, y_origin, 240.0)

    terrain = load_raster_terrain(path)
    assert terrain.projection == SOUTH
    assert (terrain.x_origin_m, terrain.y_origin_m, terrain.dx_m, terrain.dy_m) == (x_origin, y_origin, 240.0, -240.0)
    assert terrain.pixel_size_m == 240.0
    assert terrain.max_height_m == 6000.0
    assert terrain.details["height_unit"] == "m"
    assert "documentation" in terrain.details["height_unit_source"]
    assert terrain.details["sphere_radius_m"] == R
    assert terrain.details["formula_vs_proj_max_difference_m"] < 1e-6
    assert np.array_equal(terrain.heights, heights)

    file_says = read_georeferencing(path)
    assert file_says["width"] == 300 and file_says["transform"][0] == 240.0 and file_says["transform"][4] == -240.0
    assert "stere" in file_says["crs_proj4"]
    assert len(sha256_of_file(path)) == 64

    # The file gives the same profile as the array it was written from, and sees the peak due north.
    from_file = compute_profile(terrain, -85.0, 30.0)
    from_array = compute_profile(_terrain(heights, x_origin, y_origin, 240.0), -85.0, 30.0)
    assert np.array_equal(from_file.horizon_elevation_deg, from_array.horizon_elevation_deg)
    north = from_file.horizon_elevation_deg[0]
    # The block is a square of whole pixels, so its nearest corner can sit a degree off the meridian.
    centre = _centre_of_raised_azimuths(from_file, level_deg=20.0)
    assert abs((centre + 180.0) % 360.0 - 180.0) < 1.5
    assert north > from_file.horizon_elevation_deg.max() - 1.0
    # 0.3 degrees of arc = 9097 m to the block's centre, its near face 3.5 pixels (840 m) closer.
    assert north == pytest.approx(math.degrees(math.atan((6000.0 - from_file.site_height_m) / 8257.0)), abs=1.5)
    assert north > 20.0  # nothing else on this gently rolling grid comes close


def test_geotiff_no_data_value_and_kilometre_unit(tmp_path):
    heights, x_origin, y_origin = _hilly_grid()
    in_km = (heights / 1000.0).astype(np.float32)
    in_km[0:10, 0:10] = -9999.0
    path = tmp_path / "synthetic_km.tif"
    _write_geotiff(path, in_km, x_origin, y_origin, 240.0, nodata=-9999.0, units=("km",))

    terrain = load_raster_terrain(path)
    assert terrain.details["height_unit"] == "km" and terrain.details["height_unit_source"] == "file"
    assert np.isnan(terrain.heights[0:10, 0:10]).all()
    assert np.allclose(terrain.heights[10:, 10:], heights[10:, 10:], atol=0.01)
    assert terrain.max_height_m == pytest.approx(6000.0, abs=0.01)
    assert terrain.details["valid_fraction"] == pytest.approx(1.0 - 100.0 / heights.size)


def test_geotiff_whose_values_cannot_be_metres_of_relief_is_refused(tmp_path):
    heights, x_origin, y_origin = _hilly_grid()
    path = tmp_path / "kilometres_unlabelled.tif"
    _write_geotiff(path, (heights / 1000.0).astype(np.float32), x_origin, y_origin, 240.0)
    with pytest.raises(GeoreferencingError, match="relief"):
        load_raster_terrain(path)  # no unit in the file, "m" assumed from the documentation: 6 m of relief
    assert load_raster_terrain(path, documented_height_unit="km").max_height_m == pytest.approx(6000.0, abs=0.01)


def test_geotiff_with_another_sphere_radius_is_shifted_to_the_contract_sphere(tmp_path):
    heights, x_origin, y_origin = _hilly_grid()
    path = tmp_path / "other_sphere.tif"
    other = SOUTH_POLAR.replace("+R=1737400", "+R=1737000")
    _write_geotiff(path, heights, x_origin, y_origin, 240.0, crs=other)
    terrain = load_raster_terrain(path)
    assert terrain.projection.radius_m == 1_737_000.0
    # A height of h above a 1737.0 km sphere is h - 400 m above the 1737.4 km sphere.
    assert np.allclose(terrain.heights, heights - 400.0, atol=0.01)


def test_geotiff_that_is_not_polar_stereographic_is_refused(tmp_path):
    heights, x_origin, y_origin = _hilly_grid()
    path = tmp_path / "equirectangular.tif"
    equirectangular = "+proj=eqc +lat_ts=0 +lon_0=0 +R=1737400 +units=m +no_defs"
    _write_geotiff(path, heights, x_origin, y_origin, 240.0, crs=equirectangular)
    with pytest.raises(GeoreferencingError):
        load_raster_terrain(path)
