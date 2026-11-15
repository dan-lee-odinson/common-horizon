
from datetime import datetime, timezone

import numpy as np
import spiceypy as spice

from app.physics.engine.kernel_loader import (
    load_kernels,
    clear_kernels,
)

from app.physics.engine.positions import (
    get_sun_position,
    get_earth_position,
    utc_to_et,
)


from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[3]
SPICE_DIR = BACKEND_DIR / "app" / "physics" / "data" / "datasets" / "spice"


def setup_module():
    load_kernels(SPICE_DIR)


def test_utc_conversion():
    utc = datetime(2026, 11, 14, 12, 0, tzinfo=timezone.utc)

    et = utc_to_et(utc)

    assert np.isfinite(et)


def test_sun_position():
    utc = datetime(2026, 11, 14, 12, 0, tzinfo=timezone.utc)

    position = get_sun_position(utc)

    assert len(position) == 3
    assert np.all(np.isfinite(position))
    assert np.linalg.norm(position) > 0


def test_earth_position():
    utc = datetime(2026, 11, 14, 12, 0, tzinfo=timezone.utc)

    position = get_earth_position(utc)

    assert len(position) == 3
    assert np.all(np.isfinite(position))
    assert np.linalg.norm(position) > 0