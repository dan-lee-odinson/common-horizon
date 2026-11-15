""" Coordinate transofrmations for physics engine
Reference frame: MOON_ME
Coordinate convention:
- Latitude: planetocentric, degrees
- Longitude: east-positive, degrees
- Position: kilometres
"""

import numpy as np

# Get local direction unit vectors to set up local coordinate system
def get_local_coords(latitude_deg: float, longitude_deg: float,) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """ Calculate local east, north, up unit vectors at site
    Returns: Local east/north/up unit vectors expressed in MOON_ME """

    lat = np.radians(latitude_deg)
    lon = np.radians(longitude_deg)

    east = np.array([-np.sin(lon), np.cos(lon), 0.0])
    north = np.array([-np.sin(lat) * np.cos(lon), -np.sin(lat) * np.sin(lon), np.cos(lat),])

    up = np.array([np.cos(lat) * np.cos(lon), np.cos(lat) * np.sin(lon), np.sin(lat),])

    return east, north, up

# Project moon-centred vector onto local coordinate system
def get_local_components(vector_moon: np.ndarray, latitude_deg: float, longitude_deg: float,) -> tuple[float, float, float]:
    """ Project moon-centred vector onto local coordinate system (East, North, Up)
        Returns: east_component, north_component_ up_component """
    east, north, up = get_local_coords(latitude_deg, longitude_deg,)

    east_component = float(np.dot(vector_moon, east))
    north_component = float(np.dot(vector_moon, north))
    up_component = float(np.dot(vector_moon, up))

    return east_component, north_component, up_component

# Calculate azimuth and elevation of direction vector
def get_azimuth_elevation(vector_moon: np.ndarray, latitude_deg: float, longitude_deg: float,) -> tuple[float, float]:
    east, north, up = get_local_components(vector_moon, latitude_deg, longitude_deg,)

    azimuth = np.degrees(np.arctan2(east, north)) % 360
    horizontal = np.sqrt(east**2 + north**2)
    elevation = np.degrees(np.arctan2(up, horizontal))

    return float(azimuth), float(elevation)


# Calculate moon-centred position of a site in MOON_ME Coordinates
def get_site_position(latitude_deg: float, longitude_deg: float, radius_km: float,) -> np.ndarray:
    lat = np.radians(latitude_deg)
    lon = np.radians(longitude_deg)

    x = radius_km * np.cos(lat) * np.cos(lon)
    y = radius_km * np.cos(lat) * np.sin(lon)
    z = radius_km * np.sin(lat)

    return np.array([x, y, z])