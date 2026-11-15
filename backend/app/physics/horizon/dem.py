"""Elevation models on a polar stereographic grid, read from GeoTIFF files.

Needs numpy and rasterio (see ``backend/requirements-tools.txt``). Offline tool
code: the backend service never imports this module.

Nothing about a file's georeferencing is assumed. The projection, its
parameters, the pixel size, the grid origin, the no-data value, the height
scale and the sphere radius are read from the file, and the loader refuses a
file it cannot interpret exactly. The map projection is then applied with a
closed formula (polar stereographic on a sphere) that is checked against the
PROJ library, through rasterio, every time a file is opened.
"""

import hashlib
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np

from app.physics.horizon.compute import NO_DATA
from app.physics.horizon.geometry import MOON_RADIUS_M


class GeoreferencingError(ValueError):
    """The file's georeferencing is missing, ambiguous, or of a kind this reader does not handle."""


@dataclass(frozen=True)
class PolarStereographic:
    """Polar stereographic projection of a sphere, as read from a file.

    ``pole`` is +1 for the north pole, -1 for the south pole. ``scale`` is the
    scale factor at the pole. Map coordinates are metres.
    """

    pole: int
    radius_m: float
    central_longitude_deg: float
    scale: float
    false_easting_m: float
    false_northing_m: float

    def forward_unit(self, unit_vectors: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        """Map coordinates ``(x, y)`` of unit vectors ``(..., 3)`` in the body-fixed frame.

        With ``rho = 2 R k tan(colatitude / 2)`` measured from the projection's pole and
        ``lam`` the longitude past the central meridian: south pole ``x = rho sin(lam)``,
        ``y = rho cos(lam)``; north pole ``x = rho sin(lam)``, ``y = -rho cos(lam)``.
        Written with the vector's components there is no division by zero at the pole:
        ``rho sin(lam)`` and ``rho cos(lam)`` are ``2 R k`` times the horizontal
        components over ``1 + pole * z`` (``tan(c / 2) = sin(c) / (1 + cos(c))`` and the cosine
        of the colatitude from the projection's pole is ``pole * z``).
        """
        px, py, pz = unit_vectors[..., 0], unit_vectors[..., 1], unit_vectors[..., 2]
        lon0 = math.radians(self.central_longitude_deg)
        along = px * math.cos(lon0) + py * math.sin(lon0)  # cos(lat) cos(lam)
        across = py * math.cos(lon0) - px * math.sin(lon0)  # cos(lat) sin(lam)
        factor = 2.0 * self.radius_m * self.scale / (1.0 + self.pole * pz)
        x = self.false_easting_m + factor * across
        y = self.false_northing_m - self.pole * factor * along
        return x, y

    def forward(self, latitude_deg: np.ndarray, longitude_deg: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        lat, lon = np.radians(latitude_deg), np.radians(longitude_deg)
        vectors = np.stack([np.cos(lat) * np.cos(lon), np.cos(lat) * np.sin(lon), np.sin(lat)], axis=-1)
        return self.forward_unit(vectors)

    def inverse(self, x: np.ndarray, y: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        """``(latitude_deg, east longitude_deg in 0..360)`` of map coordinates."""
        dx = np.asarray(x, dtype=np.float64) - self.false_easting_m
        dy = np.asarray(y, dtype=np.float64) - self.false_northing_m
        rho = np.hypot(dx, dy)
        colatitude = 2.0 * np.arctan(rho / (2.0 * self.radius_m * self.scale))
        latitude = self.pole * (90.0 - np.degrees(colatitude))
        longitude = (self.central_longitude_deg + np.degrees(np.arctan2(dx, -self.pole * dy))) % 360.0
        return latitude, longitude

    def describe(self) -> dict[str, Any]:
        return {
            "projection": "polar stereographic (sphere)",
            "pole": "north" if self.pole > 0 else "south",
            "sphere_radius_m": self.radius_m,
            "central_longitude_deg": self.central_longitude_deg,
            "scale_factor_at_pole": self.scale,
            "false_easting_m": self.false_easting_m,
            "false_northing_m": self.false_northing_m,
        }


def projection_from_crs(crs) -> PolarStereographic:
    """Read polar stereographic parameters from a rasterio CRS, or refuse."""
    if crs is None:
        raise GeoreferencingError("the file has no coordinate reference system")
    parameters = crs.to_dict()
    if parameters.get("proj") != "stere":
        raise GeoreferencingError(f"expected a stereographic projection, the file says {parameters.get('proj')!r}")
    if parameters.get("units", "m") != "m":
        raise GeoreferencingError(f"expected map coordinates in metres, the file says {parameters.get('units')!r}")

    latitude_of_origin = float(parameters.get("lat_0", 0.0))
    if abs(abs(latitude_of_origin) - 90.0) > 1e-9:
        raise GeoreferencingError(f"expected a polar projection (lat_0 = +/-90), the file says {latitude_of_origin}")
    pole = 1 if latitude_of_origin > 0 else -1

    if "R" in parameters:
        radius = float(parameters["R"])
    elif "a" in parameters:
        radius = float(parameters["a"])
        polar_radius = float(parameters.get("b", radius))
        if "rf" in parameters and float(parameters["rf"]) != 0.0:
            polar_radius = radius * (1.0 - 1.0 / float(parameters["rf"]))
        if abs(polar_radius - radius) > 1e-6:
            raise GeoreferencingError(f"expected a sphere, the file gives radii {radius} and {polar_radius}")
    else:
        raise GeoreferencingError(f"the file's coordinate system gives no body radius: {parameters}")

    if "lat_ts" in parameters:
        # Scale true at latitude lat_ts instead of at the pole.
        scale = (1.0 + math.sin(math.radians(abs(float(parameters["lat_ts"]))))) / 2.0
    else:
        scale = float(parameters.get("k", parameters.get("k_0", 1.0)))

    return PolarStereographic(
        pole=pole,
        radius_m=radius,
        central_longitude_deg=float(parameters.get("lon_0", 0.0)),
        scale=scale,
        false_easting_m=float(parameters.get("x_0", 0.0)),
        false_northing_m=float(parameters.get("y_0", 0.0)),
    )


def check_projection_against_proj(projection: PolarStereographic, crs, tolerance_m: float = 1e-3) -> float:
    """Largest disagreement, metres, between the closed formula and PROJ for the file's own CRS.

    Raises ``GeoreferencingError`` above ``tolerance_m``. The test points lie within 35 degrees
    of the projection's pole, at longitudes all round the circle.
    """
    from rasterio.crs import CRS
    from rasterio.warp import transform

    colatitudes = np.array([0.0, 0.01, 0.316, 1.0, 4.58, 10.0, 20.0, 30.0, 35.0])
    longitudes = np.array([0.0, 31.6218, 90.0, 129.78, 180.0, 196.739, 270.0, 359.0])
    colatitude_grid, longitude_grid = np.meshgrid(colatitudes, longitudes)
    latitudes = (projection.pole * (90.0 - colatitude_grid)).ravel()
    longitudes = longitude_grid.ravel()

    geographic = CRS.from_proj4(f"+proj=longlat +R={projection.radius_m!r} +no_defs")
    proj_x, proj_y = transform(geographic, crs, longitudes.tolist(), latitudes.tolist())
    own_x, own_y = projection.forward(latitudes, longitudes)
    worst = float(np.max(np.hypot(own_x - np.asarray(proj_x), own_y - np.asarray(proj_y))))
    if not worst <= tolerance_m:
        raise GeoreferencingError(
            f"the polar stereographic formula disagrees with PROJ by {worst:.6f} m for this file's coordinate system"
        )
    back_latitude, back_longitude = projection.inverse(own_x, own_y)
    off_pole = colatitude_grid.ravel() > 0
    longitude_error = np.abs((back_longitude - longitudes + 180.0) % 360.0 - 180.0)[off_pole]
    if np.max(np.abs(back_latitude - latitudes)) > 1e-9 or np.max(longitude_error) > 1e-7:
        raise GeoreferencingError("the inverse projection does not undo the forward projection")
    return worst


class RasterTerrain:
    """One elevation grid in memory, sampled with bilinear interpolation.

    ``heights`` holds metres above the 1737.4 km sphere, NaN where the file has
    no data. Pixel ``(row, column)`` covers map coordinates from
    ``(x_origin + column * dx, y_origin + row * dy)`` to one pixel further, and its
    value is taken to sit at the pixel's centre. A sample is valid only where
    all four surrounding pixel centres have data.
    """

    def __init__(
        self,
        heights: np.ndarray,
        projection: PolarStereographic,
        x_origin_m: float,
        y_origin_m: float,
        dx_m: float,
        dy_m: float,
        name: str = "",
        details: dict[str, Any] | None = None,
    ) -> None:
        if heights.ndim != 2:
            raise ValueError("heights must be a 2D array")
        if dx_m == 0 or dy_m == 0:
            raise ValueError("pixel size must not be zero")
        self.heights = heights
        self.projection = projection
        self.x_origin_m = float(x_origin_m)
        self.y_origin_m = float(y_origin_m)
        self.dx_m = float(dx_m)
        self.dy_m = float(dy_m)
        self.name = name
        self.details = details or {}
        self.pixel_size_m = max(abs(self.dx_m), abs(self.dy_m))
        self.max_height_m = float(np.nanmax(heights))
        self.min_height_m = float(np.nanmin(heights))

    def sample_xy(self, x: np.ndarray, y: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        """Heights at map coordinates and a mask of where they are valid."""
        rows_total, columns_total = self.heights.shape
        # Position in units of pixels, measured from the centre of pixel (0, 0).
        column = (np.asarray(x, dtype=np.float64) - self.x_origin_m) / self.dx_m - 0.5
        row = (np.asarray(y, dtype=np.float64) - self.y_origin_m) / self.dy_m - 0.5
        inside = (column >= 0) & (column <= columns_total - 1) & (row >= 0) & (row <= rows_total - 1)
        column0 = np.clip(np.floor(np.where(inside, column, 0.0)).astype(np.int64), 0, columns_total - 2)
        row0 = np.clip(np.floor(np.where(inside, row, 0.0)).astype(np.int64), 0, rows_total - 2)
        column_weight = np.where(inside, column - column0, 0.0)
        row_weight = np.where(inside, row - row0, 0.0)

        top_left = self.heights[row0, column0].astype(np.float64)
        top_right = self.heights[row0, column0 + 1].astype(np.float64)
        bottom_left = self.heights[row0 + 1, column0].astype(np.float64)
        bottom_right = self.heights[row0 + 1, column0 + 1].astype(np.float64)
        top = top_left + (top_right - top_left) * column_weight
        bottom = bottom_left + (bottom_right - bottom_left) * column_weight
        values = top + (bottom - top) * row_weight
        valid = inside & np.isfinite(values)
        return values, valid

    def sample(self, unit_vectors: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        # A stereographic map of the far hemisphere is meaningless; keep to the pole's own hemisphere.
        near_side = self.projection.pole * unit_vectors[..., 2] > 0
        safe = np.where(near_side[..., np.newaxis], unit_vectors, np.array([0.0, 0.0, float(self.projection.pole)]))
        x, y = self.projection.forward_unit(safe)
        values, valid = self.sample_xy(x, y)
        valid &= near_side
        return values, np.where(valid, 0, NO_DATA).astype(np.int8)

    def pixel_center_lat_lon(self, row: int, column: int) -> tuple[float, float]:
        x = self.x_origin_m + (column + 0.5) * self.dx_m
        y = self.y_origin_m + (row + 0.5) * self.dy_m
        latitude, longitude = self.projection.inverse(np.array(x), np.array(y))
        return float(latitude), float(longitude)


class CompositeTerrain:
    """Several grids in order of preference: the first one with data at a point supplies it.

    Give the finest grid first. The source index returned by ``sample`` is the
    position of the supplying grid in ``models``.
    """

    def __init__(self, models: list[RasterTerrain]) -> None:
        if not models:
            raise ValueError("at least one elevation model is needed")
        self.models = list(models)
        self.pixel_size_m = self.models[0].pixel_size_m
        self.max_height_m = max(model.max_height_m for model in self.models)

    def sample(self, unit_vectors: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        shape = unit_vectors.shape[:-1]
        flat = unit_vectors.reshape(-1, 3)
        heights = np.full(flat.shape[0], np.nan)
        sources = np.full(flat.shape[0], NO_DATA, dtype=np.int8)
        for index, model in enumerate(self.models):
            missing = np.flatnonzero(sources == NO_DATA)
            if missing.size == 0:
                break
            values, model_sources = model.sample(flat[missing])
            found = model_sources != NO_DATA
            heights[missing[found]] = values[found]
            sources[missing[found]] = index
        return heights.reshape(shape), sources.reshape(shape)


def sha256_of_file(path: str | Path, block_size: int = 1 << 22) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        while block := handle.read(block_size):
            digest.update(block)
    return digest.hexdigest()


def read_georeferencing(path: str | Path) -> dict[str, Any]:
    """What the file itself says about its grid, without reading the pixel values."""
    import rasterio

    with rasterio.open(path) as dataset:
        transform = dataset.transform
        return {
            "file": Path(path).name,
            "driver": dataset.driver,
            "width": dataset.width,
            "height": dataset.height,
            "bands": dataset.count,
            "dtype": dataset.dtypes[0],
            "nodata": dataset.nodata,
            "crs_wkt": dataset.crs.to_wkt() if dataset.crs else None,
            "crs_proj4": dataset.crs.to_proj4() if dataset.crs else None,
            "transform": [transform.a, transform.b, transform.c, transform.d, transform.e, transform.f],
            "band_units": dataset.units[0],
            "band_scale": dataset.scales[0],
            "band_offset": dataset.offsets[0],
            "band_description": dataset.descriptions[0],
            "tags": dict(dataset.tags()),
            "band_tags": dict(dataset.tags(1)),
            "area_or_point": dataset.tags().get("AREA_OR_POINT"),
        }


_METRE_UNIT_NAMES = {"m", "meter", "meters", "metre", "metres"}
_KILOMETRE_UNIT_NAMES = {"km", "kilometer", "kilometers", "kilometre", "kilometres"}


def load_raster_terrain(path: str | Path, documented_height_unit: str = "m") -> RasterTerrain:
    """Read a polar stereographic elevation GeoTIFF into memory.

    ``documented_height_unit`` is used only when the file itself carries no unit
    for its values; it is what the product's documentation states. Whichever
    applied is recorded in ``details["height_unit_source"]``.
    """
    import rasterio

    path = Path(path)
    with rasterio.open(path) as dataset:
        if dataset.count != 1:
            raise GeoreferencingError(f"{path.name}: expected one band, found {dataset.count}")
        transform = dataset.transform
        if transform.b != 0.0 or transform.d != 0.0:
            raise GeoreferencingError(f"{path.name}: the grid is rotated or sheared, which this reader does not handle")
        projection = projection_from_crs(dataset.crs)
        proj_disagreement_m = check_projection_against_proj(projection, dataset.crs)

        file_unit = (dataset.units[0] or "").strip().lower()
        if file_unit in _METRE_UNIT_NAMES:
            unit, unit_source = "m", "file"
        elif file_unit in _KILOMETRE_UNIT_NAMES:
            unit, unit_source = "km", "file"
        elif not file_unit:
            unit, unit_source = documented_height_unit, "product documentation (the file carries no unit)"
        else:
            raise GeoreferencingError(f"{path.name}: unknown height unit {dataset.units[0]!r}")
        if unit not in ("m", "km"):
            raise GeoreferencingError(f"height unit must be 'm' or 'km', got {unit!r}")

        band_scale = float(dataset.scales[0] if dataset.scales[0] is not None else 1.0)
        band_offset = float(dataset.offsets[0] if dataset.offsets[0] is not None else 0.0)
        nodata = dataset.nodata
        heights = dataset.read(1, out_dtype="float32")
        georeferencing = {
            "file": path.name,
            "width": dataset.width,
            "height": dataset.height,
            "dtype": dataset.dtypes[0],
            "nodata": nodata,
            "crs_proj4": dataset.crs.to_proj4(),
            "transform": [transform.a, transform.b, transform.c, transform.d, transform.e, transform.f],
        }

    if nodata is not None and not math.isnan(nodata):
        heights[heights == np.float32(nodata)] = np.nan
    if band_scale != 1.0 or band_offset != 0.0:
        heights = heights * np.float32(band_scale) + np.float32(band_offset)
    if unit == "km":
        heights *= np.float32(1000.0)
    # The file's heights are relative to its own sphere; the contract's are relative to 1737.4 km.
    radius_shift = projection.radius_m - MOON_RADIUS_M
    if radius_shift != 0.0:
        heights += np.float32(radius_shift)

    valid_fraction = float(np.count_nonzero(np.isfinite(heights))) / heights.size
    if valid_fraction == 0.0:
        raise GeoreferencingError(f"{path.name}: the file holds no valid heights")
    terrain = RasterTerrain(
        heights,
        projection,
        x_origin_m=transform.c,
        y_origin_m=transform.f,
        dx_m=transform.a,
        dy_m=transform.e,
        name=path.name,
        details={
            **georeferencing,
            **projection.describe(),
            "pixel_size_m": max(abs(transform.a), abs(transform.e)),
            "height_unit": unit,
            "height_unit_source": unit_source,
            "band_scale": band_scale,
            "band_offset": band_offset,
            "height_reference_radius_m": projection.radius_m,
            "valid_fraction": valid_fraction,
            "formula_vs_proj_max_difference_m": proj_disagreement_m,
        },
    )
    # A lunar surface in metres spans kilometres of relief; anything else means the unit was read wrongly.
    relief = terrain.max_height_m - terrain.min_height_m
    if not 1_000.0 < relief < 30_000.0:
        raise GeoreferencingError(
            f"{path.name}: heights span {relief:.1f} m, which is not plausible lunar relief in metres; check the unit"
        )
    terrain.details["min_height_m"] = terrain.min_height_m
    terrain.details["max_height_m"] = terrain.max_height_m
    return terrain
