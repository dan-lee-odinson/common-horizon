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
    as_list,
    check_count,
    check_number,
    clean_spec,
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

#: Where the dark hours and longest darkness come from.
_CALLER_SOURCE = "given by the caller, such as the physics engine"


# ---------------------------------------------------------------------------
# Margin helpers
# ---------------------------------------------------------------------------

def margin_percent(available: float, load: float) -> Optional[float]:
    """(available - load) / available x 100, or None when nothing is available.

    The result is rounded to 9 decimal places to remove floating-point noise,
    so 46.650000000000006 comes back as 46.65 and -1.8e-14 as 0.0.
    """
    if available <= 0:
        return None
    return round((available - load) / available * 100.0, 9) + 0.0


def margin_status(margin: Optional[float], available: float, load: float,
                  green_at: Optional[float] = None) -> str:
    """Colour for a margin: green, yellow, red, or none when there is nothing to check.

    ``green_at`` is the green line in percent; it defaults to 25 (GSFC-STD-1000
    Rev I, Table 1.06-1, Pre-Phase A).
    """
    line = GREEN_AT_PERCENT if green_at is None else green_at
    if margin is None:
        return "red" if load > _EPS else "none"
    if margin >= line:
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

def _check_time(value: Any, field: str, name: str) -> str:
    if value not in TIMES:
        raise PlannerInputError(
            f"{field} for {name} must be one of {', '.join(TIMES)}, not {value!r}."
        )
    return value


def _load_line(spec: Spec) -> Dict[str, Any]:
    """Turn one load request into a line with kW, kWh per night and labels."""
    spec = clean_spec(spec, "load")
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
        line["power_from"] = "user"
        line["power_figure"] = user_provenance()
    elif fig is not None:
        line["power_kw"] = power_kw(fig)
        line["power_from"] = "catalog"
        line["power_figure"] = provenance(fig)
    else:
        line["power_kw"] = 0.0
        line["power_from"] = None

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
    spec = clean_spec(spec, "power source")
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
# Heating model for an uncrewed habitat in darkness (shared by both checks)
# ---------------------------------------------------------------------------

def _heating(lines: List[Dict[str, Any]], mode: Optional[bool], radiator: str,
             heat_leak_w: Optional[float],
             radiator_protection_w: Optional[float]) -> Dict[str, Any]:
    """Work out the heating model and mark the habitat lines it replaces.

    In darkness an uncrewed habitat draws (heat leak + radiator protection)
    instead of its flat 2 kW. A habitat line qualifies when its power comes
    from the catalog and it runs in darkness; a typed power or a typed
    sunlight-only timing is kept as typed.
    """
    if radiator not in ("deployed", "stowed"):
        raise PlannerInputError(f"radiator must be 'deployed' or 'stowed', not {radiator!r}.")
    leak_fig = heating_figure("heat_leak")
    rad_fig = heating_figure(f"radiator_protection_{radiator}")
    if heat_leak_w is not None:
        leak_w, leak_prov = check_number(heat_leak_w, "heat_leak_w"), user_provenance()
    else:
        leak_w, leak_prov = float(leak_fig["value"]), provenance(leak_fig)
    if radiator_protection_w is not None:
        rad_w = check_number(radiator_protection_w, "radiator_protection_w")
        rad_prov = user_provenance()
    else:
        rad_w, rad_prov = float(rad_fig["value"]), provenance(rad_fig)

    qualifying = [line for line in lines
                  if line["id"] == "hab_uncrewed" and line["power_from"] == "catalog"
                  and line["runs"] in ("always", "dark")]
    if mode is None:
        applied = bool(qualifying)
        habitats = sum(line["count"] for line in qualifying)
    elif mode:
        applied = True
        habitats = max(1, sum(line["count"] for line in qualifying))
    else:
        applied, habitats = False, 0
    for line in lines:
        line["replaced_by_heating_model"] = applied and any(line is q for q in qualifying)
    power_each = (leak_w + rad_w) / 1000.0
    return {
        "applied": applied,
        "habitats": habitats,
        "radiator": radiator,
        "heat_leak_w": leak_w,
        "heat_leak_figure": leak_prov,
        "radiator_protection_w": rad_w,
        "radiator_protection_figure": rad_prov,
        "power_kw_each": power_each,
        "total_power_kw": power_each * habitats if applied else 0.0,
    }


def _night_lines(lines: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Lines that draw in darkness and are not replaced by the heating model."""
    return [line for line in lines
            if line["runs"] in ("always", "dark") and not line.get("replaced_by_heating_model")]


def _per_night_kwh(lines: List[Dict[str, Any]]) -> float:
    """Per-night energy items of the loads that run in darkness."""
    return sum(line["total_energy_per_night_kwh"] for line in lines
               if line["runs"] in ("always", "dark"))


# ---------------------------------------------------------------------------
# power_check
# ---------------------------------------------------------------------------

def power_check(loads: Iterable[Spec] = (),
                sources: Iterable[Spec] = (),
                storage_kwh: float = 0.0,
                longest_darkness_h: Optional[float] = None,
                refill_hours: Optional[float] = None,
                radiator: str = "deployed",
                uncrewed_hab_heating: Optional[bool] = None,
                heat_leak_w: Optional[float] = None,
                radiator_protection_w: Optional[float] = None,
                green_at_percent: Optional[float] = None) -> Dict[str, Any]:
    """Check that the power sources and storage carry the loads, day and night.

    Parameters
    ----------
    loads:
        Ids from ``power_loads`` or dictionaries with ``id`` plus any of
        ``count``, ``power_kw`` (typed power, overrides the catalog),
        ``energy_per_night_kwh``, ``runs`` (``always``, ``light``, ``dark``)
        and ``use`` (a named power option, such as ``"average"`` for the
        pressurized rover). A load that is not in the catalog needs ``name``,
        ``runs`` and ``power_kw`` or ``energy_per_night_kwh``. A field set to
        ``None`` counts as not typed.
    sources:
        Ids from ``power_sources`` or dictionaries with ``id`` plus any of
        ``count``, ``power_kw`` and ``works``. A custom source needs ``name``,
        ``power_kw`` and ``works``.
    storage_kwh:
        Typed energy storage in kWh. There is no default storage.
    longest_darkness_h:
        Longest darkness at the site in hours, from the physics engine. Without
        it the night check compares power only, and storage, per-night energy
        items and refill cannot be counted.
    refill_hours:
        Sunlit hours available to refill storage. When left out it is one
        lunar month minus the longest darkness (labelled "our estimate").
    radiator, uncrewed_hab_heating, heat_leak_w, radiator_protection_w:
        The heating model for an uncrewed habitat in darkness, as in
        :func:`site_energy`. By default it replaces the habitat's flat 2 kW
        at night.
    green_at_percent:
        A typed green line in percent; the default is 25.

    Returns
    -------
    dict
        ``day``, ``night`` and ``balance`` blocks, each with a margin percent
        and a colour, plus the load and source lines with their labels.
    """
    load_lines = [_load_line(spec) for spec in as_list(loads, "loads")]
    source_lines = [_source_line(spec) for spec in as_list(sources, "sources")]
    storage = check_number(storage_kwh, "storage_kwh")
    if green_at_percent is None:
        rule = margin_rule()
        green_at = GREEN_AT_PERCENT
    else:
        green_at = check_number(green_at_percent, "green_at_percent", minimum=float("-inf"))
        rule = {"value": green_at, "unit": "%", **user_provenance()}
    heating = _heating(load_lines, uncrewed_hab_heating, radiator, heat_leak_w,
                       radiator_protection_w)
    notes: List[str] = []

    day_load = _sum(load_lines, "total_power_kw", "runs", ("always", "light"))
    night_load = (sum(line["total_power_kw"] for line in _night_lines(load_lines))
                  + heating["total_power_kw"])
    per_night = _per_night_kwh(load_lines)
    day_sources = _sum(source_lines, "total_power_kw", "works", ("always", "light"))
    continuous = _sum(source_lines, "total_power_kw", "works", ("always",))
    night_only = _sum(source_lines, "total_power_kw", "works", ("dark",))
    night_sources = continuous + night_only
    power_margin = margin_percent(night_sources, night_load)

    night: Dict[str, Any] = {
        "load_kw": night_load,
        "sources_kw": night_sources,
        "continuous_sources_kw": continuous,
        "night_only_sources_kw": night_only,
        "per_night_kwh": per_night,
        "storage_kwh": storage,
        "power_margin_percent": power_margin,
        "energy_margin_percent": None,
    }
    refill_kwh = 0.0

    if longest_darkness_h is None:
        night.update(
            basis="power (no darkness duration given)",
            longest_darkness_h=None,
            available=night_sources, load=night_load, unit="kW",
            surplus=night_sources - night_load,
            storage_needed_kwh=None,
            margin_percent=power_margin,
            passes=night_sources + _EPS >= night_load,
        )
        if storage > 0 or per_night > 0 or night_only > 0 or refill_hours is not None:
            notes.append(
                "No longest_darkness_h given: storage, per-night energy items and the "
                "refill of storage and night-only sources are not counted."
            )
    else:
        dark = check_number(longest_darkness_h, "longest_darkness_h")
        if dark == 0:
            per_night = 0.0
            night["per_night_kwh"] = 0.0
            if _per_night_kwh(load_lines) > 0:
                notes.append("No darkness at this site: per-night energy items do not apply.")
        available_kwh = night_sources * dark + storage
        load_kwh = night_load * dark + per_night
        # Order of use through the night: continuous sources, then night-only
        # sources (such as a regenerative fuel cell), then storage.
        deficit = max(0.0, load_kwh - continuous * dark)
        night_only_used = min(night_only * dark, deficit)
        storage_needed = max(0.0, deficit - night_only_used)
        refill_kwh = night_only_used + storage_needed
        energy_margin = margin_percent(available_kwh, load_kwh)
        night.update(
            longest_darkness_h=dark,
            available_kwh=available_kwh,
            load_kwh=load_kwh,
            surplus_kwh=available_kwh - load_kwh,
            storage_needed_kwh=storage_needed,
            night_only_sources_used_kwh=night_only_used,
            energy_margin_percent=energy_margin,
            passes=storage + _EPS >= storage_needed,
        )
        if dark == 0:
            night.update(basis="no darkness", available=None, load=None, unit=None,
                         surplus=None, margin_percent=None)
        elif storage_needed <= _EPS:
            # The sources working in darkness carry the whole night on their
            # own, per-night items included: their power margin is the margin.
            night.update(basis="power: sources in darkness carry the night",
                         available=night_sources, load=night_load, unit="kW",
                         surplus=night_sources - night_load, margin_percent=power_margin)
        else:
            night.update(basis="energy over the longest darkness",
                         available=available_kwh, load=load_kwh, unit="kWh",
                         surplus=available_kwh - load_kwh, margin_percent=energy_margin)
    if night["basis"] == "no darkness":
        night["status"] = "none"
    else:
        night["status"] = margin_status(night["margin_percent"], night["available"],
                                        night["load"], green_at)

    # Day: sources working in sunlight against day load plus refill power.
    refill_kw = 0.0
    refill_info: Dict[str, Any] = {"refill_kwh": refill_kwh, "refill_hours": None}
    if longest_darkness_h is not None:
        if refill_hours is None:
            hours = max(0.0, LUNAR_MONTH_HOURS - night["longest_darkness_h"])
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
        "status": margin_status(day_margin, day_sources, day_total, green_at),
        "passes": day_sources + _EPS >= day_total,
    }

    return {
        "loads": load_lines,
        "sources": source_lines,
        "heating": heating,
        "day": day,
        "night": night,
        "balance": _balance(day, night),
        "passes": day["passes"] and night["passes"],
        "margin_rule": rule,
        "notes": notes,
    }


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
    worst = min(rank for rank, _, _ in candidates)
    tied = [(name, block) for rank, name, block in candidates if rank == worst]
    name, block = tied[0]
    return {
        "margin_percent": block["margin_percent"],
        "status": block["status"],
        "limiting": " and ".join(n for n, _ in tied),
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
        With zero dark hours there is no night and they do not apply.
    radiator:
        ``"deployed"`` (default, 3,840 W) or ``"stowed"`` (about 700 W).
    uncrewed_hab_heating:
        ``None`` (default) applies the heating model to ``hab_uncrewed`` when
        its power is not typed. ``True`` applies it once even without that
        load; ``False`` keeps the flat 2 kW instead.
    heat_leak_w, radiator_protection_w:
        Typed values that override the catalog figures.
    """
    if (dark_hours is None) == (dark_percent is None):
        raise PlannerInputError("Give exactly one of dark_hours or dark_percent.")
    if dark_hours is not None:
        hours = check_number(dark_hours, "dark_hours")
        hours_figure = user_provenance()
        hours_figure["source"] = _CALLER_SOURCE
    else:
        hours = dark_hours_from_percent(dark_percent, months)
        hours_figure = {
            "status": ["our estimate"],
            "source": f"{dark_percent}% of {months} lunar month(s) of 708.73 h",
        }
    night_count = check_count(nights, "nights")

    lines = [_load_line(spec) for spec in as_list(loads, "loads")]
    heating = _heating(lines, uncrewed_hab_heating, radiator, heat_leak_w,
                       radiator_protection_w)

    night_load = sum(line["total_power_kw"] for line in _night_lines(lines))
    per_night = _per_night_kwh(lines) if hours > 0 else 0.0
    night_penalty = night_load * hours + per_night * night_count
    heating_penalty = heating["total_power_kw"] * hours

    return {
        "dark_hours": hours,
        "dark_hours_figure": hours_figure,
        "nights": night_count,
        "loads": lines,
        "night_load_kw": night_load,
        "per_night_kwh": per_night,
        "night_penalty_kwh": night_penalty,
        "heating": heating,
        "heating_penalty_kwh": heating_penalty,
        "total_kwh": night_penalty + heating_penalty,
    }
