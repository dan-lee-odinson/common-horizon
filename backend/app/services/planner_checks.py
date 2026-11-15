"""Calls the planner's ``fit_check``, ``power_check`` and ``site_energy`` and maps their answers onto
the website's ``CheckResponse`` blocks. No arithmetic of its own: every number is the planner's.
"""

from dataclasses import dataclass
from typing import Any

from app.models.website import DayCheck, NightCheck, PowerBalance, SiteEnergy
from app.planner_bridge import planner
from app.services.catalog import PlannerSelection

# The planner's night "basis" sentences, shortened as web/src/api/types.ts names them.
NIGHT_BASIS = {
    "energy over the longest darkness": "energy",
    "power: sources in darkness carry the night": "power",
    "power (no darkness duration given)": "power only",
    "no darkness": "no darkness",
}


@dataclass(frozen=True)
class FitResult:
    fits: bool | None
    verdict: str
    notes: list[str]


@dataclass(frozen=True)
class PowerResult:
    day: DayCheck
    night: NightCheck
    balance: PowerBalance
    notes: list[str]


def fit(selection: PlannerSelection) -> FitResult:
    """Does the payload fit the lander? ``planner.fit_check`` needs a lander and at least one payload."""
    if selection.lander is None:
        note = "No lander chosen: choose one to carry the payload." if selection.payloads else "No lander chosen."
        return FitResult(fits=False, verdict="no lander", notes=[note])
    if not selection.payloads:
        name = planner.get_item("landers", selection.lander)["name"]
        return FitResult(fits=True, verdict="nothing to fit", notes=[f"{name}: no payload chosen, nothing to fit."])
    result = planner.fit_check(selection.lander, selection.payloads)
    return FitResult(fits=result["fits"], verdict=result["verdict"], notes=list(result["messages"]))


def power(selection: PlannerSelection, storage_kwh: float, longest_darkness_h: float | None) -> PowerResult:
    """``planner.power_check``; raises ``planner.PlannerInputError`` when the planner cannot answer."""
    result: dict[str, Any] = planner.power_check(
        selection.loads, selection.sources, storage_kwh=storage_kwh, longest_darkness_h=longest_darkness_h
    )
    day, night, balance = result["day"], result["night"], result["balance"]
    return PowerResult(
        day=DayCheck(
            needed=day["status"] != "none",
            generation_kw=day["available"],
            load_kw=day["load_kw"],
            refill_kw=day["refill_kw"],
            refill_kwh=day["refill_kwh"],
            refill_hours=day["refill_hours"],
            margin_percent=day["margin_percent"],
            status=day["status"],
            passes=day["passes"],
        ),
        night=NightCheck(
            needed=night["status"] != "none",
            basis=NIGHT_BASIS[night["basis"]],
            generation_kw=night["sources_kw"],
            load_kw=night["load_kw"],
            per_night_kwh=night["per_night_kwh"],
            longest_darkness_h=night["longest_darkness_h"],
            storage_kwh=night["storage_kwh"],
            storage_needed_kwh=night["storage_needed_kwh"],
            available_kwh=night.get("available_kwh"),
            load_kwh=night.get("load_kwh"),
            margin_percent=night["margin_percent"],
            status=night["status"],
            passes=night["passes"],
        ),
        balance=PowerBalance(
            margin_percent=balance["margin_percent"], status=balance["status"], limiting=balance["limiting"]
        ),
        notes=list(result["notes"]),
    )


def site_energy(selection: PlannerSelection, dark_hours: float, nights: int) -> SiteEnergy:
    """``planner.site_energy``: night penalty plus heating penalty over the stay's dark hours."""
    # The planner takes nights >= 1 and ignores per-night items itself when there are no dark hours.
    result = planner.site_energy(selection.loads, dark_hours=dark_hours, nights=max(1, nights))
    return SiteEnergy(
        dark_hours=result["dark_hours"],
        nights=nights,
        night_penalty_kwh=result["night_penalty_kwh"],
        heating_penalty_kwh=result["heating_penalty_kwh"],
        total_kwh=result["total_kwh"],
    )
