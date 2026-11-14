"""Power arithmetic: day and night power checks, and the energy a site adds.

Words used here
---------------
* ``always`` - runs (or works) day and night.
* ``light``  - runs (or works) only in sunlight.
* ``dark``   - runs (or works) only in darkness.

Margin percent = (available - load) / available x 100.
Green at 25 or more, yellow from 0 up to 25, red when negative.
"""

from __future__ import annotations

from typing import Any, Dict, Iterable, List, Optional, Tuple, Union

from .catalog import (
    PlannerInputError,
    check_count,
    check_number,
    constant,
    energy_kwh,
    get_item,
    heating_figure,
    margin_rule,
    power_kw,
    provenance,
    user_provenance,
)

Spec = Union[str, Dict[str, Any]]

TIMES = ("always", "light", "dark")
LUNAR_MONTH_HOURS = constant("lunar_month_hours")
GREEN_AT_PERCENT = float(margin_rule()["value"])

#: Tolerance for comparing floating-point energies and powers.
_EPS = 1e-9


# ---------------------------------------------------------------------------
# Margin helpers
# ---------------------------------------------------------------------------

def margin_percent(available: float, load: float) -> Optional[float]:
    """(available - load) / available x 100, or None when nothing is available."""
    if available <= 0:
        return None
    return (available - load) / available * 100.0


def margin_status(margin: Optional[float], available: float, load: float) -> str:
    """Colour for a margin: green, yellow, red, or none when there is nothing to check."""
    if margin is None:
        return "red" if load > _EPS else "none"
    if margin >= GREEN_AT_PERCENT:
        return "green"
    if margin >= 0:
        return "yellow"
    return "red"


def dark_hours_from_percent(dark_percent: float, months: float = 1.0) -> float:
    """Dark hours for a dark share (in percent) of a number of lunar months."""
    percent = check_number(dark_percent, "dark_percent")
    if percent > 100:
        raise PlannerInputError(f"dark_percent must be 100 or less, not {dark_percent!r}.")
    span = check_number(months, "months", allow_equal=False)
    return percent / 100.0 * LUNAR_MONTH_HOURS * span


# ---------------------------------------------------------------------------
# Turning requests into lines
# ---------------------------------------------------------------------------

def _as_dict(spec: Spec, what: str) -> Dict[str, Any]:
    if isinstance(spec, str):
        return {"id": spec}
    if isinstance(spec, dict):
        return dict(spec)
    raise PlannerInputError(f"A {what} must be an id string or a dictionary, not {spec!r}.")


def _check_time(value: Any, field: str, name: str) -> str:
    if value not in TIMES:
        raise PlannerInputError(
            f"{field} for {name} must be one of {', '.join(TIMES)}, not {value!r}."
        )
    return value


def _load_line(spec: Spec) -> Dict[str, Any]:
    """Turn one load request into a line with kW, kWh per night and labels."""
    spec = _as_dict(spec, "load")
    unknown = set(spec) - {"id", "name", "count", "power_kw", "energy_per_night_kwh",
                           "runs", "use"}
    if unknown:
        raise PlannerInputError(
            f"Unknown load field(s): {', '.join(sorted(unknown))}. Use id, name, count, "
            "power_kw, energy_per_night_kwh, runs and use."
        )
    count = check_count(spec.get("count", 1))
    item_id = spec.get("id")
    entry = get_item("power_loads", item_id) if item_id is not None else None
    if entry is None and not spec.get("name"):
        raise PlannerInputError(
            "A load without an id needs a name, runs, and power_kw or energy_per_night_kwh."
        )
    name = spec.get("name", entry["name"] if entry else None)

    line: Dict[str, Any] = {"id": item_id, "name": name, "count": count}

    # When it runs.
    if "runs" in spec:
        line["runs"] = _check_time(spec["runs"], "runs", name)
        line["runs_from"] = "user"
    elif entry is not None:
        line["runs"] = entry["runs"]
        line["runs_from"] = "catalog"
    else:
        raise PlannerInputError(f"Load {name} needs runs: always, light or dark.")
    if entry is not None:
        line["runs_text"] = entry.get("runs_text")

    # Power (kW) and per-night energy (kWh).
    fig = None
    if entry is not None:
        if "power_options" in entry:
            option = spec.get("use", entry["default_option"])
            if option not in entry["power_options"]:
                raise PlannerInputError(
                    f"{name} has no power option {option!r}. "
                    f"Known options: {', '.join(entry['power_options'])}."
                )
            fig = entry["power_options"][option]
            line["option"] = option
        elif "use" in spec:
            raise PlannerInputError(f"{name} has only one power figure; leave out use.")
        else:
            fig = entry.get("power")
    elif "use" in spec:
        raise PlannerInputError("use only applies to a catalog load with power options.")

    if "power_kw" in spec:
        line["power_kw"] = check_number(spec["power_kw"], f"power_kw for {name}")
        line["power_figure"] = user_provenance()
    elif fig is not None:
        line["power_kw"] = power_kw(fig)
        line["power_figure"] = provenance(fig)
    else:
        line["power_kw"] = 0.0

    night_fig = entry.get("energy_per_night") if entry else None
    if "energy_per_night_kwh" in spec:
        line["energy_per_night_kwh"] = check_number(
            spec["energy_per_night_kwh"], f"energy_per_night_kwh for {name}")
        line["energy_figure"] = user_provenance()
    elif night_fig is not None:
        line["energy_per_night_kwh"] = energy_kwh(night_fig)
        line["energy_figure"] = provenance(night_fig)
    else:
        line["energy_per_night_kwh"] = 0.0

    if entry is None and "power_kw" not in spec and "energy_per_night_kwh" not in spec:
        raise PlannerInputError(f"Load {name} needs power_kw or energy_per_night_kwh.")

    line["total_power_kw"] = line["power_kw"] * count
    line["total_energy_per_night_kwh"] = line["energy_per_night_kwh"] * count
    return line


def _source_line(spec: Spec) -> Dict[str, Any]:
    """Turn one power-source request into a line with kW and labels."""
    spec = _as_dict(spec, "power source")
    unknown = set(spec) - {"id", "name", "count", "power_kw", "works"}
    if unknown:
        raise PlannerInputError(
            f"Unknown power source field(s): {', '.join(sorted(unknown))}. "
            "Use id, name, count, power_kw and works."
        )
    count = check_count(spec.get("count", 1))
    item_id = spec.get("id")
    entry = get_item("power_sources", item_id) if item_id is not None else None
    if entry is None and not spec.get("name"):
        raise PlannerInputError("A power source without an id needs a name, power_kw and works.")
    name = spec.get("name", entry["name"] if entry else None)
    line: Dict[str, Any] = {"id": item_id, "name": name, "count": count}

    if "works" in spec:
        line["works"] = _check_time(spec["works"], "works", name)
        line["works_from"] = "user"
    elif entry is not None:
        line["works"] = entry["works"]
        line["works_from"] = "catalog"
        line["works_text"] = entry.get("works_text")
    else:
        raise PlannerInputError(f"Power source {name} needs works: always, light or dark.")

    if "power_kw" in spec:
        line["power_kw"] = check_number(spec["power_kw"], f"power_kw for {name}")
        line["power_figure"] = user_provenance()
    elif entry is not None:
        line["power_kw"] = power_kw(entry["power"])
        line["power_figure"] = provenance(entry["power"])
    else:
        raise PlannerInputError(f"Power source {name} needs power_kw.")
    line["total_power_kw"] = line["power_kw"] * count
    return line


def _sum(lines: List[Dict[str, Any]], key: str, field: str, times: Tuple[str, ...]) -> float:
    return sum(line[key] for line in lines if line[field] in times)


# ---------------------------------------------------------------------------
# power_check
# ---------------------------------------------------------------------------

def power_check(loads: Iterable[Spec] = (),
                sources: Iterable[Spec] = (),
                storage_kwh: float = 0.0,
                longest_darkness_h: Optional[float] = None,
                refill_hours: Optional[float] = None) -> Dict[str, Any]:
    """Check that the power sources and storage carry the loads, day and night.

    Parameters
    ----------
    loads:
        Ids from ``power_loads`` or dictionaries with ``id`` plus any of
        ``count``, ``power_kw`` (typed power, overrides the catalog),
        ``energy_per_night_kwh``, ``runs`` (``always``, ``light``, ``dark``)
        and ``use`` (a named power option, such as ``"average"`` for the
        pressurized rover). A load that is not in the catalog needs ``name``,
        ``runs`` and ``power_kw`` or ``energy_per_night_kwh``.
    sources:
        Ids from ``power_sources`` or dictionaries with ``id`` plus any of
        ``count``, ``power_kw`` and ``works``. A custom source needs ``name``,
        ``power_kw`` and ``works``.
    storage_kwh:
        Typed energy storage in kWh. There is no default storage.
    longest_darkness_h:
        Longest darkness at the site in hours, from the physics engine. Without
        it the night check compares power only (storage and per-night energy
        items cannot be counted without a duration).
    refill_hours:
        Sunlit hours available to refill storage. When left out it is one
        lunar month minus the longest darkness (labelled "our estimate").

    Returns
    -------
    dict
        ``day``, ``night`` and ``balance`` blocks, each with a margin percent
        and a colour, plus the load and source lines with their labels.
    """
    if isinstance(loads, (str, dict)):
        loads = [loads]
    if isinstance(sources, (str, dict)):
        sources = [sources]
    load_lines = [_load_line(spec) for spec in loads]
    source_lines = [_source_line(spec) for spec in sources]
    storage = check_number(storage_kwh, "storage_kwh")
    notes: List[str] = []

    day_load = _sum(load_lines, "total_power_kw", "runs", ("always", "light"))
    night_load = _sum(load_lines, "total_power_kw", "runs", ("always", "dark"))
    per_night = sum(line["total_energy_per_night_kwh"] for line in load_lines)
    day_sources = _sum(source_lines, "total_power_kw", "works", ("always", "light"))
    continuous = _sum(source_lines, "total_power_kw", "works", ("always",))
    night_only = _sum(source_lines, "total_power_kw", "works", ("dark",))
    night_sources = continuous + night_only

    night: Dict[str, Any] = {
        "load_kw": night_load,
        "sources_kw": night_sources,
        "continuous_sources_kw": continuous,
        "night_only_sources_kw": night_only,
        "per_night_kwh": per_night,
        "storage_kwh": storage,
        "power_margin_percent": margin_percent(night_sources, night_load),
    }
    refill_kwh = 0.0

    if longest_darkness_h is None:
        available, load = night_sources, night_load
        margin = margin_percent(available, load)
        night.update(
            basis="power (no darkness duration given)",
            longest_darkness_h=None,
            available=available, load=load, unit="kW",
            surplus=available - load,
            storage_needed_kwh=None,
            passes=available + _EPS >= load,
        )
        if storage > 0 or per_night > 0:
            notes.append(
                "No longest_darkness_h given: storage and per-night energy items are "
                "not counted in the night check."
            )
    else:
        dark = check_number(longest_darkness_h, "longest_darkness_h")
        available = night_sources * dark + storage
        load = night_load * dark + per_night
        margin = margin_percent(available, load)
        # Order of use through the night: continuous sources, then night-only
        # sources (such as a regenerative fuel cell), then storage.
        deficit = max(0.0, load - continuous * dark)
        night_only_used = min(night_only * dark, deficit)
        storage_needed = max(0.0, deficit - night_only_used)
        refill_kwh = night_only_used + storage_needed
        night.update(
            basis="energy over the longest darkness",
            longest_darkness_h=dark,
            available=available, load=load, unit="kWh",
            surplus=available - load,
            storage_needed_kwh=storage_needed,
            night_only_sources_used_kwh=night_only_used,
            passes=storage + _EPS >= storage_needed,
        )
    night["margin_percent"] = margin
    night["status"] = margin_status(margin, night["available"], night["load"])

    # Day: sources working in sunlight against day load plus refill power.
    refill_kw = 0.0
    refill_info: Dict[str, Any] = {"refill_kwh": refill_kwh, "refill_hours": None}
    if longest_darkness_h is not None:
        if refill_hours is None:
            hours = LUNAR_MONTH_HOURS - night["longest_darkness_h"]
            refill_info["refill_hours_figure"] = {
                "status": ["our estimate"],
                "source": "one lunar month minus the longest darkness",
            }
        else:
            hours = check_number(refill_hours, "refill_hours")
            refill_info["refill_hours_figure"] = user_provenance()
        refill_info["refill_hours"] = hours
        if refill_kwh > _EPS:
            if hours <= 0:
                raise PlannerInputError(
                    "Storage must be refilled but there are no sunlit hours to do it; "
                    "type refill_hours."
                )
            refill_kw = refill_kwh / hours
    day_total = day_load + refill_kw
    day_margin = margin_percent(day_sources, day_total)
    day = {
        "basis": "power in sunlight",
        "available": day_sources,
        "load": day_total,
        "unit": "kW",
        "load_kw": day_load,
        "refill_kw": refill_kw,
        **refill_info,
        "surplus": day_sources - day_total,
        "margin_percent": day_margin,
        "status": margin_status(day_margin, day_sources, day_total),
        "passes": day_sources + _EPS >= day_total,
    }

    result = {
        "loads": load_lines,
        "sources": source_lines,
        "day": day,
        "night": night,
        "balance": _balance(day, night),
        "passes": day["passes"] and night["passes"],
        "margin_rule": margin_rule(),
        "notes": notes,
    }
    return result


def _balance(day: Dict[str, Any], night: Dict[str, Any]) -> Dict[str, Any]:
    """The worse of the day and night checks."""
    candidates = []
    for name, block in (("day", day), ("night", night)):
        if block["status"] == "none":
            continue
        rank = block["margin_percent"] if block["margin_percent"] is not None else float("-inf")
        candidates.append((rank, name, block))
    if not candidates:
        return {"margin_percent": None, "status": "none", "limiting": None}
    _, name, block = min(candidates, key=lambda item: item[0])
    return {
        "margin_percent": block["margin_percent"],
        "status": block["status"],
        "limiting": name,
    }


# ---------------------------------------------------------------------------
# site_energy
# ---------------------------------------------------------------------------

def site_energy(loads: Iterable[Spec] = (),
                dark_hours: Optional[float] = None,
                dark_percent: Optional[float] = None,
                months: float = 1.0,
                nights: int = 1,
                radiator: str = "deployed",
                uncrewed_hab_heating: Optional[bool] = None,
                heat_leak_w: Optional[float] = None,
                radiator_protection_w: Optional[float] = None) -> Dict[str, Any]:
    """Energy a site adds through its darkness: night penalty plus heating penalty.

    Night penalty = night load x dark hours + per-night items x nights.
    Heating penalty = (heat leak + radiator protection) x dark hours, for an
    uncrewed habitat; it replaces the flat 2 kW uncrewed load in darkness.

    Parameters
    ----------
    loads:
        The same load requests as :func:`power_check`.
    dark_hours:
        Dark hours at the site, from the physics engine.
    dark_percent, months:
        Instead of ``dark_hours``: the dark share in percent of ``months``
        lunar months (one lunar month = 708.73 h).
    nights:
        How many times the per-night items (such as rover keep-warm) apply.
    radiator:
        ``"deployed"`` (default, 3,840 W) or ``"stowed"`` (about 700 W).
    uncrewed_hab_heating:
        ``None`` (default) applies the heating model when ``hab_uncrewed`` is
        among the loads. ``True`` applies it once even without that load;
        ``False`` keeps the flat 2 kW instead.
    heat_leak_w, radiator_protection_w:
        Typed values that override the catalog figures.
    """
    if (dark_hours is None) == (dark_percent is None):
        raise PlannerInputError("Give exactly one of dark_hours or dark_percent.")
    if dark_hours is not None:
        hours = check_number(dark_hours, "dark_hours")
        hours_figure = user_provenance("dark hours from the physics engine")
    else:
        hours = dark_hours_from_percent(dark_percent, months)
        hours_figure = {
            "status": ["our estimate"],
            "source": f"{dark_percent}% of {months} lunar month(s) of 708.73 h",
        }
    night_count = check_count(nights, "nights")
    if radiator not in ("deployed", "stowed"):
        raise PlannerInputError(f"radiator must be 'deployed' or 'stowed', not {radiator!r}.")

    if isinstance(loads, (str, dict)):
        loads = [loads]
    lines = [_load_line(spec) for spec in loads]

    uncrewed = [line for line in lines if line["id"] == "hab_uncrewed"]
    if uncrewed_hab_heating is None:
        heating_on = bool(uncrewed)
        habs = sum(line["count"] for line in uncrewed)
    elif uncrewed_hab_heating:
        heating_on = True
        habs = max(1, sum(line["count"] for line in uncrewed))
    else:
        heating_on = False
        habs = 0

    night_lines = []
    for line in lines:
        replaced = heating_on and line["id"] == "hab_uncrewed"
        line["replaced_by_heating_model"] = replaced
        if line["runs"] in ("always", "dark") and not replaced:
            night_lines.append(line)
    night_load = sum(line["total_power_kw"] for line in night_lines)
    per_night = sum(line["total_energy_per_night_kwh"] for line in lines)
    night_penalty = night_load * hours + per_night * night_count

    leak_fig = heating_figure("heat_leak")
    rad_fig = heating_figure(f"radiator_protection_{radiator}")
    if heat_leak_w is not None:
        leak_w = check_number(heat_leak_w, "heat_leak_w")
        leak_prov = user_provenance()
    else:
        leak_w = float(leak_fig["value"])
        leak_prov = provenance(leak_fig)
    if radiator_protection_w is not None:
        rad_w = check_number(radiator_protection_w, "radiator_protection_w")
        rad_prov = user_provenance()
    else:
        rad_w = float(rad_fig["value"])
        rad_prov = provenance(rad_fig)
    heating_penalty = ((leak_w + rad_w) / 1000.0 * hours * habs) if heating_on else 0.0

    return {
        "dark_hours": hours,
        "dark_hours_figure": hours_figure,
        "nights": night_count,
        "loads": lines,
        "night_load_kw": night_load,
        "per_night_kwh": per_night,
        "night_penalty_kwh": night_penalty,
        "heating": {
            "applied": heating_on,
            "habitats": habs,
            "radiator": radiator,
            "heat_leak_w": leak_w,
            "heat_leak_figure": leak_prov,
            "radiator_protection_w": rad_w,
            "radiator_protection_figure": rad_prov,
        },
        "heating_penalty_kwh": heating_penalty,
        "total_kwh": night_penalty + heating_penalty,
    }
