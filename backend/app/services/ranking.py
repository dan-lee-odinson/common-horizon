"""Dan's deterministic site ranking: the score formula, the requirement order and the sort order.

All weights and scale constants live in ``DAN_RANKING_RULES`` below and nowhere else.

    score = 0.40 * sunlight + 0.25 * darkness + 0.20 * earth + 0.15 * slope

    sunlight = sunlight percentage over the stay
    darkness = max(0, 100 * (1 - longest_darkness_hours / 354))
    earth    = Earth visibility percentage over the stay
    slope    = max(0, 100 * (1 - slope_deg / 10))

An unknown input is never replaced by a guess: its term is null, ``score`` is null, and the score
is reported as the range ``score_min`` (unknown terms at 0) to ``score_max`` (unknown terms at 100).
Sites are ranked by ``score`` when it is known and by ``score_min`` (the worst case) when it is not.
"""

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Generic, TypeVar


@dataclass(frozen=True)
class RankingRules:
    weight_sunlight: float
    weight_darkness: float
    weight_earth: float
    weight_slope: float
    darkness_scale_hours: float
    slope_scale_deg: float


DAN_RANKING_RULES = RankingRules(
    weight_sunlight=0.40,
    weight_darkness=0.25,
    weight_earth=0.20,
    weight_slope=0.15,
    darkness_scale_hours=354.0,
    slope_scale_deg=10.0,
)

# Requirements in the order they are checked; the first one that fails is reported.
REQUIREMENT_ORDER = ("hardware fit", "night power", "day power", "landing slope", "Earth contact")

# pass first, then sites whose verdict is unknown (nothing failed, something unchecked), then fail.
_VERDICT_GROUP = {"pass": 0, "unknown": 1, "fail": 2}


@dataclass(frozen=True)
class Score:
    sunlight: float
    darkness: float
    earth: float
    slope: float | None
    score: float | None
    score_min: float
    score_max: float


def score_site(
    sunlight_percent: float,
    longest_darkness_hours: float,
    earth_percent: float,
    slope_deg: float | None,
    rules: RankingRules = DAN_RANKING_RULES,
) -> Score:
    sunlight = sunlight_percent
    darkness = max(0.0, 100.0 * (1.0 - longest_darkness_hours / rules.darkness_scale_hours))
    earth = earth_percent
    slope = None if slope_deg is None else max(0.0, 100.0 * (1.0 - slope_deg / rules.slope_scale_deg))
    known = rules.weight_sunlight * sunlight + rules.weight_darkness * darkness + rules.weight_earth * earth
    if slope is None:
        return Score(sunlight, darkness, earth, None, None, known, known + rules.weight_slope * 100.0)
    total = known + rules.weight_slope * slope
    return Score(sunlight, darkness, earth, slope, total, total, total)


@dataclass(frozen=True)
class VerdictResult:
    result: str  # "pass" | "fail" | "unknown"
    requirement: str | None
    unknown_requirements: list[str]


def verdict(passed: dict[str, bool | None]) -> VerdictResult:
    """``passed`` maps each name in ``REQUIREMENT_ORDER`` to True, False or None (could not be checked)."""
    unknown = [name for name in REQUIREMENT_ORDER if passed[name] is None]
    for name in REQUIREMENT_ORDER:
        if passed[name] is False:
            return VerdictResult("fail", name, unknown)
    if unknown:
        return VerdictResult("unknown", unknown[0], unknown)
    return VerdictResult("pass", None, [])


T = TypeVar("T")


@dataclass(frozen=True)
class Rankable(Generic[T]):
    site_id: str
    verdict: str
    score: Score
    item: T


def rank(entries: Sequence[Rankable[T]]) -> list[T]:
    """Pass, then unknown, then fail; each group by score (worst case when unknown), best first.

    Ties: the higher best case, then site id, then the order the sites were sent in.
    """
    order = sorted(
        enumerate(entries),
        key=lambda pair: (
            _VERDICT_GROUP[pair[1].verdict],
            -(pair[1].score.score if pair[1].score.score is not None else pair[1].score.score_min),
            -pair[1].score.score_max,
            pair[1].site_id,
            pair[0],
        ),
    )
    return [entry.item for _, entry in order]
