"""SYNTHETIC physics engine: placeholder data for interface development ONLY.

This is a deterministic toy model so the frontend and API can be built and tested
before real physics-engine results exist. It is NOT a scientific result:

* no SPICE kernels or ephemerides: the Sun and Earth follow idealised periodic
  motion anchored to a nominal new-moon epoch;
* no terrain: the horizon is a smooth sphere (only the observer-height dip is
  applied), so ``terrain_blocked`` never occurs and slope is reported as 0;
* metric definitions (a sample counts as "visible" when any part of the disc is
  above the horizon) are placeholders until the physics owner defines them.

Every response built from this engine carries ``provenance.is_synthetic = true``
and the ``SYNTHETIC_NOTICE`` text.
"""

import math
from collections.abc import Sequence
from datetime import UTC, datetime

from app.models.results import (
    BodyTimeseries,
    MissionMetrics,
    ObstructionState,
    SiteInfo,
    Timeseries,
    TimeWindow,
)
from app.physics.interface import EngineInfo, SimulationRequest, SimulationResult
from app.timegrid import SECONDS_PER_DAY, build_time_grid

ENGINE_INFO = EngineInfo(name="synthetic-fixture", version="0.1.0", is_synthetic=True)

SYNTHETIC_NOTICE = (
    "SYNTHETIC FIXTURE: values come from a simplified toy model for interface development only. "
    "They are not physics-engine results and must not be used for mission decisions."
)

# Approximate constants: good enough for plausible-looking placeholder curves.
_MOON_RADIUS_KM = 1737.4
_AU_KM = 149_597_870.7
_EARTH_DISTANCE_KM = 384_400.0
_SUN_ANGULAR_RADIUS_DEG = 0.2666
_EARTH_ANGULAR_RADIUS_DEG = math.degrees(math.asin(6371.0 / _EARTH_DISTANCE_KM))
_SYNODIC_MONTH_DAYS = 29.530589
_REFERENCE_NEW_MOON = datetime(2000, 1, 6, 18, 14, tzinfo=UTC)
_SUBSOLAR_LAT_AMPLITUDE_DEG, _SUBSOLAR_LAT_PERIOD_DAYS = 1.54, 346.62
_LIBRATION_LON_AMPLITUDE_DEG, _LIBRATION_LON_PERIOD_DAYS = 7.9, 27.5546
_LIBRATION_LAT_AMPLITUDE_DEG, _LIBRATION_LAT_PERIOD_DAYS = 6.7, 27.2122

Vec = tuple[float, float, float]


def _unit_from_lat_lon(lat_deg: float, lon_deg: float) -> Vec:
    lat, lon = math.radians(lat_deg), math.radians(lon_deg)
    return (math.cos(lat) * math.cos(lon), math.cos(lat) * math.sin(lon), math.sin(lat))


def _dot(a: Vec, b: Vec) -> float:
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def _normalise(v: Vec) -> Vec:
    norm = math.sqrt(_dot(v, v))
    return (v[0] / norm, v[1] / norm, v[2] / norm)


def _disc_fraction(elevation_deg: float, horizon_deg: float, radius_deg: float) -> float:
    """Fraction of a disc of angular ``radius_deg`` above a flat horizon (small-angle)."""
    x = (elevation_deg - horizon_deg) / radius_deg
    if x >= 1.0:
        return 1.0
    if x <= -1.0:
        return 0.0
    return (math.pi - math.acos(x) + x * math.sqrt(1.0 - x * x)) / math.pi


def _state(fraction: float) -> ObstructionState:
    if fraction >= 1.0:
        return ObstructionState.VISIBLE
    if fraction <= 0.0:
        return ObstructionState.BELOW_HORIZON
    return ObstructionState.PARTIAL


def _hours(seconds: float) -> float:
    return round(seconds / 3600.0, 4)


def _visibility_runs(times: Sequence[datetime], fractions: Sequence[float]) -> list[tuple[int, int]]:
    """Index ranges [i, j) of consecutive *intervals* that start with the body visible.

    Interval k spans times[k] .. times[k + 1] and takes the state sampled at times[k].
    """
    runs: list[tuple[int, int]] = []
    start: int | None = None
    for k in range(len(times) - 1):
        visible = fractions[k] > 0.0
        if visible and start is None:
            start = k
        elif not visible and start is not None:
            runs.append((start, k))
            start = None
    if start is not None:
        runs.append((start, len(times) - 1))
    return runs


def _run_seconds(times: Sequence[datetime], run: tuple[int, int]) -> float:
    return (times[run[1]] - times[run[0]]).total_seconds()


def _first_set(times: Sequence[datetime], fractions: Sequence[float]) -> tuple[float | None, datetime | None]:
    """Time from start until a body that is visible at start first disappears."""
    if fractions[0] <= 0.0:
        return None, None
    for k, fraction in enumerate(fractions):
        if fraction <= 0.0:
            return _hours((times[k] - times[0]).total_seconds()), times[k]
    return None, None


def _summarise(
    times: Sequence[datetime], sun_fraction: Sequence[float], earth_fraction: Sequence[float]
) -> tuple[MissionMetrics, list[TimeWindow]]:
    total_s = (times[-1] - times[0]).total_seconds()

    sun_runs = _visibility_runs(times, sun_fraction)
    sunlit_s = sum(_run_seconds(times, run) for run in sun_runs)
    longest_sunlight_s = max((_run_seconds(times, run) for run in sun_runs), default=0.0)

    # Darkness runs are the gaps between sunlit runs (including the mission edges).
    boundaries = [0, *[i for run in sun_runs for i in run], len(times) - 1]
    longest_darkness_s = max(
        ((times[boundaries[i + 1]] - times[boundaries[i]]).total_seconds() for i in range(0, len(boundaries), 2)),
        default=0.0,
    )

    earth_runs = _visibility_runs(times, earth_fraction)
    earth_s = sum(_run_seconds(times, run) for run in earth_runs)
    windows = [
        TimeWindow(start_utc=times[i], end_utc=times[j], duration_hours=_hours(_run_seconds(times, (i, j))))
        for i, j in earth_runs
    ]

    time_to_sunset, sunset_utc = _first_set(times, sun_fraction)
    time_to_earthset, earthset_utc = _first_set(times, earth_fraction)

    metrics = MissionMetrics(
        sunlight_hours=_hours(sunlit_s),
        sunlight_percentage=round(100.0 * sunlit_s / total_s, 3),
        longest_sunlight_hours=_hours(longest_sunlight_s),
        longest_darkness_hours=_hours(longest_darkness_s),
        earth_visibility_hours=_hours(earth_s),
        earth_visibility_percentage=round(100.0 * earth_s / total_s, 3),
        sky_visibility_fraction=1.0,  # no terrain in the synthetic model
        time_to_sunset_hours=time_to_sunset,
        sunset_utc=sunset_utc,
        time_to_earthset_hours=time_to_earthset,
        earthset_utc=earthset_utc,
    )
    return metrics, windows


class SyntheticPhysicsEngine:
    """Deterministic placeholder engine. See the module docstring for its limits."""

    info = ENGINE_INFO

    def simulate(self, request: SimulationRequest) -> SimulationResult:
        times = build_time_grid(request.start_utc, request.duration_s, request.time_step_s)

        elevation_m = request.altitude_m if request.altitude_m is not None else 0.0
        surface_radius_km = _MOON_RADIUS_KM + elevation_m / 1000.0
        observer_radius_km = surface_radius_km + request.observer_height_m / 1000.0
        horizon_dip_deg = -math.degrees(math.acos(surface_radius_km / observer_radius_km))

        lat, lon = math.radians(request.latitude_deg), math.radians(request.longitude_deg)
        up = _unit_from_lat_lon(request.latitude_deg, request.longitude_deg)
        east = (-math.sin(lon), math.cos(lon), 0.0)
        north = (-math.sin(lat) * math.cos(lon), -math.sin(lat) * math.sin(lon), math.cos(lat))
        observer = (up[0] * observer_radius_km, up[1] * observer_radius_km, up[2] * observer_radius_km)

        bodies = {"sun": _empty_series(), "earth": _empty_series()}
        for t in times:
            days = (t - _REFERENCE_NEW_MOON).total_seconds() / SECONDS_PER_DAY
            subsolar = _unit_from_lat_lon(
                _SUBSOLAR_LAT_AMPLITUDE_DEG * math.sin(2 * math.pi * days / _SUBSOLAR_LAT_PERIOD_DAYS),
                180.0 - 360.0 * days / _SYNODIC_MONTH_DAYS,
            )
            sub_earth = _unit_from_lat_lon(
                _LIBRATION_LAT_AMPLITUDE_DEG * math.sin(2 * math.pi * days / _LIBRATION_LAT_PERIOD_DAYS),
                _LIBRATION_LON_AMPLITUDE_DEG * math.sin(2 * math.pi * days / _LIBRATION_LON_PERIOD_DAYS),
            )
            for name, direction_from_centre, distance_km, radius_deg in (
                ("sun", subsolar, _AU_KM, _SUN_ANGULAR_RADIUS_DEG),
                ("earth", sub_earth, _EARTH_DISTANCE_KM, _EARTH_ANGULAR_RADIUS_DEG),
            ):
                position: Vec = (
                    direction_from_centre[0] * distance_km,
                    direction_from_centre[1] * distance_km,
                    direction_from_centre[2] * distance_km,
                )
                direction = _normalise(
                    (position[0] - observer[0], position[1] - observer[1], position[2] - observer[2])
                )
                elevation = math.degrees(math.asin(max(-1.0, min(1.0, _dot(direction, up)))))
                azimuth = math.degrees(math.atan2(_dot(direction, east), _dot(direction, north))) % 360.0
                fraction = _disc_fraction(elevation, horizon_dip_deg, radius_deg)

                series = bodies[name]
                series["position_km"].append([round(c, 1) for c in position])
                series["direction_unit"].append([round(c, 6) for c in direction])
                series["azimuth_deg"].append(round(azimuth, 4) % 360.0)
                series["elevation_deg"].append(round(elevation, 4))
                series["visibility_fraction"].append(round(fraction, 4))
                series["obstruction_state"].append(_state(fraction))

        metrics, windows = _summarise(
            times, bodies["sun"]["visibility_fraction"], bodies["earth"]["visibility_fraction"]
        )
        timeseries = (
            Timeseries(
                timestamps_utc=times,
                sun=BodyTimeseries(**bodies["sun"]),
                earth=BodyTimeseries(**bodies["earth"]),
            )
            if request.include_timeseries
            else None
        )
        site = SiteInfo(
            latitude_deg=request.latitude_deg,
            longitude_deg=request.longitude_deg,
            elevation_m=elevation_m,
            elevation_source="input" if request.altitude_m is not None else "synthetic_default",
            slope_deg=0.0,
            slope_source="synthetic engine: terrain is not modelled, 0 is a placeholder, not a measured slope",
        )
        return SimulationResult(
            site=site,
            timeseries=timeseries,
            metrics=metrics,
            communication_windows=windows,
            terrain_skyline=None,
            warnings=[SYNTHETIC_NOTICE, "Terrain is not modelled: smooth horizon, slope reported as 0."],
        )


def _empty_series() -> dict[str, list]:
    return {
        "position_km": [],
        "direction_unit": [],
        "azimuth_deg": [],
        "elevation_deg": [],
        "visibility_fraction": [],
        "obstruction_state": [],
    }
