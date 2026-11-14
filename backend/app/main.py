"""FastAPI application entry point (``uvicorn app.main:app``)."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import health, missions
from app.config import SERVICE_VERSION, Settings, get_settings
from app.physics.factory import build_engine

DESCRIPTION = """
Backend bridge between the Common Horizon website and the lunar physics engine.

**The physics engine calculates; the backend validates and passes results through.**
Every response states its data source in `provenance`. While the real engine is
being integrated, responses come from a clearly labelled synthetic fixture
(`provenance.is_synthetic = true`).

Units are part of every field name: `_deg` degrees, `_m` metres, `_km` kilometres,
`_s` seconds, `_hours`, `_days`, `_utc` ISO 8601 timestamps in UTC.
"""


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    build_engine(settings.physics_engine)  # fail fast on a misconfigured engine name

    app = FastAPI(
        title="Common Horizon API",
        version=SERVICE_VERSION,
        summary="Lunar landing-site Sun/Earth visibility evaluation",
        description=DESCRIPTION,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.cors_origins),
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Content-Type"],
        expose_headers=["X-Data-Source"],
    )
    app.include_router(health.router)
    app.include_router(missions.router)
    return app


app = create_app()
