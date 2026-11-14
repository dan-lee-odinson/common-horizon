"""Turns one validated ``MissionInput`` into a full ``MissionEvaluation``."""

from datetime import timedelta

from pydantic import ValidationError

from app.config import CONTRACT_VERSION
from app.models.mission import MissionInput
from app.models.results import DataProvenance, DataSource, LaunchDelayCase, MissionEvaluation
from app.physics.interface import EngineContractError, PhysicsEngine, SimulationRequest, SimulationResult
from app.physics.synthetic import SYNTHETIC_NOTICE
from app.services.requirements import check_requirements, overall_pass

PHYSICS_NOTICE = "Values computed by the Common Horizon physics engine."


def _run(engine: PhysicsEngine, mission: MissionInput, delay_days: int, include_timeseries: bool) -> SimulationResult:
    request = SimulationRequest(
        latitude_deg=mission.landing_site.latitude_deg,
        longitude_deg=mission.landing_site.longitude_deg,
        altitude_m=mission.landing_site.altitude_m,
        observer_height_m=mission.observer_height_m,
        start_utc=mission.mission_start_utc + timedelta(days=delay_days),
        duration_s=mission.stay_duration_s,
        time_step_s=mission.time_step_s,
        include_timeseries=include_timeseries,
    )
    try:
        result = engine.simulate(request)
        if not isinstance(result, SimulationResult):
            raise EngineContractError(
                f"Physics engine '{engine.info.name}' returned {type(result).__name__}, expected SimulationResult."
            )
        # Validate again at the boundary: results built with model_copy(update=...) or
        # model_construct() skip validation, and nothing unchecked may reach the website.
        return SimulationResult.model_validate(result.model_dump(warnings=False))
    except ValidationError as exc:
        raise EngineContractError(
            f"Physics engine '{engine.info.name}' returned data that violates the API contract "
            f"({exc.error_count()} validation error(s))."
        ) from exc


def evaluate_mission(mission: MissionInput, engine: PhysicsEngine) -> MissionEvaluation:
    base = _run(engine, mission, delay_days=0, include_timeseries=True)
    if base.timeseries is None:
        raise EngineContractError(f"Physics engine '{engine.info.name}' returned no time series.")

    requirement_results = check_requirements(mission.hardware_requirements, base.metrics, base.site)

    delay_cases = []
    for delay in mission.launch_delays():
        result = base if delay == 0 else _run(engine, mission, delay_days=delay, include_timeseries=False)
        delay_cases.append(
            LaunchDelayCase(
                launch_delay_days=delay,
                mission_start_utc=mission.mission_start_utc + timedelta(days=delay),
                metrics=result.metrics,
                requirements_passed=overall_pass(
                    check_requirements(mission.hardware_requirements, result.metrics, result.site)
                ),
            )
        )

    info = engine.info
    provenance = DataProvenance(
        source=DataSource.SYNTHETIC if info.is_synthetic else DataSource.PHYSICS_ENGINE,
        is_synthetic=info.is_synthetic,
        engine_name=info.name,
        engine_version=info.version,
        notice=SYNTHETIC_NOTICE if info.is_synthetic else PHYSICS_NOTICE,
    )
    return MissionEvaluation(
        contract_version=CONTRACT_VERSION,
        provenance=provenance,
        mission=mission,
        site=base.site,
        timeseries=base.timeseries,
        metrics=base.metrics,
        communication_windows=base.communication_windows,
        terrain_skyline=base.terrain_skyline,
        requirement_results=requirement_results,
        requirements_passed=overall_pass(requirement_results),
        launch_delay_results=delay_cases,
        warnings=base.warnings,
    )
