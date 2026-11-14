"""Rocket equation: delta-v from specific impulse and masses.

delta-v = Isp x g0 x ln(start mass / final mass), with g0 = 9.80665 m/s^2.

Every result is labelled "our estimate": it is worked out here from the
numbers typed in, not taken from a published source. The inputs are returned
with the result so anyone can redo the sum.
"""

from __future__ import annotations

import math
from typing import Any, Dict

from .catalog import OUR_ESTIMATE, PlannerInputError, check_number, constant

STANDARD_GRAVITY = constant("standard_gravity")
FORMULA = "delta-v = Isp x 9.80665 x ln(start mass / final mass)"


def rocket_delta_v(isp_s: float, dry_mass: float, propellant_mass: float,
                   payload_mass: float = 0.0, mass_unit: str = "t") -> Dict[str, Any]:
    """Delta-v of a stage that burns all its propellant.

    Parameters
    ----------
    isp_s:
        Specific impulse in seconds.
    dry_mass, propellant_mass, payload_mass:
        Masses in any one unit (tonnes by default); only their ratio matters.
        Start mass = dry + propellant + payload. Final mass = dry + payload.
    mass_unit:
        The unit the masses were typed in, echoed back for display.

    Returns
    -------
    dict
        ``delta_v_m_s``, ``status`` (``["our estimate"]``), ``formula``,
        ``inputs`` (every number used, including g0), ``start_mass``,
        ``final_mass``, ``mass_ratio`` and a one-line ``message``.
    """
    isp = check_number(isp_s, "isp_s", allow_equal=False)
    dry = check_number(dry_mass, "dry_mass")
    propellant = check_number(propellant_mass, "propellant_mass")
    payload = check_number(payload_mass, "payload_mass")
    if not isinstance(mass_unit, str) or not mass_unit:
        raise PlannerInputError("mass_unit must be a short text such as 't' or 'kg'.")
    start = dry + propellant + payload
    final = dry + payload
    if final <= 0:
        raise PlannerInputError(
            "Final mass (dry + payload) must be more than 0; type a dry mass or a payload mass."
        )
    ratio = start / final
    delta_v = isp * STANDARD_GRAVITY * math.log(ratio)
    return {
        "delta_v_m_s": delta_v,
        "status": [OUR_ESTIMATE],
        "source": "rocket equation worked out by this module",
        "formula": FORMULA,
        "inputs": {
            "isp_s": isp,
            "dry_mass": dry,
            "propellant_mass": propellant,
            "payload_mass": payload,
            "mass_unit": mass_unit,
            "g0_m_s2": STANDARD_GRAVITY,
        },
        "start_mass": start,
        "final_mass": final,
        "mass_ratio": ratio,
        "message": (
            f"About {delta_v:,.0f} m/s (our estimate): {isp:g} s x {STANDARD_GRAVITY} m/s^2 "
            f"x ln({start:g} {mass_unit} / {final:g} {mass_unit})."
        ),
    }
