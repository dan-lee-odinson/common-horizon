"""``POST /evaluate`` and ``POST /check`` for the website.

The backend orchestrates: one physics run per site through the existing ``evaluate_mission`` path
(the same engine abstraction, provenance and validation as ``/api/v1/missions/evaluate``), then the
planner's checks, then Dan's ranking. The physics engine computes every physical number; this
module only reads them, converts the Sun and Earth position vectors to sub-points, and counts
the dark periods in the sampled series.
"""

import math
from dataclasses import dataclass
from datetime import datetime

from app.models import limits
from app.models.mission import LandingSite, MissionInput
from app.models.results import DataProvenance, MissionEvaluation
from app.models.website import (
    CheckRequest,
    CheckResponse,
    EvaluateRequest,
    EvaluateResponse,
    Geometry,
    RequirementCheck,
    ScoreComponents,
    SiteEvaluation,
    SiteRef,
    Verdict,
    lon_east_to_signed,
    normalize_lon_east,
)
from app.physics.interface import PhysicsEngine
from app.planner_bridge import planner
from app.services import planner_checks, ranking
from app.services.catalog import PlannerSelection, lander_item, to_planner_selection
from app.services.evaluation import evaluate_mission
from app.timegrid import SECONDS_PER_DAY, count_samples

# Observer height for website requests: the stored terrain horizon profiles are computed for an
# observer 2 m above the ground (the team default since b27aa0e). Team decision to confirm.
WEBSITE_OBSERVER_HEIGHT_M = 2.0
# One sample per hour, coarser only when the request would exceed WEBSITE_MAX_TOTAL_SAMPLES.
BASE_TIME_STEP_S = 3600

TRANSIT_WARNING = (
    "transit_days was not given and the team has not fixed a transit time: the stay is assumed to start at "
    "launch_utc + slip_days (landing_utc = launch_utc + slip_days)."
)
SLOPE_UNKNOWN_WARNING = (
    "Slope is unknown for {count} of {total} site(s): the landing-slope requirement cannot be checked there "
    "(verdict 'unknown' unless another requirement fails) and their score is the range score_min..score_max."
)


def choose_time_step(stay_days: float, site_count: int) -> int:
    """The smallest step (whole minutes, at least one hour) that keeps all sites inside the budget."""
    duration_s = stay_days * SECONDS_PER_DAY
    step = BASE_TIME_STEP_S
    estimate = math.ceil(duration_s * site_count / max(1, limits.WEBSITE_MAX_TOTAL_SAMPLES - site_count))
    step = max(step, 60 * math.ceil(estimate / 60))
    while site_count * count_samples(duration_s, step) > limits.WEBSITE_MAX_TOTAL_SAMPLES:
        step += 60
    return min(step, limits.TIME_STEP_MAX_S)


def _simulate(engine: PhysicsEngine, site: SiteRef, start: datetime, stay_days: float, step: int) -> MissionEvaluation:
    mission = MissionInput(
        landing_site=LandingSite(latitude_deg=site.lat, longitude_deg=lon_east_to_signed(site.lon_east)),
        observer_height_m=WEBSITE_OBSERVER_HEIGHT_M,
        mission_start_utc=start,
        stay_duration_days=stay_days,
        time_step_s=step,
    )
    return evaluate_mission(mission, engine)


def _subpoint(position_km: list[float]) -> tuple[float, float]:
    """Latitude and east longitude where a Moon-centred MOON_ME vector meets the surface."""
    x, y, z = position_km
    return math.degrees(math.atan2(z, math.hypot(x, y))), normalize_lon_east(math.degrees(math.atan2(y, x)))


def geometry_at_start(evaluation: MissionEvaluation) -> Geometry:
    sun_lat, sun_lon = _subpoint(evaluation.timeseries.sun.position_km[0])
    earth_lat, earth_lon = _subpoint(evaluation.timeseries.earth.position_km[0])
    return Geometry(
        subsolar_lat=sun_lat, subsolar_lon_east=sun_lon, subearth_lat=earth_lat, subearth_lon_east=earth_lon
    )


def dark_periods(evaluation: MissionEvaluation) -> int:
    """Number of separate spells with no part of the Sun's disc visible, in the sampled series."""
    count, dark = 0, False
    for fraction in evaluation.timeseries.sun.visibility_fraction:
        if fraction == 0.0 and not dark:
            count += 1
        dark = fraction == 0.0
    return count


def earth_link(earth_percent: float) -> str:
    """'none': Earth never visible during the stay; 'clear': always visible; otherwise 'intermittent'."""
    if earth_percent <= 0.0:
        return "none"
    if earth_percent >= 100.0:
        return "clear"
    return "intermittent"


@dataclass(frozen=True)
class _SiteStay:
    evaluation: MissionEvaluation
    dark_hours: float
    nights: int


def _site_stay(engine: PhysicsEngine, site: SiteRef, start: datetime, stay_days: float, step: int) -> _SiteStay:
    evaluation = _simulate(engine, site, start, stay_days, step)
    stay_hours = stay_days * 24.0
    dark_hours = max(0.0, stay_hours - evaluation.metrics.sunlight_hours)
    return _SiteStay(evaluation=evaluation, dark_hours=dark_hours, nights=dark_periods(evaluation))


def _slope_check(slope_deg: float | None, selection: PlannerSelection) -> RequirementCheck:
    lander = lander_item(selection)
    if lander is None:
        return RequirementCheck(requirement="landing slope", passed=None, detail="No lander chosen: no slope limit.")
    if lander.max_slope_deg is None:
        return RequirementCheck(
            requirement="landing slope", passed=None, detail=f"No published slope limit for {lander.name}."
        )
    if slope_deg is None:
        return RequirementCheck(
            requirement="landing slope",
            passed=None,
            detail=f"Site slope is unknown; {lander.name} accepts up to {lander.max_slope_deg:g} deg.",
        )
    passed = slope_deg <= lander.max_slope_deg
    return RequirementCheck(
        requirement="landing slope",
        passed=passed,
        detail=f"Slope {slope_deg:g} deg; {lander.name} accepts up to {lander.max_slope_deg:g} deg.",
    )


def _evaluate_site(
    stay: _SiteStay,
    site: SiteRef,
    selection: PlannerSelection,
    fit: planner_checks.FitResult,
    storage_kwh: float,
) -> tuple[SiteEvaluation, ranking.Score, str]:
    metrics, info = stay.evaluation.metrics, stay.evaluation.site
    warnings = list(stay.evaluation.warnings)

    power: planner_checks.PowerResult | None
    try:
        power = planner_checks.power(selection, storage_kwh, metrics.longest_darkness_hours)
    except planner.PlannerInputError as exc:
        power = None
        warnings.append(f"The planner could not run the power check: {exc}")
    energy = planner_checks.site_energy(selection, stay.dark_hours, stay.nights)

    link = earth_link(metrics.earth_visibility_percentage)
    checks = [
        RequirementCheck(requirement="hardware fit", passed=fit.fits, detail=fit.verdict),
        RequirementCheck(
            requirement="night power",
            passed=None if power is None else power.night.passes,
            detail="power check unavailable" if power is None else f"night status {power.night.status}",
        ),
        RequirementCheck(
            requirement="day power",
            passed=None if power is None else power.day.passes,
            detail="power check unavailable" if power is None else f"day status {power.day.status}",
        ),
        _slope_check(info.slope_deg, selection),
        RequirementCheck(requirement="Earth contact", passed=link != "none", detail=f"Earth link {link}"),
    ]
    decided = ranking.verdict({check.requirement: check.passed for check in checks})
    score = ranking.score_site(
        metrics.sunlight_percentage,
        metrics.longest_darkness_hours,
        metrics.earth_visibility_percentage,
        info.slope_deg,
    )
    evaluation = SiteEvaluation(
        site_id=site.id,
        rank=1,  # set after ranking
        score=score.score,
        score_min=score.score_min,
        score_max=score.score_max,
        score_components=ScoreComponents(
            sunlight=score.sunlight, darkness=score.darkness, earth=score.earth, slope=score.slope
        ),
        sunlight_hours=metrics.sunlight_hours,
        sunlight_percent=metrics.sunlight_percentage,
        longest_darkness_hours=metrics.longest_darkness_hours,
        earth_visible_percent=metrics.earth_visibility_percentage,
        clear_sky_percent=None if metrics.sky_visibility_fraction is None else 100.0 * metrics.sky_visibility_fraction,
        slope_deg=info.slope_deg,
        earth_link=link,
        hardware_fits=fit.fits,
        energy_added_kwh=None,
        site_energy=energy,
        power_margin_percent=None if power is None else power.balance.margin_percent,
        power_status="none" if power is None else power.balance.status,
        verdict=Verdict(
            result=decided.result, requirement=decided.requirement, unknown_requirements=decided.unknown_requirements
        ),
        requirements=checks,
        elevation_m=info.elevation_m,
        elevation_source=info.elevation_source,
        warnings=warnings,
    )
    return evaluation, score, decided.result


def _provenance_of(stays: list[_SiteStay]) -> DataProvenance:
    first = stays[0].evaluation.provenance
    if any(stay.evaluation.provenance != first for stay in stays[1:]):  # one engine per request
        raise RuntimeError("sites of one request were evaluated by different engines")
    return first


def evaluate_sites(request: EvaluateRequest, engine: PhysicsEngine) -> EvaluateResponse:
    selection = to_planner_selection(request.hardware)
    fit = planner_checks.fit(selection)
    step = choose_time_step(request.stay_days, len(request.sites))
    landing = request.landing_utc

    stays = [_site_stay(engine, site, landing, request.stay_days, step) for site in request.sites]
    built = [
        _evaluate_site(stay, site, selection, fit, request.storage_kwh)
        for stay, site in zip(stays, request.sites, strict=True)
    ]
    ordered = ranking.rank(
        [
            ranking.Rankable(site_id=evaluation.site_id, verdict=result, score=score, item=evaluation)
            for evaluation, score, result in built
        ]
    )
    results = [evaluation.model_copy(update={"rank": position}) for position, evaluation in enumerate(ordered, start=1)]

    warnings: list[str] = []
    if request.transit_days is None:
        warnings.append(TRANSIT_WARNING)
    if step > BASE_TIME_STEP_S:
        warnings.append(
            f"Sampled every {step} s (not hourly) so that {len(request.sites)} site(s) x {request.stay_days:g} days "
            f"stay within {limits.WEBSITE_MAX_TOTAL_SAMPLES} samples."
        )
    unknown_slope = sum(1 for evaluation in results if evaluation.slope_deg is None)
    if unknown_slope:
        warnings.append(SLOPE_UNKNOWN_WARNING.format(count=unknown_slope, total=len(results)))

    return EvaluateResponse(
        launch_utc=request.launch_utc,
        landing_utc=landing,
        transit_days=request.transit_days,
        slip_days=request.slip_days,
        stay_days=request.stay_days,
        time_step_s=step,
        geometry=geometry_at_start(stays[0].evaluation),
        results=results,
        provenance=_provenance_of(stays),
        warnings=warnings,
    )


def check_hardware(request: CheckRequest, engine: PhysicsEngine) -> CheckResponse:
    """The planner's checks for one site (or none). Raises ``planner.PlannerInputError`` (422)."""
    selection = to_planner_selection(request.hardware)
    fit = planner_checks.fit(selection)
    if request.site is None:
        power = planner_checks.power(selection, request.storage_kwh, None)
        return CheckResponse(
            fits=fit.fits,
            fit_verdict=fit.verdict,
            fit_notes=fit.notes,
            day=power.day,
            night=power.night,
            balance=power.balance,
            power_notes=power.notes,
            energy_added_kwh=None,
            site_energy=None,
            provenance=None,
            warnings=["No site chosen: there is no darkness length, so the night check compares power only."],
        )

    stay = _site_stay(
        engine, request.site, request.landing_utc, request.stay_days, choose_time_step(request.stay_days, 1)
    )
    power = planner_checks.power(selection, request.storage_kwh, stay.evaluation.metrics.longest_darkness_hours)
    return CheckResponse(
        fits=fit.fits,
        fit_verdict=fit.verdict,
        fit_notes=fit.notes,
        day=power.day,
        night=power.night,
        balance=power.balance,
        power_notes=power.notes,
        energy_added_kwh=None,
        site_energy=planner_checks.site_energy(selection, stay.dark_hours, stay.nights),
        provenance=stay.evaluation.provenance,
        warnings=list(stay.evaluation.warnings),
    )
