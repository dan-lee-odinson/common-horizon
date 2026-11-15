"""Compare the physics engine's Sun and Earth directions with NASA's JPL Horizons System.

THIS IS A CHECK, NOT THE ENGINE. The engine works out where the Sun and the Earth are
in a landing site's sky from NASA NAIF SPICE kernels. JPL's Horizons System
(https://ssd.jpl.nasa.gov/horizons/) answers the same question from JPL's own service.
This script asks both, for the same sites and the same hours, and reports how far
apart the two answers are.

It needs spiceypy (``backend/requirements-tools.txt``), network access to
``ssd.jpl.nasa.gov``, and the four NAIF kernels in a folder outside the repository
(``backend/docs/SOURCES-horizon.md``)::

    naif0012.tls  de440s.bsp  moon_pa_de440_200625.bpc  moon_de440_250416.tf

What is compared, for each site and each hour:

* the engine: the body's position from ``app.physics.engine.positions`` (Moon-centred,
  MOON_ME frame, kilometres, geometric), minus the observer's position at
  1737.4 km + site height + observer height, turned into azimuth and elevation by
  ``app.physics.engine.frames``;
* Horizons: apparent azimuth and elevation (quantity 4, airless) of the same body for
  an observer at the same longitude, latitude and height on the Moon
  (``CENTER='coord@301'``).

The two are not expected to match exactly. Horizons corrects for light time and
stellar aberration and the engine's positions are geometric, and Horizons uses its
own lunar body-fixed frame. The script reports the angle between the two directions,
so that azimuth near the zenith does not inflate the result.

    python backend/scripts/validate_against_horizons.py --kernel-dir /path/to/naif \\
        --out backend/data/horizon_validation/horizons_check_2027.json
"""

from __future__ import annotations

import argparse
import json
import math
import sys
import urllib.parse
import urllib.request
from datetime import UTC, datetime, timedelta
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

API = "https://ssd.jpl.nasa.gov/api/horizons.api"
MOON_RADIUS_KM = 1737.4
BODIES = {"sun": "10", "earth": "399"}
MONTHS = {m: i + 1 for i, m in enumerate(
    ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"])}

# Site heights are metres above the 1737.4 km sphere. The two polar sites take theirs
# from the stored horizon profiles; Apollo 11 uses the sphere itself, because no height
# for it is stored in this repository.
SITES = [
    {"id": "shackleton-ridge", "profile": "shackleton-ridge.json"},
    {"id": "nobile", "profile": "nobile.json"},
    {"id": "apollo-11", "latitude_deg": 0.67416, "longitude_deg": 23.47314,
     "site_height_m": 0.0, "observer_height_m": 2.0},
]


def load_sites() -> list[dict]:
    out = []
    for site in SITES:
        if "profile" in site:
            p = json.loads((BACKEND / "data" / "horizon" / site["profile"]).read_text(encoding="utf-8"))
            out.append({"id": site["id"], "latitude_deg": p["latitude_deg"],
                        "longitude_deg": p["longitude_deg"], "site_height_m": p["site_height_m"],
                        "observer_height_m": p["observer_height_m"]})
        else:
            out.append(dict(site))
    return out


def horizons_query(body: str, site: dict, start: datetime, stop: datetime, step_minutes: int) -> tuple[dict, str]:
    alt_km = (site["site_height_m"] + site["observer_height_m"]) / 1000.0
    params = {
        "format": "text",
        "COMMAND": f"'{BODIES[body]}'",
        "OBJ_DATA": "'NO'",
        "MAKE_EPHEM": "'YES'",
        "EPHEM_TYPE": "'OBSERVER'",
        "CENTER": "'coord@301'",
        "COORD_TYPE": "'GEODETIC'",
        "SITE_COORD": f"'{site['longitude_deg']:.6f},{site['latitude_deg']:.6f},{alt_km:.6f}'",
        "START_TIME": f"'{start:%Y-%m-%d %H:%M}'",
        "STOP_TIME": f"'{stop:%Y-%m-%d %H:%M}'",
        "STEP_SIZE": f"'{step_minutes} m'",
        "QUANTITIES": "'4'",
        "APPARENT": "'AIRLESS'",
        "ANG_FORMAT": "'DEG'",
        "CSV_FORMAT": "'YES'",
        "TIME_DIGITS": "'MINUTES'",
    }
    url = API + "?" + urllib.parse.urlencode(params)
    with urllib.request.urlopen(url, timeout=120) as resp:  # noqa: S310 (fixed https host)
        text = resp.read().decode("utf-8", errors="replace")
    return params, text


def parse_horizons(text: str) -> list[tuple[datetime, float, float]]:
    if "$$SOE" not in text:
        raise RuntimeError("Horizons returned no ephemeris:\n" + text[:800])
    rows = []
    for line in text.split("$$SOE", 1)[1].split("$$EOE", 1)[0].strip().splitlines():
        cells = [c.strip() for c in line.split(",")]
        date, clock = cells[0].split()
        year, mon, day = date.split("-")
        hh, mm = clock.split(":")[:2]
        when = datetime(int(year), MONTHS[mon], int(day), int(hh), int(mm), tzinfo=UTC)
        numbers = [float(c) for c in cells[1:] if c and c.replace(".", "", 1).replace("-", "", 1).isdigit()]
        rows.append((when, numbers[0], numbers[1]))
    return rows


def unit(az_deg: float, el_deg: float) -> tuple[float, float, float]:
    az, el = math.radians(az_deg), math.radians(el_deg)
    return (math.cos(el) * math.sin(az), math.cos(el) * math.cos(az), math.sin(el))


def separation_deg(a: tuple[float, float], b: tuple[float, float]) -> float:
    ua, ub = unit(*a), unit(*b)
    dot = max(-1.0, min(1.0, sum(x * y for x, y in zip(ua, ub, strict=True))))
    return math.degrees(math.acos(dot))


def engine_az_el(body: str, site: dict, when: datetime) -> tuple[float, float]:
    import numpy as np

    from app.physics.engine import frames, positions

    radius = MOON_RADIUS_KM + (site["site_height_m"] + site["observer_height_m"]) / 1000.0
    observer = frames.get_site_position(site["latitude_deg"], site["longitude_deg"], radius)
    getter = positions.get_sun_position if body == "sun" else positions.get_earth_position
    vector = np.array(getter(when), dtype=float) - observer
    az, el = frames.get_azimuth_elevation(vector, site["latitude_deg"], site["longitude_deg"])
    return float(az), float(el)


def summarize(values: list[float]) -> dict:
    ordered = sorted(values)
    return {
        "max_deg": round(ordered[-1], 5),
        "p95_deg": round(ordered[int(0.95 * (len(ordered) - 1))], 5),
        "mean_deg": round(sum(ordered) / len(ordered), 5),
    }


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--kernel-dir", required=True)
    ap.add_argument("--start", default="2027-02-15T00:00")
    ap.add_argument("--days", type=int, default=30)
    ap.add_argument("--step-minutes", type=int, default=60)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    from app.physics.engine import kernel_loader

    kernel_loader.load_kernels(args.kernel_dir)
    start = datetime.fromisoformat(args.start).replace(tzinfo=UTC)
    stop = start + timedelta(days=args.days)

    signature = None
    results = {}
    for site in load_sites():
        results[site["id"]] = {"site": site, "bodies": {}}
        for body in BODIES:
            params, text = horizons_query(body, site, start, stop, args.step_minutes)
            rows = parse_horizons(text)
            if signature is None:
                signature = {
                    "api_version": next((ln.strip() for ln in text.splitlines() if ln.startswith("API VERSION")), ""),
                    "ephemeris_line": next((ln.strip() for ln in text.splitlines() if "Ephemeris / API" in ln), ""),
                    "center_line": next((ln.strip() for ln in text.splitlines() if ln.startswith("Center body name")), ""),
                    "site_frame_lines": [ln.strip() for ln in text.splitlines()
                                         if ln.startswith(("Center geodetic", "Center cylindric", "Center radii",
                                                           "Center pole/equ", "Target pole/equ"))][:4],
                }
            seps, el_diffs, sample = [], [], []
            for i, (when, h_az, h_el) in enumerate(rows):
                e_az, e_el = engine_az_el(body, site, when)
                sep = separation_deg((e_az, e_el), (h_az, h_el))
                seps.append(sep)
                el_diffs.append(abs(e_el - h_el))
                if i % 120 == 0:
                    sample.append({"utc": when.strftime("%Y-%m-%dT%H:%MZ"),
                                   "engine_az_el_deg": [round(e_az, 4), round(e_el, 4)],
                                   "horizons_az_el_deg": [round(h_az, 4), round(h_el, 4)],
                                   "separation_deg": round(sep, 5)})
            results[site["id"]]["bodies"][body] = {
                "samples": len(rows),
                "angle_between_directions": summarize(seps),
                "elevation_difference": summarize(el_diffs),
                "every_120th_sample": sample,
                "horizons_parameters": {k: v.strip("'") for k, v in params.items()},
            }
            print(f"{site['id']:18s} {body:5s} n={len(rows)} "
                  f"max sep {max(seps):.5f} deg, max elevation diff {max(el_diffs):.5f} deg")

    out = {
        "format": "common-horizon/horizons-check",
        "format_version": 1,
        "what": ("Angle between the direction the physics engine gives for the Sun and the Earth and the "
                 "direction NASA's JPL Horizons System gives, for the same site and hour."),
        "service": {"name": "JPL Horizons System", "url": "https://ssd.jpl.nasa.gov/horizons/",
                    "api": API, "retrieved_utc": datetime.now(UTC).strftime("%Y-%m-%dT%H:%MZ"),
                    "signature": signature},
        "engine": {"positions": "app.physics.engine.positions (MOON_ME, km, geometric, aberration correction NONE)",
                   "angles": "app.physics.engine.frames.get_azimuth_elevation",
                   "kernels": ["naif0012.tls", "de440s.bsp", "moon_pa_de440_200625.bpc", "moon_de440_250416.tf"]},
        "window": {"start_utc": start.strftime("%Y-%m-%dT%H:%MZ"), "days": args.days,
                   "step_minutes": args.step_minutes},
        "expected_differences": ("Horizons corrects for light time and stellar aberration and the engine's positions "
                                 "are geometric; Horizons uses its own lunar body-fixed frame. Small differences "
                                 "are expected. Terrain is not part of this check."),
        "sites": results,
    }
    Path(args.out).write_text(json.dumps(out, indent=1) + "\n", encoding="utf-8")
    print("wrote", args.out)


if __name__ == "__main__":
    main()
