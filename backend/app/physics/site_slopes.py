"""Stored slopes of the preset landing sites (``backend/data/site_slopes.json``).

``scripts/site_slopes_from_moon_trek.py`` builds the file: for each preset site it fetches a LOLA
elevation patch from NASA Moon Trek and fits a plane to the heights within 500 m of the site.
The slope is that plane's tilt. It is a regional slope over a circle 1 km across, wider than a
lander: the ground under a lander's feet can be steeper or flatter.

The engine adapter reports a stored slope only for a request at a preset site's own coordinates
(within ``SLOPE_MATCH_DISTANCE_M``). Every other point keeps ``slope_deg = null``. Checking it
against a lander's published limit is regional terrain screening, not a touchdown safety assessment.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from pathlib import Path

from app.physics.horizon.geometry import MOON_RADIUS_M, unit_from_lat_lon

DEFAULT_SITE_SLOPES_FILE = Path(__file__).resolve().parents[2] / "data" / "site_slopes.json"

FIT_RADIUS_M = 500.0
SLOPE_DESCRIPTION = "slope of the best-fit plane to LOLA heights within 500 m (NASA Moon Trek)"
# The same description, written to sit inside parentheses (the landing-slope requirement's detail).
SLOPE_DESCRIPTION_INLINE = "slope of the best-fit plane to LOLA heights within 500 m, NASA Moon Trek"
SLOPE_SCALE_NOTE = (
    "It is a regional slope over a circle 1 km across, wider than a lander: the ground under a "
    "lander's feet can be steeper or flatter."
)
# What comparing this slope with a lander's limit is, and is not.
SCREENING_NOTE = "Regional terrain screening over a circle 1 km across, not a touchdown safety assessment."
SLOPES_NOT_INSTALLED_WARNING = "Stored site slopes are not installed, so slope_deg is null."
# A request gets a stored slope only at the preset site's own point; 1 m absorbs the rounding of
# the longitude conversions between the website (0..360) and the physics request (-180..180).
SLOPE_MATCH_DISTANCE_M = 1.0

FORMAT = "common-horizon/site-slopes"
FORMAT_VERSION = 1


class SiteSlopesError(ValueError):
    """The stored slope file is missing a field or holds a value out of range."""


@dataclass(frozen=True)
class StoredSlope:
    site_id: str
    latitude_deg: float
    lon_east_deg: float
    slope_deg: float
    fit_radius_m: float
    layer: str
    pixel_size_m: float
    heights_fitted: int
    fetch_date: str


def _distance_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    a, b = unit_from_lat_lon(lat1, lon1), unit_from_lat_lon(lat2, lon2)
    cross = (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])
    sine = math.sqrt(sum(c * c for c in cross))
    cosine = sum(x * y for x, y in zip(a, b, strict=True))
    return math.atan2(sine, cosine) * MOON_RADIUS_M


def _number(entry: dict, key: str, site_id: str, low: float, high: float) -> float:
    value = entry.get(key)
    if isinstance(value, bool) or not isinstance(value, int | float) or not low <= value <= high:
        raise SiteSlopesError(f"site {site_id!r}: {key} must be a number in [{low:g}, {high:g}]")
    return float(value)


class SiteSlopes:
    """The stored slopes, found by site position."""

    def __init__(self, slopes: list[StoredSlope]) -> None:
        self.slopes = tuple(slopes)

    @classmethod
    def from_json(cls, data: dict) -> SiteSlopes:
        if data.get("format") != FORMAT or data.get("format_version") != FORMAT_VERSION:
            raise SiteSlopesError(f"not a {FORMAT} file, version {FORMAT_VERSION}")
        sites = data.get("sites")
        if not isinstance(sites, dict) or not sites:
            raise SiteSlopesError("no sites")
        slopes = []
        for site_id, entry in sites.items():
            if not isinstance(entry, dict):
                raise SiteSlopesError(f"site {site_id!r} is not an object")
            fitted = entry.get("heights_fitted")
            if isinstance(fitted, bool) or not isinstance(fitted, int) or fitted < 3:
                raise SiteSlopesError(f"site {site_id!r}: heights_fitted must be a whole number of at least 3")
            if not isinstance(entry.get("layer"), str) or not isinstance(entry.get("fetch_date"), str):
                raise SiteSlopesError(f"site {site_id!r}: layer and fetch_date must be text")
            slopes.append(
                StoredSlope(
                    site_id=site_id,
                    latitude_deg=_number(entry, "lat", site_id, -90.0, 90.0),
                    lon_east_deg=_number(entry, "lon_east", site_id, 0.0, 360.0),
                    slope_deg=_number(entry, "slope_deg", site_id, 0.0, 90.0),
                    fit_radius_m=_number(entry, "fit_radius_m", site_id, 0.0, 100_000.0),
                    layer=entry["layer"],
                    pixel_size_m=_number(entry, "pixel_size_m", site_id, 0.0, 100_000.0),
                    heights_fitted=fitted,
                    fetch_date=entry["fetch_date"],
                )
            )
        return cls(slopes)

    @classmethod
    def load(cls, path: Path) -> SiteSlopes:
        """Raises ``OSError``, ``json.JSONDecodeError`` or ``SiteSlopesError``."""
        return cls.from_json(json.loads(path.read_text(encoding="utf-8")))

    def at(self, latitude_deg: float, longitude_deg: float) -> StoredSlope | None:
        """The stored slope of the preset site at this point, if the point is one."""
        best: tuple[float, StoredSlope] | None = None
        for slope in self.slopes:
            distance = _distance_m(latitude_deg, longitude_deg, slope.latitude_deg, slope.lon_east_deg)
            if best is None or distance < best[0]:
                best = (distance, slope)
        if best is None or best[0] > SLOPE_MATCH_DISTANCE_M:
            return None
        return best[1]
