"""GET /api/v1/horizons/compare. No network and no kernels: Horizons and the engine are stand-ins."""

import urllib.error
from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from app.api import horizons
from app.main import create_app
from app.physics import horizons_client
from app.physics.horizons_client import HorizonsError

URL = "/api/v1/horizons/compare"
PLACE = {"latitude_deg": -89.684, "longitude_deg": 196.739, "site_height_m": 1726.649, "observer_height_m": 2.0}
MONTH_NAMES = {number: name for name, number in horizons_client.MONTHS.items()}
KERNELS = ["naif0012.tls", "de440s.bsp", "moon_pa_de440_200625.bpc", "moon_de440_250416.tf"]


class StandInHorizons:
    """Answers like Horizons' text API: two one-minute rows per query, fixed azimuth and elevation."""

    def __init__(self, directions=None, fail: Exception | None = None):
        self.directions = directions or {"10": (120.0, 30.0), "399": (200.0, 10.0)}
        self.fail = fail
        self.calls: list[tuple[dict, float]] = []

    def __call__(self, params: dict, timeout_s: float) -> str:
        self.calls.append((params, timeout_s))
        if self.fail is not None:
            raise self.fail
        start = datetime.strptime(params["START_TIME"].strip("'"), "%Y-%m-%d %H:%M")
        az, el = self.directions[params["COMMAND"].strip("'")]
        rows = []
        for i in range(2):
            t = start + timedelta(minutes=i)
            rows.append(f" {t.year}-{MONTH_NAMES[t.month]}-{t.day:02d} {t:%H:%M}, , , {az + i:.6f}, {el:.6f},")
        return "API VERSION: 1.2\nAPI SOURCE: NASA/JPL Horizons API\n\n$$SOE\n" + "\n".join(rows) + "\n$$EOE\n"


class StandInEngine:
    def __init__(self, directions):
        self.directions = directions
        self.calls: list[tuple[dict, datetime]] = []

    def __call__(self, site, when):
        self.calls.append((site, when))
        return self.directions


@pytest.fixture
def make_client(monkeypatch):
    monkeypatch.delenv("CH_SPICE_KERNEL_DIR", raising=False)

    def build(fetch=None, engine=None, cache=None):
        app = create_app()
        answer_cache = cache if cache is not None else horizons.AnswerCache()
        if fetch is not None:
            app.dependency_overrides[horizons.get_horizons_fetch] = lambda: fetch
        app.dependency_overrides[horizons.get_answer_cache] = lambda: answer_cache
        if engine is not None:
            app.dependency_overrides[horizons.get_engine] = lambda: engine
        return TestClient(app)

    return build


def test_good_answer_puts_both_sides_and_the_angle_between_them(make_client):
    fetch = StandInHorizons()
    engine = StandInEngine({"sun": (120.003, 30.004), "earth": (200.0, 10.0)})
    client = make_client(fetch, engine)

    response = client.get(URL, params={**PLACE, "time_utc": "2027-06-01T12:00:20Z"})

    assert response.status_code == 200
    body = response.json()
    assert body["time_utc"] == "2027-06-01T12:00:00Z"
    assert body["sun"]["horizons"] == {"azimuth_deg": 120.0, "elevation_deg": 30.0}
    assert body["sun"]["engine"] == {"azimuth_deg": 120.003, "elevation_deg": 30.004}
    expected = round(horizons_client.separation_deg((120.003, 30.004), (120.0, 30.0)), 6)
    assert body["sun"]["angle_between_deg"] == expected > 0
    assert body["earth"]["angle_between_deg"] == 0.0
    assert body["engine_unavailable_reason"] is None
    provenance = body["provenance"]
    assert provenance["horizons"]["api_url"] == "https://ssd.jpl.nasa.gov/api/horizons.api"
    assert provenance["horizons"]["api_version"] == "1.2"
    assert provenance["horizons"]["from_cache"] is False
    assert provenance["engine"]["kernels"] == KERNELS
    # One query per body, both for the rounded minute and this place, within the 10 s budget.
    assert [p["COMMAND"] for p, _ in fetch.calls] == ["'10'", "'399'"]
    assert all(p["START_TIME"] == "'2027-06-01 12:00'" for p, _ in fetch.calls)
    assert all(p["SITE_COORD"] == "'196.739000,-89.684000,1.728649'" for p, _ in fetch.calls)
    assert all(0 < timeout <= 10 for _, timeout in fetch.calls)
    assert provenance["horizons"]["queries"]["sun"]["SITE_COORD"] == "196.739000,-89.684000,1.728649"
    # The engine ran for the same minute and place.
    [(site, when)] = engine.calls
    assert when.isoformat() == "2027-06-01T12:00:00+00:00"
    assert site == PLACE


def test_horizons_down_gives_502_with_a_json_reason(make_client, monkeypatch):
    def no_answer(url, timeout):
        assert timeout <= 10
        raise urllib.error.URLError(TimeoutError("timed out"))

    # The production fetch, with the network replaced: Horizons does not answer.
    monkeypatch.setattr(horizons_client.urllib.request, "urlopen", no_answer)
    engine = StandInEngine({"sun": (1.0, 2.0), "earth": (3.0, 4.0)})
    client = make_client(engine=engine)

    response = client.get(URL, params={**PLACE, "time_utc": "2027-06-01T12:00:00Z"})

    assert response.status_code == 502
    body = response.json()
    assert body["error"] == "horizons_unavailable"
    assert "TimeoutError" in body["reason"]
    assert body["horizons_api"] == horizons_client.API
    assert engine.calls == []  # no half answer


def test_horizons_answer_without_a_table_is_also_502(make_client):
    def bad_answer(params, timeout_s):
        return "API VERSION: 1.2\nCannot interpret date. Type \"?!\" for help.\n"

    client = make_client(bad_answer, StandInEngine({}))

    response = client.get(URL, params={**PLACE, "time_utc": "2027-06-01T12:00:00Z"})

    assert response.status_code == 502
    assert response.json()["error"] == "horizons_unavailable"


def test_kernels_not_configured_gives_engine_null_with_a_reason(make_client):
    client = make_client(StandInHorizons())

    response = client.get(URL, params={**PLACE, "time_utc": "2027-06-01T12:00:00Z"})

    assert response.status_code == 200
    body = response.json()
    assert body["sun"]["horizons"] == {"azimuth_deg": 120.0, "elevation_deg": 30.0}
    for name in ("sun", "earth"):
        assert body[name]["engine"] is None
        assert body[name]["angle_between_deg"] is None
    assert "CH_SPICE_KERNEL_DIR is not set" in body["engine_unavailable_reason"]


def test_kernels_missing_from_the_folder_gives_engine_null_and_names_them(make_client, monkeypatch, tmp_path):
    (tmp_path / "naif0012.tls").write_text("not a real kernel", encoding="utf-8")
    monkeypatch.setenv("CH_SPICE_KERNEL_DIR", str(tmp_path))
    client = make_client(StandInHorizons())

    response = client.get(URL, params={**PLACE, "time_utc": "2027-06-01T12:00:00Z"})

    assert response.status_code == 200
    body = response.json()
    assert body["sun"]["engine"] is None and body["earth"]["engine"] is None
    reason = body["engine_unavailable_reason"]
    assert "de440s.bsp" in reason and "naif0012.tls" not in reason
    assert str(tmp_path) not in response.text  # never the server's folder


@pytest.mark.parametrize(
    "change",
    [
        {"latitude_deg": 90.5},
        {"latitude_deg": -91},
        {"latitude_deg": "nan"},
        {"longitude_deg": -0.1},
        {"longitude_deg": 360.5},
        {"time_utc": "1949-12-31T23:59:00Z"},
        {"time_utc": "2101-01-01T00:00:00Z"},
        {"time_utc": "2027-06-01T12:00:00"},  # no timezone
        {"observer_height_m": -1},
    ],
)
def test_bad_input_is_422_and_nothing_is_asked(make_client, change):
    fetch = StandInHorizons()
    client = make_client(fetch, StandInEngine({}))

    response = client.get(URL, params={**PLACE, "time_utc": "2027-06-01T12:00:00Z", **change})

    assert response.status_code == 422
    assert fetch.calls == []


def test_missing_latitude_is_422(make_client):
    client = make_client(StandInHorizons(), StandInEngine({}))
    params = {k: v for k, v in PLACE.items() if k != "latitude_deg"}

    assert client.get(URL, params={**params, "time_utc": "2027-06-01T12:00:00Z"}).status_code == 422


def test_same_place_and_minute_is_answered_from_the_cache(make_client):
    fetch = StandInHorizons()
    client = make_client(fetch, StandInEngine({"sun": (120.0, 30.0), "earth": (200.0, 10.0)}))

    first = client.get(URL, params={**PLACE, "time_utc": "2027-06-01T12:00:10Z"}).json()
    second = client.get(URL, params={**PLACE, "time_utc": "2027-06-01T11:59:40Z"}).json()

    assert len(fetch.calls) == 2  # Sun and Earth once
    assert first["provenance"]["horizons"]["from_cache"] is False
    assert second["provenance"]["horizons"]["from_cache"] is True
    assert second["sun"]["horizons"] == first["sun"]["horizons"]

    client.get(URL, params={**PLACE, "time_utc": "2027-06-01T12:01:00Z"})
    client.get(URL, params={**PLACE, "latitude_deg": -89.0, "time_utc": "2027-06-01T12:00:00Z"})
    assert len(fetch.calls) == 6  # another minute and another place are asked again


def test_failed_answers_are_not_cached(make_client):
    fetch = StandInHorizons(fail=HorizonsError("Horizons did not answer (TimeoutError)"))
    client = make_client(fetch, StandInEngine({"sun": (120.0, 30.0), "earth": (200.0, 10.0)}))
    params = {**PLACE, "time_utc": "2027-06-01T12:00:00Z"}

    assert client.get(URL, params=params).status_code == 502
    fetch.fail = None
    assert client.get(URL, params=params).status_code == 200
    assert len(fetch.calls) == 3


def test_cache_keeps_the_last_answers_and_drops_the_oldest():
    assert horizons.AnswerCache().maxsize == 256
    cache = horizons.AnswerCache(maxsize=2)
    answers = [horizons.HorizonsAnswer({}, "1.2", datetime(2026, 11, 15), {}) for _ in range(3)]

    cache.put(("a", "t"), answers[0])
    cache.put(("b", "t"), answers[1])
    assert cache.get(("a", "t")) is answers[0]  # "a" is now the most recently used
    cache.put(("c", "t"), answers[2])

    assert len(cache) == 2
    assert cache.get(("b", "t")) is None
    assert cache.get(("a", "t")) is answers[0] and cache.get(("c", "t")) is answers[2]


def test_route_is_registered_but_not_in_the_shared_contract(app):
    with TestClient(app) as client:
        assert client.get(URL).status_code == 422  # there, and asking for its query fields
    assert URL not in app.openapi()["paths"]
