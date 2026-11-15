"""Terrain horizon profiles: the skyline around a site and what it hides.

Two halves:

* ``profile`` (with ``geometry``) is pure Python. It loads a stored profile and
  interpolates the skyline. This is what the service can use at run time.
* ``compute`` and ``dem`` build the profiles from elevation models. They need
  numpy and rasterio (``backend/requirements-tools.txt``), run offline, and are
  deliberately not imported here.
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

__all__ = [
    "DEFAULT_PROFILE_DIR",
    "MOON_RADIUS_M",
    "HorizonProfile",
    "ProfileError",
    "elevation_angle_deg",
    "geometric_dip_deg",
    "interpolate_skyline",
    "load_profile",
    "load_site_profile",
]
