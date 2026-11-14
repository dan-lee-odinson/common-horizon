import pytest

from app.models.mission import HardwareRequirements
from app.models.results import MissionMetrics, SiteInfo
from app.services.requirements import check_requirements, overall_pass

METRICS = MissionMetrics(
    sunlight_hours=200,
    sunlight_percentage=60,
    longest_sunlight_hours=150,
    longest_darkness_hours=80,
    earth_visibility_hours=100,
    earth_visibility_percentage=30,
)
SITE = SiteInfo(latitude_deg=-89.5, longitude_deg=0, elevation_m=0, elevation_source="input", slope_deg=8)


@pytest.mark.parametrize(
    "rule, threshold, passed",
    [
        ("min_sunlight_percentage", 60, True),  # equal to threshold passes
        ("min_sunlight_percentage", 60.01, False),
        ("min_sunlight_hours", 250, False),
        ("max_darkness_hours", 80, True),
        ("max_darkness_hours", 79.9, False),
        ("min_earth_visibility_percentage", 25, True),
        ("min_earth_visibility_hours", 100.5, False),
        ("max_slope_deg", 10, True),
        ("max_slope_deg", 5, False),
    ],
)
def test_each_rule_compares_engine_value_with_threshold(rule, threshold, passed):
    [result] = check_requirements(HardwareRequirements(**{rule: threshold}), METRICS, SITE)

    assert result.requirement == rule
    assert result.threshold == threshold
    assert result.passed is passed


def test_missing_slope_gives_undecided_result():
    site = SITE.model_copy(update={"slope_deg": None})

    [result] = check_requirements(HardwareRequirements(max_slope_deg=10), METRICS, site)

    assert result.actual is None
    assert result.passed is None


def test_overall_pass_logic():
    passing = check_requirements(HardwareRequirements(min_sunlight_percentage=10), METRICS, SITE)
    failing = check_requirements(HardwareRequirements(min_sunlight_percentage=90), METRICS, SITE)
    undecided = check_requirements(
        HardwareRequirements(max_slope_deg=10), METRICS, SITE.model_copy(update={"slope_deg": None})
    )

    assert overall_pass([]) is None
    assert overall_pass(passing) is True
    assert overall_pass(failing + undecided) is False
    assert overall_pass(passing + undecided) is None


def test_no_requirements_gives_no_results():
    assert check_requirements(None, METRICS, SITE) == []
    assert check_requirements(HardwareRequirements(), METRICS, SITE) == []
