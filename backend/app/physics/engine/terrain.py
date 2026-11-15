
"""LOLA terrain elevation lookup for the physics engine."""

from pathlib import Path

import math
import numpy as np
import rasterio
from rasterio.warp import transform


# Locate the LOLA datasets relative to this module
PHYSICS_DIR = Path(__file__).resolve().parent.parent
LOLA_DIR = PHYSICS_DIR / "data" / "datasets" / "lola"

# Preferred DEM order highest resolution first
DEM_FILES = [
    ("80 m polar", "LDEM_80S_80MPP_ADJ.tiff"),
    ("240 m polar", "LDEM_60S_240MPP_ADJ.tiff"),
    ("118 m global", "Lunar_LRO_LOLA_Global_LDEM_118m_Mar2014.tif"),
]


def get_elevation_from_dem(
    latitude_deg: float,
    longitude_deg: float,
    dem_path: str | Path,
) -> float | None:
    """
    Return terrain elevation in metres from a specified LOLA DEM.

    Returns:
        Elevation in metres, or None if the location is outside
        the raster or its terrain pixel is invalid.
    """

    if not -90.0 <= latitude_deg <= 90.0:
        raise ValueError("Latitude must be between -90 and 90 degrees.")

    if not math.isfinite(longitude_deg):
        raise ValueError("Longitude must be finite.")

    longitude_deg = longitude_deg % 360.0

    path = Path(dem_path)

    if not path.is_file():
        raise FileNotFoundError(f"LOLA DEM not found: {path}")

    with rasterio.open(path) as dem:

        # Convert geographic coordinates into the DEM projection.
        xs, ys = transform(
            dem.crs.geodetic_crs,
            dem.crs,
            [longitude_deg],
            [latitude_deg],
        )

        x, y = xs[0], ys[0]

        # Check whether the projected coordinate is inside the DEM.
        if not (
            dem.bounds.left <= x < dem.bounds.right
            and dem.bounds.bottom < y <= dem.bounds.top
        ):
            return None

        # Retrieve the corresponding terrain pixel.
        value = next(
            dem.sample([(x, y)], masked=True)
        )[0]

        if np.ma.is_masked(value):
            return None

        raw_elevation = float(value)

        if not math.isfinite(raw_elevation):
            return None

        # Convert stored values into physical elevation in metres.
        elevation = (
            raw_elevation * dem.scales[0]
            + dem.offsets[0]
        )

        return float(elevation)


def get_elevation(
    latitude_deg: float,
    longitude_deg: float,
) -> tuple[float, str] | None:
    """
    Find terrain elevation using the best available LOLA DEM.

    Returns:
        (elevation_metres, dem_name), or None if no DEM
        contains a valid terrain pixel at the requested location.
    """

    for dem_name, filename in DEM_FILES:

        dem_path = LOLA_DIR / filename

        elevation = get_elevation_from_dem(
            latitude_deg,
            longitude_deg,
            dem_path,
        )

        if elevation is not None:
            return elevation, dem_name

    return None
