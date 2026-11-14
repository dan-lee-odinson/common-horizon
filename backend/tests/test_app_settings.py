"""Dependencies must follow the ``Settings`` passed to ``create_app``, not the process environment.

Regression test for the independent Codex review of c34f59e (PR #4): an app created with
``Settings(physics_engine="physics")`` still served synthetic data under default environment settings.
"""

import pytest
from fastapi.testclient import TestClient

from app.config import DEFAULT_CORS_ORIGINS, Settings, get_settings
from app.main import create_app
from tests.conftest import VALID_MISSION

URL = "/api/v1/missions/evaluate"


@pytest.fixture
def clean_settings_cache():
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def _client(engine_name: str) -> TestClient:
    return TestClient(create_app(Settings(physics_engine=engine_name, cors_origins=DEFAULT_CORS_ORIGINS)))


def test_supplied_physics_setting_is_used_even_when_environment_says_synthetic(monkeypatch, clean_settings_cache):
    monkeypatch.setenv("CH_PHYSICS_ENGINE", "synthetic")

    with _client("physics") as client:
        response = client.post(URL, json=VALID_MISSION)
        health = client.get("/health").json()["physics_engine"]

    assert response.status_code == 503
    assert "X-Data-Source" not in response.headers
    assert health["is_synthetic"] is False
    assert health["available"] is False


def test_supplied_synthetic_setting_is_used_even_when_environment_says_physics(monkeypatch, clean_settings_cache):
    monkeypatch.setenv("CH_PHYSICS_ENGINE", "physics")

    with _client("synthetic") as client:
        response = client.post(URL, json=VALID_MISSION)

    assert response.status_code == 200
    assert response.headers["X-Data-Source"] == "synthetic"
    assert response.json()["provenance"]["is_synthetic"] is True
