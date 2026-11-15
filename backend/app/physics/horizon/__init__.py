"""Terrain horizon profiles: the skyline around a site and what it hides.

Two halves:

* ``profile`` and ``visibility`` (with ``geometry``) are pure Python. They load a
  stored profile, interpolate the skyline and tell how much of the Sun's or the
  Earth's disc clears it. These are what the service can use at run time.
* ``compute`` and ``dem`` build the profiles from elevation models. They need
  numpy and rasterio (``backend/requirements-tools.txt``), run offline, and are
  deliberately not imported here.

See ``README.md`` in this folder.
"""

from app.physics.horizon.geometry import MOON_RADIUS_M, elevation_angle_deg, geometric_dip_deg
from app.physics.horizon.profile import (
    DEFAULT_PROFILE_DIR,
    HorizonProfile,
    ProfileError,
    interpolate_skyline,
    load_profile,
    load_site_profile,
)
from app.physics.horizon.visibility import (
    BodyVisibility,
    body_visibility,
    disc_fraction_above_skyline,
    obstruction_state,
)

__all__ = [
    "DEFAULT_PROFILE_DIR",
    "MOON_RADIUS_M",
    "BodyVisibility",
    "HorizonProfile",
    "ProfileError",
    "body_visibility",
    "disc_fraction_above_skyline",
    "elevation_angle_deg",
    "geometric_dip_deg",
    "interpolate_skyline",
    "load_profile",
    "load_site_profile",
    "obstruction_state",
]
