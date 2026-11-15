"""Stored terrain horizon profiles: load, check and interpolate (pure Python).

A profile is the terrain skyline seen from one site: for each azimuth, the
elevation angle of the highest terrain in that direction. Profiles are computed
offline from elevation models by ``scripts/compute_horizon_profiles.py`` and
stored as one small JSON file per site in ``backend/data/horizon``.

This module needs only the standard library and the contract models, so it runs
wherever the backend runs.
"""

import json
import math
from bisect import bisect_right
from collections.abc import Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from app.models.results import TerrainSkyline
from app.physics.horizon.geometry import MOON_RADIUS_M, geometric_dip_deg

PROFILE_FORMAT = "common-horizon/horizon-profile"
PROFILE_FORMAT_VERSION = 1

# backend/data/horizon, next to backend/app.
DEFAULT_PROFILE_DIR = Path(__file__).resolve().parents[3] / "data" / "horizon"


class ProfileError(ValueError):
    """A horizon profile file is missing a field or holds values outside the conventions."""


@dataclass(frozen=True)
class HorizonProfile:
    """Terrain skyline around one site.

    ``azimuth_deg`` is strictly increasing in ``[0, 360)``, degrees clockwise from
    local north. ``horizon_elevation_deg`` is the skyline's elevation above the
    observer's local horizontal plane at each azimuth. It can be negative: from a
    summit the terrain horizon lies below the horizontal.
    """

    site_id: str
    latitude_deg: float
    longitude_deg: float
    site_height_m: float
    observer_height_m: float
    azimuth_deg: tuple[float, ...]
    horizon_elevation_deg: tuple[float, ...]
    max_distance_m: tuple[float | None, ...] = ()
    metadata: dict[str, Any] = field(default_factory=dict, compare=False)
    # Set when the azimuths are evenly spaced from 0, which lets lookups skip the search.
    _uniform_step_deg: float | None = field(default=None, init=False, repr=False, compare=False)

    def __post_init__(self) -> None:
        azimuths, elevations = self.azimuth_deg, self.horizon_elevation_deg
        if len(azimuths) != len(elevations):
            raise ProfileError("azimuth_deg and horizon_elevation_deg must have the same length")
        if not azimuths:
            raise ProfileError("a profile needs at least one azimuth")
        if self.max_distance_m and len(self.max_distance_m) != len(azimuths):
            raise ProfileError("max_distance_m must have one entry per azimuth")
        for azimuth in azimuths:
            if not (math.isfinite(azimuth) and 0.0 <= azimuth < 360.0):
                raise ProfileError("azimuth_deg values must be finite and in [0, 360)")
        if any(later <= earlier for earlier, later in zip(azimuths, azimuths[1:], strict=False)):
            raise ProfileError("azimuth_deg must be strictly increasing")
        for elevation in elevations:
            if not (math.isfinite(elevation) and -90.0 <= elevation <= 90.0):
                raise ProfileError("horizon_elevation_deg values must be finite and in [-90, 90]")

        step = 360.0 / len(azimuths)
        uniform = all(abs(azimuth - index * step) <= 1e-9 for index, azimuth in enumerate(azimuths))
        object.__setattr__(self, "_uniform_step_deg", step if uniform else None)

    @property
    def min_elevation_deg(self) -> float:
        return min(self.horizon_elevation_deg)

    @property
    def max_elevation_deg(self) -> float:
        return max(self.horizon_elevation_deg)

    @property
    def mean_elevation_deg(self) -> float:
        return math.fsum(self.horizon_elevation_deg) / len(self.horizon_elevation_deg)

    def elevation_at(self, azimuth_deg: float) -> float:
        """Skyline elevation at any azimuth, by linear interpolation that wraps at 360.

        Between the last stored azimuth and the first one (across north) the
        interpolation continues round the circle, so ``elevation_at(359.9)`` blends
        the last and the first samples. Any real azimuth is accepted: 370 and -350
        both mean 10.
        """
        if not math.isfinite(azimuth_deg):
            raise ValueError("azimuth_deg must be finite")
        azimuths, elevations = self.azimuth_deg, self.horizon_elevation_deg
        count = len(azimuths)
        if count == 1:
            return elevations[0]
        azimuth = azimuth_deg % 360.0
        if azimuth >= 360.0:  # -1e-20 % 360.0 rounds to 360.0
            azimuth = 0.0

        step = self._uniform_step_deg
        if step is not None:
            position = azimuth / step
            lower = min(int(position), count - 1)
            weight = position - lower
            upper = lower + 1 if lower + 1 < count else 0
            return elevations[lower] + (elevations[upper] - elevations[lower]) * weight

        upper = bisect_right(azimuths, azimuth)
        lower = upper - 1
        if upper == count or lower < 0:
            # In the gap that spans north: from the last azimuth round to the first.
            lower, upper = count - 1, 0
            span = azimuths[upper] + 360.0 - azimuths[lower]
            offset = (azimuth - azimuths[lower]) % 360.0
        else:
            span = azimuths[upper] - azimuths[lower]
            offset = azimuth - azimuths[lower]
        return elevations[lower] + (elevations[upper] - elevations[lower]) * (offset / span)

    def to_terrain_skyline(self) -> TerrainSkyline:
        """The profile in the API contract's ``TerrainSkyline`` shape."""
        return TerrainSkyline(
            azimuth_deg=list(self.azimuth_deg), horizon_elevation_deg=list(self.horizon_elevation_deg)
        )

    def to_json_dict(self) -> dict[str, Any]:
        """The profile as the JSON document stored on disk (metadata fields first)."""
        document: dict[str, Any] = {
            "format": PROFILE_FORMAT,
            "format_version": PROFILE_FORMAT_VERSION,
            "site_id": self.site_id,
            "latitude_deg": self.latitude_deg,
            "longitude_deg": self.longitude_deg,
            "site_height_m": self.site_height_m,
            "observer_height_m": self.observer_height_m,
        }
        document.update(self.metadata)
        document["azimuth_deg"] = list(self.azimuth_deg)
        document["horizon_elevation_deg"] = list(self.horizon_elevation_deg)
        if self.max_distance_m:
            document["max_distance_m"] = list(self.max_distance_m)
        return document

    @classmethod
    def from_json_dict(cls, document: dict[str, Any]) -> "HorizonProfile":
        if document.get("format") != PROFILE_FORMAT:
            raise ProfileError(f"not a horizon profile: format is {document.get('format')!r}")
        if document.get("format_version") != PROFILE_FORMAT_VERSION:
            raise ProfileError(f"unsupported horizon profile version {document.get('format_version')!r}")
        own_fields = {
            "format",
            "format_version",
            "site_id",
            "latitude_deg",
            "longitude_deg",
            "site_height_m",
            "observer_height_m",
            "azimuth_deg",
            "horizon_elevation_deg",
            "max_distance_m",
        }
        try:
            return cls(
                site_id=str(document["site_id"]),
                latitude_deg=float(document["latitude_deg"]),
                longitude_deg=float(document["longitude_deg"]),
                site_height_m=float(document["site_height_m"]),
                observer_height_m=float(document["observer_height_m"]),
                azimuth_deg=tuple(float(value) for value in document["azimuth_deg"]),
                horizon_elevation_deg=tuple(float(value) for value in document["horizon_elevation_deg"]),
                max_distance_m=tuple(
                    None if value is None else float(value) for value in document.get("max_distance_m", ())
                ),
                metadata={key: value for key, value in document.items() if key not in own_fields},
            )
        except KeyError as missing:
            raise ProfileError(f"horizon profile is missing the field {missing.args[0]!r}") from None
        except TypeError as error:
            raise ProfileError(f"horizon profile has a field of the wrong type: {error}") from None

    @classmethod
    def smooth_sphere(
        cls,
        *,
        site_id: str = "smooth-sphere",
        latitude_deg: float = 0.0,
        longitude_deg: float = 0.0,
        site_height_m: float = 0.0,
        observer_height_m: float = 2.0,
        azimuth_step_deg: float = 0.5,
    ) -> "HorizonProfile":
        """The "no terrain" reference: the geometric dip at every azimuth.

        The sphere passes through the site, so its radius is 1737.4 km plus the
        site height, and the observer stands ``observer_height_m`` above it.
        """
        surface_radius = MOON_RADIUS_M + site_height_m
        dip = geometric_dip_deg(surface_radius + observer_height_m, surface_radius)
        count = round(360.0 / azimuth_step_deg)
        return cls(
            site_id=site_id,
            latitude_deg=latitude_deg,
            longitude_deg=longitude_deg,
            site_height_m=site_height_m,
            observer_height_m=observer_height_m,
            azimuth_deg=tuple(index * 360.0 / count for index in range(count)),
            horizon_elevation_deg=(dip,) * count,
            metadata={"terrain": "none (smooth sphere through the site)"},
        )


def load_profile(path: str | Path) -> HorizonProfile:
    """Read one profile file."""
    with open(path, encoding="utf-8") as handle:
        document = json.load(handle)
    if not isinstance(document, dict):
        raise ProfileError(f"{path}: a horizon profile must be a JSON object")
    return HorizonProfile.from_json_dict(document)


def load_site_profile(site_id: str, directory: str | Path = DEFAULT_PROFILE_DIR) -> HorizonProfile:
    """Read the stored profile of a preset site, ``<directory>/<site_id>.json``."""
    if not site_id or any(character in site_id for character in "/\\.") or site_id != site_id.strip():
        raise ProfileError(f"not a site id: {site_id!r}")
    return load_profile(Path(directory) / f"{site_id}.json")


def interpolate_skyline(azimuths_deg: Sequence[float], elevations_deg: Sequence[float], azimuth_deg: float) -> float:
    """Skyline elevation at ``azimuth_deg`` from bare arrays (for example a contract ``TerrainSkyline``)."""
    profile = HorizonProfile(
        site_id="",
        latitude_deg=0.0,
        longitude_deg=0.0,
        site_height_m=0.0,
        observer_height_m=0.0,
        azimuth_deg=tuple(azimuths_deg),
        horizon_elevation_deg=tuple(elevations_deg),
    )
    return profile.elevation_at(azimuth_deg)
