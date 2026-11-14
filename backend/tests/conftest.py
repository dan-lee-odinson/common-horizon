import copy

import pytest
from fastapi.testclient import TestClient

from app.main import create_app

VALID_MISSION = {
    "landing_site": {"latitude_deg": -89.5, "longitude_deg": -45.0, "altitude_m": 1200.0},
    "observer_height_m": 2.0,
    "mission_start_utc": "2027-01-15T00:00:00Z",
    "stay_duration_days": 2,
    "time_step_s": 3600,
}


@pytest.fixture
def app():
    return create_app()


@pytest.fixture
def client(app):
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def mission_payload() -> dict:
    return copy.deepcopy(VALID_MISSION)
