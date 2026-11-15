"""Ask NASA's JPL Horizons System where the Sun or the Earth is in a lunar site's sky.

THIS IS A CHECK, NOT THE ENGINE. The physics engine works out the Sun's and the Earth's
directions from NASA NAIF SPICE kernels; JPL's Horizons System
(https://ssd.jpl.nasa.gov/horizons/) answers the same question from JPL's own service.
This module builds the Horizons query, sends it and reads the answer. It is used by
``scripts/validate_against_horizons.py`` (the stored year-long check) and by the live
comparison route ``app/api/horizons.py``.

Standard library only (``urllib``): no extra package is needed to talk to Horizons.

What is asked: apparent azimuth and elevation (quantity 4, airless, degrees) of the body for
an observer at the given east longitude, latitude and height above the 1737.4 km sphere on
the Moon (``CENTER='coord@301'``, ``COORD_TYPE='GEODETIC'``).
"""

from __future__ import annotations

import math
import urllib.error
import urllib.parse
import urllib.request
from datetime import UTC, datetime

API = "https://ssd.jpl.nasa.gov/api/horizons.api"
SERVICE_URL = "https://ssd.jpl.nasa.gov/horizons/"
DOCS_URL = "https://ssd-api.jpl.nasa.gov/doc/horizons.html"
MOON_RADIUS_KM = 1737.4
BODIES = {"sun": "10", "earth": "399"}
MONTHS = {m: i + 1 for i, m in enumerate(
    ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"])}


class HorizonsError(RuntimeError):
    """Horizons did not answer, or answered without an ephemeris table."""


def site_coord(longitude_deg: float, latitude_deg: float, site_height_m: float, observer_height_m: float) -> str:
    """The ``SITE_COORD`` value: east longitude and latitude in degrees, height in km (1 mm steps)."""
    alt_km = (site_height_m + observer_height_m) / 1000.0
    return f"{longitude_deg:.6f},{latitude_deg:.6f},{alt_km:.6f}"


def query_parameters(body: str, site: dict, start: datetime, stop: datetime, step_minutes: int) -> dict[str, str]:
    """Horizons API parameters for ``body`` ("sun" or "earth") seen from ``site``.

    ``site`` holds ``latitude_deg``, ``longitude_deg`` (east), ``site_height_m`` and
    ``observer_height_m``. Times are UTC, to the minute.
    """
    coord = site_coord(site["longitude_deg"], site["latitude_deg"], site["site_height_m"], site["observer_height_m"])
    return {
        "format": "text",
        "COMMAND": f"'{BODIES[body]}'",
        "OBJ_DATA": "'NO'",
        "MAKE_EPHEM": "'YES'",
        "EPHEM_TYPE": "'OBSERVER'",
        "CENTER": "'coord@301'",
        "COORD_TYPE": "'GEODETIC'",
        "SITE_COORD": f"'{coord}'",
        "START_TIME": f"'{start:%Y-%m-%d %H:%M}'",
        "STOP_TIME": f"'{stop:%Y-%m-%d %H:%M}'",
        "STEP_SIZE": f"'{step_minutes} m'",
        "QUANTITIES": "'4'",
        "APPARENT": "'AIRLESS'",
        "ANG_FORMAT": "'DEG'",
        "CSV_FORMAT": "'YES'",
        "TIME_DIGITS": "'MINUTES'",
    }


def query_url(params: dict[str, str]) -> str:
    return API + "?" + urllib.parse.urlencode(params)


def fetch_text(params: dict[str, str], timeout_s: float) -> str:
    """Send one query and return Horizons' text answer. Any failure becomes ``HorizonsError``."""
    try:
        with urllib.request.urlopen(query_url(params), timeout=timeout_s) as resp:  # noqa: S310 (fixed https host)
            return resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as error:
        raise HorizonsError(f"Horizons answered HTTP {error.code}") from None
    except OSError as error:  # URLError, TimeoutError and connection errors are all OSError
        cause = error.reason if isinstance(error, urllib.error.URLError) else error
        name = cause if isinstance(cause, str) else type(cause).__name__
        raise HorizonsError(f"Horizons did not answer ({name})") from None


def horizons_query(body: str, site: dict, start: datetime, stop: datetime, step_minutes: int,
                   timeout_s: float = 120.0) -> tuple[dict[str, str], str]:
    """Build, send and return (parameters, text) for one body and one site."""
    params = query_parameters(body, site, start, stop, step_minutes)
    return params, fetch_text(params, timeout_s)


def parse_horizons(text: str) -> list[tuple[datetime, float, float]]:
    """Rows of (UTC time, azimuth deg, elevation deg) from a CSV observer table."""
    if "$$SOE" not in text:
        raise HorizonsError("Horizons returned no ephemeris:\n" + text[:800])
    rows = []
    for line in text.split("$$SOE", 1)[1].split("$$EOE", 1)[0].strip().splitlines():
        cells = [c.strip() for c in line.split(",")]
        date, clock = cells[0].split()
        year, mon, day = date.split("-")
        hh, mm = clock.split(":")[:2]
        when = datetime(int(year), MONTHS[mon], int(day), int(hh), int(mm), tzinfo=UTC)
        numbers = [float(c) for c in cells[1:] if c and c.replace(".", "", 1).replace("-", "", 1).isdigit()]
        if len(numbers) < 2:
            raise HorizonsError(f"Horizons row without azimuth and elevation: {line.strip()[:120]}")
        rows.append((when, numbers[0], numbers[1]))
    return rows


def api_version(text: str) -> str | None:
    """The version from the ``API VERSION: 1.2`` line Horizons puts at the top of a text answer."""
    for line in text.splitlines():
        if line.startswith("API VERSION"):
            return line.split(":", 1)[1].strip() or None
    return None


def signature(text: str) -> dict:
    """Lines of the answer that say which service, ephemeris and site frame produced it."""
    lines = text.splitlines()
    return {
        "api_version": api_version(text),
        "ephemeris_line": next((ln.strip() for ln in lines if "Ephemeris / API" in ln), ""),
        "center_line": next((ln.strip() for ln in lines if ln.startswith("Center body name")), ""),
        "site_frame_lines": [ln.strip() for ln in lines
                             if ln.startswith(("Center geodetic", "Center cylindric", "Center radii",
                                               "Center pole/equ", "Target pole/equ"))][:4],
    }


def unit(az_deg: float, el_deg: float) -> tuple[float, float, float]:
    az, el = math.radians(az_deg), math.radians(el_deg)
    return (math.cos(el) * math.sin(az), math.cos(el) * math.cos(az), math.sin(el))


def separation_deg(a: tuple[float, float], b: tuple[float, float]) -> float:
    """Angle on the sky, degrees, between two (azimuth, elevation) directions."""
    ua, ub = unit(*a), unit(*b)
    dot = max(-1.0, min(1.0, sum(x * y for x, y in zip(ua, ub, strict=True))))
    return math.degrees(math.acos(dot))
