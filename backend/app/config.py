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
    # Data folders of the real engine. None: the engine's defaults (see app/physics/engine_adapter.py).
    spice_kernel_dir: str | None = None
    horizon_profile_dir: str | None = None


def _optional_path(raw: str | None) -> str | None:
    return raw.strip() if raw and raw.strip() else None


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
        # Folder holding the four NAIF kernels (naif0012.tls, de440s.bsp, moon_pa_de440_200625.bpc,
        # moon_de440_250416.tf) and folder of the stored horizon profiles (backend/data/horizon).
        spice_kernel_dir=_optional_path(os.getenv("CH_SPICE_KERNEL_DIR")),
        horizon_profile_dir=_optional_path(os.getenv("CH_HORIZON_PROFILE_DIR")),
    )
