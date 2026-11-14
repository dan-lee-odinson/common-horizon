"""Hardware catalog: loading, lookup and the figure helpers the checks share.

The catalog lives in ``data/catalog.json``. Every figure in it is a small
dictionary with at least ``value``, ``unit``, ``status`` (a list of status
labels) and ``source``. This module reads that file once, checks its shape,
and hands out copies so a caller can never change the shared data by accident.
"""

from __future__ import annotations

import copy
import json
import math
from importlib import resources
from typing import Any, Dict, Iterable, List, Optional

STATUS_LABELS = (
    "built",
    "company figure",
    "NASA figure",
    "NASA goal",
    "NASA study",
    "university study",
    "research estimate",
    "our estimate",
)

#: Marks a number the user typed in place of a catalog default.
USER_VALUE = "user value"
USER_SOURCE = "typed by user"

#: Marks a number this package worked out from other numbers.
OUR_ESTIMATE = "our estimate"

SECTIONS = (
    "status_labels",
    "default_rule",
    "landers",
    "payloads",
    "power_loads",
    "power_sources",
    "storage",
    "heating",
    "margin_rule",
    "constants",
    "reference",
)


class PlannerInputError(ValueError):
    """Raised when a caller passes something the planner cannot use.

    The message is written for a person: it says what was wrong and what to
    type instead. A web backend can return it as a 400 response.
    """


def _read_catalog() -> Dict[str, Any]:
    path = resources.files("planner").joinpath("data/catalog.json")
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


_CATALOG: Dict[str, Any] = _read_catalog()


# ---------------------------------------------------------------------------
# Public catalog access
# ---------------------------------------------------------------------------

def list_catalog(section: Optional[str] = None) -> Any:
    """Return the hardware catalog, or one section of it, as plain data.

    With no argument the whole catalog comes back as a dictionary with the
    keys ``status_labels``, ``default_rule``, ``landers``, ``payloads``,
    ``power_loads``, ``power_sources``, ``storage``, ``heating``,
    ``margin_rule``, ``constants`` and ``reference``.

    The result is a deep copy, so it is safe to change or to turn into JSON.
    """
    if section is None:
        return copy.deepcopy(_CATALOG)
    if section not in SECTIONS:
        raise PlannerInputError(
            f"Unknown catalog section {section!r}. Choose one of: {', '.join(SECTIONS)}."
        )
    return copy.deepcopy(_CATALOG[section])


def get_item(section: str, item_id: str) -> Dict[str, Any]:
    """Return one catalog entry (a copy) by section and id."""
    entries = _CATALOG.get(section)
    if not isinstance(entries, list):
        raise PlannerInputError(
            f"Section {section!r} has no list of items to look up."
        )
    for entry in entries:
        if entry["id"] == item_id:
            return copy.deepcopy(entry)
    known = ", ".join(entry["id"] for entry in entries)
    raise PlannerInputError(
        f"Unknown id {item_id!r} in {section}. Known ids: {known}."
    )


def constant(name: str) -> float:
    """Return the value of a named constant, such as ``lunar_month_hours``."""
    return float(_CATALOG["constants"][name]["value"])


def heating_figure(name: str) -> Dict[str, Any]:
    """Return one heating figure (a copy), such as ``heat_leak``."""
    return copy.deepcopy(_CATALOG["heating"][name])


def margin_rule() -> Dict[str, Any]:
    """Return the green-margin rule figure (a copy)."""
    return copy.deepcopy(_CATALOG["margin_rule"]["green_at_percent"])


# ---------------------------------------------------------------------------
# Figure helpers
# ---------------------------------------------------------------------------

_POWER_TO_KW = {"W": 0.001, "kW": 1.0}
_ENERGY_TO_KWH = {"Wh": 0.001, "kWh": 1.0}


def figure_value(fig: Dict[str, Any]) -> Optional[float]:
    """Return the number a check should use for a figure.

    A plain number is returned as it is. A published range returns its
    ``default`` end. A figure that is not published returns ``None``.
    """
    value = fig.get("value")
    if value is None:
        return None
    if isinstance(value, list):
        if "default" not in fig:
            raise PlannerInputError(
                "This figure is a range or size with no default; it cannot be used in a check."
            )
        return float(fig["default"])
    return float(value)


def power_kw(fig: Dict[str, Any]) -> Optional[float]:
    """Return a power figure in kilowatts."""
    value = figure_value(fig)
    if value is None:
        return None
    return value * _POWER_TO_KW[fig["unit"]]


def energy_kwh(fig: Dict[str, Any]) -> Optional[float]:
    """Return an energy figure in kilowatt-hours."""
    value = figure_value(fig)
    if value is None:
        return None
    return value * _ENERGY_TO_KWH[fig["unit"]]


def provenance(fig: Dict[str, Any]) -> Dict[str, Any]:
    """Return the label part of a figure: status, source and any notes."""
    out: Dict[str, Any] = {
        "status": list(fig.get("status", [])),
        "source": fig.get("source"),
    }
    for key in ("status_note", "qualifier", "note", "kind"):
        if key in fig:
            out[key] = fig[key]
    if isinstance(fig.get("value"), list):
        out["published_value"] = list(fig["value"])
    return out


def user_provenance(note: Optional[str] = None) -> Dict[str, Any]:
    """Provenance for a number the user typed."""
    out: Dict[str, Any] = {"status": [USER_VALUE], "source": USER_SOURCE}
    if note:
        out["note"] = note
    return out


def check_number(value: Any, name: str, *, minimum: float = 0.0,
                 allow_equal: bool = True) -> float:
    """Check that a typed value is a finite number at or above ``minimum``."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise PlannerInputError(f"{name} must be a number, not {value!r}.")
    number = float(value)
    if not math.isfinite(number):
        raise PlannerInputError(f"{name} must be a finite number, not {value!r}.")
    if number < minimum or (not allow_equal and number == minimum):
        relation = "at least" if allow_equal else "more than"
        raise PlannerInputError(f"{name} must be {relation} {minimum:g}, not {value!r}.")
    return number


def check_count(value: Any, name: str = "count") -> int:
    """Check that a typed count is a whole number of one or more."""
    if isinstance(value, bool) or not isinstance(value, int) or value < 1:
        raise PlannerInputError(f"{name} must be a whole number of 1 or more, not {value!r}.")
    return value


# ---------------------------------------------------------------------------
# Self-check of the data file
# ---------------------------------------------------------------------------

def _iter_figures(catalog: Dict[str, Any]) -> Iterable[tuple]:
    """Yield (path, figure) for every figure in the catalog."""
    for lander in catalog["landers"]:
        for option in lander["capacity_options"]:
            yield f"landers/{lander['id']}/capacity/{option['option']}", option
        for key, fig in lander["dimensions"].items():
            yield f"landers/{lander['id']}/dimensions/{key}", fig
        for key, fig in lander["other_figures"].items():
            yield f"landers/{lander['id']}/{key}", fig
    for payload in catalog["payloads"]:
        yield f"payloads/{payload['id']}/mass", payload["mass"]
        for key, fig in payload["dimensions"].items():
            yield f"payloads/{payload['id']}/dimensions/{key}", fig
    for load in catalog["power_loads"]:
        for key in ("power", "energy_per_night", "energy_per_drive_day"):
            if key in load:
                yield f"power_loads/{load['id']}/{key}", load[key]
        for key, fig in load.get("power_options", {}).items():
            yield f"power_loads/{load['id']}/power_options/{key}", fig
    for source in catalog["power_sources"]:
        yield f"power_sources/{source['id']}/power", source["power"]
    for key, fig in catalog["heating"].items():
        if isinstance(fig, dict):
            yield f"heating/{key}", fig
    for key, fig in catalog["margin_rule"].items():
        yield f"margin_rule/{key}", fig
    for key, fig in catalog["constants"].items():
        yield f"constants/{key}", fig
    for ref in catalog["reference"]:
        yield f"reference/{ref['id']}", ref["figure"]


def validate_catalog(catalog: Optional[Dict[str, Any]] = None) -> List[str]:
    """Check every figure in the catalog and return a list of problems.

    An empty list means the data is well formed: every figure has a unit, a
    source, and status labels drawn only from the eight allowed labels (or an
    explicit note saying why no label applies), and every range used in a
    check names its default end.
    """
    data = _CATALOG if catalog is None else catalog
    problems: List[str] = []
    if tuple(data.get("status_labels", ())) != STATUS_LABELS:
        problems.append("status_labels do not match the eight allowed labels")
    seen_ids = set()
    for section in ("landers", "payloads", "power_loads", "power_sources", "reference"):
        for entry in data[section]:
            if entry["id"] in seen_ids:
                problems.append(f"duplicate id {entry['id']}")
            seen_ids.add(entry["id"])
    for path, fig in _iter_figures(data):
        if "unit" not in fig:
            problems.append(f"{path}: no unit")
        if not fig.get("source"):
            problems.append(f"{path}: no source")
        status = fig.get("status")
        if not isinstance(status, list):
            problems.append(f"{path}: status must be a list")
            continue
        for label in status:
            if label not in STATUS_LABELS:
                problems.append(f"{path}: unknown status label {label!r}")
        if not status and not fig.get("status_note"):
            problems.append(f"{path}: no status label and no status_note")
        value = fig.get("value")
        if isinstance(value, list):
            if fig.get("kind") not in ("range", "size"):
                problems.append(f"{path}: a list value needs kind 'range' or 'size'")
            if fig.get("kind") == "range" and "default" in fig:
                low, high = min(value), max(value)
                if not low <= fig["default"] <= high:
                    problems.append(f"{path}: default lies outside the range")
        elif value is None:
            if "not published" not in (fig.get("note", "") + fig.get("status_note", "")).lower():
                problems.append(f"{path}: a missing value must say 'not published'")
        elif isinstance(value, bool) or not isinstance(value, (int, float)):
            problems.append(f"{path}: value must be a number, a list or null")
    for load in data["power_loads"]:
        if load["runs"] not in ("always", "dark", "light"):
            problems.append(f"power_loads/{load['id']}: runs must be always, dark or light")
        if "power_options" in load and load.get("default_option") not in load["power_options"]:
            problems.append(f"power_loads/{load['id']}: default_option is not one of power_options")
    for source in data["power_sources"]:
        if source["works"] not in ("always", "dark", "light"):
            problems.append(f"power_sources/{source['id']}: works must be always, dark or light")
    return problems


_PROBLEMS = validate_catalog()
if _PROBLEMS:  # pragma: no cover - only reached if the data file is broken
    raise RuntimeError("planner catalog is malformed: " + "; ".join(_PROBLEMS))
