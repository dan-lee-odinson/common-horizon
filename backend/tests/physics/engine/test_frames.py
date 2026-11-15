
import numpy as np

from app.physics.engine.frames import (
    get_local_coords,
    get_local_components,
    get_azimuth_elevation,
)

def test_local_basis_is_orthogonal():
    east, north, up = get_local_coords(-89.684, 196.739)

    assert np.isclose(np.dot(east, north), 0)
    assert np.isclose(np.dot(east, up), 0)
    assert np.isclose(np.dot(north, up), 0)


def test_local_basis_has_unit_vectors():
    east, north, up = get_local_coords(-89.684, 196.739)

    assert np.isclose(np.linalg.norm(east), 1)
    assert np.isclose(np.linalg.norm(north), 1)
    assert np.isclose(np.linalg.norm(up), 1)


def test_north_direction():
    _, north, _ = get_local_coords(0.0, 0.0)

    azimuth, elevation = get_azimuth_elevation(north, 0.0, 0.0)

    assert np.isclose(azimuth, 0.0)
    assert np.isclose(elevation, 0.0)


def test_east_direction():
    east, _, _ = get_local_coords(0.0, 0.0)

    azimuth, elevation = get_azimuth_elevation(east, 0.0, 0.0)

    assert np.isclose(azimuth, 90.0)
    assert np.isclose(elevation, 0.0)
