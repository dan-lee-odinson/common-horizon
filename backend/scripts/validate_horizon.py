"""Check stored horizon profiles against the real Sun and Earth over one year.

THIS IS A CHECK, NOT THE ENGINE. It exists to show that the stored skylines give
sensible sunlight and Earth-contact numbers when driven by real ephemerides, and
to put a number on how much the answer depends on the elevation model's pixel
size. The physics engine has its own position and frame functions.

It needs spiceypy (``backend/requirements-tools.txt``) and four NASA NAIF generic
kernels in a folder outside the repository (``backend/docs/SOURCES-horizon.md``)::

    naif0012.tls  de440s.bsp  moon_pa_de440_200625.bpc  moon_de440_250416.tf

For every hour of the year, and for each site, it asks SPICE where the Sun and
the Earth are as seen from the observer (2 m above the site, in the MOON_ME
frame, corrected for light time and stellar aberration, ``LT+S``), turns that
into azimuth and elevation in the site's local frame, and compares each disc
with the skyline. It reports, with terrain and without (a smooth sphere, where
the skyline is the geometric dip):

* percent of the year with any part of the Sun's disc visible;
* the longest continuous period with none of it visible;
* percent of the year with any part of the Earth's disc visible.

With ``--compare-dir`` it repeats this for profiles of the same sites computed
from the 240 m model alone and reports the differences as an error estimate.

    python backend/scripts/validate_horizon.py --kernel-dir D:/data/naif \\
        --sites shackleton-ridge nobile --year 2027 \\
        --compare-dir backend/data/horizon_validation --compare-suffix .240m
"""

import argparse
import json
import math
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.physics.horizon.geometry import MOON_RADIUS_M, local_frame  # noqa: E402
from app.physics.horizon.profile import DEFAULT_PROFILE_DIR, HorizonProfile, load_profile  # noqa: E402
from app.physics.horizon.visibility import body_visibility  # noqa: E402

KERNELS = ("naif0012.tls", "de440s.bsp", "moon_pa_de440_200625.bpc", "moon_de440_250416.tf")
FRAME = "MOON_ME"
ABERRATION_CORRECTION = "LT+S"

# Body radii for the angular size of the discs. No text PCK is among the four kernels, so they are
# written here: the IAU nominal solar radius (2015 Resolution B3) and the Earth's equatorial radius
# (IAU 2009 system of astronomical constants). The Earth's polar flattening (1/298) is ignored.
SUN_RADIUS_KM = 695_700.0
EARTH_RADIUS_KM = 6_378.1366


def longest_run_hours(flags: list[bool], step_hours: float) -> float:
    """Length, in hours, of the longest unbroken run of True values, each sample standing for one step."""
    longest = current = 0
    for flag in flags:
        current = current + 1 if flag else 0
        longest = max(longest, current)
    return longest * step_hours


def summarise(sun_fractions: list[float], earth_fractions: list[float], step_hours: float) -> dict[str, float]:
    """Yearly figures from per-sample disc fractions. Each sample stands for one step of time."""
    if not sun_fractions or len(sun_fractions) != len(earth_fractions):
        raise ValueError("sun and earth series must be non-empty and of equal length")
    count = len(sun_fractions)
    return {
        "sun_any_part_visible_percent": 100.0 * sum(fraction > 0.0 for fraction in sun_fractions) / count,
        "sun_whole_disc_visible_percent": 100.0 * sum(fraction >= 1.0 for fraction in sun_fractions) / count,
        "sun_mean_disc_fraction_percent": 100.0 * math.fsum(sun_fractions) / count,
        "longest_dark_period_hours": longest_run_hours([fraction <= 0.0 for fraction in sun_fractions], step_hours),
        "earth_any_part_visible_percent": 100.0 * sum(fraction > 0.0 for fraction in earth_fractions) / count,
        "earth_whole_disc_visible_percent": 100.0 * sum(fraction >= 1.0 for fraction in earth_fractions) / count,
        "longest_earth_outage_hours": longest_run_hours([fraction <= 0.0 for fraction in earth_fractions], step_hours),
    }


def azimuth_elevation_deg(direction, up, east, north) -> tuple[float, float]:
    """Azimuth (clockwise from north, 0..360) and elevation of a direction in a site's local frame."""
    norm = math.sqrt(sum(component * component for component in direction))
    unit = [component / norm for component in direction]
    dot = lambda a, b: a[0] * b[0] + a[1] * b[1] + a[2] * b[2]  # noqa: E731
    elevation = math.degrees(math.asin(max(-1.0, min(1.0, dot(unit, up)))))
    azimuth = math.degrees(math.atan2(dot(unit, east), dot(unit, north))) % 360.0
    return (0.0 if azimuth >= 360.0 else azimuth), elevation


def load_kernels(kernel_dir: Path):
    import spiceypy

    missing = [name for name in KERNELS if not (kernel_dir / name).is_file()]
    if missing:
        raise FileNotFoundError(f"missing kernels in {kernel_dir}: {', '.join(missing)}")
    spiceypy.kclear()
    for name in KERNELS:
        spiceypy.furnsh(str(kernel_dir / name))
    return spiceypy


def hourly_epochs(spice, year: int, step_hours: float) -> list[float]:
    """Ephemeris times from 1 January 00:00 UTC of ``year`` up to, not including, 1 January of the next."""
    start = spice.str2et(f"{year} JAN 01 00:00:00 UTC")
    end = spice.str2et(f"{year + 1} JAN 01 00:00:00 UTC")
    step = step_hours * 3600.0
    return [start + index * step for index in range(int(round((end - start) / step)))]


def body_track(spice, target: str, radius_km: float, profile: HorizonProfile, epochs: list[float]):
    """``(azimuth_deg, elevation_deg, angular_radius_deg)`` of a body from a profile's observer, per epoch.

    The observer is fixed to the Moon at the profile's site, ``observer_height_m`` above its surface.
    ``spkcpo`` returns the target's position relative to that surface point in MOON_ME at the observer's
    epoch, corrected for light time and stellar aberration as seen from the point itself.
    """
    up, east, north = local_frame(profile.latitude_deg, profile.longitude_deg)
    observer_radius_km = (MOON_RADIUS_M + profile.site_height_m + profile.observer_height_m) / 1000.0
    observer_km = [component * observer_radius_km for component in up]
    track = []
    for epoch in epochs:
        state, _ = spice.spkcpo(target, epoch, FRAME, "OBSERVER", ABERRATION_CORRECTION, observer_km, "MOON", FRAME)
        position = [float(state[0]), float(state[1]), float(state[2])]
        distance = math.sqrt(sum(component * component for component in position))
        azimuth, elevation = azimuth_elevation_deg(position, up, east, north)
        track.append((azimuth, elevation, math.degrees(math.asin(radius_km / distance))))
    return track


def sky_sanity(spice, epochs: list[float]) -> dict[str, float]:
    """Facts about the real sky that any correct kernel and frame setup must reproduce.

    Seen from the Moon's centre in MOON_ME: the Sun stays within about 1.6 degrees of the lunar
    equator (the Moon's small axial tilt), and the Earth stays near the mean sub-Earth point at
    latitude 0, longitude 0, swinging by libration (about 8 degrees in longitude, 7 in latitude).
    """
    sun_latitudes, earth_latitudes, earth_longitudes = [], [], []
    for epoch in epochs[::6]:
        for target, latitudes in (("SUN", sun_latitudes), ("EARTH", earth_latitudes)):
            position, _ = spice.spkpos(target, epoch, FRAME, ABERRATION_CORRECTION, "MOON")
            distance = math.sqrt(sum(float(component) ** 2 for component in position))
            latitudes.append(math.degrees(math.asin(float(position[2]) / distance)))
            if target == "EARTH":
                earth_longitudes.append(math.degrees(math.atan2(float(position[1]), float(position[0]))))
    return {
        "subsolar_latitude_min_deg": min(sun_latitudes),
        "subsolar_latitude_max_deg": max(sun_latitudes),
        "subearth_latitude_min_deg": min(earth_latitudes),
        "subearth_latitude_max_deg": max(earth_latitudes),
        "subearth_longitude_min_deg": min(earth_longitudes),
        "subearth_longitude_max_deg": max(earth_longitudes),
    }


def evaluate(profile: HorizonProfile, sun_track, earth_track, step_hours: float) -> dict[str, float]:
    sun = [body_visibility(profile, *sample).fraction for sample in sun_track]
    earth = [body_visibility(profile, *sample).fraction for sample in earth_track]
    return summarise(sun, earth, step_hours)


def skyline_difference(first: HorizonProfile, second: HorizonProfile) -> dict[str, float]:
    """How two skylines of the same site differ, sampled at the first one's azimuths (first minus second)."""
    differences = [
        elevation - second.elevation_at(azimuth)
        for azimuth, elevation in zip(first.azimuth_deg, first.horizon_elevation_deg, strict=True)
    ]
    count = len(differences)
    return {
        "mean_deg": math.fsum(differences) / count,
        "rms_deg": math.sqrt(math.fsum(value * value for value in differences) / count),
        "max_abs_deg": max(abs(value) for value in differences),
        "median_abs_deg": sorted(abs(value) for value in differences)[count // 2],
    }


def parse_arguments(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--kernel-dir", type=Path, required=True, help="folder holding the four NAIF kernels")
    parser.add_argument("--sites", nargs="+", default=["shackleton-ridge", "nobile"])
    parser.add_argument("--profiles-dir", type=Path, default=DEFAULT_PROFILE_DIR)
    parser.add_argument("--compare-dir", type=Path, help="folder with profiles of the same sites to compare with")
    parser.add_argument("--compare-suffix", default=".240m", help="file name suffix of the profiles in --compare-dir")
    parser.add_argument("--year", type=int, default=2027)
    parser.add_argument("--step-hours", type=float, default=1.0)
    parser.add_argument("--json-out", type=Path, help="also write the results to this JSON file")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    arguments = parse_arguments(argv)
    spice = load_kernels(arguments.kernel_dir)
    epochs = hourly_epochs(spice, arguments.year, arguments.step_hours)
    sanity = sky_sanity(spice, epochs)
    print(
        f"{arguments.year}: {len(epochs)} samples, one every {arguments.step_hours:g} h; frame {FRAME}, "
        f"correction {ABERRATION_CORRECTION}; kernels {', '.join(KERNELS)}"
    )
    print(
        "sky check from the Moon's centre: sub-solar latitude "
        f"{sanity['subsolar_latitude_min_deg']:+.3f} to {sanity['subsolar_latitude_max_deg']:+.3f} deg; sub-Earth "
        f"latitude {sanity['subearth_latitude_min_deg']:+.2f} to {sanity['subearth_latitude_max_deg']:+.2f}, "
        f"longitude {sanity['subearth_longitude_min_deg']:+.2f} to {sanity['subearth_longitude_max_deg']:+.2f} deg"
    )
    sky_ok = (
        -1.7 < sanity["subsolar_latitude_min_deg"] < -1.3
        and 1.3 < sanity["subsolar_latitude_max_deg"] < 1.7
        and -7.5 < sanity["subearth_latitude_min_deg"] < -5.0
        and 5.0 < sanity["subearth_latitude_max_deg"] < 7.5
        and -9.0 < sanity["subearth_longitude_min_deg"] < -4.5
        and 4.5 < sanity["subearth_longitude_max_deg"] < 9.0
    )
    print("sky check:", "PASSED" if sky_ok else "FAILED (kernels or frame are not what this script expects)")
    if not sky_ok:
        return 1

    results: dict = {
        "what": "check of stored horizon profiles against SPICE Sun and Earth positions; not engine output",
        "year": arguments.year,
        "step_hours": arguments.step_hours,
        "samples": len(epochs),
        "frame": FRAME,
        "aberration_correction": ABERRATION_CORRECTION,
        "kernels": list(KERNELS),
        "sun_radius_km": SUN_RADIUS_KM,
        "earth_radius_km": EARTH_RADIUS_KM,
        "visible_means": "any part of the disc above the skyline (disc fraction > 0)",
        "sky_check": {key: round(value, 4) for key, value in sanity.items()},
        "sites": {},
    }
    for site_id in arguments.sites:
        profile = load_profile(arguments.profiles_dir / f"{site_id}.json")
        sun_track = body_track(spice, "SUN", SUN_RADIUS_KM, profile, epochs)
        earth_track = body_track(spice, "EARTH", EARTH_RADIUS_KM, profile, epochs)
        smooth = HorizonProfile.smooth_sphere(
            site_id=site_id,
            latitude_deg=profile.latitude_deg,
            longitude_deg=profile.longitude_deg,
            site_height_m=profile.site_height_m,
            observer_height_m=profile.observer_height_m,
        )
        rows = {"terrain": evaluate(profile, sun_track, earth_track, arguments.step_hours)}
        site_result: dict = {
            "latitude_deg": profile.latitude_deg,
            "longitude_deg": profile.longitude_deg,
            "site_height_m": profile.site_height_m,
            "observer_height_m": profile.observer_height_m,
            "skyline_min_deg": round(profile.min_elevation_deg, 5),
            "skyline_max_deg": round(profile.max_elevation_deg, 5),
            "skyline_mean_deg": round(profile.mean_elevation_deg, 5),
            "sun_elevation_min_deg": round(min(sample[1] for sample in sun_track), 4),
            "sun_elevation_max_deg": round(max(sample[1] for sample in sun_track), 4),
            "earth_elevation_min_deg": round(min(sample[1] for sample in earth_track), 4),
            "earth_elevation_max_deg": round(max(sample[1] for sample in earth_track), 4),
            "sun_angular_radius_deg": [
                round(min(sample[2] for sample in sun_track), 5),
                round(max(sample[2] for sample in sun_track), 5),
            ],
            "earth_angular_radius_deg": [
                round(min(sample[2] for sample in earth_track), 5),
                round(max(sample[2] for sample in earth_track), 5),
            ],
        }
        labels = {"terrain": "with terrain (stored profile)"}
        if arguments.compare_dir:
            other = load_profile(arguments.compare_dir / f"{site_id}{arguments.compare_suffix}.json")
            if (other.latitude_deg, other.longitude_deg) != (profile.latitude_deg, profile.longitude_deg):
                raise SystemExit(f"{site_id}: the comparison profile is for a different point")
            rows["comparison"] = evaluate(other, sun_track, earth_track, arguments.step_hours)
            labels["comparison"] = f"with terrain ({arguments.compare_suffix.lstrip('.')} profile)"
            site_result["comparison_site_height_m"] = other.site_height_m
            site_result["skyline_difference_deg"] = {
                key: round(value, 5) for key, value in skyline_difference(profile, other).items()
            }
            site_result["difference_terrain_minus_comparison"] = {
                key: round(rows["terrain"][key] - rows["comparison"][key], 4) for key in rows["terrain"]
            }
        rows["no_terrain"] = evaluate(smooth, sun_track, earth_track, arguments.step_hours)
        labels["no_terrain"] = "no terrain (smooth sphere)"
        site_result["results"] = {
            name: {key: round(value, 4) for key, value in row.items()} for name, row in rows.items()
        }
        results["sites"][site_id] = site_result

        print(
            f"\n{site_id}  lat {profile.latitude_deg} lon {profile.longitude_deg}  site {profile.site_height_m:.1f} m"
            f" + {profile.observer_height_m:g} m; skyline {profile.min_elevation_deg:.3f} to "
            f"{profile.max_elevation_deg:.3f}, mean {profile.mean_elevation_deg:.3f} deg"
        )
        print(
            f"  Sun elevation over the year {site_result['sun_elevation_min_deg']:+.3f} to "
            f"{site_result['sun_elevation_max_deg']:+.3f} deg; Earth {site_result['earth_elevation_min_deg']:+.3f} to "
            f"{site_result['earth_elevation_max_deg']:+.3f} deg"
        )
        print(f"  {'':34s} {'Sun any':>8s} {'Sun mean':>9s} {'dark max':>9s} {'Earth any':>10s} {'Earth all':>10s}")
        for name, row in rows.items():
            print(
                f"  {labels[name]:34s} {row['sun_any_part_visible_percent']:7.2f}% "
                f"{row['sun_mean_disc_fraction_percent']:8.2f}% {row['longest_dark_period_hours']:7.0f} h "
                f"{row['earth_any_part_visible_percent']:9.2f}% {row['earth_whole_disc_visible_percent']:9.2f}%"
            )
        if "comparison" in rows:
            difference = site_result["difference_terrain_minus_comparison"]
            skyline = site_result["skyline_difference_deg"]
            print(
                f"  stored minus comparison: Sun any {difference['sun_any_part_visible_percent']:+.2f} points, "
                f"dark max {difference['longest_dark_period_hours']:+.0f} h, "
                f"Earth any {difference['earth_any_part_visible_percent']:+.2f} points; skyline rms "
                f"{skyline['rms_deg']:.3f}, median |d| {skyline['median_abs_deg']:.3f}, "
                f"max |d| {skyline['max_abs_deg']:.3f} deg"
            )

    if arguments.json_out:
        arguments.json_out.parent.mkdir(parents=True, exist_ok=True)
        arguments.json_out.write_text(json.dumps(results, indent=1) + "\n", encoding="utf-8", newline="\n")
        print(f"\nwrote {arguments.json_out}")
    spice.kclear()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
