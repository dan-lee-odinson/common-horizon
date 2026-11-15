"""Scalar horizon geometry on a spherical Moon (pure Python, no third-party packages).

Everything here is exact spherical geometry: no small-angle shortcuts, no
atmosphere and therefore no refraction. The numpy ray walker in
``app.physics.horizon.compute`` applies the same formulas to whole arrays; the
tests compare the two.

Conventions (the same as the API contract):

* radii and heights in metres, heights relative to the 1737.4 km sphere;
* body-fixed vectors in the MOON_ME frame, +z through the north pole, +x through
  longitude 0 on the equator, east longitude positive;
* azimuth in degrees clockwise from local north (0 = north, 90 = east);
* elevation in degrees above the observer's local horizontal plane, the plane
  perpendicular to the radius through the observer.
"""

import math

MOON_RADIUS_M = 1_737_400.0

Vec = tuple[float, float, float]


def unit_from_lat_lon(latitude_deg: float, longitude_deg: float) -> Vec:
    """Unit vector from the Moon's centre through (latitude, east longitude)."""
    lat, lon = math.radians(latitude_deg), math.radians(longitude_deg)
    return (math.cos(lat) * math.cos(lon), math.cos(lat) * math.sin(lon), math.sin(lat))


def local_frame(latitude_deg: float, longitude_deg: float) -> tuple[Vec, Vec, Vec]:
    """``(up, east, north)`` unit vectors at a site.

    At the poles themselves "north" has no natural direction; the longitude given
    then fixes it (north points along the meridian of that longitude), so the
    frame stays well defined and continuous along that meridian.
    """
    lat, lon = math.radians(latitude_deg), math.radians(longitude_deg)
    up = (math.cos(lat) * math.cos(lon), math.cos(lat) * math.sin(lon), math.sin(lat))
    east = (-math.sin(lon), math.cos(lon), 0.0)
    north = (-math.sin(lat) * math.cos(lon), -math.sin(lat) * math.sin(lon), math.cos(lat))
    return up, east, north


def destination_unit(latitude_deg: float, longitude_deg: float, azimuth_deg: float, central_angle_rad: float) -> Vec:
    """Unit vector reached by leaving the site along ``azimuth_deg`` for ``central_angle_rad`` of great circle."""
    up, east, north = local_frame(latitude_deg, longitude_deg)
    az = math.radians(azimuth_deg)
    ca, sa = math.cos(az), math.sin(az)
    cp, sp = math.cos(central_angle_rad), math.sin(central_angle_rad)
    return (
        up[0] * cp + (north[0] * ca + east[0] * sa) * sp,
        up[1] * cp + (north[1] * ca + east[1] * sa) * sp,
        up[2] * cp + (north[2] * ca + east[2] * sa) * sp,
    )


def lat_lon_from_unit(vector: Vec) -> tuple[float, float]:
    """``(latitude_deg, east longitude_deg in 0..360)`` of a unit vector."""
    x, y, z = vector
    latitude = math.degrees(math.asin(max(-1.0, min(1.0, z))))
    longitude = math.degrees(math.atan2(y, x)) % 360.0
    return latitude, longitude


def geometric_dip_deg(observer_radius_m: float, surface_radius_m: float = MOON_RADIUS_M) -> float:
    """Elevation of the horizon of a smooth sphere: ``-arccos(R / (R + h))`` in degrees.

    This is the "no terrain" reference. It is negative: an observer standing above
    a smooth sphere looks slightly down to its horizon.
    """
    if observer_radius_m < surface_radius_m:
        raise ValueError("the observer must not be below the surface")
    return -math.degrees(math.acos(surface_radius_m / observer_radius_m))


def elevation_tangent(observer_radius_m: float, target_radius_m: float, central_angle_rad: float) -> float:
    """Tangent of the elevation angle of a point seen from the observer.

    The observer is at ``observer_radius_m`` from the Moon's centre, the point at
    ``target_radius_m``, and the two radii are ``central_angle_rad`` apart. In the
    plane through both radii, with the observer's radius as the vertical axis, the
    point is ``target * cos(angle) - observer`` above the observer's horizontal
    plane and ``target * sin(angle)`` away along it. Curvature is in the cosine.
    """
    return (target_radius_m * math.cos(central_angle_rad) - observer_radius_m) / (
        target_radius_m * math.sin(central_angle_rad)
    )


def elevation_angle_deg(observer_radius_m: float, target_radius_m: float, central_angle_rad: float) -> float:
    """Elevation angle, degrees, of a point seen from the observer (see ``elevation_tangent``)."""
    return math.degrees(math.atan(elevation_tangent(observer_radius_m, target_radius_m, central_angle_rad)))


def bound_tangent_beyond(observer_radius_m: float, highest_radius_m: float, central_angle_rad: float) -> float:
    """Largest elevation tangent any terrain at or beyond ``central_angle_rad`` can have.

    ``highest_radius_m`` is the radius of the highest terrain that exists. The
    elevation tangent grows with the terrain radius, so the bound is the curve
    for terrain at that radius. That curve falls with distance once the terrain
    is past the point where the line of sight is tangent to the sphere of radius
    ``highest_radius_m``; before that point (only possible when the observer is
    above the highest terrain) the bound is the tangent value itself.
    """
    if observer_radius_m * math.cos(central_angle_rad) > highest_radius_m:
        return -math.sqrt(observer_radius_m**2 - highest_radius_m**2) / highest_radius_m
    return elevation_tangent(observer_radius_m, highest_radius_m, central_angle_rad)
