"""Sun and Earth azimuth/elevation over time at a lunar surface site."""

from datetime import datetime, timedelta, timezone
import math

import numpy as np

from .frames import get_azimuth_elevation, get_site_position
from .positions import get_sun_position, get_earth_position

MOON_RADIUS_KM = 1737.4


def compute_sun_earth_angles(
    latitude_deg: float,
    longitude_deg: float,
    start_time: datetime,
    duration_seconds: float,
    time_step_seconds: float,
) -> list[dict]:
    """
    Calculate Sun and Earth azimuth/elevation at a lunar site over time.

    Parameters:
        latitude_deg: Planetocentric latitude, degrees.
        longitude_deg: East-positive longitude, degrees.
        start_time: Timezone-aware starting datetime.
        duration_seconds: Total sampling duration, seconds.
        time_step_seconds: Interval between samples, seconds.

    Returns:
        A list of timestamped Sun/Earth azimuth and elevation values.
        Angles are in degrees; timestamps are UTC ISO 8601 strings.

    Positions are calculated in MOON_ME, in kilometres.
    Terrain obstruction and observer altitude are not included.
    """

    if not math.isfinite(latitude_deg) or not -90.0 <= latitude_deg <= 90.0:
        raise ValueError("Latitude must be finite and between -90 and 90 degrees.")

    if not math.isfinite(longitude_deg):
        raise ValueError("Longitude must be finite.")

    if start_time.tzinfo is None or start_time.utcoffset() is None:
        raise ValueError("start_time must be timezone-aware.")

    if not math.isfinite(duration_seconds) or duration_seconds < 0:
        raise ValueError("Duration must be finite and non-negative.")

    if not math.isfinite(time_step_seconds) or time_step_seconds <= 0:
        raise ValueError("Time step must be finite and positive.")

    start_time = start_time.astimezone(timezone.utc)
    longitude_deg %= 360.0

    site_position = get_site_position(
        latitude_deg,
        longitude_deg,
        MOON_RADIUS_KM,
    )

    # Include the requested end time, even if duration is not an exact multiple of the time step.
    offsets = []
    sample_index = 0

    while sample_index * time_step_seconds < duration_seconds:
        offsets.append(sample_index * time_step_seconds)
        sample_index += 1

    if not offsets or not math.isclose(
        offsets[-1], duration_seconds, rel_tol=1e-12, abs_tol=1e-9
    ):
        offsets.append(duration_seconds)

    results = []

    for offset in offsets:
        sample_time = start_time + timedelta(seconds=offset)

        sun_position = np.asarray(
            get_sun_position(sample_time),
            dtype=float,
        )
        earth_position = np.asarray(
            get_earth_position(sample_time),
            dtype=float,
        )

        if sun_position.shape != (3,) or earth_position.shape != (3,):
            raise ValueError("SPICE body positions must contain three components.")

        if not np.all(np.isfinite(sun_position)) or not np.all(
            np.isfinite(earth_position)
        ):
            raise ValueError("SPICE returned a non-finite body position.")

        sun_direction = sun_position - site_position
        earth_direction = earth_position - site_position

        sun_azimuth, sun_elevation = get_azimuth_elevation(
            sun_direction,
            latitude_deg,
            longitude_deg,
        )

        earth_azimuth, earth_elevation = get_azimuth_elevation(
            earth_direction,
            latitude_deg,
            longitude_deg,
        )

        results.append({
            "timestamp": sample_time.isoformat(),
            "sun_azimuth_deg": sun_azimuth,
            "sun_elevation_deg": sun_elevation,
            "earth_azimuth_deg": earth_azimuth,
            "earth_elevation_deg": earth_elevation,
        })

    return results
