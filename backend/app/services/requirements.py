"""Hardware requirement checks: plain threshold comparisons on engine-provided values.

No physics happens here. Every ``actual`` value comes from the engine's metrics
or site information; this module only compares it with the user's threshold.
"""

from collections.abc import Callable
from dataclasses import dataclass
from typing import Literal

from app.models.mission import HardwareRequirements
from app.models.results import MissionMetrics, RequirementResult, SiteInfo


@dataclass(frozen=True)
class _Rule:
    metric: str
    comparison: Literal[">=", "<="]
    unit: str
    actual: Callable[[MissionMetrics, SiteInfo], float | None]


_RULES: dict[str, _Rule] = {
    "min_sunlight_percentage": _Rule("sunlight_percentage", ">=", "%", lambda m, s: m.sunlight_percentage),
    "min_sunlight_hours": _Rule("sunlight_hours", ">=", "h", lambda m, s: m.sunlight_hours),
    "max_darkness_hours": _Rule("longest_darkness_hours", "<=", "h", lambda m, s: m.longest_darkness_hours),
    "min_earth_visibility_percentage": _Rule(
        "earth_visibility_percentage", ">=", "%", lambda m, s: m.earth_visibility_percentage
    ),
    "min_earth_visibility_hours": _Rule(
        "earth_visibility_hours", ">=", "h", lambda m, s: m.earth_visibility_hours
    ),
    "max_slope_deg": _Rule("landing_site_slope_deg", "<=", "deg", lambda m, s: s.slope_deg),
}


def check_requirements(
    requirements: HardwareRequirements | None, metrics: MissionMetrics, site: SiteInfo
) -> list[RequirementResult]:
    if requirements is None:
        return []
    results = []
    for name, threshold in requirements.model_dump(exclude_none=True).items():
        rule = _RULES[name]
        actual = rule.actual(metrics, site)
        if actual is None:
            passed = None
        elif rule.comparison == ">=":
            passed = actual >= threshold
        else:
            passed = actual <= threshold
        results.append(
            RequirementResult(
                requirement=name,
                metric=rule.metric,
                comparison=rule.comparison,
                threshold=threshold,
                actual=actual,
                unit=rule.unit,
                passed=passed,
            )
        )
    return results


def overall_pass(results: list[RequirementResult]) -> bool | None:
    """False if any check failed, None if nothing could be decided, else True."""
    if not results:
        return None
    if any(r.passed is False for r in results):
        return False
    if any(r.passed is None for r in results):
        return None
    return True
