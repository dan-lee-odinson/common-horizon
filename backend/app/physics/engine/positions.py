"""Calculate Moon-centred positions of celestial bodies using SPICE."""

from datetime import datetime, timezone
import spiceypy as spice

REFERENCE_FRAME = "MOON_ME"
OBSERVER = "MOON"

# Geometric positions (no light-time or abberation correction)
ABERRATION_CORRECTION = "NONE"

# Function to convert UTC to ET
def utc_to_et(utc_time: datetime) -> float:
    if utc_time.tzinfo is None or utc_time.utcoffset() is None:
        raise ValueError("utc_time must be timezone-aware")

    utc_time = utc_time.astimezone(timezone.utc)

    # SPICE-compatible UTC format
    utc_string = utc_time.strftime("%Y-%m-%d %H:%M:%S UTC")

    return spice.str2et(utc_string)

# Function to calculate celestial body's moon-cenetred position vector
def get_body_position(body: str, utc_time: datetime, ) -> list[float]:
    """ Parameters: body = SPICE body such as 'SUN' or 'EARTH'
                    utc_time = time of calculation in UTC
        Returns: list[float] = 3-component position vector in km expressed in MOON_ME reference frame
    """

    et = utc_to_et(utc_time)

    position, light_time = spice.spkpos(body, et, REFERENCE_FRAME, ABERRATION_CORRECTION, OBSERVER,)

    return [float(component) for component in position]

def get_sun_position(utc_time: datetime) -> list[float]:
    return get_body_position("SUN", utc_time)

def get_earth_position(utc_time: datetime) -> list[float]:
    return get_body_position("EARTH", utc_time)