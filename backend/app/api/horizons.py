"""Live comparison with NASA's JPL Horizons System: ``GET /api/v1/horizons/compare``.

For one place on the Moon and one minute, the route asks Horizons for the apparent azimuth and
elevation of the Sun and of the Earth, works out the same two directions with the physics engine,
and reports the angle on the sky between each pair.

* Engine side: ``engine_az_el`` below, which ``scripts/validate_against_horizons.py`` (the stored
  year-long check) also uses: the body's position from ``app.physics.engine.positions`` minus the
  observer's position at 1737.4 km + site height + observer height, turned into azimuth and
  elevation by ``app.physics.engine.frames``. The four NAIF kernels are loaded from the folder named
  by the environment variable ``CH_SPICE_KERNEL_DIR``. When it is unset or the kernels do not load,
  the Horizons figures are still returned, with ``"engine": null`` and a plain reason. No number is
  ever filled in.
* Horizons side: ``app.physics.horizons_client``, 10 seconds for both requests together. The last
  256 answers are kept in memory, keyed by the query sent: the place (1e-6 degree, 1 mm) and the
  time rounded to the minute. When Horizons does not answer, HTTP 502 with
  ``{"error": "horizons_unavailable", ...}``, so the website can show the stored check
  (``web/public/data/horizons-check.json``) instead.

The route is left out of the OpenAPI schema (``include_in_schema=False``): the exported contract in
``backend/contract/`` is shared with the website and is not regenerated here. The route is described
in ``backend/docs/HORIZONS-CHECK.md``.
"""

import os
import threading
import time
from collections import OrderedDict
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse
from pydantic import AfterValidator, BaseModel, Field

from app.models import limits
from app.models.types import UtcDatetime
from app.physics import horizons_client
from app.physics.horizons_client import BODIES, HorizonsError

# Every SPICE call in this process runs under the engine adapter's lock: SPICE keeps global state and
# is not thread-safe, and FastAPI runs this route in a worker thread.
from app.physics.engine_adapter import _SPICE_LOCK as SPICE_LOCK

router = APIRouter(prefix="/api/v1/horizons", tags=["horizons"])

TIMEOUT_S = 10.0
CACHE_SIZE = 256
KERNEL_DIR_VARIABLE = "CH_SPICE_KERNEL_DIR"
STORED_CHECK_FILE = "web/public/data/horizons-check.json"
EARLIEST_YEAR = 1950
LATEST_YEAR = 2100


# ----------------------------------------------------------------------------- engine side


class EngineUnavailable(Exception):
    """The engine's directions could not be computed; the message is the plain reason."""


def engine_az_el(body: str, site: dict, when: datetime) -> tuple[float, float]:
    """The engine's azimuth and elevation of ``body`` ("sun" or "earth"), degrees.

    SPICE position (Moon-centred, MOON_ME, km, geometric) minus the observer's position at
    1737.4 km + site height + observer height, in the site's east/north/up axes. The kernels must
    already be loaded.
    """
    import numpy as np

    from app.physics.engine import frames, positions

    radius = horizons_client.MOON_RADIUS_KM + (site["site_height_m"] + site["observer_height_m"]) / 1000.0
    observer = frames.get_site_position(site["latitude_deg"], site["longitude_deg"], radius)
    getter = positions.get_sun_position if body == "sun" else positions.get_earth_position
    vector = np.array(getter(when), dtype=float) - observer
    az, el = frames.get_azimuth_elevation(vector, site["latitude_deg"], site["longitude_deg"])
    return float(az), float(el)


_loaded_from: str | None = None


def _kernel_names() -> list[str]:
    try:
        from app.physics.engine.kernel_loader import SPICE_KERNELS
    except ImportError:
        return []
    return list(SPICE_KERNELS)


def _ensure_kernels(kernel_dir: str | None) -> None:
    """Load the four kernels once per folder. Call with ``SPICE_LOCK`` held."""
    global _loaded_from
    if not kernel_dir:
        raise EngineUnavailable(f"{KERNEL_DIR_VARIABLE} is not set on the server, so the engine was not run.")
    if _loaded_from == kernel_dir:
        return
    try:
        from spiceypy.utils.exceptions import SpiceyError

        from app.physics.engine import kernel_loader
    except ImportError as error:
        raise EngineUnavailable(f"The physics engine's packages are not installed ({error.name}).") from None
    # Reasons name files, never the server's folder.
    directory = Path(kernel_dir).expanduser()
    if not directory.is_dir():
        raise EngineUnavailable(f"The folder named by {KERNEL_DIR_VARIABLE} does not exist on the server.")
    missing = [name for name in kernel_loader.SPICE_KERNELS if not (directory / name).is_file()]
    if missing:
        raise EngineUnavailable(f"SPICE kernels missing from {KERNEL_DIR_VARIABLE}: {', '.join(missing)}.")
    try:
        kernel_loader.load_kernels(directory)
    except (OSError, SpiceyError) as error:
        raise EngineUnavailable(f"SPICE could not load the kernels ({type(error).__name__}).") from None
    _loaded_from = kernel_dir


EngineDirections = Callable[[dict, datetime], dict[str, tuple[float, float]]]
"""Maps (site, UTC minute) to {"sun": (az, el), "earth": (az, el)}, or raises EngineUnavailable."""


def spice_engine(kernel_dir: str | None) -> EngineDirections:
    def directions(site: dict, when: datetime) -> dict[str, tuple[float, float]]:
        with SPICE_LOCK:
            _ensure_kernels(kernel_dir)
            from spiceypy.utils.exceptions import SpiceyError

            try:
                return {body: engine_az_el(body, site, when) for body in BODIES}
            except SpiceyError as error:
                raise EngineUnavailable(
                    f"SPICE could not compute the directions at this time ({type(error).__name__})."
                ) from None

    return directions


def get_kernel_dir() -> str | None:
    raw = os.getenv(KERNEL_DIR_VARIABLE)
    return raw.strip() if raw and raw.strip() else None


def get_engine(kernel_dir: Annotated[str | None, Depends(get_kernel_dir)]) -> EngineDirections:
    return spice_engine(kernel_dir)


# ----------------------------------------------------------------------------- Horizons side


@dataclass(frozen=True)
class HorizonsAnswer:
    directions: dict[str, tuple[float, float]]
    api_version: str | None
    retrieved_utc: datetime
    queries: dict[str, dict[str, str]]


class AnswerCache:
    """The last ``maxsize`` Horizons answers, the least recently used dropped first. Thread-safe."""

    def __init__(self, maxsize: int = CACHE_SIZE) -> None:
        self.maxsize = maxsize
        self._items: OrderedDict[tuple[str, str], HorizonsAnswer] = OrderedDict()
        self._lock = threading.Lock()

    def get(self, key: tuple[str, str]) -> HorizonsAnswer | None:
        with self._lock:
            answer = self._items.get(key)
            if answer is not None:
                self._items.move_to_end(key)
            return answer

    def put(self, key: tuple[str, str], answer: HorizonsAnswer) -> None:
        with self._lock:
            self._items[key] = answer
            self._items.move_to_end(key)
            while len(self._items) > self.maxsize:
                self._items.popitem(last=False)

    def __len__(self) -> int:
        with self._lock:
            return len(self._items)

    def clear(self) -> None:
        with self._lock:
            self._items.clear()


_CACHE = AnswerCache()

Fetch = Callable[[dict[str, str], float], str]
"""Sends one Horizons query with a timeout in seconds and returns the text answer."""


def get_horizons_fetch() -> Fetch:
    return horizons_client.fetch_text


def get_answer_cache() -> AnswerCache:
    return _CACHE


def ask_horizons(site: dict, minute: datetime, fetch: Fetch, cache: AnswerCache) -> tuple[HorizonsAnswer, bool]:
    """Horizons' Sun and Earth directions for one place and minute, and whether they came from the cache."""
    key = (horizons_client.site_coord(site["longitude_deg"], site["latitude_deg"], site["site_height_m"],
                                      site["observer_height_m"]), minute.strftime("%Y-%m-%dT%H:%MZ"))
    cached = cache.get(key)
    if cached is not None:
        return cached, True

    deadline = time.monotonic() + TIMEOUT_S
    directions, queries, versions = {}, {}, []
    for body in BODIES:
        params = horizons_client.query_parameters(body, site, minute, minute + timedelta(minutes=1), 1)
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise HorizonsError(f"Horizons did not answer within {TIMEOUT_S:g} s")
        text = fetch(params, remaining)
        row = next((r for r in horizons_client.parse_horizons(text) if r[0] == minute), None)
        if row is None:
            raise HorizonsError("Horizons' answer did not include the requested minute")
        directions[body] = (row[1], row[2])
        queries[body] = {k: v.strip("'") for k, v in params.items()}
        versions.append(horizons_client.api_version(text))
    answer = HorizonsAnswer(directions=directions, api_version=versions[0] if len(set(versions)) == 1 else None,
                            retrieved_utc=datetime.now(UTC).replace(microsecond=0), queries=queries)
    cache.put(key, answer)
    return answer, False


# ----------------------------------------------------------------------------- route


def _years_supported(value: datetime) -> datetime:
    if not EARLIEST_YEAR <= value.year <= LATEST_YEAR:
        raise ValueError(f"time_utc must be in the years {EARLIEST_YEAR} to {LATEST_YEAR}")
    return value


ComparisonTime = Annotated[UtcDatetime, AfterValidator(_years_supported)]


class AzEl(BaseModel):
    azimuth_deg: float = Field(description="Degrees clockwise from local north, 0..360.")
    elevation_deg: float = Field(description="Degrees above the local horizontal plane (no terrain).")


class BodyComparison(BaseModel):
    horizons: AzEl
    engine: AzEl | None = Field(description="null when the engine could not run; see engine_unavailable_reason.")
    angle_between_deg: float | None = Field(description="Angle on the sky between the two directions, degrees.")


class ComparedSite(BaseModel):
    latitude_deg: float
    longitude_deg: float = Field(description="East longitude, 0..360.")
    site_height_m: float = Field(description="Ground height above the 1737.4 km sphere, metres.")
    observer_height_m: float


class HorizonsProvenance(BaseModel):
    service: str
    url: str
    api_url: str
    api_version: str | None
    quantity: str
    retrieved_utc: datetime
    from_cache: bool
    queries: dict[str, dict[str, str]] = Field(description="The query sent to Horizons for each body.")


class EngineProvenance(BaseModel):
    positions: str
    angles: str
    kernels: list[str]
    kernel_dir_variable: str


class ComparisonProvenance(BaseModel):
    horizons: HorizonsProvenance
    engine: EngineProvenance
    expected_differences: str


class ComparisonResponse(BaseModel):
    site: ComparedSite
    requested_time_utc: datetime
    time_utc: datetime = Field(description="The requested time rounded to the minute; both sides use it.")
    sun: BodyComparison
    earth: BodyComparison
    engine_unavailable_reason: str | None
    provenance: ComparisonProvenance


def _rounded(value: float) -> float:
    return round(value, 6)


@router.get(
    "/compare",
    response_model=ComparisonResponse,
    include_in_schema=False,
    summary="Sun and Earth directions from the engine and from JPL Horizons, side by side",
)
def compare(
    latitude_deg: Annotated[float, Query(ge=-90, le=90, allow_inf_nan=False)],
    longitude_deg: Annotated[float, Query(ge=0, le=360, allow_inf_nan=False, description="East longitude.")],
    time_utc: Annotated[ComparisonTime, Query(description="ISO 8601 with a timezone, years 1950 to 2100.")],
    fetch: Annotated[Fetch, Depends(get_horizons_fetch)],
    cache: Annotated[AnswerCache, Depends(get_answer_cache)],
    engine: Annotated[EngineDirections, Depends(get_engine)],
    site_height_m: Annotated[
        float, Query(ge=limits.ALTITUDE_MIN_M, le=limits.ALTITUDE_MAX_M, allow_inf_nan=False)
    ] = 0.0,
    observer_height_m: Annotated[
        float, Query(ge=limits.OBSERVER_HEIGHT_MIN_M, le=limits.OBSERVER_HEIGHT_MAX_M, allow_inf_nan=False)
    ] = 2.0,
) -> Any:
    # Both sides use the place at the precision sent to Horizons and the same minute.
    site = {"latitude_deg": round(latitude_deg, 6), "longitude_deg": round(longitude_deg, 6),
            "site_height_m": round(site_height_m, 3), "observer_height_m": round(observer_height_m, 3)}
    minute = (time_utc + timedelta(seconds=30)).replace(second=0, microsecond=0)

    try:
        answer, from_cache = ask_horizons(site, minute, fetch, cache)
    except HorizonsError as error:
        return JSONResponse(status_code=502, content={
            "error": "horizons_unavailable",
            "reason": str(error).splitlines()[0],
            "horizons_api": horizons_client.API,
            "stored_check": STORED_CHECK_FILE,
        })

    try:
        engine_directions: dict[str, tuple[float, float]] | None = engine(site, minute)
        reason = None
    except EngineUnavailable as error:
        engine_directions, reason = None, str(error)

    bodies = {}
    for body in BODIES:
        h_az, h_el = answer.directions[body]
        if engine_directions is None:
            bodies[body] = BodyComparison(horizons=AzEl(azimuth_deg=h_az, elevation_deg=h_el), engine=None,
                                          angle_between_deg=None)
            continue
        e_az, e_el = engine_directions[body]
        bodies[body] = BodyComparison(
            horizons=AzEl(azimuth_deg=h_az, elevation_deg=h_el),
            engine=AzEl(azimuth_deg=_rounded(e_az), elevation_deg=_rounded(e_el)),
            angle_between_deg=_rounded(horizons_client.separation_deg((e_az, e_el), (h_az, h_el))),
        )

    return ComparisonResponse(
        site=ComparedSite(**site),
        requested_time_utc=time_utc,
        time_utc=minute,
        sun=bodies["sun"],
        earth=bodies["earth"],
        engine_unavailable_reason=reason,
        provenance=ComparisonProvenance(
            horizons=HorizonsProvenance(
                service="JPL Horizons System", url=horizons_client.SERVICE_URL, api_url=horizons_client.API,
                api_version=answer.api_version,
                quantity="apparent azimuth and elevation (quantity 4, airless), observer at coord@301",
                retrieved_utc=answer.retrieved_utc, from_cache=from_cache, queries=answer.queries,
            ),
            engine=EngineProvenance(
                positions="app.physics.engine.positions (MOON_ME, km, geometric, aberration correction NONE)",
                angles="app.physics.engine.frames.get_azimuth_elevation",
                kernels=_kernel_names(), kernel_dir_variable=KERNEL_DIR_VARIABLE,
            ),
            expected_differences=(
                "Horizons' directions are apparent (corrected for light time and the aberration of light) and "
                "the engine's are geometric, so small differences are expected, the Sun's larger than the "
                "Earth's. The sizes measured for the preset sites over 2027 are in backend/docs/HORIZONS-CHECK.md."
            ),
        ),
    )
