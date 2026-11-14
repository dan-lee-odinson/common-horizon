"""Runtime configuration read from environment variables.

No secrets live in this module or anywhere in the repository. Later AWS work
(Bedrock) must use the standard AWS credential chain: an IAM role inside Lambda,
a local profile during development.
"""

import os
from dataclasses import dataclass
from functools import lru_cache

SERVICE_NAME = "common-horizon-backend"
SERVICE_VERSION = "0.1.0"
# Bump on any breaking change to request/response shapes so the frontend can detect it.
CONTRACT_VERSION = "0.1.0"

DEFAULT_CORS_ORIGINS = ("http://localhost:3000", "http://localhost:5173")


@dataclass(frozen=True)
class Settings:
    physics_engine: str
    cors_origins: tuple[str, ...]


def _parse_origins(raw: str | None) -> tuple[str, ...]:
    if raw is None or not raw.strip():
        return DEFAULT_CORS_ORIGINS
    return tuple(origin.strip() for origin in raw.split(",") if origin.strip())


@lru_cache
def get_settings() -> Settings:
    return Settings(
        # "synthetic" (default until real results exist) or "physics" (real engine adapter).
        physics_engine=os.getenv("CH_PHYSICS_ENGINE", "synthetic").strip().lower(),
        cors_origins=_parse_origins(os.getenv("CH_CORS_ORIGINS")),
    )
