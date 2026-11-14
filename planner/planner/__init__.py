"""Common Horizon planner: hardware catalog, fit check and power arithmetic.

Plain functions, no network. Import what you need::

    from planner import list_catalog, fit_check, power_check, site_energy, rocket_delta_v
"""

from .catalog import PlannerInputError, STATUS_LABELS, get_item, list_catalog, validate_catalog
from .fit import fit_check
from .rocket import STANDARD_GRAVITY, rocket_delta_v
from .power import (
    GREEN_AT_PERCENT,
    LUNAR_MONTH_HOURS,
    dark_hours_from_percent,
    margin_percent,
    margin_status,
    power_check,
    site_energy,
)

__version__ = "0.1.0"

__all__ = [
    "GREEN_AT_PERCENT",
    "LUNAR_MONTH_HOURS",
    "PlannerInputError",
    "STANDARD_GRAVITY",
    "STATUS_LABELS",
    "dark_hours_from_percent",
    "fit_check",
    "get_item",
    "list_catalog",
    "margin_percent",
    "margin_status",
    "power_check",
    "rocket_delta_v",
    "site_energy",
    "validate_catalog",
]
