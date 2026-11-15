"""Slopes of the 17 preset landing sites from LOLA elevation patches served by NASA Moon Trek.

For each preset site this script fetches a LOLA elevation patch around the site from Moon Trek's
subset service (a float32 GeoTIFF of heights in metres above the 1737.4 km sphere)::

    GET https://trek.nasa.gov/moon/TrekWS/rest/transform/latlon/subset/stream/tiff?src=<layer>&ulx=&uly=&lrx=&lry=

turns every pixel centre into local east/north metres around the site, keeps the heights whose
centre lies within 500 m of the site, and fits a plane ``h = a*east + b*north + c`` to them by
least squares. The slope is that plane's tilt, ``atan(hypot(a, b))``, in degrees. It is a regional
slope over a circle 1 km across, wider than a lander.

Layers, in the order they are tried:

* ``LRO_LOLA_DEM_SPole875_5mp_v04`` for a site south of 87.5 S (5 m pixels);
* ``LRO_LOLA_DEM_SPole75_30mp_v04`` for a site from 75 S to 87.5 S (30 m pixels);
* ``LRO_LOLA_DEM_Global_128ppd_v04`` otherwise, and whenever a polar patch has no-data inside the
  500 m circle.

The polar layers take the box in map metres (south polar stereographic on the 1,737,400 m sphere:
``r = 2 R tan(45 + lat/2)``, ``x = r sin(lon)``, ``y = r cos(lon)``); the box is 1,100 m wide around
the site. The global layer takes the box in whole degrees with longitudes from -180 to 180 (a box
in 0..360 comes back as no-data); it is the smallest whole-degree box that holds the same 1,100 m.

One request at a time, with a pause between requests. Every patch is kept in ``--patch-dir``
(``<site id>.<layer>.tif`` plus a ``.meta.json`` with the address and the retrieval time); a patch
already kept is read instead of being fetched again. ::

    python -I backend/scripts/site_slopes_from_moon_trek.py \\
        --patch-dir backend/data/site_slopes --out backend/data/site_slopes.json

Needs numpy and rasterio (``backend/requirements.txt``) and, for patches not kept yet, network
access to ``trek.nasa.gov``.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
REPO = BACKEND.parent
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from app.physics.site_slopes import (  # noqa: E402
    FIT_RADIUS_M,
    FORMAT,
    FORMAT_VERSION,
    SLOPE_DESCRIPTION,
    SLOPE_SCALE_NOTE,
)

SERVICE = "https://trek.nasa.gov/moon/TrekWS/rest/transform/latlon/subset/stream/tiff"
R_M = 1_737_400.0
POLAR_BOX_HALF_M = 550.0
USER_AGENT = "common-horizon-check/1"
PRESET_SITES_FILE = BACKEND / "app" / "data" / "preset_sites.json"

GLOBAL = "LRO_LOLA_DEM_Global_128ppd_v04"
SPOLE_5M = "LRO_LOLA_DEM_SPole875_5mp_v04"
SPOLE_30M = "LRO_LOLA_DEM_SPole75_30mp_v04"
GLOBAL_PIXEL_DEG = 1.0 / 128.0
# Pixel size in metres; for the global layer, along a meridian (east-west it shrinks with cos(latitude)).
PIXEL_SIZE_M = {SPOLE_5M: 5.0, SPOLE_30M: 30.0, GLOBAL: round(math.radians(GLOBAL_PIXEL_DEG) * R_M, 1)}


class PatchUnusable(ValueError):
    """The patch cannot give a slope: no-data inside the circle, or too few heights."""


def layers_for(latitude_deg: float) -> list[str]:
    """The layers to try, best first: the polar model the site lies in, then the global one."""
    if latitude_deg < -87.5:
        return [SPOLE_5M, GLOBAL]
    if latitude_deg <= -75.0:
        return [SPOLE_30M, GLOBAL]
    return [GLOBAL]


def signed_lon(lon_east: float) -> float:
    return lon_east - 360.0 if lon_east > 180.0 else lon_east


def polar_xy(latitude_deg: float, lon_east_deg: float) -> tuple[float, float]:
    """South polar stereographic map metres on the 1,737,400 m sphere."""
    r = 2.0 * R_M * math.tan(math.radians(45.0 + latitude_deg / 2.0))
    lon = math.radians(lon_east_deg)
    return r * math.sin(lon), r * math.cos(lon)


def polar_lat_lon(x, y):
    """Inverse of ``polar_xy`` (works on numpy arrays): latitude and east longitude, degrees."""
    import numpy as np

    r = np.hypot(x, y)
    return np.degrees(2.0 * np.arctan(r / (2.0 * R_M))) - 90.0, np.degrees(np.arctan2(x, y))


def request_box(layer: str, latitude_deg: float, lon_east_deg: float) -> dict[str, float | int]:
    if layer == GLOBAL:
        lon = signed_lon(lon_east_deg)
        d_lat = math.degrees(POLAR_BOX_HALF_M / R_M)
        d_lon = math.degrees(POLAR_BOX_HALF_M / (R_M * math.cos(math.radians(latitude_deg))))
        west, east = math.floor(lon - d_lon), math.ceil(lon + d_lon)
        south, north = math.floor(latitude_deg - d_lat), math.ceil(latitude_deg + d_lat)
        if west < -180 or east > 180 or south < -90 or north > 90:
            raise ValueError("the box would cross the 180 degree meridian or a pole")
        return {"ulx": west, "uly": north, "lrx": east, "lry": south}
    x, y = polar_xy(latitude_deg, lon_east_deg)
    h = POLAR_BOX_HALF_M
    return {"ulx": round(x - h, 3), "uly": round(y + h, 3), "lrx": round(x + h, 3), "lry": round(y - h, 3)}


def request_url(layer: str, latitude_deg: float, lon_east_deg: float) -> str:
    return f"{SERVICE}?{urllib.parse.urlencode({'src': layer, **request_box(layer, latitude_deg, lon_east_deg)})}"


def local_east_north(lat0: float, lon0: float, lat, lon):
    """East and north metres of points (degrees, numpy arrays) in the tangent plane at (lat0, lon0)."""
    import numpy as np

    la, lo = np.radians(lat), np.radians(lon)
    ux, uy, uz = np.cos(la) * np.cos(lo), np.cos(la) * np.sin(lo), np.sin(la)
    p, q = math.radians(lat0), math.radians(lon0)
    east = (-math.sin(q), math.cos(q), 0.0)
    north = (-math.sin(p) * math.cos(q), -math.sin(p) * math.sin(q), math.cos(p))
    e = R_M * (ux * east[0] + uy * east[1] + uz * east[2])
    n = R_M * (ux * north[0] + uy * north[1] + uz * north[2])
    return e, n


@dataclass(frozen=True)
class Fit:
    slope_deg: float
    heights_fitted: int
    gradient_east: float
    gradient_north: float


def fit_plane(east, north, height) -> Fit:
    """Least-squares plane ``h = a*east + b*north + c``; slope ``atan(hypot(a, b))`` in degrees."""
    import numpy as np

    east, north, height = (np.asarray(v, dtype=float).ravel() for v in (east, north, height))
    if east.size < 3:
        raise PatchUnusable(f"only {east.size} heights inside the circle; a plane needs 3")
    design = np.column_stack([east, north, np.ones_like(east)])
    (a, b, _), *_ = np.linalg.lstsq(design, height, rcond=None)
    if np.linalg.matrix_rank(design) < 3:
        raise PatchUnusable("the heights inside the circle lie on one line")
    return Fit(math.degrees(math.atan(math.hypot(a, b))), int(east.size), float(a), float(b))


def heights_in_circle(values, nodata, transform, layer: str, latitude_deg: float, lon_east_deg: float,
                      radius_m: float = FIT_RADIUS_M):
    """East, north and height of every pixel whose centre lies within ``radius_m`` of the site.

    ``transform`` is the patch's affine geotransform (``rasterio`` ``Affine``). Raises
    ``PatchUnusable`` when a pixel inside the circle is no-data.
    """
    import numpy as np

    values = np.asarray(values, dtype=float)
    rows, cols = np.indices(values.shape)
    col, row = cols + 0.5, rows + 0.5  # pixel centres
    x = transform.a * col + transform.b * row + transform.c
    y = transform.d * col + transform.e * row + transform.f
    if layer == GLOBAL:
        lat, lon = y, x
    else:
        lat, lon = polar_lat_lon(x, y)
    east, north = local_east_north(latitude_deg, lon_east_deg, lat, lon)
    inside = np.hypot(east, north) <= radius_m
    if not inside.any():
        raise PatchUnusable("no pixel centre lies inside the circle")
    missing = ~np.isfinite(values) | (values == nodata if nodata is not None else False)
    if (missing & inside).any():
        raise PatchUnusable(f"{int((missing & inside).sum())} no-data pixel(s) inside the {radius_m:g} m circle")
    return east[inside], north[inside], values[inside]


def read_patch(path: Path):
    """``(values, nodata, transform, crs)`` of a kept GeoTIFF."""
    import rasterio

    with rasterio.open(path) as dataset:
        return dataset.read(1), dataset.nodata, dataset.transform, dataset.crs


def check_crs(crs, layer: str) -> None:
    if crs is None:
        raise PatchUnusable("the patch has no coordinate reference system")
    wkt = crs.to_wkt()
    if layer == GLOBAL:
        ok = crs.is_geographic and "1737400" in wkt
    else:
        south_pole = '"latitude_of_origin",-90' in wkt
        ok = crs.is_projected and "Polar_Stereographic" in wkt and "1737400" in wkt and south_pole
    if not ok:
        raise PatchUnusable(f"unexpected coordinate reference system for {layer}")


def slope_from_patch(path: Path, layer: str, latitude_deg: float, lon_east_deg: float) -> Fit:
    values, nodata, transform, crs = read_patch(path)
    check_crs(crs, layer)
    east, north, height = heights_in_circle(values, nodata, transform, layer, latitude_deg, lon_east_deg)
    return fit_plane(east, north, height)


def patch_path(patch_dir: Path, site_id: str, layer: str) -> Path:
    return patch_dir / f"{site_id}.{layer}.tif"


def fetch_patch(url: str, path: Path, timeout_s: float) -> dict:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=timeout_s) as response:  # noqa: S310 (fixed https address)
        if response.status != 200:
            raise RuntimeError(f"HTTP {response.status} from {url}")
        body = response.read()
    if not body.startswith((b"II*\x00", b"MM\x00*")):
        raise RuntimeError(f"not a GeoTIFF from {url}: {body[:120]!r}")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(body)
    meta = {"url": url, "retrieved_utc": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "bytes": len(body), "sha256": hashlib.sha256(body).hexdigest()}
    path.with_suffix(".meta.json").write_text(json.dumps(meta, indent=1) + "\n", encoding="utf-8")
    return meta


def kept_meta(path: Path, url: str) -> dict | None:
    meta_path = path.with_suffix(".meta.json")
    if not (path.is_file() and meta_path.is_file()):
        return None
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    if meta.get("url") != url:
        raise RuntimeError(f"{path.name} was fetched with another address; move it away to fetch again")
    if hashlib.sha256(path.read_bytes()).hexdigest() != meta.get("sha256"):
        raise RuntimeError(f"{path.name} does not match the checksum in its .meta.json")
    return meta


def repo_path(path: Path) -> str:
    try:
        return path.resolve().relative_to(REPO).as_posix()
    except ValueError:
        return path.name


def site_slope(site: dict, patch_dir: Path, timeout_s: float, pause_s: float, fetched: list[int]) -> dict:
    """The stored entry for one site: try its layers in order, keep every patch fetched."""
    lat, lon_east = site["lat"], site["lon_east"]
    skipped = []
    for layer in layers_for(lat):
        url = request_url(layer, lat, lon_east)
        path = patch_path(patch_dir, site["id"], layer)
        meta = kept_meta(path, url)
        if meta is None:
            if fetched[0]:
                time.sleep(pause_s)
            meta = fetch_patch(url, path, timeout_s)
            fetched[0] += 1
            print(f"  fetched {path.name} ({meta['bytes']} bytes)", flush=True)
        try:
            fit = slope_from_patch(path, layer, lat, lon_east)
        except PatchUnusable as reason:
            skipped.append({"layer": layer, "reason": str(reason), "patch_file": repo_path(path)})
            continue
        entry = {
            "name": site["name"],
            "lat": lat,
            "lon_east": lon_east,
            "slope_deg": round(fit.slope_deg, 3),
            "fit_radius_m": FIT_RADIUS_M,
            "layer": layer,
            "pixel_size_m": PIXEL_SIZE_M[layer],
            "heights_fitted": fit.heights_fitted,
            "fetch_date": meta["retrieved_utc"][:10],
            "patch_file": repo_path(path),
            "request": url,
        }
        if skipped:
            entry["layers_not_used"] = skipped
        return entry
    raise PatchUnusable(f"{site['id']}: no layer gave a slope ({skipped})")


def preset_sites() -> list[dict]:
    return json.loads(PRESET_SITES_FILE.read_text(encoding="utf-8"))["sites"]


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--patch-dir", required=True, help="where the fetched patches are kept")
    ap.add_argument("--out", required=True)
    ap.add_argument("--sites", default=None, help="comma-separated preset ids (default: all)")
    ap.add_argument("--pause-s", type=float, default=1.0, help="pause between Moon Trek requests")
    ap.add_argument("--timeout-s", type=float, default=120.0)
    args = ap.parse_args()

    sites = preset_sites()
    if args.sites:
        wanted = args.sites.split(",")
        unknown = set(wanted) - {s["id"] for s in sites}
        if unknown:
            ap.error(f"unknown site ids: {', '.join(sorted(unknown))}")
        sites = [s for s in sites if s["id"] in wanted]

    fetched, results = [0], {}
    for site in sites:
        entry = site_slope(site, Path(args.patch_dir), args.timeout_s, args.pause_s, fetched)
        results[site["id"]] = entry
        not_used = [skip["layer"] for skip in entry.get("layers_not_used", [])]
        note = f" (not used: {', '.join(not_used)})" if not_used else ""
        print(f"{site['id']:18s} slope {entry['slope_deg']:7.3f} deg  {entry['layer']}  "
              f"{entry['heights_fitted']} heights{note}", flush=True)

    out = {
        "format": FORMAT,
        "format_version": FORMAT_VERSION,
        "what": f"For each preset site, the {SLOPE_DESCRIPTION}. {SLOPE_SCALE_NOTE}",
        "method": ("Pixel centres turned into east/north metres in the tangent plane at the site; every height whose "
                   "centre lies within fit_radius_m of the site is fitted with a least-squares plane "
                   "h = a*east + b*north + c; slope_deg = atan(hypot(a, b)). A polar layer is used where the site "
                   "lies in it, unless its patch has no-data inside the circle; then the global layer."),
        "pixel_size_m": "Pixel size of the layer used; for the global layer (1/128 degree), along a meridian.",
        "source": "NASA Moon Trek (https://trek.nasa.gov/moon/), LOLA DEM layers, subset service " + SERVICE,
        "script": "backend/scripts/site_slopes_from_moon_trek.py",
        "sites": results,
    }
    Path(args.out).write_text(json.dumps(out, indent=1) + "\n", encoding="utf-8")
    print(f"wrote {args.out}; {fetched[0]} requests sent to Moon Trek")


if __name__ == "__main__":
    main()
