"""Compare the physics engine's Sun direction with NASA Moon Trek's Sun angle service.

THIS IS A CHECK, NOT THE ENGINE. It does for NASA Moon Trek (https://trek.nasa.gov/moon/) what
``validate_against_horizons.py`` does for JPL Horizons: the same 17 preset sites, every hour of a
year, and the angle on the sky between the engine's direction to the Sun and the direction the
other service gives. Moon Trek's angle service answers for the Sun only (it refuses the Earth).

Moon Trek is asked one month per request, one request at a time, with a pause between requests::

    GET https://trek.nasa.gov/getAzElfromT1/LTD002=Moon,<lat>,<lon>,<altKm>,<lat>,<lon>,1,1/Sun/<start>/<end>/<step s>

Every answer is kept, unchanged, in ``--answers-dir`` (``<site id>/<YYYY-MM>.xml`` plus a
``.meta.json`` with the address and the retrieval time). An answer already there is read
instead of being asked again.

The engine side is ``app.api.horizons.engine_az_el``, the function the Horizons check uses, with
the same heights (``validate_against_horizons.load_sites``). Moon Trek is given the same height in
km (site height + observer height above the 1737.4 km sphere); for the Sun, a height of a few km
moves the direction by less than 1e-6 degree.

    python backend/scripts/validate_against_moon_trek.py --kernel-dir /path/to/naif --year 2027 \\
        --answers-dir /path/outside/the/repo/moon-trek-sun-2027 \\
        --out backend/data/horizon_validation/moon_trek_sun_check_2027.json \\
        --web-out web/public/data/moon-trek-sun-check.json

The script exits with status 1 if any angle is larger than 0.05 degrees (the files are still written).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import time
import urllib.request
import xml.etree.ElementTree as ET
from datetime import UTC, datetime, timedelta
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
REPO = BACKEND.parent
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from app.physics.horizons_client import separation_deg  # noqa: E402
from scripts.validate_against_horizons import (  # noqa: E402
    dumps_compact_rows,
    load_sites,
    summarize,
    utc_text,
)

SERVICE = "https://trek.nasa.gov/getAzElfromT1"
SERVICE_NAME = "NASA Moon Trek, Sun azimuth and elevation service (getAzElfromT1)"
STEP_SECONDS = 3600
TOLERANCE_DEG = 0.05
FORMAT = "common-horizon/moon-trek-sun-check"
FORMAT_VERSION = 1
WEB_FORMAT = "common-horizon/moon-trek-sun-check-summary"
WEEKLY_COLUMNS = ["utc", "engine_az_deg", "engine_el_deg", "moon_trek_az_deg", "moon_trek_el_deg", "angle_deg"]
USER_AGENT = "common-horizon-check/1"


class MoonTrekError(RuntimeError):
    """Moon Trek did not answer, or answered without the samples asked for."""


def month_ranges(year: int) -> list[tuple[datetime, datetime]]:
    """One (first, last) hour pair per month. December ends at 1 January of the next year, 00:00,
    so the year has 8761 samples, the same period as the Horizons check."""
    ranges = []
    for month in range(1, 13):
        first = datetime(year, month, 1, tzinfo=UTC)
        following = datetime(year + (month == 12), month % 12 + 1, 1, tzinfo=UTC)
        last = following if month == 12 else following - timedelta(seconds=STEP_SECONDS)
        ranges.append((first, last))
    return ranges


def _moon_trek_time(when: datetime) -> str:
    return when.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%S")


def moon_trek_url(site: dict, first: datetime, last: datetime, step_s: int = STEP_SECONDS) -> str:
    alt_km = (site["site_height_m"] + site["observer_height_m"]) / 1000.0
    lat, lon = f"{site['latitude_deg']:.6f}", f"{site['longitude_deg']:.6f}"
    place = f"LTD002=Moon,{lat},{lon},{alt_km:.6f},{lat},{lon},1,1"
    return f"{SERVICE}/{place}/Sun/{_moon_trek_time(first)}/{_moon_trek_time(last)}/{step_s}"


def parse_moon_trek(text: str) -> list[tuple[datetime, float, float]]:
    """``(UTC time, azimuth, elevation)`` per ``<sample>``. Times come as ``2027-048T12:00:00.000000``."""
    try:
        root = ET.fromstring(text)
    except ET.ParseError as error:
        raise MoonTrekError(f"answer is not XML ({error})") from None
    rows = []
    for sample in root.iter("sample"):
        stamp, az, el = sample.findtext("time"), sample.findtext("Az"), sample.findtext("El")
        if stamp is None or az is None or el is None:
            raise MoonTrekError("a sample lacks <time>, <Az> or <El>")
        when = datetime.strptime(stamp.strip(), "%Y-%jT%H:%M:%S.%f").replace(tzinfo=UTC)
        rows.append((when, float(az), float(el)))
    if not rows:
        raise MoonTrekError("answer holds no samples")
    return rows


def fetch(url: str, timeout_s: float) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=timeout_s) as response:  # noqa: S310 (fixed https address)
        if response.status != 200:
            raise MoonTrekError(f"HTTP {response.status} from {url}")
        return response.read()


def answer(site: dict, first: datetime, last: datetime, answers_dir: Path, timeout_s: float,
           pause_s: float, fetched: list[int]) -> tuple[str, dict]:
    """The kept answer for one site and month, asking Moon Trek only when it is not kept yet."""
    folder = answers_dir / site["id"]
    stem = f"{first:%Y-%m}"
    xml_path, meta_path = folder / f"{stem}.xml", folder / f"{stem}.meta.json"
    url = moon_trek_url(site, first, last)
    if xml_path.is_file() and meta_path.is_file():
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        if meta.get("url") != url:
            raise MoonTrekError(f"{xml_path} was asked with another address; move it away to ask again")
        body = xml_path.read_bytes()
    else:
        if fetched[0]:
            time.sleep(pause_s)
        body = fetch(url, timeout_s)
        fetched[0] += 1
        folder.mkdir(parents=True, exist_ok=True)
        xml_path.write_bytes(body)
        meta = {"url": url, "retrieved_utc": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")}
        meta_path.write_text(json.dumps(meta, indent=1) + "\n", encoding="utf-8")
    meta = {**meta, "bytes": len(body), "sha256": hashlib.sha256(body).hexdigest()}
    return body.decode("iso-8859-1"), meta


def expected_times(first: datetime, last: datetime, step_s: int = STEP_SECONDS) -> list[datetime]:
    count = int((last - first).total_seconds()) // step_s + 1
    return [first + timedelta(seconds=i * step_s) for i in range(count)]


def compare(site: dict, rows: list[tuple[datetime, float, float]], engine=None) -> dict:
    """Statistics over every sample and one row per week, Moon Trek against the engine at the same times."""
    if engine is None:
        from app.api.horizons import engine_az_el as engine
    every = 7 * 24 * 3600 // STEP_SECONDS
    seps, el_diffs, weekly = [], [], []
    for i, (when, m_az, m_el) in enumerate(rows):
        e_az, e_el = engine("sun", site, when)
        sep = separation_deg((e_az, e_el), (m_az, m_el))
        seps.append(sep)
        el_diffs.append(abs(e_el - m_el))
        if i % every == 0:
            weekly.append([utc_text(when), round(e_az, 6), round(e_el, 6), m_az, m_el, round(sep, 6)])
    return {
        "samples": len(rows),
        "angle_between_directions": summarize(seps),
        "elevation_difference": summarize(el_diffs),
        "weekly_samples": {"columns": WEEKLY_COLUMNS, "rows": weekly},
    }


def web_summary(result: dict, source: str) -> dict:
    """The small copy for the website: per site, the largest Sun angle, sample count, period, retrieval."""
    period = {key: result["period"][key] for key in ("start_utc", "stop_utc", "step_minutes")}
    sites = {
        site_id: {
            "sun_max_angle_deg": entry["sun"]["angle_between_directions"]["max_deg"],
            "samples": entry["sun"]["samples"],
            "period": period,
            "retrieved_utc": max(request["retrieved_utc"] for request in entry["requests"]),
            "moon_trek_url": SERVICE,
        }
        for site_id, entry in result["sites"].items()
    }
    return {
        "format": WEB_FORMAT,
        "format_version": 1,
        "what": ("Largest angle, in degrees, between the physics engine's direction to the Sun and the direction "
                 "NASA Moon Trek's Sun angle service gives, over every hour of the period."),
        "source": source,
        "sites": sites,
    }


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--kernel-dir", default=os.environ.get("CH_SPICE_KERNEL_DIR"),
                    help="folder with the four NAIF kernels (default: $CH_SPICE_KERNEL_DIR)")
    ap.add_argument("--year", type=int, default=2027)
    ap.add_argument("--sites", default=None, help="comma-separated preset ids (default: all 17)")
    ap.add_argument("--answers-dir", required=True, help="where Moon Trek's answers are kept (outside the repo)")
    ap.add_argument("--pause-s", type=float, default=1.0, help="pause between Moon Trek requests")
    ap.add_argument("--timeout-s", type=float, default=120.0)
    ap.add_argument("--out", required=True)
    ap.add_argument("--web-out", default=None, help="also write the small summary for the website here")
    args = ap.parse_args()
    if not args.kernel_dir:
        ap.error("give --kernel-dir or set CH_SPICE_KERNEL_DIR")

    from app.physics.engine import kernel_loader

    kernel_loader.load_kernels(args.kernel_dir)
    months = month_ranges(args.year)
    start, stop = months[0][0], months[-1][1]
    expected = int((stop - start).total_seconds()) // STEP_SECONDS + 1
    sites = load_sites(args.sites.split(",") if args.sites else None)
    answers_dir = Path(args.answers_dir)

    fetched, results = [0], {}
    for site in sites:
        rows, requests = [], []
        for first, last in months:
            text, meta = answer(site, first, last, answers_dir, args.timeout_s, args.pause_s, fetched)
            month_rows = parse_moon_trek(text)
            if [row[0] for row in month_rows] != expected_times(first, last):
                raise MoonTrekError(f"{site['id']} {first:%Y-%m}: {len(month_rows)} samples, not the hours asked for")
            rows.extend(month_rows)
            requests.append({"month": f"{first:%Y-%m}", "samples": len(month_rows), **meta})
        if len(rows) != expected:
            raise MoonTrekError(f"{site['id']}: {len(rows)} samples, expected {expected}")
        entry = compare(site, rows)
        results[site["id"]] = {"site": {k: v for k, v in site.items() if k != "id"}, "sun": entry,
                               "requests": requests}
        print(f"{site['id']:18s} sun n={entry['samples']} "
              f"max angle {entry['angle_between_directions']['max_deg']:.6f} deg, "
              f"p95 {entry['angle_between_directions']['p95_deg']:.6f}, "
              f"mean {entry['angle_between_directions']['mean_deg']:.6f}, "
              f"max elevation diff {entry['elevation_difference']['max_deg']:.6f} deg", flush=True)

    out = {
        "format": FORMAT,
        "format_version": FORMAT_VERSION,
        "what": ("Angle between the direction the physics engine gives for the Sun and the direction NASA Moon "
                 "Trek's Sun angle service gives, for the same site and hour."),
        "service": {"name": SERVICE_NAME, "url": SERVICE, "home": "https://trek.nasa.gov/moon/",
                    "request": "one month per request, one request at a time, hourly samples",
                    "answers_kept": "every answer unchanged, outside the repository; sha256 and size below"},
        "engine": {"function": "app.api.horizons.engine_az_el",
                   "positions": "app.physics.engine.positions (MOON_ME, km, geometric, aberration correction NONE)",
                   "angles": "app.physics.engine.frames.get_azimuth_elevation",
                   "kernels": list(kernel_loader.SPICE_KERNELS)},
        "period": {"start_utc": utc_text(start), "stop_utc": utc_text(stop), "step_minutes": STEP_SECONDS // 60,
                   "samples_per_site": expected},
        "statistics": ("max_deg, p95_deg (value at rank 0.95 * (n - 1), rounded down) and mean_deg over every "
                       "sample: the angle on the sky between the two directions, and the absolute difference "
                       "in elevation."),
        "tolerance_deg": TOLERANCE_DEG,
        "sites": results,
    }
    text = dumps_compact_rows(out)
    Path(args.out).write_text(text, encoding="utf-8")
    print(f"wrote {args.out} ({len(text.encode('utf-8'))} bytes); {fetched[0]} requests sent to Moon Trek")

    if args.web_out:
        try:
            source = Path(args.out).resolve().relative_to(REPO).as_posix()
        except ValueError:
            source = Path(args.out).name
        Path(args.web_out).parent.mkdir(parents=True, exist_ok=True)
        Path(args.web_out).write_text(json.dumps(web_summary(out, source), indent=1) + "\n", encoding="utf-8")
        print("wrote", args.web_out)

    over = [(site_id, entry["sun"]["angle_between_directions"]["max_deg"]) for site_id, entry in results.items()
            if entry["sun"]["angle_between_directions"]["max_deg"] > TOLERANCE_DEG]
    for site_id, value in over:
        print(f"EXCEEDS {TOLERANCE_DEG} deg: {site_id} largest Sun angle {value:.6f} deg", file=sys.stderr)
    if over:
        sys.exit(1)


if __name__ == "__main__":
    main()
