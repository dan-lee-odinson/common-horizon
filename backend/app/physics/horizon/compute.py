"""Compute a terrain horizon profile by walking rays over an elevation model.

Needs numpy (see ``backend/requirements-tools.txt``). It is an offline tool: the
backend service itself never imports this module, it only reads the stored
profiles through ``app.physics.horizon.profile``.

Method, for one site:

1. Take the surface height at the site from the elevation model. The observer
   stands ``observer_height_m`` above it.
2. For each azimuth (clockwise from local north) walk outward along the great
   circle. At each sample take the terrain height and work out the elevation
   angle of that terrain point seen from the observer, in 3D on a spherical Moon:
   the observer at radius ``R + site height + observer height``, the terrain point
   at ``R + its height``, the angle measured from the observer's local horizontal
   plane. There is no atmosphere, so no refraction.
3. The skyline in that direction is the largest elevation angle found.

Sampling. The first sample is ``near_skip_pixels`` (1.5) pixels from the site:
THE NEAREST PIXEL AND A HALF OF TERRAIN IS SKIPPED ON PURPOSE, so that the
observer's own cell (whose interpolated surface can rise above a 2 m observer on
a slope) does not block the view. Terrain closer than that is not in the profile.
From there the step is ``min_step_pixels`` (0.5) pixels and grows with distance as
``step_growth * distance`` once that is larger. Close to the site each of those
steps is split further, so that no step is longer than ``near_step_fraction``
(0.005) of the distance, down to ``near_step_floor_m`` (0.5 m): for an observer
2 m up, the elevation of ground 60 to 300 m away changes by about half a degree
in 20 m, and half-pixel steps alone would miss the highest point of the
interpolated surface there. Beyond 4 km (40 m pixels) the split no longer applies.

Stopping. A ray stops when no terrain still ahead could beat the current maximum,
judged with the elevation model's highest value (terrain at that height, at the
current distance or beyond, would still appear lower), or at ``max_range_m``.
A ray that meets samples without elevation data before that rule is met is
flagged ``ran_out_of_data``: its skyline is the highest of the data it did have.
"""

import math
from dataclasses import asdict, dataclass
from typing import Protocol

import numpy as np

from app.physics.horizon.geometry import MOON_RADIUS_M, local_frame

NO_DATA = -1


class SiteOutsideCoverage(ValueError):
    """The elevation model has no data at the site itself, so its height is unknown."""


class Terrain(Protocol):
    """An elevation model the ray walker can sample.

    ``sample`` takes unit vectors from the Moon's centre (MOON_ME frame, shape
    ``(..., 3)``) and returns the surface height in metres above the 1737.4 km
    sphere and, for each point, the index of the model that supplied it, or
    ``NO_DATA`` (-1) where there is none. Heights at ``NO_DATA`` points are ignored.
    """

    pixel_size_m: float  # of the finest model: sets the near-field skip and the first steps
    max_height_m: float  # highest value in the model(s): the bound of the stopping rule

    def sample(self, unit_vectors: np.ndarray) -> tuple[np.ndarray, np.ndarray]: ...


@dataclass(frozen=True)
class SamplingSettings:
    azimuth_step_deg: float = 0.5
    near_skip_pixels: float = 1.5  # first sample; nearer terrain is skipped (see the module docstring)
    min_step_pixels: float = 0.5  # step near the site, in pixels of the finest model
    step_growth: float = 0.00025  # step = max(min step, step_growth * distance): 25 m per 100 km
    near_step_fraction: float = 0.005  # close to the site no step is longer than this share of the distance
    near_step_floor_m: float = 0.5  # ... but steps are never split finer than this
    max_range_m: float = 400_000.0
    chunk_steps: int = 256  # distance samples handled per numpy pass; has no effect on the result

    def as_dict(self) -> dict[str, float | int]:
        return asdict(self)


@dataclass(frozen=True)
class ProfileResult:
    """Output of ``compute_profile``: one entry per azimuth unless noted."""

    site_height_m: float
    site_source: int  # index of the model that gave the site height
    azimuth_deg: np.ndarray
    horizon_elevation_deg: np.ndarray
    max_distance_m: np.ndarray  # great-circle distance of the skyline point; NaN where the ray had no data at all
    max_source: np.ndarray  # index of the model that gave the skyline point, NO_DATA where none
    stop_distance_m: np.ndarray  # distance at which the ray stopped (max_range_m when it never met the rule)
    ran_out_of_data: np.ndarray  # True: samples without data came before the stopping rule was met
    reached_max_range: np.ndarray  # True: walked to max_range_m without meeting the stopping rule
    sample_distances_m: np.ndarray  # the distance sequence every ray uses (not per azimuth)


def sample_distances(pixel_size_m: float, settings: SamplingSettings) -> np.ndarray:
    """Great-circle distances of the samples along a ray, metres, increasing.

    The main sequence starts at the near-field skip and advances by half a pixel, or by
    ``step_growth * distance`` once that is larger. Each of its steps is then split into equal
    parts where needed to keep the near-field rule (see the module docstring); the points of the
    main sequence are always kept.
    """
    if pixel_size_m <= 0 or settings.min_step_pixels <= 0 or settings.near_skip_pixels <= 0:
        raise ValueError("pixel size, minimum step and near-field skip must be positive")
    if settings.step_growth < 0:
        raise ValueError("step_growth must not be negative")
    if settings.near_step_fraction <= 0 or settings.near_step_floor_m <= 0:
        raise ValueError("near_step_fraction and near_step_floor_m must be positive")
    minimum_step = settings.min_step_pixels * pixel_size_m
    distances = []
    distance = settings.near_skip_pixels * pixel_size_m
    while distance <= settings.max_range_m:
        step = max(minimum_step, settings.step_growth * distance)
        longest_allowed = max(settings.near_step_floor_m, settings.near_step_fraction * distance)
        parts = max(1, math.ceil(step / longest_allowed - 1e-9))
        for part in range(parts):
            sample = distance + step * part / parts
            if sample <= settings.max_range_m:
                distances.append(sample)
        distance += step
    if not distances:
        raise ValueError("max_range_m is closer than the first sample")
    return np.asarray(distances, dtype=np.float64)


def bound_tangents(observer_radius_m: float, highest_radius_m: float, central_angles_rad: np.ndarray) -> np.ndarray:
    """Array form of ``geometry.bound_tangent_beyond``: the best any terrain at or beyond each angle can do."""
    return _bound_tangents(observer_radius_m, highest_radius_m, np.cos(central_angles_rad), np.sin(central_angles_rad))


def _bound_tangents(
    observer_radius_m: float, highest_radius_m: float, cosines: np.ndarray, sines: np.ndarray
) -> np.ndarray:
    falling = (highest_radius_m * cosines - observer_radius_m) / (highest_radius_m * sines)
    if observer_radius_m <= highest_radius_m:
        return falling
    tangent_value = -np.sqrt(observer_radius_m**2 - highest_radius_m**2) / highest_radius_m
    return np.where(observer_radius_m * cosines > highest_radius_m, tangent_value, falling)


def compute_profile(
    terrain: Terrain,
    latitude_deg: float,
    longitude_deg: float,
    observer_height_m: float = 2.0,
    settings: SamplingSettings | None = None,
    reference_radius_m: float = MOON_RADIUS_M,
) -> ProfileResult:
    """Terrain skyline around a site. See the module docstring for the method."""
    settings = settings or SamplingSettings()
    if not -90.0 <= latitude_deg <= 90.0:
        raise ValueError("latitude_deg must be in [-90, 90]")
    if observer_height_m < 0:
        raise ValueError("observer_height_m must not be negative")
    azimuth_count = round(360.0 / settings.azimuth_step_deg)
    if azimuth_count < 1 or abs(azimuth_count * settings.azimuth_step_deg - 360.0) > 1e-9:
        raise ValueError("azimuth_step_deg must divide 360 evenly")

    up, east, north = (np.asarray(vector, dtype=np.float64) for vector in local_frame(latitude_deg, longitude_deg))

    site_height, site_source = terrain.sample(up[np.newaxis, :])
    if site_source[0] == NO_DATA:
        raise SiteOutsideCoverage(
            f"no elevation data at latitude {latitude_deg}, longitude {longitude_deg}; the site height is unknown"
        )
    site_height_m = float(site_height[0])
    observer_radius = reference_radius_m + site_height_m + observer_height_m
    highest_radius = reference_radius_m + terrain.max_height_m

    azimuths = np.arange(azimuth_count, dtype=np.float64) * (360.0 / azimuth_count)
    azimuths_rad = np.radians(azimuths)
    # Horizontal unit vector of each ray: north at azimuth 0, east at azimuth 90.
    headings = np.cos(azimuths_rad)[:, np.newaxis] * north + np.sin(azimuths_rad)[:, np.newaxis] * east

    distances = sample_distances(terrain.pixel_size_m, settings)
    central_angles = distances / reference_radius_m
    # Cosines and sines once for the whole sequence, so the bound and the samples use the very same values.
    all_cosines, all_sines = np.cos(central_angles), np.sin(central_angles)
    bounds = _bound_tangents(observer_radius, highest_radius, all_cosines, all_sines)

    best_tangent = np.full(azimuth_count, -np.inf)
    best_distance = np.full(azimuth_count, np.nan)
    best_source = np.full(azimuth_count, NO_DATA, dtype=np.int8)
    stop_distance = np.full(azimuth_count, float(settings.max_range_m))
    ran_out = np.zeros(azimuth_count, dtype=bool)
    active = np.ones(azimuth_count, dtype=bool)

    for start in range(0, len(distances), settings.chunk_steps):
        rays = np.flatnonzero(active)
        if rays.size == 0:
            break
        cosines = all_cosines[start : start + settings.chunk_steps]
        sines = all_sines[start : start + settings.chunk_steps]
        steps = len(cosines)
        # Point at central angle psi along a ray: up * cos(psi) + heading * sin(psi). Shape (steps, rays, 3).
        points = cosines[:, np.newaxis, np.newaxis] * up + sines[:, np.newaxis, np.newaxis] * headings[rays]
        heights, sources = terrain.sample(points)
        has_data = sources != NO_DATA
        terrain_radius = reference_radius_m + np.where(has_data, heights, 0.0)
        tangents = (terrain_radius * cosines[:, np.newaxis] - observer_radius) / (terrain_radius * sines[:, np.newaxis])
        tangents = np.where(has_data, tangents, -np.inf)

        # Running maximum along each ray, carried in from the earlier chunks.
        running = np.maximum.accumulate(np.vstack([best_tangent[rays][np.newaxis, :], tangents]), axis=0)[1:]
        # The stopping rule holds at a sample once nothing at that distance or beyond can beat the running
        # maximum. The bound never rises with distance and the maximum never falls, so once met it stays met.
        rule_met = bounds[start : start + steps, np.newaxis] < running
        stops = rule_met.any(axis=0)
        stop_step = np.where(stops, rule_met.argmax(axis=0), steps)

        # Missing data counts only where terrain could still have mattered: before the rule was met.
        before_stop = np.arange(steps)[:, np.newaxis] < stop_step[np.newaxis, :]
        ran_out[rays] |= (~has_data & before_stop).any(axis=0)

        # Samples after the stop cannot beat the maximum (that is what the rule says), so the whole chunk
        # can be searched for the new maximum without changing the answer.
        chunk_step = tangents.argmax(axis=0)
        columns = np.arange(rays.size)
        chunk_best = tangents[chunk_step, columns]
        improved = chunk_best > best_tangent[rays]
        improved_rays = rays[improved]
        best_tangent[improved_rays] = chunk_best[improved]
        best_distance[improved_rays] = distances[start + chunk_step[improved]]
        best_source[improved_rays] = sources[chunk_step[improved], columns[improved]]

        stopped_rays = rays[stops]
        stop_distance[stopped_rays] = distances[start + stop_step[stops]]
        active[stopped_rays] = False

    no_data_at_all = best_source == NO_DATA
    # A ray with no data at all has no terrain to report: it gets the smooth-sphere dip, flagged.
    site_radius = reference_radius_m + site_height_m
    dip_tangent = -np.sqrt(observer_radius**2 - site_radius**2) / site_radius
    elevation = np.degrees(np.arctan(np.where(no_data_at_all, dip_tangent, best_tangent)))

    return ProfileResult(
        site_height_m=site_height_m,
        site_source=int(site_source[0]),
        azimuth_deg=azimuths,
        horizon_elevation_deg=elevation,
        max_distance_m=best_distance,
        max_source=best_source,
        stop_distance_m=stop_distance,
        ran_out_of_data=ran_out,
        reached_max_range=active.copy(),
        sample_distances_m=distances,
    )


class FunctionTerrain:
    """Terrain given by a formula instead of a file: smooth spheres and synthetic shapes for the tests.

    ``height_function`` maps unit vectors ``(..., 3)`` to heights in metres above the reference
    sphere; return NaN where the terrain has no data.
    """

    def __init__(self, height_function, pixel_size_m: float, max_height_m: float) -> None:
        self._height_function = height_function
        self.pixel_size_m = float(pixel_size_m)
        self.max_height_m = float(max_height_m)

    def sample(self, unit_vectors: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        heights = np.asarray(self._height_function(unit_vectors), dtype=np.float64)
        heights = np.broadcast_to(heights, unit_vectors.shape[:-1]).copy()
        sources = np.where(np.isfinite(heights), 0, NO_DATA).astype(np.int8)
        return heights, sources
