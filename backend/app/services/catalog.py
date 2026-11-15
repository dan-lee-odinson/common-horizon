"""The planner's hardware catalog in the website's shape (``GET /catalog``), and the reverse step:
the website's ``{id, count}`` choices turned into the planner's own request lists.

Every number comes from ``planner.list_catalog()``. Nothing is filled in: a figure the planner does
not have is null, and the planner's original figure (published unit, status labels, source) is kept
next to each converted number in ``figures``.
"""

from dataclasses import dataclass, field
from functools import lru_cache
from typing import Any

from app.models import limits
from app.models.website import CapacityOption, CatalogFigure, CatalogItem, CatalogResponse, HardwareChoice
from app.planner_bridge import planner

_catalog = planner.catalog  # the planner's figure helpers (figure_value, power_kw, energy_kwh)

# Published slope limits, by lander id -> id in the catalog's "reference" section. Only a figure that
# is published as a slope limit for that lander is used. Starship HLS: the crew-lander *tilt*
# threshold (HLS-R-0071, 0-8 deg) is not mapped, because tilt is not ground slope; Dan and Isabella
# to decide (see docs/WEBSITE_API.md). Blue Moon landers: no published figure in the catalog.
LANDER_SLOPE_LIMIT_REFERENCE: dict[str, str] = {"griffin": "griffin_slope"}


class HardwareChoiceError(ValueError):
    """A hardware choice the planner cannot use (unknown id, two landers, ...). Returned as 422."""


def _figure(fig: dict[str, Any]) -> CatalogFigure:
    value = fig.get("value")
    return CatalogFigure(
        value=[float(v) for v in value] if isinstance(value, list) else (None if value is None else float(value)),
        unit=fig["unit"],
        status=list(fig.get("status", [])),
        source=fig.get("source") or "",
        qualifier=fig.get("qualifier"),
        note=fig.get("note") or fig.get("status_note"),
    )


def _lander(entry: dict[str, Any], references: dict[str, dict[str, Any]]) -> CatalogItem:
    options = [
        CapacityOption(
            option=option["option"],
            label=option["label"],
            capacity_kg=_catalog.figure_value(option),
            figure=_figure(option),
        )
        for option in entry["capacity_options"]
    ]
    figures = {f"capacity_{option.option}": option.figure for option in options}
    slope = None
    reference_id = LANDER_SLOPE_LIMIT_REFERENCE.get(entry["id"])
    if reference_id is not None:
        slope_figure = references[reference_id]["figure"]
        slope = _catalog.figure_value(slope_figure)
        figures["max_slope"] = _figure(slope_figure)
    return CatalogItem(
        id=entry["id"],
        name=entry["name"],
        kind="lander",
        countable=False,
        default_count=1,
        max_count=1,
        mass_kg=None,
        capacity_kg=options[0].capacity_kg if len(options) == 1 else None,
        capacity_options=options,
        max_slope_deg=slope,
        load_day_kw=None,
        load_night_kw=None,
        gen_kw=None,
        gen_needs_sun=None,
        note=None if len(options) == 1 else "Several published payload figures: the fit check uses each of them.",
        figures=figures,
    )


def _payload(entry: dict[str, Any]) -> CatalogItem:
    return CatalogItem(
        id=entry["id"],
        name=entry["name"],
        kind="cargo",
        countable=True,
        default_count=1,
        max_count=limits.MAX_HARDWARE_COUNT,
        mass_kg=_catalog.figure_value(entry["mass"]),
        load_day_kw=None,
        load_night_kw=None,
        gen_kw=None,
        gen_needs_sun=None,
        note=entry["mass"].get("note"),
        figures={"mass": _figure(entry["mass"])},
    )


def _load(entry: dict[str, Any]) -> CatalogItem:
    figures: dict[str, CatalogFigure] = {}
    if "power_options" in entry:
        fig = entry["power_options"][entry["default_option"]]
        figures.update({f"power_{name}": _figure(option) for name, option in entry["power_options"].items()})
    else:
        fig = entry.get("power")
        if fig is not None:
            figures["power"] = _figure(fig)
    # As in the planner: a load with no power figure (keep-warm) draws only its per-night energy.
    power = _catalog.power_kw(fig) if fig is not None else 0.0
    runs = entry["runs"]
    night_fig = entry.get("energy_per_night")
    if night_fig is not None:
        figures["energy_per_night"] = _figure(night_fig)
    notes = [entry.get("runs_text"), entry.get("note"), entry.get("runs_note")]
    return CatalogItem(
        id=entry["id"],
        name=entry["name"],
        kind="load",
        countable=True,
        default_count=1,
        max_count=limits.MAX_HARDWARE_COUNT,
        mass_kg=None,
        load_day_kw=power if runs in ("always", "light") else 0.0,
        load_night_kw=power if runs in ("always", "dark") else 0.0,
        energy_per_night_kwh=_catalog.energy_kwh(night_fig) if night_fig is not None else None,
        gen_kw=None,
        gen_needs_sun=None,
        note="; ".join(n for n in notes if n) or None,
        figures=figures,
    )


def _source(entry: dict[str, Any]) -> CatalogItem:
    return CatalogItem(
        id=entry["id"],
        name=entry["name"],
        kind="power",
        countable=True,
        default_count=1,
        max_count=limits.MAX_HARDWARE_COUNT,
        mass_kg=None,
        load_day_kw=None,
        load_night_kw=None,
        gen_kw=_catalog.power_kw(entry["power"]),
        gen_needs_sun=entry["works"] == "light",
        note="; ".join(n for n in (entry.get("works_text"), entry["power"].get("note")) if n) or None,
        figures={"power": _figure(entry["power"])},
    )


@lru_cache
def website_catalog() -> CatalogResponse:
    data = planner.list_catalog()
    references = {entry["id"]: entry for entry in data["reference"]}
    items = (
        [_lander(entry, references) for entry in data["landers"]]
        + [_payload(entry) for entry in data["payloads"]]
        + [_source(entry) for entry in data["power_sources"]]
        + [_load(entry) for entry in data["power_loads"]]
    )
    return CatalogResponse(items=items, status_labels=list(data["status_labels"]))


@dataclass
class PlannerSelection:
    """The website's choices in the planner's terms."""

    lander: str | None = None
    payloads: list[dict[str, Any]] = field(default_factory=list)
    loads: list[dict[str, Any]] = field(default_factory=list)
    sources: list[dict[str, Any]] = field(default_factory=list)


def to_planner_selection(hardware: list[HardwareChoice]) -> PlannerSelection:
    """Sort ``{id, count}`` choices into lander, payloads, loads and sources. Count 0 means not chosen."""
    by_id = {item.id: item for item in website_catalog().items}
    selection = PlannerSelection()
    landers: list[str] = []
    for choice in hardware:
        item = by_id.get(choice.id)
        if item is None:
            raise HardwareChoiceError(f"Unknown hardware id {choice.id!r}. Known ids: {', '.join(sorted(by_id))}.")
        if choice.count == 0:
            continue
        if choice.count > item.max_count:
            raise HardwareChoiceError(
                f"{item.name} ({item.id}): count {choice.count} is over its maximum of {item.max_count}."
            )
        spec = {"id": item.id, "count": choice.count}
        if item.kind == "lander":
            landers.append(item.id)
        elif item.kind == "cargo":
            selection.payloads.append(spec)
        elif item.kind == "load":
            selection.loads.append(spec)
        else:
            selection.sources.append(spec)
    if len(landers) > 1:
        raise HardwareChoiceError(f"Choose one lander, not {len(landers)} ({', '.join(landers)}).")
    selection.lander = landers[0] if landers else None
    return selection


def lander_item(selection: PlannerSelection) -> CatalogItem | None:
    if selection.lander is None:
        return None
    return next(item for item in website_catalog().items if item.id == selection.lander)
