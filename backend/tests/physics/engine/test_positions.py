
"""Tests for SPICE-based lunar body positions."""

from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pytest

from app.physics.engine.kernel_loader import (
    SPICE_KERNELS,
    load_kernels,
    clear_kernels,
)
from app.physics.engine.positions import (
    get_sun_position,
    get_earth_position,
    utc_to_et,
)

BACKEND_DIR = Path(__file__).resolve().parents[3]
SPICE_DIR = (
    BACKEND_DIR / "app" / "physics" / "data" / "datasets" / "spice"
)

KERNELS_AVAILABLE = (
    SPICE_DIR.is_dir()
    and all((SPICE_DIR / filename).is_file() for filename in SPICE_KERNELS)
)

pytestmark = pytest.mark.skipif(
    not KERNELS_AVAILABLE,
    reason="Local SPICE kernel files are not installed.",
)


def setup_module():
    load_kernels(SPICE_DIR)


def teardown_module():
    clear_kernels()


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
