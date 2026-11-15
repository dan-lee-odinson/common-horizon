"""``POST /horizon`` for the website: skyline, Sun path and Earth box of one site over one window.

One physics run through the ``PhysicsEngine`` interface, the same interface ``/evaluate`` uses, so it
works on the synthetic fixture and on the real engine adapter. The engine computes every number;
this module only reads them:

* ``skyline``: the terrain skyline the engine returns (a stored horizon profile, at its own spacing).
  When the engine returns none, the site has no stored profile and the engine sees a smooth sphere
  through it; the skyline is then that sphere, built by the engine's own horizon model
  (``HorizonProfile.smooth_sphere``, the call the engine adapter makes) from the site elevation the
  engine reported and the website's 2 m observer. The engine's warning that terrain is not included
  is passed on.
* ``sun_path``: the engine's Sun azimuth and elevation at each sample. ``state`` is "above" when the
  engine's visible fraction of the Sun's disc is above zero: the rule ``/evaluate`` uses for sunlight.
* ``earth_box``: the smallest box around the engine's Earth directions with elevation above 0, null
  when there are none. Its azimuth range is the shortest arc holding them, so az_min > az_max when
  the box wraps past north.
"""

import math

from pydantic import ValidationError

from app.models.results import DataProvenance, DataSource, TerrainSkyline
from app.models.website import lon_east_to_signed
from app.models.website_horizon import (
    HORIZON_MAX_SAMPLES,
    HorizonRequest,
    HorizonResponse,
    SkyBox,
    SkyPoint,
    SunPathPoint,
)
from app.physics.horizon.profile import HorizonProfile
from app.physics.interface import (
    EngineContractError,
    EvaluationCache,
    PhysicsEngine,
    SimulationRequest,
    SimulationResult,
)
from app.physics.synthetic import SYNTHETIC_NOTICE
from app.services.evaluation import PHYSICS_NOTICE
from app.services.website_evaluation import WEBSITE_OBSERVER_HEIGHT_M
from app.timegrid import count_samples

SMOOTH_SPHERE_WARNING = (
    "Skyline: the engine has no stored terrain horizon profile for this site, so the skyline is the smooth "
    "sphere through the site that the engine uses (geometric horizon dip only); local terrain is not included."
)


def choose_step(duration_s: float, step_hours: float) -> tuple[int, int]:
    """(requested, used) steps in whole seconds. The request is rounded to whole minutes (at least one);
    the step used is the smallest whole-minute step at or above it that keeps the Sun path within
    ``HORIZON_MAX_SAMPLES`` samples."""
    requested = max(60, 60 * round(step_hours * 60))
    step = requested
    if count_samples(duration_s, step) > HORIZON_MAX_SAMPLES:
        step = max(step, 60 * math.ceil(duration_s / (HORIZON_MAX_SAMPLES - 1) / 60))
        while count_samples(duration_s, step) > HORIZON_MAX_SAMPLES:
            step += 60
    return requested, step


def run_engine(engine: PhysicsEngine, request: HorizonRequest, step_s: int) -> SimulationResult:
    """One validated simulation, with the same checks ``evaluate_mission`` applies to engine output."""
    simulation = SimulationRequest(
        latitude_deg=request.site.lat,
        longitude_deg=lon_east_to_signed(request.site.lon_east),
        altitude_m=None,
        observer_height_m=WEBSITE_OBSERVER_HEIGHT_M,
        start_utc=request.start_utc,
        duration_s=(request.end_utc - request.start_utc).total_seconds(),
        time_step_s=step_s,
        include_timeseries=True,
        sample_cache=EvaluationCache(),
    )
    try:
        result = engine.simulate(simulation)
        if not isinstance(result, SimulationResult):
            raise EngineContractError(
                f"Physics engine '{engine.info.name}' returned {type(result).__name__}, expected SimulationResult."
            )
        result = SimulationResult.model_validate(result.model_dump(warnings=False))
    except ValidationError as exc:
        raise EngineContractError(
            f"Physics engine '{engine.info.name}' returned data that violates the API contract "
            f"({exc.error_count()} validation error(s))."
        ) from exc
    if result.timeseries is None:
        raise EngineContractError(f"Physics engine '{engine.info.name}' returned no time series.")
    return result


def provenance_of(engine: PhysicsEngine, result: SimulationResult) -> DataProvenance:
    """Built exactly as ``evaluate_mission`` builds it."""
    info = engine.info
    return DataProvenance(
        source=DataSource.SYNTHETIC if info.is_synthetic else DataSource.PHYSICS_ENGINE,
        is_synthetic=info.is_synthetic,
        engine_name=info.name,
        engine_version=info.version,
        notice=SYNTHETIC_NOTICE if info.is_synthetic else PHYSICS_NOTICE,
        sources=result.sources,
    )


def skyline_points(skyline: TerrainSkyline) -> list[SkyPoint]:
    pairs = sorted(zip(skyline.azimuth_deg, skyline.horizon_elevation_deg, strict=True))
    return [SkyPoint(az=az, el=el) for az, el in pairs]


def azimuth_range(azimuths: list[float]) -> tuple[float, float]:
    """The shortest arc holding every azimuth, as (start, end) clockwise; start > end when it crosses north."""
    ordered = sorted({az % 360.0 for az in azimuths})
    if len(ordered) == 1:
        return ordered[0], ordered[0]
    count = len(ordered)
    gaps = [(ordered[(i + 1) % count] - ordered[i]) % 360.0 for i in range(count)]
    widest = max(range(count), key=lambda i: gaps[i])  # the arc is everything except the widest empty gap
    return ordered[(widest + 1) % count], ordered[widest]


def earth_box(azimuths: list[float], elevations: list[float]) -> SkyBox | None:
    above = [(az, el) for az, el in zip(azimuths, elevations, strict=True) if el > 0.0]
    if not above:
        return None
    az_min, az_max = azimuth_range([az for az, _ in above])
    return SkyBox(az_min=az_min, az_max=az_max, el_min=min(el for _, el in above), el_max=max(el for _, el in above))


def horizon_view(request: HorizonRequest, engine: PhysicsEngine) -> HorizonResponse:
    duration_s = (request.end_utc - request.start_utc).total_seconds()
    requested_step, step = choose_step(duration_s, request.step_hours)
    result = run_engine(engine, request, step)
    series = result.timeseries
    assert series is not None  # run_engine refuses a result without one

    warnings = list(result.warnings)
    if step != requested_step:
        warnings.append(
            f"Sampled every {step} s, not the requested {requested_step} s, so that the Sun path stays within "
            f"{HORIZON_MAX_SAMPLES} samples."
        )

    if result.terrain_skyline is not None and result.terrain_skyline.azimuth_deg:
        skyline, source = skyline_points(result.terrain_skyline), "stored_profile"
    else:
        sphere = HorizonProfile.smooth_sphere(
            latitude_deg=result.site.latitude_deg,
            longitude_deg=result.site.longitude_deg,
            site_height_m=result.site.elevation_m,
            observer_height_m=WEBSITE_OBSERVER_HEIGHT_M,
        )
        skyline, source = skyline_points(sphere.to_terrain_skyline()), "smooth_sphere"
        warnings.append(SMOOTH_SPHERE_WARNING)

    sun = series.sun
    sun_path = [
        SunPathPoint(t=t, az=az, el=el, state="above" if fraction > 0.0 else "hidden")
        for t, az, el, fraction in zip(
            series.timestamps_utc, sun.azimuth_deg, sun.elevation_deg, sun.visibility_fraction, strict=True
        )
    ]
    box = earth_box(series.earth.azimuth_deg, series.earth.elevation_deg)
    if box is None:
        warnings.append(
            "The Earth stays at or below the local horizontal plane for the whole window, so earth_box is null."
        )

    return HorizonResponse(
        site_id=request.site.id,
        skyline=skyline,
        sun_path=sun_path,
        earth_box=box,
        skyline_source=source,
        time_step_s=step,
        provenance=provenance_of(engine, result),
        warnings=warnings,
    )
