
"""Lunar horizon obstruction calculations using LOLA terrain data."""

from contextlib import ExitStack
from dataclasses import dataclass
from pathlib import Path
import math

import numpy as np
import rasterio
from rasterio.warp import transform

from .terrain import DEM_FILES, LOLA_DIR

MOON_RADIUS_M = 1_737_400.0


@dataclass
class HorizonConfig:
    """Configuration for lunar horizon sampling."""

    azimuth_step_deg: float = 1.0
    sample_step_m: float = 80.0
    coarse_start_m: float = 30_000.0
    coarse_sample_step_m: float = 1_000.0
    max_distance_m: float = 250_000.0
    observer_height_m: float = 2.0
    moon_radius_m: float = MOON_RADIUS_M

    def __post_init__(self):
        if not 0 < self.azimuth_step_deg <= 360:
            raise ValueError("Azimuth step must be in (0, 360].")

        if self.sample_step_m <= 0:
            raise ValueError("Fine sampling step must be positive.")

        if self.coarse_start_m <= 0:
            raise ValueError("Coarse sampling start must be positive.")

        if self.coarse_sample_step_m <= 0:
            raise ValueError("Coarse sampling step must be positive.")

        if self.max_distance_m <= self.coarse_start_m:
            raise ValueError(
                "Maximum distance must exceed coarse sampling start."
            )

        if self.observer_height_m < 0:
            raise ValueError("Observer height cannot be negative.")

        if self.moon_radius_m <= 0:
            raise ValueError("Moon radius must be positive.")


def destination_point(
    latitude_deg: float,
    longitude_deg: float,
    azimuth_deg: float,
    distance_m: float,
    moon_radius_m: float = MOON_RADIUS_M,
) -> tuple[float, float]:
    """Calculate a destination along a spherical lunar surface."""

    if not -90 <= latitude_deg <= 90:
        raise ValueError("Latitude must be between -90 and 90.")
    if distance_m < 0:
        raise ValueError("Distance cannot be negative.")
    if moon_radius_m <= 0:
        raise ValueError("Moon radius must be positive.")

    lat1 = math.radians(latitude_deg)
    lon1 = math.radians(longitude_deg)
    azimuth = math.radians(azimuth_deg)
    angular_distance = distance_m / moon_radius_m

    lat2 = math.asin(
        math.sin(lat1) * math.cos(angular_distance)
        + math.cos(lat1) * math.sin(angular_distance)
        * math.cos(azimuth)
    )

    lon2 = lon1 + math.atan2(
        math.sin(azimuth) * math.sin(angular_distance)
        * math.cos(lat1),
        math.cos(angular_distance)
        - math.sin(lat1) * math.sin(lat2),
    )

    return math.degrees(lat2), math.degrees(lon2) % 360.0


def calculate_elevation_angle(
    surface_distance_m: float,
    terrain_elevation_m: float,
    observer_height_m: float = 2.0,
    moon_radius_m: float = MOON_RADIUS_M,
    observer_terrain_elevation_m: float = 0.0,
) -> float:
    """Calculate apparent terrain elevation relative to local horizontal."""

    if surface_distance_m <= 0:
        raise ValueError("Surface distance must be positive.")
    if moon_radius_m <= 0:
        raise ValueError("Moon radius must be positive.")
    if observer_height_m < 0:
        raise ValueError("Observer height cannot be negative.")

    angular_distance = surface_distance_m / moon_radius_m

    observer_radius = (
        moon_radius_m
        + observer_terrain_elevation_m
        + observer_height_m
    )
    terrain_radius = moon_radius_m + terrain_elevation_m

    vertical = (
        terrain_radius * math.cos(angular_distance)
        - observer_radius
    )
    horizontal = terrain_radius * math.sin(angular_distance)

    return math.degrees(math.atan2(vertical, horizontal))


def _get_elevation_from_open_dems(
    latitude_deg: float,
    longitude_deg: float,
    datasets: list,
) -> tuple[float, str] | None:
    """Look up elevation using already-open DEM datasets."""

    for dem_name, dem in datasets:
        xs, ys = transform(
            dem.crs.geodetic_crs,
            dem.crs,
            [longitude_deg],
            [latitude_deg],
        )

        x, y = xs[0], ys[0]

        if not (
            dem.bounds.left <= x < dem.bounds.right
            and dem.bounds.bottom < y <= dem.bounds.top
        ):
            continue

        value = next(dem.sample([(x, y)], masked=True))[0]

        if np.ma.is_masked(value):
            continue

        raw_elevation = float(value)

        if not math.isfinite(raw_elevation):
            continue

        elevation = (
            raw_elevation * dem.scales[0]
            + dem.offsets[0]
        )

        return float(elevation), dem_name

    return None

def _get_elevations_from_open_dems(
    latitudes: np.ndarray,
    longitudes: np.ndarray,
    datasets: list,
) -> list[tuple[float, str] | None]:
    """Batch terrain lookup for multiple coordinates using open DEMs."""

    results = [None] * len(latitudes)

    for dem_name, dem in datasets:
        # Transform all points into this DEM's coordinate system at once.
        xs, ys = transform(
            dem.crs.geodetic_crs,
            dem.crs,
            longitudes.tolist(),
            latitudes.tolist(),
        )

        # Only sample points not already covered by a higher-priority DEM.
        indices = [
            i for i, (x, y) in enumerate(zip(xs, ys))
            if results[i] is None
            and dem.bounds.left <= x < dem.bounds.right
            and dem.bounds.bottom < y <= dem.bounds.top
        ]

        if not indices:
            continue

        coordinates = [(xs[i], ys[i]) for i in indices]

        # Submit all eligible points in one sampling operation.
        samples = dem.sample(coordinates, masked=True)

        for i, value in zip(indices, samples):
            raw_elevation = value[0]

            if np.ma.is_masked(raw_elevation):
                continue

            raw_elevation = float(raw_elevation)

            if not math.isfinite(raw_elevation):
                continue

            elevation = (
                raw_elevation * dem.scales[0]
                + dem.offsets[0]
            )

            results[i] = (float(elevation), dem_name)

    return results

def _generate_sampling_distances(
    config: HorizonConfig,
) -> np.ndarray:
    """Generate fine near-field and coarse far-field sample distances."""

    fine_distances = np.arange(
        config.sample_step_m,
        config.coarse_start_m,
        config.sample_step_m,
    )

    coarse_distances = np.arange(
        config.coarse_start_m,
        config.max_distance_m,
        config.coarse_sample_step_m,
    )

    distances = np.concatenate([
        fine_distances,
        coarse_distances,
        np.array([config.max_distance_m]),
    ])

    return np.unique(distances)

def compute_horizon_profile(
    latitude_deg: float,
    longitude_deg: float,
    config: HorizonConfig | None = None,
) -> list[dict]:
    """
    Compute terrain obstruction angles around a lunar observer.

    Returns one result per azimuth, containing:
        azimuth_deg
        elevation_angle_deg
        distance_m
        terrain_elevation_m
        dem

    Angles are measured above the observer's local horizontal.
    """

    if not -90 <= latitude_deg <= 90:
        raise ValueError("Latitude must be between -90 and 90.")

    if not math.isfinite(longitude_deg):
        raise ValueError("Longitude must be finite.")

    longitude_deg %= 360.0
    config = config or HorizonConfig()

    with ExitStack() as stack:
        datasets = []

        # Open each available DEM once for the entire calculation.
        for dem_name, filename in DEM_FILES:
            dem_path = LOLA_DIR / filename

            if dem_path.is_file():
                dem = stack.enter_context(rasterio.open(dem_path))
                datasets.append((dem_name, dem))

        if not datasets:
            raise FileNotFoundError(
                f"No LOLA DEM files found in {LOLA_DIR}"
            )

        observer = _get_elevation_from_open_dems(
            latitude_deg, longitude_deg, datasets
        )

        if observer is None:
            raise ValueError(
                "No valid LOLA elevation found at observer location."
            )

        observer_elevation_m, observer_dem = observer

        profile = []
        azimuth_count = math.ceil(
            360.0 / config.azimuth_step_deg
        )

        # Generate the sampling distances once.
        distances = _generate_sampling_distances(config)

        for index in range(azimuth_count):
            azimuth = (
                index * config.azimuth_step_deg
            ) % 360.0

            maximum_angle = None
            maximum_distance = None
            maximum_terrain = None
            maximum_dem = None

            # Generate all coordinates along this azimuth.
            sample_points = [
                destination_point(
                    latitude_deg,
                    longitude_deg,
                    azimuth,
                    float(distance),
                    config.moon_radius_m,
                )
                for distance in distances
            ]

            sample_latitudes = np.array(
                [point[0] for point in sample_points]
            )

            sample_longitudes = np.array(
                [point[1] for point in sample_points]
            )

            # Batch-transform and sample all terrain points.
            terrain_results = _get_elevations_from_open_dems(
                sample_latitudes,
                sample_longitudes,
                datasets,
            )

            for distance, terrain in zip(
                distances, terrain_results
            ):
                distance = float(distance)

                if terrain is None:
                    continue

                terrain_elevation_m, dem_name = terrain

                angle = calculate_elevation_angle(
                    surface_distance_m=distance,
                    terrain_elevation_m=terrain_elevation_m,
                    observer_height_m=config.observer_height_m,
                    moon_radius_m=config.moon_radius_m,
                    observer_terrain_elevation_m=observer_elevation_m,
                )

                if maximum_angle is None or angle > maximum_angle:
                    maximum_angle = angle
                    maximum_distance = distance
                    maximum_terrain = terrain_elevation_m
                    maximum_dem = dem_name

            # Append exactly one result per azimuth.
            profile.append({
                "azimuth_deg": float(azimuth),
                "elevation_angle_deg": maximum_angle,
                "distance_m": maximum_distance,
                "terrain_elevation_m": maximum_terrain,
                "dem": maximum_dem,
            })

        return profile