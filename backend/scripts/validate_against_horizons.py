"""Compare the physics engine's Sun and Earth directions with NASA's JPL Horizons System.

THIS IS A CHECK, NOT THE ENGINE. The engine works out where the Sun and the Earth are
in a landing site's sky from NASA NAIF SPICE kernels. JPL's Horizons System
(https://ssd.jpl.nasa.gov/horizons/) answers the same question from JPL's own service.
This script asks both, for a list of sites and every hour of a year, and reports how far
apart the two answers are.

It needs spiceypy (``backend/requirements.txt``), network access to
``ssd.jpl.nasa.gov``, and the four NAIF kernels in a folder outside the repository
(``backend/docs/SOURCES-horizon.md``)::

    naif0012.tls  de440s.bsp  moon_pa_de440_200625.bpc  moon_de440_250416.tf

What is compared, for each site, body and hour:

* the engine: ``app.api.horizons.engine_az_el`` (the same function the live comparison
  route uses): the body's position from ``app.physics.engine.positions`` (Moon-centred,
  MOON_ME frame, kilometres, geometric), minus the observer's position at
  1737.4 km + site height + observer height, turned into azimuth and elevation by
  ``app.physics.engine.frames``;
* Horizons: apparent azimuth and elevation (quantity 4, airless) of the same body for
  an observer at the same longitude, latitude and height on the Moon
  (``CENTER='coord@301'``), asked through ``app.physics.horizons_client``.

Heights: a site with a stored horizon profile (``backend/data/horizon/<id>.json``) takes its
``site_height_m`` and ``observer_height_m`` from it; any other site uses 0 m (the 1737.4 km
sphere) and a 2 m observer, and the output says so (``height_source``).

The two are not expected to match exactly. Horizons corrects for light time and
stellar aberration and the engine's positions are geometric, and Horizons uses its
own lunar body-fixed frame. The script reports the angle between the two directions,
so that azimuth near the zenith does not inflate the result.

One request per site and body, one at a time, with a pause between requests::

    python backend/scripts/validate_against_horizons.py --kernel-dir /path/to/naif --year 2027 \\
        --out backend/data/horizon_validation/horizons_check_2027.json \\
        --web-out web/public/data/horizons-check.json

``--sites shackleton-ridge,nobile`` limits the run to some of the preset sites. The script
exits with status 1 if any angle is larger than 0.02 degrees (the file is still written).
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from datetime import UTC, datetime
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
REPO = BACKEND.parent
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from app.physics.horizons_client import (  # noqa: E402
    API,
    BODIES,
    SERVICE_URL,
    HorizonsError,
    horizons_query,
    parse_horizons,
    separation_deg,
    signature,
)

PROFILE_DIR = BACKEND / "data" / "horizon"
DEFAULT_SITE_HEIGHT_M = 0.0
DEFAULT_OBSERVER_HEIGHT_M = 2.0
TOLERANCE_DEG = 0.02
FORMAT = "common-horizon/horizons-check"
FORMAT_VERSION = 2
WEB_FORMAT = "common-horizon/horizons-check-summary"
WEEKLY_COLUMNS = ["utc", "engine_az_deg", "engine_el_deg", "horizons_az_deg", "horizons_el_deg", "angle_deg"]

# The 17 preset sites: id, planetocentric latitude, east longitude (degrees). The same points as
# the website's preset list (web/src/api/examples/sites.json, sources in web/SOURCES-web.md).
SITES = [
    ("shackleton-ridge", -89.684, 196.739),
    ("nobile", -85.42088, 31.6218),
    ("apollo-11", 0.67416, 23.47314),
    ("apollo-12", -3.0128, 336.5781),
    ("apollo-14", -3.64589, 342.52806),
    ("apollo-15", 26.13239, 3.6333),
    ("apollo-16", -8.9734, 15.5011),
    ("apollo-17", 20.1911, 30.7723),
    ("im-1-odysseus", -80.13, 1.44),
    ("im-2-athena", -84.7906, 29.1957),
    ("blue-ghost-m1", 18.562, 61.81),
    ("im-3-reiner-gamma", 7.585, 301.275),
    ("blue-ghost-m2", -24.9, 177.4),
    ("blue-ghost-m3", 36.56, 319.28),
    ("draper-cp12", -75.0, 132.4),
    ("chandrayaan-3", -69.373, 32.319),
    ("slim", -13.316, 25.251),
]


def load_sites(ids: list[str] | None = None, profile_dir: Path = PROFILE_DIR) -> list[dict]:
    """The chosen preset sites with their heights and where the heights come from."""
    table = {site_id: (lat, lon) for site_id, lat, lon in SITES}
    wanted = ids or list(table)
    unknown = [site_id for site_id in wanted if site_id not in table]
    if unknown:
        raise ValueError(f"unknown site ids: {', '.join(unknown)}")
    out = []
    for site_id in wanted:
        lat, lon = table[site_id]
        site = {"id": site_id, "latitude_deg": lat, "longitude_deg": lon}
        profile_path = profile_dir / f"{site_id}.json"
        if profile_path.is_file():
            profile = json.loads(profile_path.read_text(encoding="utf-8"))
            if profile["latitude_deg"] != lat or profile["longitude_deg"] != lon:
                raise ValueError(f"{profile_path.name} is for another point than the preset {site_id}")
            site.update(site_height_m=profile["site_height_m"], observer_height_m=profile["observer_height_m"],
                        height_source=f"backend/data/horizon/{site_id}.json")
        else:
            site.update(site_height_m=DEFAULT_SITE_HEIGHT_M, observer_height_m=DEFAULT_OBSERVER_HEIGHT_M,
                        height_source=("no stored horizon profile: 0 m site height (the 1737.4 km sphere) "
                                       "and 2 m observer height"))
        out.append(site)
    return out


def summarize(values: list[float]) -> dict:
    """Largest, 95th percentile (the value at rank 0.95 * (n - 1), rounded down) and mean."""
    ordered = sorted(values)
    return {
        "max_deg": round(ordered[-1], 6),
        "p95_deg": round(ordered[int(0.95 * (len(ordered) - 1))], 6),
        "mean_deg": round(sum(ordered) / len(ordered), 6),
    }


def utc_text(when: datetime) -> str:
    return when.strftime("%Y-%m-%dT%H:%MZ")


def compare_rows(body: str, site: dict, rows: list[tuple[datetime, float, float]], step_minutes: int,
                 engine=None) -> dict:
    """Statistics and one row per week, Horizons' rows against the engine at the same times."""
    if engine is None:
        from app.api.horizons import engine_az_el as engine
    every = max(1, 7 * 24 * 60 // step_minutes)
    seps, el_diffs, weekly = [], [], []
    for i, (when, h_az, h_el) in enumerate(rows):
        e_az, e_el = engine(body, site, when)
        sep = separation_deg((e_az, e_el), (h_az, h_el))
        seps.append(sep)
        el_diffs.append(abs(e_el - h_el))
        if i % every == 0:
            weekly.append([utc_text(when), round(e_az, 6), round(e_el, 6), round(h_az, 6), round(h_el, 6),
                           round(sep, 6)])
    return {
        "samples": len(rows),
        "angle_between_directions": summarize(seps),
        "elevation_difference": summarize(el_diffs),
        "weekly_samples": {"columns": WEEKLY_COLUMNS, "rows": weekly},
    }


def dumps_compact_rows(data: dict) -> str:
    """JSON with an indent of 1, except that each weekly row stays on one line."""
    rows: list[str] = []

    def swap(obj):
        if isinstance(obj, dict):
            return {k: ([_token(rows, r) for r in v] if k == "rows" and isinstance(v, list) else swap(v))
                    for k, v in obj.items()}
        if isinstance(obj, list):
            return [swap(item) for item in obj]
        return obj

    text = json.dumps(swap(data), indent=1)
    text = re.sub(r'"@@row(\d+)@@"', lambda m: rows[int(m.group(1))], text)
    if json.loads(text) != data:
        raise AssertionError("compact JSON writer changed the data")
    return text + "\n"


def _token(rows: list[str], row: list) -> str:
    rows.append(json.dumps(row))
    return f"@@row{len(rows) - 1}@@"


def web_summary(result: dict, source: str) -> dict:
    """The small copy for the website: per site, the largest angles, sample counts, period, retrieval, address."""
    period = {"start_utc": result["period"]["start_utc"], "stop_utc": result["period"]["stop_utc"],
              "step_minutes": result["period"]["step_minutes"]}
    sites = {}
    for site_id, entry in result["sites"].items():
        bodies = entry["bodies"]
        sites[site_id] = {
            "sun_max_angle_deg": bodies["sun"]["angle_between_directions"]["max_deg"],
            "earth_max_angle_deg": bodies["earth"]["angle_between_directions"]["max_deg"],
            "samples": {body: bodies[body]["samples"] for body in BODIES},
            "period": period,
            "retrieved_utc": max(bodies[body]["retrieved_utc"] for body in BODIES),
            "horizons_url": result["service"]["api"],
        }
    return {
        "format": WEB_FORMAT,
        "format_version": 1,
        "what": ("Largest angle, in degrees, between the physics engine's direction to the Sun and to the Earth "
                 "and the direction NASA's JPL Horizons System gives, over every hour of the period."),
        "source": source,
        "sites": sites,
    }


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--kernel-dir", default=os.environ.get("CH_SPICE_KERNEL_DIR"),
                    help="folder with the four NAIF kernels (default: $CH_SPICE_KERNEL_DIR)")
    ap.add_argument("--year", type=int, default=2027)
    ap.add_argument("--sites", default=None, help="comma-separated preset ids (default: all 17)")
    ap.add_argument("--step-minutes", type=int, default=60)
    ap.add_argument("--pause-s", type=float, default=1.0, help="pause between Horizons requests")
    ap.add_argument("--timeout-s", type=float, default=120.0)
    ap.add_argument("--out", required=True)
    ap.add_argument("--web-out", default=None, help="also write the small summary for the website here")
    args = ap.parse_args()
    if not args.kernel_dir:
        ap.error("give --kernel-dir or set CH_SPICE_KERNEL_DIR")

    from app.physics.engine import kernel_loader

    kernel_loader.load_kernels(args.kernel_dir)
    start = datetime(args.year, 1, 1, tzinfo=UTC)
    stop = datetime(args.year + 1, 1, 1, tzinfo=UTC)
    expected = int((stop - start).total_seconds() // 60) // args.step_minutes + 1
    sites = load_sites(args.sites.split(",") if args.sites else None)

    first_signature, versions, results, requests = None, set(), {}, 0
    for site in sites:
        results[site["id"]] = {"site": {k: v for k, v in site.items() if k != "id"}, "bodies": {}}
        for body in BODIES:
            if requests:
                time.sleep(args.pause_s)
            requests += 1
            params, text = horizons_query(body, site, start, stop, args.step_minutes, timeout_s=args.timeout_s)
            retrieved = utc_text(datetime.now(UTC))
            rows = parse_horizons(text)
            if len(rows) != expected or rows[0][0] != start or rows[-1][0] != stop:
                raise HorizonsError(f"{site['id']} {body}: {len(rows)} rows from Horizons, expected {expected}")
            sig = signature(text)
            first_signature = first_signature or sig
            versions.add(sig["api_version"])
            entry = compare_rows(body, site, rows, args.step_minutes)
            entry["retrieved_utc"] = retrieved
            entry["horizons_query"] = {k: v.strip("'") for k, v in params.items()}
            results[site["id"]]["bodies"][body] = entry
            print(f"{site['id']:18s} {body:5s} n={entry['samples']} "
                  f"max angle {entry['angle_between_directions']['max_deg']:.6f} deg, "
                  f"max elevation diff {entry['elevation_difference']['max_deg']:.6f} deg", flush=True)

    out = {
        "format": FORMAT,
        "format_version": FORMAT_VERSION,
        "what": ("Angle between the direction the physics engine gives for the Sun and the Earth and the "
                 "direction NASA's JPL Horizons System gives, for the same site and hour."),
        "changes_from_version_1": ("17 preset sites instead of 3; every hour of a whole year instead of 30 days; "
                                   "one sample per week stored as rows under fixed columns; statistics to 1e-6 "
                                   "degree; retrieval time and query kept per site and body; heights recorded "
                                   "per site with their source."),
        "service": {"name": "JPL Horizons System", "url": SERVICE_URL, "api": API,
                    "api_versions": sorted(v for v in versions if v), "signature_of_first_answer": first_signature},
        "engine": {"function": "app.api.horizons.engine_az_el",
                   "positions": "app.physics.engine.positions (MOON_ME, km, geometric, aberration correction NONE)",
                   "angles": "app.physics.engine.frames.get_azimuth_elevation",
                   "kernels": list(kernel_loader.SPICE_KERNELS)},
        "period": {"start_utc": utc_text(start), "stop_utc": utc_text(stop), "step_minutes": args.step_minutes,
                   "samples_per_site_and_body": expected},
        "statistics": ("max_deg, p95_deg (value at rank 0.95 * (n - 1), rounded down) and mean_deg over every "
                       "sample: the angle on the sky between the two directions, and the absolute difference "
                       "in elevation."),
        "tolerance_deg": TOLERANCE_DEG,
        "expected_differences": ("Horizons corrects for light time and stellar aberration and the engine's positions "
                                 "are geometric; Horizons uses its own lunar body-fixed frame. Small differences "
                                 "are expected. Terrain is not part of this check."),
        "sites": results,
    }
    text = dumps_compact_rows(out)
    Path(args.out).write_text(text, encoding="utf-8")
    print(f"wrote {args.out} ({len(text.encode('utf-8'))} bytes)")

    if args.web_out:
        try:
            source = Path(args.out).resolve().relative_to(REPO).as_posix()
        except ValueError:
            source = Path(args.out).name
        Path(args.web_out).parent.mkdir(parents=True, exist_ok=True)
        Path(args.web_out).write_text(json.dumps(web_summary(out, source), indent=1) + "\n", encoding="utf-8")
        print("wrote", args.web_out)

    over = [(site_id, body, entry["angle_between_directions"]["max_deg"])
            for site_id, site_entry in results.items() for body, entry in site_entry["bodies"].items()
            if max(entry["angle_between_directions"]["max_deg"], entry["elevation_difference"]["max_deg"])
            > TOLERANCE_DEG]
    for site_id, body, value in over:
        print(f"EXCEEDS {TOLERANCE_DEG} deg: {site_id} {body} largest angle {value:.6f} deg", file=sys.stderr)
    if over:
        sys.exit(1)


if __name__ == "__main__":
    main()
