"""How much of a body's disc shows above a terrain skyline (pure Python).

Given where a body is in the observer's sky (azimuth, elevation of its centre)
and its angular radius, ``disc_fraction_above_skyline`` returns the fraction of
the disc's area above the skyline, and ``obstruction_state`` names the result
with the API contract's four values.

The disc is cut into narrow vertical strips. Each strip is compared with the
skyline at that strip's own azimuth, so a skyline that slopes or has a notch
under the disc is followed. A step of azimuth covers less sky the higher you
look, so a strip that is ``x`` degrees of sky to the side of the disc's centre
is ``x / cos(elevation)`` degrees of azimuth away from it.

The sky near the disc is treated as flat. For the Sun (radius about 0.27 degrees)
and the Earth seen from the Moon (about 0.95 degrees) the error of that is far
below the resolution of the skyline itself.
"""

import math
from collections.abc import Callable
from dataclasses import dataclass

from app.models.results import ObstructionState
from app.physics.horizon.profile import HorizonProfile

DEFAULT_STRIPS = 64

# Near the zenith or nadir cos(elevation) goes to zero and the disc spans every azimuth.
_MIN_COS_ELEVATION = 1e-9
_MAX_AZIMUTH_OFFSET_DEG = 180.0


@dataclass(frozen=True)
class BodyVisibility:
    fraction: float
    state: ObstructionState


def disc_fraction_above_skyline(
    skyline_elevation_at: Callable[[float], float],
    azimuth_deg: float,
    elevation_deg: float,
    angular_radius_deg: float,
    strips: int = DEFAULT_STRIPS,
) -> float:
    """Fraction (0..1) of a disc's area above the skyline.

    ``skyline_elevation_at`` maps an azimuth in degrees (any real number; it must
    wrap by itself) to the skyline's elevation there, for example
    ``HorizonProfile.elevation_at``.

    Strip ``i`` sits ``x_i`` degrees to the side of the centre and reaches
    ``h_i = sqrt(r^2 - x_i^2)`` above and below it. The part of it above a skyline
    at elevation ``s`` is ``elevation + h_i - s``, limited to between 0 and the
    strip's full height ``2 h_i``. Summing the strips' visible heights and dividing
    by the sum of their full heights gives the fraction; dividing by the same sum
    makes a clear disc exactly 1 and a hidden one exactly 0.
    """
    if strips < 1:
        raise ValueError("strips must be at least 1")
    if not (angular_radius_deg > 0 and math.isfinite(angular_radius_deg)):
        raise ValueError("angular_radius_deg must be positive and finite")
    if not (math.isfinite(azimuth_deg) and math.isfinite(elevation_deg)):
        raise ValueError("azimuth_deg and elevation_deg must be finite")

    azimuth_per_sky_degree = 1.0 / max(math.cos(math.radians(elevation_deg)), _MIN_COS_ELEVATION)
    visible = 0.0
    total = 0.0
    for index in range(strips):
        # Strip centres, evenly spaced across the disc's width from -r to +r.
        offset = angular_radius_deg * ((2 * index + 1) / strips - 1.0)
        half_height = math.sqrt(angular_radius_deg**2 - offset**2)
        azimuth_offset = offset * azimuth_per_sky_degree
        azimuth_offset = max(-_MAX_AZIMUTH_OFFSET_DEG, min(_MAX_AZIMUTH_OFFSET_DEG, azimuth_offset))
        skyline = skyline_elevation_at(azimuth_deg + azimuth_offset)
        above = elevation_deg + half_height - skyline
        visible += min(max(above, 0.0), 2.0 * half_height)
        total += 2.0 * half_height
    return min(max(visible / total, 0.0), 1.0)


def obstruction_state(fraction: float, elevation_deg: float, angular_radius_deg: float) -> ObstructionState:
    """Name a visibility result with the contract's four values.

    The fraction decides first. A body can be seen below 0 degrees elevation,
    because the skyline itself dips below the horizontal wherever the ground
    falls away (and always by the small geometric dip). So:

    * any of the disc showing: ``visible`` if all of it, else ``partial``;
    * none showing: ``terrain_blocked`` if some of the disc is above the local
      horizontal plane (its upper limb, ``elevation + radius``, is above 0), where
      only terrain can be hiding it; otherwise ``below_horizon``.
    """
    if fraction >= 1.0:
        return ObstructionState.VISIBLE
    if fraction > 0.0:
        return ObstructionState.PARTIAL
    if elevation_deg + angular_radius_deg > 0.0:
        return ObstructionState.TERRAIN_BLOCKED
    return ObstructionState.BELOW_HORIZON


def body_visibility(
    profile: HorizonProfile,
    azimuth_deg: float,
    elevation_deg: float,
    angular_radius_deg: float,
    strips: int = DEFAULT_STRIPS,
) -> BodyVisibility:
    """Disc fraction above a stored profile's skyline, and the matching obstruction state."""
    if not (angular_radius_deg > 0 and math.isfinite(angular_radius_deg)):
        raise ValueError("angular_radius_deg must be positive and finite")
    # The interpolated skyline never leaves the range of its samples, so a disc clear of that
    # range is decided without looking at individual strips.
    if elevation_deg - angular_radius_deg >= profile.max_elevation_deg:
        fraction = 1.0
    elif elevation_deg + angular_radius_deg <= profile.min_elevation_deg:
        fraction = 0.0
    else:
        fraction = disc_fraction_above_skyline(
            profile.elevation_at, azimuth_deg, elevation_deg, angular_radius_deg, strips
        )
    return BodyVisibility(fraction=fraction, state=obstruction_state(fraction, elevation_deg, angular_radius_deg))
