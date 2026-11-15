"""Dan's ranking rules: formula, weights, requirement order and sort order."""

import pytest

from app.services.ranking import DAN_RANKING_RULES, REQUIREMENT_ORDER, Rankable, rank, score_site, verdict


def test_weights_and_scales_are_dans():
    rules = DAN_RANKING_RULES
    assert (rules.weight_sunlight, rules.weight_darkness, rules.weight_earth, rules.weight_slope) == (
        0.40,
        0.25,
        0.20,
        0.15,
    )
    assert rules.weight_sunlight + rules.weight_darkness + rules.weight_earth + rules.weight_slope == pytest.approx(1)
    assert (rules.darkness_scale_hours, rules.slope_scale_deg) == (354.0, 10.0)


def test_formula():
    s = score_site(sunlight_percent=80, longest_darkness_hours=177, earth_percent=50, slope_deg=5)
    assert (s.sunlight, s.darkness, s.earth, s.slope) == (80, 50, 50, 50)
    assert s.score == pytest.approx(0.40 * 80 + 0.25 * 50 + 0.20 * 50 + 0.15 * 50)
    assert s.score_min == s.score_max == s.score


@pytest.mark.parametrize(("hours", "term"), [(0, 100), (354, 0), (708, 0), (35.4, 90)])
def test_darkness_term_is_clamped_at_zero(hours, term):
    assert score_site(0, hours, 0, 0).darkness == pytest.approx(term)


@pytest.mark.parametrize(("slope", "term"), [(0, 100), (10, 0), (25, 0), (2.5, 75)])
def test_slope_term_is_clamped_at_zero(slope, term):
    assert score_site(0, 0, 0, slope).slope == pytest.approx(term)


def test_unknown_slope_gives_a_range_not_a_guess():
    s = score_site(sunlight_percent=80, longest_darkness_hours=0, earth_percent=100, slope_deg=None)
    known = 0.40 * 80 + 0.25 * 100 + 0.20 * 100
    assert s.slope is None
    assert s.score is None
    assert s.score_min == pytest.approx(known)
    assert s.score_max == pytest.approx(known + 15)


def _passed(**overrides):
    passed = dict.fromkeys(REQUIREMENT_ORDER, True)
    passed.update({name.replace("_", " "): value for name, value in overrides.items()})
    return passed


def test_requirement_order_is_dans():
    assert REQUIREMENT_ORDER == ("hardware fit", "night power", "day power", "landing slope", "Earth contact")


def test_the_first_failed_requirement_is_reported():
    passed = dict.fromkeys(REQUIREMENT_ORDER, False)
    assert verdict(passed).requirement == "hardware fit"
    passed["hardware fit"] = True
    assert verdict(passed).requirement == "night power"
    passed["night power"] = True
    assert verdict(passed).requirement == "day power"
    passed["day power"] = True
    assert verdict(passed).requirement == "landing slope"
    passed["landing slope"] = True
    assert verdict(passed).requirement == "Earth contact"
    passed["Earth contact"] = True
    assert (verdict(passed).result, verdict(passed).requirement) == ("pass", None)


def test_a_failure_wins_over_an_earlier_unknown():
    passed = dict.fromkeys(REQUIREMENT_ORDER, True)
    passed["landing slope"] = None
    passed["Earth contact"] = False
    result = verdict(passed)
    assert (result.result, result.requirement, result.unknown_requirements) == (
        "fail",
        "Earth contact",
        ["landing slope"],
    )


def test_unknown_is_never_reported_as_a_pass():
    passed = dict.fromkeys(REQUIREMENT_ORDER, True)
    passed["hardware fit"] = None
    passed["landing slope"] = None
    result = verdict(passed)
    assert (result.result, result.requirement) == ("unknown", "hardware fit")
    assert result.unknown_requirements == ["hardware fit", "landing slope"]


def _entry(site_id, result, score, slope=0.0):
    s = score_site(score, 0, 0, slope) if slope is not None else score_site(score, 0, 0, None)
    return Rankable(site_id=site_id, verdict=result, score=s, item=site_id)


def test_passing_sites_come_first_then_unknown_then_failing_each_by_score():
    entries = [
        _entry("fail-high", "fail", 100),
        _entry("pass-low", "pass", 10),
        _entry("unknown-mid", "unknown", 60, slope=None),
        _entry("pass-high", "pass", 90),
        _entry("fail-low", "fail", 20),
    ]
    assert rank(entries) == ["pass-high", "pass-low", "unknown-mid", "fail-high", "fail-low"]


def test_unknown_scores_rank_by_their_worst_case():
    # 'known' scores 0.40*50 + 25 + 15 = 60; 'unknown' has the same three terms but no slope: 45..60.
    known = _entry("known", "unknown", 50, slope=0.0)
    unknown = _entry("unknown", "unknown", 50, slope=None)
    assert rank([unknown, known]) == ["known", "unknown"]


def test_ties_are_broken_by_site_id_then_input_order():
    entries = [_entry("b", "pass", 50), _entry("a", "pass", 50), _entry("c", "pass", 50)]
    assert rank(entries) == ["a", "b", "c"]
    assert rank(list(reversed(entries))) == ["a", "b", "c"]
    same_id = [Rankable("x", "pass", score_site(50, 0, 0, 0), item=i) for i in range(3)]
    assert rank(same_id) == [0, 1, 2]
