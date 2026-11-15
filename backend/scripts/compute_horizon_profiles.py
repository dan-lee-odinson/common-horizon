"""Compute terrain horizon profiles for landing sites from LOLA elevation models.

Needs the packages in ``backend/requirements-tools.txt`` and the two elevation
files of NASA Goddard PGDA product 90 in a folder outside the repository (see
``backend/docs/SOURCES-horizon.md`` for where they come from)::

    LDEM_80S_40MPP_ADJ.TIF     40 m pixels, 80 S to the pole
    LDEM_60S_240MPP_ADJ.TIF   240 m pixels, 60 S to the pole

Run from the repository root (or anywhere; paths are resolved from this file)::

    python backend/scripts/compute_horizon_profiles.py --dem-dir /path/to/lola --sites shackleton-ridge nobile
    python backend/scripts/compute_horizon_profiles.py --dem-dir /path/to/lola --check-georeferencing

Each site is written to ``backend/data/horizon/<site_id>.json``. Site coordinates
are read from ``web/src/api/examples/sites.json`` (only read). The 40 m model is
used wherever it has data and the 240 m model beyond its edge. With
``--coarse-only`` the 240 m model is used alone and the profile is marked coarse.

The method, the near-field skip and the stopping rule are described in
``app/physics/horizon/compute.py``; the conventions and limits in
``app/physics/horizon/README.md``.
"""

import argparse
import json
import re
import sys
import time
from datetime import UTC, datetime
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
REPOSITORY_DIR = BACKEND_DIR.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import numpy as np  # noqa: E402

from app.physics.horizon.compute import (  # noqa: E402
    NO_DATA,
    ProfileResult,
    SamplingSettings,
    SiteOutsideCoverage,
    compute_profile,
)
from app.physics.horizon.dem import (  # noqa: E402
    CompositeTerrain,
    RasterTerrain,
    load_raster_terrain,
    read_georeferencing,
    sha256_of_file,
)
from app.physics.horizon.geometry import (  # noqa: E402
    MOON_RADIUS_M,
    destination_unit,
    geometric_dip_deg,
    lat_lon_from_unit,
    unit_from_lat_lon,
)
from app.physics.horizon.profile import DEFAULT_PROFILE_DIR, HorizonProfile  # noqa: E402

FINE_MODEL = "LDEM_80S_40MPP_ADJ.TIF"
COARSE_MODEL = "LDEM_60S_240MPP_ADJ.TIF"
SITES_FILE = REPOSITORY_DIR / "web" / "src" / "api" / "examples" / "sites.json"

PRODUCT_CITATION = (
    "Barker, M. K., et al. (2023). A New View of the Lunar South Pole from the Lunar Orbiter Laser "
    "Altimeter (LOLA). The Planetary Science Journal, 4, 183. doi:10.3847/PSJ/acf3e1. "
    "Data: NASA Goddard Planetary Geodesy Data Archive (PGDA), product 90, "
    "https://pgda.gsfc.nasa.gov/products/90, doi:10.60903/gsfcpgda-lola-spole."
)
# The product page states the unit of the LDEM values; the files themselves carry none.
DOCUMENTED_HEIGHT_UNIT = "m"

AZIMUTH_CONVENTION = "degrees clockwise from local north, 0 <= azimuth < 360 (0 north, 90 east)"
ELEVATION_CONVENTION = (
    "degrees above the observer's local horizontal plane (perpendicular to the radius through the observer); "
    "spherical Moon, no refraction"
)

# IAU names and centres from the USGS Gazetteer of Planetary Nomenclature (planetarynames.wr.usgs.gov),
# read 2026-11-14: (name, latitude, east longitude, diameter in km). Used only by --check-georeferencing.
GAZETTEER_CRATERS = (
    ("Shackleton", -89.67, 129.78, 20.92),
    ("de Gerlache", -88.48, -88.34, 32.71),
    ("Shoemaker", -88.14, 45.91, 51.82),
    ("Haworth", -87.45, -5.17, 51.42),
    ("Faustini", -87.18, 84.31, 42.48),
)


def _round_list(values: np.ndarray, digits: int) -> list[float | None]:
    return [None if not np.isfinite(value) else round(float(value), digits) for value in values]


def dumps_compact_arrays(document: dict) -> str:
    """JSON with one key per line and each array of plain values on a single line."""
    text = json.dumps(document, indent=1, ensure_ascii=False, allow_nan=False)
    return re.sub(r"\[\s+([^\[\]{}]*?)\s+\]", lambda match: "[" + re.sub(r"\s+", " ", match.group(1)) + "]", text)


def write_json(path: Path, document: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(dumps_compact_arrays(document) + "\n", encoding="utf-8", newline="\n")


def load_sites(path: Path) -> dict[str, dict]:
    with open(path, encoding="utf-8") as handle:
        return {site["id"]: site for site in json.load(handle)["sites"]}


def model_record(index: int, terrain: RasterTerrain, sha256: str, role: str) -> dict:
    details = terrain.details
    return {
        "index": index,
        "file": terrain.name,
        "role": role,
        "pixel_size_m": details["pixel_size_m"],
        "sha256": sha256,
        "projection": details["projection"],
        "pole": details["pole"],
        "sphere_radius_m": details["sphere_radius_m"],
        "central_longitude_deg": details["central_longitude_deg"],
        "scale_factor_at_pole": details["scale_factor_at_pole"],
        "grid_origin_m": [details["transform"][2], details["transform"][5]],
        "grid_size_pixels": [details["width"], details["height"]],
        "crs_proj4": details["crs_proj4"],
        "height_unit": details["height_unit"],
        "height_unit_source": details["height_unit_source"],
        "min_height_m": round(details["min_height_m"], 3),
        "max_height_m": round(details["max_height_m"], 3),
    }


def build_document(
    site_id: str,
    site_name: str | None,
    latitude_deg: float,
    longitude_deg: float,
    observer_height_m: float,
    result: ProfileResult,
    settings: SamplingSettings,
    model_records: list[dict],
    pixel_size_m: float,
    coarse: bool,
) -> dict:
    elevation = result.horizon_elevation_deg
    site_radius = MOON_RADIUS_M + result.site_height_m
    sources_used = sorted({int(source) for source in result.max_source if source != NO_DATA})
    at_first_sample = result.max_distance_m == result.sample_distances_m[0]
    if coarse:
        quality = "COARSE: computed from the 240 m model alone; near-field terrain within 360 m is skipped"
    else:
        quality = "40 m model wherever it has data, 240 m model beyond its edge"
    metadata = {
        "site_name": site_name,
        "reference_radius_m": MOON_RADIUS_M,
        "frame": "MOON_ME",
        "coarse": coarse,
        "quality": quality,
        "azimuth_convention": AZIMUTH_CONVENTION,
        "elevation_convention": ELEVATION_CONVENTION,
        "site_height_source": model_records[result.site_source]["file"],
        "smooth_sphere_dip_deg": round(geometric_dip_deg(site_radius + observer_height_m, site_radius), 5),
        "summary": {
            "min_elevation_deg": round(float(elevation.min()), 5),
            "max_elevation_deg": round(float(elevation.max()), 5),
            "mean_elevation_deg": round(float(elevation.mean()), 5),
            "farthest_skyline_point_m": round(float(np.nanmax(result.max_distance_m)), 1),
            "rays": int(elevation.size),
            "rays_ran_out_of_data": int(result.ran_out_of_data.sum()),
            "rays_reached_max_range": int(result.reached_max_range.sum()),
            "rays_without_any_data": int((result.max_source == NO_DATA).sum()),
            "rays_with_skyline_at_first_sample": int(at_first_sample.sum()),
            "models_supplying_the_skyline": [model_records[index]["file"] for index in sources_used],
        },
        "elevation_models": model_records,
        "citation": PRODUCT_CITATION,
        "sampling": {
            **settings.as_dict(),
            "first_sample_m": float(result.sample_distances_m[0]),
            "near_field_skipped_m": float(result.sample_distances_m[0]),
            "min_step_m": settings.min_step_pixels * pixel_size_m,
            "near_field_steps": (
                "close to the site each step is split so that none is longer than near_step_fraction of the "
                "distance, down to near_step_floor_m"
            ),
            "samples_per_ray_at_most": int(result.sample_distances_m.size),
            "interpolation": "bilinear between pixel centres",
            "stopping_rule": (
                "a ray stops when terrain at the models' highest value, at the current distance or beyond, "
                "would appear below the current maximum, or at max_range_m"
            ),
        },
        "computed_utc": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "generator": "backend/scripts/compute_horizon_profiles.py",
        "coverage": {
            "note": (
                "ran_out_of_data: samples without elevation data came before the stopping rule was met, so "
                "farther terrain that might have been higher is not in the value. reached_max_range: the ray "
                "was walked to max_range_m. max_source: index into elevation_models of the model that gave "
                "the skyline point, -1 if the ray had no data at all (the value is then the smooth-sphere dip). "
                "at_first_sample: the skyline point is the very first sample, at the edge of the skipped near "
                "field, so nearer terrain that was skipped on purpose might have stood higher."
            ),
            "ran_out_of_data": [bool(flag) for flag in result.ran_out_of_data],
            "reached_max_range": [bool(flag) for flag in result.reached_max_range],
            "max_source": [int(source) for source in result.max_source],
            "at_first_sample": [bool(flag) for flag in at_first_sample],
            "stop_distance_m": _round_list(result.stop_distance_m, 1),
        },
    }
    profile = HorizonProfile(
        site_id=site_id,
        latitude_deg=latitude_deg,
        longitude_deg=longitude_deg,
        site_height_m=round(result.site_height_m, 3),
        observer_height_m=observer_height_m,
        azimuth_deg=tuple(float(azimuth) for azimuth in result.azimuth_deg),
        horizon_elevation_deg=tuple(_round_list(elevation, 5)),
        max_distance_m=tuple(_round_list(result.max_distance_m, 1)),
        metadata=metadata,
    )
    document = profile.to_json_dict()
    document["coverage"] = document.pop("coverage")  # per-azimuth flags last, after the profile arrays
    return document


def check_georeferencing(terrains: list[RasterTerrain], paths: list[Path]) -> bool:
    """Print what each file says about itself and test the coordinate conversion on known points."""
    ok = True
    for terrain, path in zip(terrains, paths, strict=True):
        file_says = read_georeferencing(path)
        print(f"== {terrain.name}")
        for key in ("driver", "width", "height", "dtype", "nodata", "crs_proj4", "transform", "band_units"):
            print(f"   {key}: {file_says[key]}")
        print(f"   area_or_point: {file_says['area_or_point']}; tags: {file_says['tags']}")
        details = terrain.details
        print(
            f"   read as: {details['projection']}, {details['pole']} pole, sphere {details['sphere_radius_m']} m, "
            f"central longitude {details['central_longitude_deg']}, scale at pole {details['scale_factor_at_pole']}"
        )
        print(
            f"   pixel {details['pixel_size_m']} m; heights in {details['height_unit']} "
            f"({details['height_unit_source']}); min {terrain.min_height_m:.2f} m, max {terrain.max_height_m:.2f} m; "
            f"valid {100 * details['valid_fraction']:.3f}% of pixels"
        )
        print(f"   closed formula vs PROJ, largest difference: {details['formula_vs_proj_max_difference_m']:.2e} m")

        # 1. The pole must fall on the grid's centre, where the four central pixels meet.
        pole_x, pole_y = terrain.projection.forward(np.array(-90.0), np.array(0.0))
        column = (float(pole_x) - terrain.x_origin_m) / terrain.dx_m
        row = (float(pole_y) - terrain.y_origin_m) / terrain.dy_m
        centred = abs(column - details["width"] / 2) < 1e-6 and abs(row - details["height"] / 2) < 1e-6
        ok &= centred
        print(f"   south pole at column {column:.3f}, row {row:.3f} of {details['width']} x {details['height']}: "
              f"{'centre, OK' if centred else 'NOT the centre'}")

        # 2. Latitude of the grid's edge midpoints (the product's stated latitude limit).
        edge_latitude, _ = terrain.projection.inverse(np.array(terrain.x_origin_m), np.array(0.0))
        print(f"   latitude at the middle of the grid's edge: {float(edge_latitude):.4f}")

        # 3. Known points: craters must be where the IAU gazetteer puts them. The floor at the listed
        #    centre must lie well below the rim, a ring of the listed radius around that centre.
        for name, latitude, longitude, diameter_km in GAZETTEER_CRATERS:
            centre = np.asarray(unit_from_lat_lon(latitude, longitude))
            centre_height, centre_source = terrain.sample(centre[np.newaxis, :])
            ring_lat, ring_lon = _ring(latitude, longitude, diameter_km * 500.0)
            ring_vectors = np.stack(
                [
                    np.cos(np.radians(ring_lat)) * np.cos(np.radians(ring_lon)),
                    np.cos(np.radians(ring_lat)) * np.sin(np.radians(ring_lon)),
                    np.sin(np.radians(ring_lat)),
                ],
                axis=-1,
            )
            ring_height, ring_source = terrain.sample(ring_vectors)
            if centre_source[0] == NO_DATA or (ring_source == NO_DATA).any():
                print(f"   {name}: outside this model")
                continue
            depth = float(ring_height.mean() - centre_height[0])
            is_crater = depth > 1000.0 and float(ring_height.min()) > float(centre_height[0])
            ok &= is_crater
            print(
                f"   {name} ({latitude}, {longitude} E, D {diameter_km} km): centre {centre_height[0]:.0f} m, "
                f"rim ring mean {ring_height.mean():.0f} m (lowest {ring_height.min():.0f} m), "
                f"depth {depth:.0f} m: {'crater found there, OK' if is_crater else 'NO crater there'}"
            )

    if len(terrains) == 2:
        # 4. The two models must agree where they overlap, sampled at the same latitudes and longitudes.
        generator = np.random.default_rng(20261114)
        latitudes = generator.uniform(-89.9, -80.5, 20000)
        longitudes = generator.uniform(0.0, 360.0, 20000)
        vectors = np.stack(
            [
                np.cos(np.radians(latitudes)) * np.cos(np.radians(longitudes)),
                np.cos(np.radians(latitudes)) * np.sin(np.radians(longitudes)),
                np.sin(np.radians(latitudes)),
            ],
            axis=-1,
        )
        first, first_source = terrains[0].sample(vectors)
        second, second_source = terrains[1].sample(vectors)
        both = (first_source != NO_DATA) & (second_source != NO_DATA)
        difference = first[both] - second[both]
        rms = float(np.sqrt(np.mean(difference**2)))
        # A shift of one coarse pixel would decorrelate the two; agreement to tens of metres rules it out.
        coarse_x, coarse_y = terrains[1].projection.forward(latitudes, longitudes)
        shifted, _ = terrains[1].sample_xy(coarse_x + terrains[1].pixel_size_m, coarse_y + terrains[1].pixel_size_m)
        rms_shifted = float(np.sqrt(np.nanmean((first[both] - shifted[both]) ** 2)))
        agree = rms < rms_shifted
        ok &= agree
        print(
            f"== {terrains[0].name} minus {terrains[1].name} at {int(both.sum())} random points south of 80.5 S: "
            f"mean {difference.mean():+.2f} m, rms {rms:.2f} m, median |d| {np.median(np.abs(difference)):.2f} m; "
            f"rms with the coarse grid shifted by one pixel: {rms_shifted:.2f} m "
            f"({'aligned, OK' if agree else 'NOT aligned'})"
        )
    print("GEOREFERENCING CHECK:", "PASSED" if ok else "FAILED")
    return ok


def _ring(
    latitude_deg: float, longitude_deg: float, radius_m: float, points: int = 72
) -> tuple[np.ndarray, np.ndarray]:
    """Latitudes and longitudes of a circle of great-circle radius ``radius_m`` around a point."""
    positions = [
        lat_lon_from_unit(
            destination_unit(latitude_deg, longitude_deg, 360.0 * index / points, radius_m / MOON_RADIUS_M)
        )
        for index in range(points)
    ]
    return np.array([position[0] for position in positions]), np.array([position[1] for position in positions])


def parse_arguments(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--dem-dir", type=Path, required=True, help="folder holding the elevation GeoTIFF files")
    parser.add_argument("--sites", nargs="*", default=[], help="site ids from the sites file")
    parser.add_argument(
        "--point",
        nargs=3,
        action="append",
        default=[],
        metavar=("ID", "LAT", "LON_EAST"),
        help="an extra point that is not in the sites file (repeatable)",
    )
    parser.add_argument("--sites-file", type=Path, default=SITES_FILE)
    parser.add_argument("--out-dir", type=Path, default=DEFAULT_PROFILE_DIR)
    parser.add_argument("--suffix", default="", help="added to the output file name, before .json")
    parser.add_argument(
        "--coarse-only", action="store_true", help=f"use only {COARSE_MODEL} and mark the profile coarse"
    )
    parser.add_argument("--observer-height-m", type=float, default=2.0)
    parser.add_argument("--azimuth-step-deg", type=float, default=SamplingSettings.azimuth_step_deg)
    parser.add_argument("--step-growth", type=float, default=SamplingSettings.step_growth)
    parser.add_argument("--max-range-km", type=float, default=SamplingSettings.max_range_m / 1000.0)
    parser.add_argument(
        "--near-skip-pixels",
        type=float,
        default=SamplingSettings.near_skip_pixels,
        help="distance of the first sample in pixels; for sensitivity studies, stored profiles use the default",
    )
    parser.add_argument(
        "--check-georeferencing", action="store_true", help="print the files' georeferencing, test it, exit"
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    arguments = parse_arguments(argv)
    model_names = [COARSE_MODEL] if arguments.coarse_only else [FINE_MODEL, COARSE_MODEL]
    paths = [arguments.dem_dir / name for name in model_names]
    for path in paths:
        if not path.is_file():
            print(f"missing elevation file: {path}", file=sys.stderr)
            return 2

    terrains: list[RasterTerrain] = []
    for path in paths:
        started = time.perf_counter()
        terrain = load_raster_terrain(path, documented_height_unit=DOCUMENTED_HEIGHT_UNIT)
        terrains.append(terrain)
        print(
            f"loaded {path.name}: {terrain.heights.shape[1]} x {terrain.heights.shape[0]} pixels of "
            f"{terrain.pixel_size_m:g} m, heights {terrain.min_height_m:.1f} to {terrain.max_height_m:.1f} m "
            f"({time.perf_counter() - started:.1f} s)"
        )

    if arguments.check_georeferencing:
        return 0 if check_georeferencing(terrains, paths) else 1

    targets: list[tuple[str, str | None, float, float]] = []
    if arguments.sites:
        sites = load_sites(arguments.sites_file)
        for site_id in arguments.sites:
            if site_id not in sites:
                print(f"unknown site id {site_id!r} (not in {arguments.sites_file})", file=sys.stderr)
                return 2
            site = sites[site_id]
            targets.append((site_id, site.get("name"), float(site["lat"]), float(site["lon_east"])))
    for point_id, latitude, longitude in arguments.point:
        targets.append((point_id, None, float(latitude), float(longitude)))
    if not targets:
        print("nothing to do: give --sites, --point or --check-georeferencing", file=sys.stderr)
        return 2

    roles = ["coarse"] if arguments.coarse_only else ["fine", "coarse, used beyond the fine model's edge"]
    records = [
        model_record(index, terrain, sha256_of_file(path), role)
        for index, (terrain, path, role) in enumerate(zip(terrains, paths, roles, strict=True))
    ]
    composite = CompositeTerrain(terrains)
    settings = SamplingSettings(
        azimuth_step_deg=arguments.azimuth_step_deg,
        step_growth=arguments.step_growth,
        max_range_m=arguments.max_range_km * 1000.0,
        near_skip_pixels=arguments.near_skip_pixels,
    )

    for site_id, site_name, latitude, longitude in targets:
        started = time.perf_counter()
        try:
            result = compute_profile(composite, latitude, longitude, arguments.observer_height_m, settings)
        except SiteOutsideCoverage as error:
            print(f"{site_id}: skipped, {error}", file=sys.stderr)
            return 1
        document = build_document(
            site_id,
            site_name,
            latitude,
            longitude,
            arguments.observer_height_m,
            result,
            settings,
            records,
            composite.pixel_size_m,
            coarse=arguments.coarse_only,
        )
        out_path = arguments.out_dir / f"{site_id}{arguments.suffix}.json"
        write_json(out_path, document)
        summary = document["summary"]
        print(
            f"{site_id}: site height {result.site_height_m:.1f} m; skyline min {summary['min_elevation_deg']:.3f}, "
            f"max {summary['max_elevation_deg']:.3f}, mean {summary['mean_elevation_deg']:.3f} deg; "
            f"farthest skyline point {summary['farthest_skyline_point_m'] / 1000:.1f} km; "
            f"rays out of data {summary['rays_ran_out_of_data']}, at max range {summary['rays_reached_max_range']}; "
            f"{time.perf_counter() - started:.1f} s -> {out_path}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
