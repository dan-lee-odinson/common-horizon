"""Adapter: the Common Horizon physics engine behind the backend's ``PhysicsEngine`` interface.

What is computed, and from what:

* Sun and Earth positions come from the physics engine's SPICE functions
  (``app.physics.engine.positions``): Moon-centred vectors in kilometres in the
  MOON_ME frame, geometric (aberration correction ``NONE``), from the four NAIF
  kernels listed in ``app.physics.engine.kernel_loader.SPICE_KERNELS``.
* Directions, azimuth and elevation come from ``app.physics.engine.frames``, with the
  observer at radius 1737.4 km + site height + observer height (the construction
  ``scripts/validate_horizon.py`` uses to check the stored profiles). Planetocentric
  latitude, east-positive longitude, azimuth clockwise from local north.
  ``ephemeris.compute_sun_earth_angles`` is not called: it returns angles only (no
  position vectors, which ``position_km`` and the discs' angular radii need) and
  places the observer on the 1737.4 km sphere.
* Terrain: the stored horizon profile (``backend/data/horizon``) computed for this
  site and observer geometry, when there is one. Otherwise a smooth sphere through
  the site, with a warning that local terrain is not included.
* Disc visibility and obstruction state: ``app.physics.horizon.body_visibility``,
  with each disc's angular radius taken from its distance at that sample.
* Metrics and communication windows: ``app.physics.metrics`` (sample-and-hold).

Not available at run time and therefore reported as unknown: the site slope
(``slope_deg = null``) and, without a stored profile, the sky visibility fraction
and the terrain skyline. A site with neither a stored profile nor a supplied
altitude has no known elevation. The contract requires a number, so it is reported
as a 0 m placeholder labelled ``elevation_source = "synthetic_default"``, with a warning.

Missing kernels, a missing or empty profile directory and an unreadable profile
raise ``PhysicsEngineUnavailable`` (HTTP 503). Nothing falls back to synthetic data.
Error messages name files, never absolute server paths; the paths go to the log.

SPICE keeps global state and is not thread-safe, so every SPICE call in this
process runs under one lock.
"""

import logging
import math
import numbers
import threading
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Literal

from app.models import limits
from app.models.results import BodyTimeseries, ObstructionState, SiteInfo, TerrainSkyline, Timeseries
from app.physics.horizon.geometry import MOON_RADIUS_M, unit_from_lat_lon
from app.physics.horizon.profile import DEFAULT_PROFILE_DIR, HorizonProfile, load_profile
from app.physics.horizon.visibility import body_visibility
from app.physics.interface import (
    EngineContractError,
    EngineInfo,
    PhysicsEngineUnavailable,
    SimulationRequest,
    SimulationResult,
)
from app.physics.metrics import summarise
from app.timegrid import build_time_grid

logger = logging.getLogger(__name__)

ENGINE_NAME = "common-horizon-physics"
ENGINE_VERSION = "0.1.0"

# Where the physics engine's README asks for the kernels. Deployments set CH_SPICE_KERNEL_DIR instead.
DEFAULT_SPICE_KERNEL_DIR = Path(__file__).resolve().parent / "data" / "datasets" / "spice"

# Disc radii, the same values as scripts/validate_horizon.py: the IAU nominal solar radius
# (2015 Resolution B3) and the Earth's equatorial radius.
SUN_RADIUS_KM = 695_700.0
EARTH_RADIUS_KM = 6_378.1366

# A stored profile is the skyline seen from one point. It is used only when the request is for
# that point and that observer geometry. 50 m is under the 60 m of near-field terrain that even
# the finest stored profiles skip; at Nobile half the skyline is set by terrain closer than 200 m.
PROFILE_MATCH_DISTANCE_M = 50.0
SITE_HEIGHT_MATCH_M = 0.5
OBSERVER_HEIGHT_MATCH_M = 0.01

PROFILE_FRAME = "MOON_ME"

# Launch-delay runs reuse the per-timestamp disc fractions of earlier runs for the same site.
# About 0.3 kB per entry. The cap is never below the per-evaluation work budget, so an accepted
# request never has its shared samples evicted mid-sweep (20 000 entries: about 6 MB).
_FRACTION_CACHE_MAX = max(60_000, limits.MAX_TOTAL_SAMPLES)

# Transport rounding of the time series (metrics are computed before rounding): 1 m for
# positions, 1e-9 for unit vectors, 1e-6 degree for angles. Visibility fractions are not rounded.
_POSITION_DECIMALS = 3
_DIRECTION_DECIMALS = 9
_ANGLE_DECIMALS = 6

_SPICE_LOCK = threading.RLock()

BodyPositions = Callable[[datetime], tuple[Sequence[float], Sequence[float]]]
"""Maps a UTC instant to the (Sun, Earth) positions in km, Moon-centred, MOON_ME frame."""


@dataclass(frozen=True)
class Terrain:
    """The horizon used for one request, and how it was chosen."""

    profile: HorizonProfile
    stored: bool
    site_height_m: float
    elevation_source: Literal["input", "terrain_model", "synthetic_default"]
    sky_visibility_fraction: float | None
    warnings: tuple[str, ...]
    sources: tuple[str, ...]

    @property
    def skyline(self) -> TerrainSkyline | None:
        return self.profile.to_terrain_skyline() if self.stored else None


@dataclass(frozen=True, slots=True)
class BodySample:
    position_km: tuple[float, float, float]
    direction_unit: tuple[float, float, float]
    azimuth_deg: float
    elevation_deg: float
    fraction: float
    state: ObstructionState


def central_distance_m(lat1_deg: float, lon1_deg: float, lat2_deg: float, lon2_deg: float) -> float:
    """Great-circle distance on the 1737.4 km sphere, metres. Longitudes may be in any range."""
    a = unit_from_lat_lon(lat1_deg, lon1_deg)
    b = unit_from_lat_lon(lat2_deg, lon2_deg)
    cross = (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])
    sine = math.sqrt(sum(c * c for c in cross))
    cosine = sum(x * y for x, y in zip(a, b, strict=True))
    return math.atan2(sine, cosine) * MOON_RADIUS_M


def sky_visibility_fraction(profile: HorizonProfile) -> float:
    """Share of the upper hemisphere's solid angle above the skyline, 0..1.

    The sky above elevation ``h`` in a slice of azimuth ``d(az)`` has solid angle
    ``(1 - sin h) d(az)``; the hemisphere has ``2 pi``. Sky below the horizontal (a skyline
    that dips under 0 degrees) is not counted, so a clear horizon gives exactly 1. The
    azimuth integral is a periodic trapezoid rule over the stored samples.
    """
    azimuths, elevations = profile.azimuth_deg, profile.horizon_elevation_deg
    count = len(azimuths)
    if count == 1:
        return 1.0 - math.sin(math.radians(max(elevations[0], 0.0)))
    total = 0.0
    for index in range(count):
        gap_before = (azimuths[index] - azimuths[index - 1]) % 360.0
        gap_after = (azimuths[(index + 1) % count] - azimuths[index]) % 360.0
        weight = (gap_before + gap_after) / 2.0
        total += weight * (1.0 - math.sin(math.radians(max(elevations[index], 0.0))))
    return min(max(total / 360.0, 0.0), 1.0)


class ProfileIndex:
    """The stored horizon profiles of one directory, found by site position."""

    def __init__(self, profiles: Sequence[HorizonProfile]) -> None:
        self.profiles = tuple(profiles)

    @classmethod
    def load(cls, directory: Path) -> "ProfileIndex":
        if not directory.is_dir():
            logger.error("Horizon profile directory not found: %s", directory)
            raise PhysicsEngineUnavailable(
                "The stored terrain horizon profiles are missing (set CH_HORIZON_PROFILE_DIR to the folder "
                "holding backend/data/horizon)."
            )
        profiles = []
        for path in sorted(directory.glob("*.json")):
            try:
                profile = load_profile(path)
            except (OSError, ValueError):  # ProfileError and JSON errors are ValueErrors
                # The loader's message can contain the absolute path: it goes to the log only.
                logger.exception("Unreadable horizon profile %s", path)
                raise PhysicsEngineUnavailable(
                    f"Stored horizon profile {path.name} is unreadable or invalid (details in the server log)."
                ) from None
            problem = _convention_problem(profile, path)
            if problem:
                raise PhysicsEngineUnavailable(f"Stored horizon profile {path.name} {problem}.")
            profiles.append(profile)
        if not profiles:
            logger.error("No horizon profiles in %s", directory)
            raise PhysicsEngineUnavailable("The stored terrain horizon profile directory holds no profiles.")
        return cls(profiles)

    def nearest(self, latitude_deg: float, longitude_deg: float) -> tuple[HorizonProfile, float] | None:
        best: tuple[HorizonProfile, float] | None = None
        for profile in self.profiles:
            distance = central_distance_m(latitude_deg, longitude_deg, profile.latitude_deg, profile.longitude_deg)
            if best is None or distance < best[1]:
                best = (profile, distance)
        return best


def _convention_problem(profile: HorizonProfile, path: Path) -> str | None:
    if profile.site_id != path.stem:
        return f"has site_id {profile.site_id!r}, which does not match its file name"
    frame = profile.metadata.get("frame")
    if frame != PROFILE_FRAME:
        return f"is in frame {frame!r}, not {PROFILE_FRAME}"
    radius = profile.metadata.get("reference_radius_m")
    if not isinstance(radius, int | float) or abs(radius - MOON_RADIUS_M) > 1e-6:
        return f"uses reference radius {radius!r} m, not {MOON_RADIUS_M:g} m"
    return None


def _profile_notes(profile: HorizonProfile) -> tuple[list[str], list[str]]:
    """``(warnings, sources)`` describing a stored profile's limits and origin, from its own metadata."""
    meta: dict[str, Any] = profile.metadata
    summary = meta.get("summary") if isinstance(meta.get("summary"), dict) else {}
    sampling = meta.get("sampling") if isinstance(meta.get("sampling"), dict) else {}
    models = [m.get("file") for m in meta.get("elevation_models", []) if isinstance(m, dict) and m.get("file")]

    warnings = []
    near_field = sampling.get("near_field_skipped_m")
    limit = (
        f"Terrain skyline from the stored horizon profile '{profile.site_id}'. Terrain within "
        f"{near_field:g} m of the site and features smaller than the elevation-model pixels are not in it."
        if isinstance(near_field, int | float)
        else f"Terrain skyline from the stored horizon profile '{profile.site_id}'."
    )
    warnings.append(limit)
    if meta.get("coarse"):
        warnings.append(f"Coarse terrain profile: {meta.get('quality', 'computed from a coarse elevation model')}.")
    for key, text in (
        ("rays_without_any_data", "azimuths had no elevation data and use the smooth-sphere dip"),
        ("rays_ran_out_of_data", "azimuths left the elevation data before the skyline was certain"),
        ("rays_with_skyline_at_first_sample", "azimuths have their skyline at the near-field cut-off"),
    ):
        count = summary.get(key)
        if isinstance(count, int) and count > 0:
            warnings.append(f"Stored profile '{profile.site_id}': {count} of {len(profile.azimuth_deg)} {text}.")

    step = 360.0 / len(profile.azimuth_deg)
    source = (
        f"Terrain: stored horizon profile '{profile.site_id}' ({len(profile.azimuth_deg)} azimuths, "
        f"{step:g} degree step, observer {profile.observer_height_m:g} m above a site at "
        f"{profile.site_height_m:.1f} m), computed {meta.get('computed_utc', 'at an unrecorded time')} "
        f"from {', '.join(models) if models else 'unrecorded elevation models'}."
    )
    sources = [source]
    if meta.get("citation"):
        sources.append(f"Terrain data citation: {meta['citation']}")
    return warnings, sources


def select_terrain(index: ProfileIndex, request: SimulationRequest) -> Terrain:
    """The stored profile computed for this site and observer, else a smooth sphere (with a warning)."""
    nearest = index.nearest(request.latitude_deg, request.longitude_deg)
    reason: str
    same_site: HorizonProfile | None = None  # the stored site at these coordinates, even if its skyline cannot be used
    if nearest is None or nearest[1] > PROFILE_MATCH_DISTANCE_M:
        reason = f"no stored terrain horizon profile lies within {PROFILE_MATCH_DISTANCE_M:g} m of this site"
    else:
        profile, _ = nearest
        same_site = profile
        if abs(profile.observer_height_m - request.observer_height_m) > OBSERVER_HEIGHT_MATCH_M:
            reason = (
                f"the stored profile '{profile.site_id}' is for an observer {profile.observer_height_m:g} m above "
                f"the surface, not {request.observer_height_m:g} m"
            )
        elif request.altitude_m is not None and abs(request.altitude_m - profile.site_height_m) > SITE_HEIGHT_MATCH_M:
            reason = (
                f"the supplied altitude_m ({request.altitude_m:g} m) differs from the site height of the stored "
                f"profile '{profile.site_id}' ({profile.site_height_m:.1f} m)"
            )
        else:
            warnings, sources = _profile_notes(profile)
            supplied = request.altitude_m is not None
            return Terrain(
                profile=profile,
                stored=True,
                site_height_m=request.altitude_m if supplied else profile.site_height_m,
                elevation_source="input" if supplied else "terrain_model",
                sky_visibility_fraction=sky_visibility_fraction(profile),
                warnings=tuple(warnings),
                sources=tuple(sources),
            )

    warnings = [
        (
            f"Local terrain is NOT included: {reason}. Visibility uses a smooth sphere through the site "
            "(geometric horizon dip only), so sunlight and Earth visibility can differ substantially from "
            "the real site, especially near the poles. No terrain skyline or sky visibility fraction is given."
        )
    ]
    elevation_source: Literal["input", "terrain_model", "synthetic_default"]
    if request.altitude_m is not None:
        site_height = request.altitude_m
        elevation_source = "input"
    elif same_site is not None:
        # Same coordinates as a stored site: its elevation (from the elevation model) still applies,
        # although its skyline does not fit this observer.
        site_height = same_site.site_height_m
        elevation_source = "terrain_model"
        warnings.append(
            f"Site elevation {site_height:.1f} m is taken from the stored profile '{same_site.site_id}' of this "
            "site; only its skyline could not be used."
        )
    else:
        site_height = 0.0
        elevation_source = "synthetic_default"
        warnings.append(
            "Site elevation is UNKNOWN (no stored profile at this site and no altitude_m supplied). "
            "elevation_m = 0 is a placeholder on the 1737.4 km reference sphere, not a measured value; "
            "display it as unknown, or supply altitude_m."
        )
    profile = HorizonProfile.smooth_sphere(
        latitude_deg=request.latitude_deg,
        longitude_deg=request.longitude_deg,
        site_height_m=site_height,
        observer_height_m=request.observer_height_m,
    )
    return Terrain(
        profile=profile,
        stored=False,
        site_height_m=site_height,
        elevation_source=elevation_source,
        sky_visibility_fraction=None,
        warnings=tuple(warnings),
        sources=("Terrain: none (smooth sphere through the site, geometric horizon dip only).",),
    )


def _position_vector(position_km: Any) -> Any:
    """Three finite real numbers as a numpy vector, else ``EngineContractError`` (HTTP 502).

    Components must be real numbers already: strings, booleans, None, nested arrays and other
    objects are refused rather than converted.
    """
    import numpy as np

    if isinstance(position_km, str | bytes):
        components: list[Any] = []
    else:
        try:
            components = list(position_km)
        except TypeError:
            components = []
    if len(components) != 3 or not all(
        isinstance(c, numbers.Real) and not isinstance(c, bool | np.bool_) for c in components
    ):
        raise EngineContractError("The ephemeris returned a position that is not three finite numbers.")
    position = np.array([float(c) for c in components], dtype=float)
    if not np.all(np.isfinite(position)):
        raise EngineContractError("The ephemeris returned a position that is not three finite numbers.")
    return position


def _observe(
    position_km: Sequence[float],
    site_km: Any,
    latitude_deg: float,
    longitude_deg: float,
    body_radius_km: float,
    profile: HorizonProfile,
) -> BodySample:
    import numpy as np

    from app.physics.engine import frames

    position = _position_vector(position_km)
    vector = position - site_km
    distance = float(np.linalg.norm(vector))
    if not distance > body_radius_km:
        raise EngineContractError("The ephemeris placed the observer inside the Sun or the Earth.")
    azimuth, elevation = frames.get_azimuth_elevation(vector, latitude_deg, longitude_deg)
    if azimuth >= 360.0:  # (-tiny) % 360 rounds to 360.0
        azimuth = 0.0
    angular_radius_deg = math.degrees(math.asin(body_radius_km / distance))
    visibility = body_visibility(profile, azimuth, elevation, angular_radius_deg)
    direction = vector / distance
    return BodySample(
        position_km=(float(position[0]), float(position[1]), float(position[2])),
        direction_unit=(float(direction[0]), float(direction[1]), float(direction[2])),
        azimuth_deg=azimuth,
        elevation_deg=elevation,
        fraction=visibility.fraction,
        state=visibility.state,
    )


def _body_timeseries(samples: Sequence[BodySample]) -> BodyTimeseries:
    def azimuth(value: float) -> float:
        rounded = round(value, _ANGLE_DECIMALS) % 360.0
        return 0.0 if rounded >= 360.0 else rounded

    return BodyTimeseries(
        position_km=[[round(c, _POSITION_DECIMALS) for c in s.position_km] for s in samples],
        direction_unit=[[round(c, _DIRECTION_DECIMALS) for c in s.direction_unit] for s in samples],
        azimuth_deg=[azimuth(s.azimuth_deg) for s in samples],
        elevation_deg=[round(s.elevation_deg, _ANGLE_DECIMALS) for s in samples],
        visibility_fraction=[s.fraction for s in samples],
        obstruction_state=[s.state for s in samples],
    )


class PhysicsEngineAdapter:
    """The real engine: SPICE ephemerides plus stored terrain horizon profiles.

    ``spice_kernel_dir`` and ``horizon_profile_dir`` come from configuration only
    (``CH_SPICE_KERNEL_DIR``, ``CH_HORIZON_PROFILE_DIR``), never from a request.
    ``body_positions`` replaces SPICE in tests; results then say so in ``sources``.
    """

    def __init__(
        self,
        spice_kernel_dir: str | Path | None = None,
        horizon_profile_dir: str | Path | None = None,
        *,
        body_positions: BodyPositions | None = None,
    ) -> None:
        self._kernel_dir = Path(spice_kernel_dir) if spice_kernel_dir else DEFAULT_SPICE_KERNEL_DIR
        self._profile_dir = Path(horizon_profile_dir) if horizon_profile_dir else DEFAULT_PROFILE_DIR
        self._injected_positions = body_positions
        self._kernels_loaded = False
        self._profiles: ProfileIndex | None = None
        self._cache_key: tuple[Any, ...] | None = None
        self._fraction_cache: dict[datetime, tuple[float, float]] = {}

    # ----------------------------------------------------------------------------------- status

    @property
    def info(self) -> EngineInfo:
        return EngineInfo(name=ENGINE_NAME, version=ENGINE_VERSION, is_synthetic=False, available=self._data_present())

    def _data_present(self) -> bool:
        """Cheap file check for /health: never loads kernels or profiles."""
        if not self._profile_dir.is_dir():
            return False
        if self._injected_positions is not None or self._kernels_loaded:
            return True
        from app.physics.engine.kernel_loader import SPICE_KERNELS

        return all((self._kernel_dir / name).is_file() for name in SPICE_KERNELS)

    # ------------------------------------------------------------------------------ data access

    def _ensure_kernels(self) -> None:
        """Load the four NAIF kernels once per process. Caller holds ``_SPICE_LOCK``."""
        if self._kernels_loaded:
            return
        try:
            from spiceypy.utils.exceptions import SpiceyError

            from app.physics.engine import kernel_loader
        except ImportError as error:
            raise PhysicsEngineUnavailable(
                f"The physics engine's dependencies are not installed ({error.name})."
            ) from None

        directory = self._kernel_dir.expanduser()
        if not directory.is_dir():
            logger.error("SPICE kernel directory not found: %s", directory)
            raise PhysicsEngineUnavailable(
                "SPICE kernel directory not found. Set CH_SPICE_KERNEL_DIR to the folder holding "
                f"{', '.join(kernel_loader.SPICE_KERNELS)}."
            )
        missing = [name for name in kernel_loader.SPICE_KERNELS if not (directory / name).is_file()]
        if missing:
            logger.error("Missing SPICE kernels in %s: %s", directory, missing)
            raise PhysicsEngineUnavailable(f"Missing SPICE kernels: {', '.join(missing)}.")
        try:
            kernel_loader.load_kernels(directory.resolve(strict=True))
        except (OSError, SpiceyError) as error:
            logger.exception("Loading SPICE kernels from %s failed", directory)
            raise PhysicsEngineUnavailable(f"SPICE could not load the kernels ({type(error).__name__}).") from None
        self._kernels_loaded = True

    def _profile_index(self) -> ProfileIndex:
        if self._profiles is None:
            self._profiles = ProfileIndex.load(self._profile_dir)
        return self._profiles

    def _positions_function(self) -> BodyPositions:
        if self._injected_positions is not None:
            return self._injected_positions
        self._ensure_kernels()
        from spiceypy.utils.exceptions import SpiceyError

        from app.physics.engine import positions

        def spice_positions(moment: datetime) -> tuple[Sequence[float], Sequence[float]]:
            try:
                return positions.get_sun_position(moment), positions.get_earth_position(moment)
            except SpiceyError as error:
                logger.exception("SPICE failed at %s", moment.isoformat())
                raise PhysicsEngineUnavailable(
                    f"SPICE could not compute Sun/Earth positions at {moment.isoformat()} ({type(error).__name__}); "
                    "check the kernel set and its time coverage."
                ) from None

        return spice_positions

    def _ephemeris_sources(self) -> list[str]:
        if self._injected_positions is not None:
            return ["Ephemeris: INJECTED TEST POSITIONS, not SPICE. Not a physics result."]
        from app.physics.engine.kernel_loader import SPICE_KERNELS

        return [
            "Ephemeris: NAIF SPICE kernels "
            + ", ".join(SPICE_KERNELS)
            + " through app.physics.engine.positions; Moon-centred geometric positions (aberration "
            "correction NONE) in the MOON_ME frame, km.",
            (
                f"Disc radii: Sun {SUN_RADIUS_KM!r} km (IAU 2015 nominal), Earth {EARTH_RADIUS_KM!r} km "
                "(equatorial); angular radius from the distance at each sample."
            ),
        ]

    # --------------------------------------------------------------------------------- simulate

    def simulate(self, request: SimulationRequest) -> SimulationResult:
        if request.start_utc.tzinfo is None or request.start_utc.utcoffset() is None:
            raise ValueError("start_utc must be timezone-aware")
        if not (math.isfinite(request.latitude_deg) and -90.0 <= request.latitude_deg <= 90.0):
            raise ValueError("latitude_deg must be finite and in [-90, 90]")
        if not math.isfinite(request.longitude_deg):
            raise ValueError("longitude_deg must be finite")

        terrain = select_terrain(self._profile_index(), request)
        times = build_time_grid(request.start_utc, request.duration_s, request.time_step_s)

        with _SPICE_LOCK:
            body_positions = self._positions_function()
            from app.physics.engine import frames

            observer_radius_km = (MOON_RADIUS_M + terrain.site_height_m + request.observer_height_m) / 1000.0
            site_km = frames.get_site_position(request.latitude_deg, request.longitude_deg, observer_radius_km)
            self._use_cache_for(request, terrain)

            def observe(moment: datetime) -> tuple[BodySample, BodySample]:
                positions = body_positions(moment)
                if not isinstance(positions, tuple | list) or len(positions) != 2:
                    raise EngineContractError("The ephemeris did not return one Sun and one Earth position.")
                sun_km, earth_km = positions
                lat, lon, profile = request.latitude_deg, request.longitude_deg, terrain.profile
                sun = _observe(sun_km, site_km, lat, lon, SUN_RADIUS_KM, profile)
                earth = _observe(earth_km, site_km, lat, lon, EARTH_RADIUS_KM, profile)
                self._remember(moment, sun.fraction, earth.fraction)
                return sun, earth

            if request.include_timeseries:
                pairs = [observe(moment) for moment in times]
                sun_fraction = [sun.fraction for sun, _ in pairs]
                earth_fraction = [earth.fraction for _, earth in pairs]
            else:
                sun_fraction, earth_fraction = [], []
                for moment in times:
                    cached = self._fraction_cache.get(moment)
                    if cached is None:
                        sun, earth = observe(moment)
                        cached = (sun.fraction, earth.fraction)
                    sun_fraction.append(cached[0])
                    earth_fraction.append(cached[1])

        metrics, windows = summarise(times, sun_fraction, earth_fraction, terrain.sky_visibility_fraction)
        timeseries = None
        if request.include_timeseries:
            timeseries = Timeseries(
                timestamps_utc=times,
                sun=_body_timeseries([sun for sun, _ in pairs]),
                earth=_body_timeseries([earth for _, earth in pairs]),
            )

        warnings = list(terrain.warnings)
        warnings.append("Site slope is not computed (no slope data at run time): slope_deg is null.")
        if any(moment.microsecond for moment in times):
            warnings.append(
                "SPICE evaluates times to the whole second (the engine's UTC conversion drops fractions); "
                "the error is under 1 s of Sun and Earth motion."
            )
        return SimulationResult(
            site=SiteInfo(
                latitude_deg=request.latitude_deg,
                longitude_deg=request.longitude_deg,
                elevation_m=terrain.site_height_m,
                elevation_source=terrain.elevation_source,
                slope_deg=None,
            ),
            timeseries=timeseries,
            metrics=metrics,
            communication_windows=windows,
            # Only the full (baseline) run's skyline reaches the response; metric-only runs skip building it.
            terrain_skyline=terrain.skyline if request.include_timeseries else None,
            warnings=warnings,
            sources=[*self._ephemeris_sources(), *terrain.sources],
        )

    # ------------------------------------------------------------------------- fraction cache

    def _use_cache_for(self, request: SimulationRequest, terrain: Terrain) -> None:
        key = (
            request.latitude_deg,
            request.longitude_deg,
            request.observer_height_m,
            terrain.site_height_m,
            terrain.profile.site_id,
            terrain.stored,
        )
        if key != self._cache_key:
            self._cache_key = key
            self._fraction_cache = {}

    def _remember(self, moment: datetime, sun_fraction: float, earth_fraction: float) -> None:
        if len(self._fraction_cache) >= _FRACTION_CACHE_MAX:
            self._fraction_cache = {}
        self._fraction_cache[moment] = (sun_fraction, earth_fraction)
