"""CORS: FastAPI owns it. Exact, normalised origins only; never a wildcard."""

import pytest
from fastapi.testclient import TestClient

from app.config import (
    DEFAULT_CORS_ORIGINS,
    Settings,
    get_settings,
    normalize_origin,
    parse_cors_origins,
)
from app.main import create_app
from tests.conftest import VALID_MISSION

EVALUATE = "/api/v1/missions/evaluate"
PRODUCTION = ("https://commonhorizon.study", "https://www.commonhorizon.study")
LOCAL_DEV = "http://localhost:5173"
AMPLIFY = "https://main.d2abcdef123456.amplifyapp.com"
FOREIGN = "https://evil.example.com"


def _client(*origins: str) -> TestClient:
    return TestClient(create_app(Settings(physics_engine="synthetic", cors_origins=origins)))


def _preflight(client: TestClient, origin: str, method: str = "POST", headers: str = "content-type"):
    return client.options(
        EVALUATE,
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": method,
            "Access-Control-Request-Headers": headers,
        },
    )


@pytest.fixture
def clean_settings_cache():
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


# --- defaults -------------------------------------------------------------------------------------


def test_defaults_are_production_domains_and_local_vite_only():
    assert DEFAULT_CORS_ORIGINS == (*PRODUCTION, LOCAL_DEV)


def test_environment_defaults(monkeypatch, clean_settings_cache):
    monkeypatch.delenv("CH_CORS_ORIGINS", raising=False)
    monkeypatch.delenv("CH_CORS_EXTRA_ORIGINS", raising=False)

    assert get_settings().cors_origins == DEFAULT_CORS_ORIGINS


# --- preflight ------------------------------------------------------------------------------------


@pytest.mark.parametrize("origin", [*PRODUCTION, LOCAL_DEV])
def test_preflight_from_allowed_origin_succeeds(origin):
    with _client(*DEFAULT_CORS_ORIGINS) as client:
        response = _preflight(client, origin)

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == origin  # echoed, never "*"
    assert "POST" in response.headers["access-control-allow-methods"]
    assert "content-type" in response.headers["access-control-allow-headers"].lower()
    assert "access-control-allow-credentials" not in response.headers
    assert "origin" in response.headers["vary"].lower()


@pytest.mark.parametrize(
    "origin",
    [
        FOREIGN,
        "https://commonhorizon.study.evil.example.com",  # suffix attack
        "https://evilcommonhorizon.study",
        "http://commonhorizon.study",  # wrong scheme
        "https://commonhorizon.study:8443",  # wrong port
        "http://localhost:3000",  # dropped default
        AMPLIFY,  # not allowed until configured
        "null",
    ],
)
def test_preflight_from_disallowed_origin_is_rejected(origin):
    with _client(*DEFAULT_CORS_ORIGINS) as client:
        response = _preflight(client, origin)

    assert response.status_code == 400
    assert "access-control-allow-origin" not in response.headers


@pytest.mark.parametrize(("method", "headers"), [("DELETE", "content-type"), ("POST", "authorization")])
def test_preflight_for_unlisted_method_or_header_is_rejected(method, headers):
    with _client(*DEFAULT_CORS_ORIGINS) as client:
        response = _preflight(client, PRODUCTION[0], method=method, headers=headers)

    assert response.status_code == 400


# --- actual requests ------------------------------------------------------------------------------


def test_allowed_origin_gets_cors_headers_and_exposed_data_source():
    with _client(*DEFAULT_CORS_ORIGINS) as client:
        response = client.post(EVALUATE, json=VALID_MISSION, headers={"Origin": PRODUCTION[1]})

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == PRODUCTION[1]
    assert "x-data-source" in response.headers["access-control-expose-headers"].lower()


def test_disallowed_origin_gets_no_cors_headers():
    with _client(*DEFAULT_CORS_ORIGINS) as client:
        response = client.get("/health", headers={"Origin": FOREIGN})

    assert response.status_code == 200  # CORS is enforced by the browser; the server only withholds the headers
    assert "access-control-allow-origin" not in response.headers


# --- environment configuration --------------------------------------------------------------------


def test_extra_origins_are_added_to_defaults(monkeypatch, clean_settings_cache):
    monkeypatch.delenv("CH_CORS_ORIGINS", raising=False)
    monkeypatch.setenv("CH_CORS_EXTRA_ORIGINS", f" {AMPLIFY}/ ")

    assert get_settings().cors_origins == (*DEFAULT_CORS_ORIGINS, AMPLIFY)
    with TestClient(create_app()) as client:
        assert _preflight(client, AMPLIFY).status_code == 200
        assert _preflight(client, PRODUCTION[0]).status_code == 200


def test_cors_origins_replaces_defaults(monkeypatch, clean_settings_cache):
    monkeypatch.setenv("CH_CORS_ORIGINS", f"{AMPLIFY},{PRODUCTION[0]}")
    monkeypatch.delenv("CH_CORS_EXTRA_ORIGINS", raising=False)

    assert get_settings().cors_origins == (AMPLIFY, PRODUCTION[0])


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("https://commonhorizon.study/", "https://commonhorizon.study"),
        ("  https://www.commonhorizon.study//  ", "https://www.commonhorizon.study"),
        ("HTTPS://WWW.CommonHorizon.Study", "https://www.commonhorizon.study"),
        ("https://commonhorizon.study:443", "https://commonhorizon.study"),
        ("http://localhost:5173/", "http://localhost:5173"),
        ("http://127.0.0.1:8000", "http://127.0.0.1:8000"),
        ("http://[::1]:5173", "http://[::1]:5173"),
        ("http://localhost:80", "http://localhost"),
    ],
)
def test_origins_are_normalised_to_browser_form(raw, expected):
    assert normalize_origin(raw) == expected


@pytest.mark.parametrize(
    "raw",
    [
        "*",
        "https://*.amplifyapp.com",
        "null",
        "commonhorizon.study",  # no scheme
        "ftp://commonhorizon.study",
        "http://commonhorizon.study",  # plain http only for local development
        "https://commonhorizon.study/app",  # path
        "https://commonhorizon.study?x=1",
        "https://commonhorizon.study#top",
        "https://user@commonhorizon.study",
        "https://commonhorizon.study:99999",
        "https://",
    ],
)
def test_invalid_or_wildcard_origins_are_refused(raw):
    with pytest.raises(ValueError):
        normalize_origin(raw)


def test_invalid_origin_in_environment_fails_at_startup(monkeypatch, clean_settings_cache):
    monkeypatch.setenv("CH_CORS_EXTRA_ORIGINS", "*")

    with pytest.raises(ValueError, match="wildcard"):
        get_settings()


def test_settings_built_in_code_are_normalised_and_cannot_hold_a_wildcard():
    settings = Settings(physics_engine="synthetic", cors_origins=("https://commonhorizon.study/",))
    assert settings.cors_origins == ("https://commonhorizon.study",)

    with pytest.raises(ValueError):
        Settings(physics_engine="synthetic", cors_origins=("*",))


def test_parsing_skips_blanks_and_removes_duplicates():
    assert parse_cors_origins(
        "https://commonhorizon.study/, ,https://commonhorizon.study,http://localhost:5173", None
    ) == ("https://commonhorizon.study", "http://localhost:5173")
    assert parse_cors_origins("  ", "") == DEFAULT_CORS_ORIGINS
    assert parse_cors_origins(None, f"{PRODUCTION[0]}/") == DEFAULT_CORS_ORIGINS
