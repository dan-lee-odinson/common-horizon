"""Fit check: does a set of payloads fit a lander's payload-to-surface mass?

Only mass is checked. Dimensions are in the catalog for reference but are not
compared here.
"""

from __future__ import annotations

from typing import Any, Dict, Iterable, List, Optional, Union

from .catalog import (
    PlannerInputError,
    as_list,
    check_count,
    clean_spec,
    check_number,
    figure_value,
    get_item,
    provenance,
    user_provenance,
)

PayloadSpec = Union[str, Dict[str, Any]]


def _payload_line(spec: PayloadSpec) -> Dict[str, Any]:
    """Turn one payload request into a line of the result."""
    spec = clean_spec(spec, "payload")
    unknown = set(spec) - {"id", "name", "mass_kg", "count"}
    if unknown:
        raise PlannerInputError(
            f"Unknown payload field(s): {', '.join(sorted(unknown))}. "
            "Use id, name, mass_kg and count."
        )
    count = check_count(spec.get("count", 1))
    item_id = spec.get("id")
    typed_mass = spec.get("mass_kg")

    if item_id is not None:
        entry = get_item("payloads", item_id)
        name = spec.get("name", entry["name"])
        fig = entry["mass"]
    else:
        if not spec.get("name"):
            raise PlannerInputError(
                "A payload without an id needs a name and a mass_kg."
            )
        name = spec["name"]
        fig = None

    line: Dict[str, Any] = {"id": item_id, "name": name, "count": count}
    if typed_mass is not None:
        mass = check_number(typed_mass, f"mass_kg for {name}")
        line.update(unit_mass_kg=mass, mass_from="user", mass_figure=user_provenance())
    elif fig is not None and figure_value(fig) is not None:
        line.update(unit_mass_kg=figure_value(fig), mass_from="catalog",
                    mass_figure=provenance(fig))
    else:
        line.update(unit_mass_kg=None, mass_from=None,
                    mass_figure=provenance(fig) if fig else None)
        example = (f"{{'id': '{item_id}', 'mass_kg': <kg>}}" if item_id
                   else f"{{'name': '{name}', 'mass_kg': <kg>}}")
        line["message"] = (
            f"Mass not published for {name}. Type a value, for example {example}."
        )
    line["missing"] = line["unit_mass_kg"] is None
    line["line_mass_kg"] = (None if line["missing"]
                            else line["unit_mass_kg"] * count)
    return line


def _capacity_checks(lander: Optional[str], capacity_kg: Any,
                     capacity_option: Optional[str]) -> tuple:
    """Return (lander description, list of capacity figures to check)."""
    if lander is None and capacity_kg is None:
        raise PlannerInputError("Give a lander id, or type capacity_kg.")
    entry = get_item("landers", lander) if lander is not None else None
    lander_info = {
        "id": lander,
        "name": entry["name"] if entry else "Custom lander",
    }
    if capacity_kg is not None:
        if capacity_option is not None:
            raise PlannerInputError("Give capacity_kg or capacity_option, not both.")
        value = check_number(capacity_kg, "capacity_kg", allow_equal=False)
        lander_info["name"] += f" (typed capacity {_kg(value)})"
        return lander_info, [{
            "option": "user",
            "label": "Payload to the surface (typed)",
            "capacity_kg": value,
            "capacity_figure": user_provenance(),
        }]
    options = entry["capacity_options"]
    if capacity_option is not None:
        options = [o for o in options if o["option"] == capacity_option]
        if not options:
            known = ", ".join(o["option"] for o in entry["capacity_options"])
            raise PlannerInputError(
                f"{entry['name']} has no capacity option {capacity_option!r}. "
                f"Known options: {known}."
            )
    return lander_info, [{
        "option": o["option"],
        "label": o["label"],
        "capacity_kg": figure_value(o),
        "capacity_figure": provenance(o),
    } for o in options]


def _kg(value: float) -> str:
    return f"{value:,.0f} kg"


def _capacity_text(check: Dict[str, Any]) -> str:
    """'12,000 kg, the bottom of 12,000 to 15,000 kg' for a range; '100,000 kg' otherwise."""
    published = check["capacity_figure"].get("published_value")
    if check["capacity_figure"].get("kind") == "range" and published:
        low, high = published
        return f"{_kg(check['capacity_kg'])}, the harder end of {low:,.0f} to {_kg(high)}"
    return _kg(check["capacity_kg"])


def fit_check(lander: Optional[str] = None,
              payloads: Iterable[PayloadSpec] = (),
              capacity_kg: Optional[float] = None,
              capacity_option: Optional[str] = None) -> Dict[str, Any]:
    """Check the total payload mass against a lander's payload to the surface.

    Parameters
    ----------
    lander:
        A lander id from the catalog, such as ``"blue_moon_mk1"``. May be
        ``None`` when ``capacity_kg`` is typed.
    payloads:
        A list of payloads. Each is an id string (``"astrolab_clv1"``) or a
        dictionary with any of ``id``, ``name``, ``mass_kg`` (a typed mass that
        overrides the catalog) and ``count`` (default 1). A payload that is not
        in the catalog needs ``name`` and ``mass_kg``.
    capacity_kg:
        A typed capacity that overrides the catalog.
    capacity_option:
        Pick one published capacity figure, for example ``"one_way"`` or
        ``"reusable"`` for Blue Moon Mark 2 cargo. When left out, the payload
        is checked against every published capacity figure of the lander.

    Returns
    -------
    dict
        ``fits`` (True, False, or None when the answer depends on the capacity
        figure or a mass is missing), ``spare_kg`` and ``margin_percent``
        (filled in when there is one capacity figure), ``verdict``, one entry
        in ``checks`` per capacity figure, the payload lines and messages.
        ``spare_kg`` is negative when the payload is over.
    """
    lines = [_payload_line(spec) for spec in as_list(payloads, "payloads")]
    if not lines:
        raise PlannerInputError("Give at least one payload.")
    lander_info, capacities = _capacity_checks(lander, capacity_kg, capacity_option)

    missing = [line for line in lines if line["missing"]]
    known_kg = sum(line["line_mass_kg"] for line in lines if not line["missing"])
    result: Dict[str, Any] = {
        "lander": lander_info,
        "payloads": lines,
        "known_payload_kg": known_kg,
        "missing_masses": [
            {"id": line["id"], "name": line["name"], "message": line["message"]}
            for line in missing
        ],
        "messages": ["Mass only: dimensions are not checked."],
    }

    if missing:
        result.update(payload_total_kg=None, checks=[], fits=None,
                      spare_kg=None, margin_percent=None, verdict="mass needed")
        result["messages"] = [line["message"] for line in missing] + result["messages"]
        return result

    total = known_kg
    checks = []
    for cap in capacities:
        spare = cap["capacity_kg"] - total
        checks.append({
            **cap,
            "payload_kg": total,
            "fits": total <= cap["capacity_kg"],
            "spare_kg": spare,
            "margin_percent": spare / cap["capacity_kg"] * 100.0,
        })

    result.update(payload_total_kg=total, checks=checks)
    if len(checks) == 1:
        only = checks[0]
        result.update(fits=only["fits"], spare_kg=only["spare_kg"],
                      margin_percent=only["margin_percent"],
                      verdict="fits" if only["fits"] else "does not fit")
        if only["fits"]:
            text = f"fits with {_kg(only['spare_kg'])} spare"
        else:
            text = f"does not fit: {_kg(-only['spare_kg'])} over"
        result["messages"].insert(0, f"{lander_info['name']}: {text}.")
    else:
        verdicts = {c["fits"] for c in checks}
        if verdicts == {True}:
            fits, verdict = True, "fits"
        elif verdicts == {False}:
            fits, verdict = False, "does not fit"
        else:
            fits, verdict = None, "depends on capacity figure"
        result.update(fits=fits, spare_kg=None, margin_percent=None, verdict=verdict)
        for c in checks:
            if c["fits"]:
                text = f"fits with {_kg(c['spare_kg'])} spare"
            else:
                text = f"does not fit: {_kg(-c['spare_kg'])} over"
            result["messages"].insert(
                len(result["messages"]) - 1,
                f"{lander_info['name']}, {c['label']} ({_capacity_text(c)}): {text}.",
            )
    return result
