"""Runtime configuration read from environment variables.

No secrets live in this module or anywhere in the repository. The assistant's Bedrock
calls use the standard AWS credential chain: the Lambda's IAM role in production,
a local profile during development.
"""

import os
from dataclasses import dataclass
from functools import lru_cache
from urllib.parse import urlsplit

SERVICE_NAME = "common-horizon-backend"
SERVICE_VERSION = "0.1.0"
# Bump on any breaking change to request/response shapes so the frontend can detect it.
CONTRACT_VERSION = "0.1.0"

# CORS is owned by this FastAPI app only. Do not also configure CORS on the Lambda Function URL:
# duplicated Access-Control-Allow-Origin headers make browsers reject the response.
PRODUCTION_CORS_ORIGINS = ("https://commonhorizon.study", "https://www.commonhorizon.study")
LOCAL_DEV_CORS_ORIGINS = ("http://localhost:5173",)  # Vite dev server
DEFAULT_CORS_ORIGINS = PRODUCTION_CORS_ORIGINS + LOCAL_DEV_CORS_ORIGINS

_DEFAULT_PORTS = {"http": 80, "https": 443}
_LOCAL_HOSTS = frozenset({"localhost", "127.0.0.1", "::1"})


def normalize_origin(raw: str) -> str:
    """Return ``raw`` in the exact form a browser sends in the ``Origin`` header.

    Browsers send ``scheme://host[:port]``: lowercase scheme and host, no trailing slash, no path,
    and no port when it is the scheme's default. Starlette compares origins as exact strings, so a
    configured ``https://example.com/`` would otherwise never match. Wildcards are refused.
    """
    value = raw.strip()
    if "*" in value:
        raise ValueError(f"CORS origin {raw!r}: wildcard origins are not allowed; list exact origins")
    parts = urlsplit(value.rstrip("/"))
    scheme = parts.scheme.lower()
    if scheme not in _DEFAULT_PORTS or not parts.hostname:
        raise ValueError(f"CORS origin {raw!r}: expected http(s)://host[:port]")
    if parts.path or parts.query or parts.fragment or parts.username is not None or "@" in parts.netloc:
        raise ValueError(f"CORS origin {raw!r}: an origin has no path, query, fragment or user info")
    host = parts.hostname  # lowercased by urlsplit; IPv6 without brackets
    if not host.isascii():
        raise ValueError(f"CORS origin {raw!r}: use the ASCII (punycode) host name")
    if scheme == "http" and host not in _LOCAL_HOSTS:
        raise ValueError(f"CORS origin {raw!r}: plain http is only allowed for localhost development")
    try:
        port = parts.port
    except ValueError:
        raise ValueError(f"CORS origin {raw!r}: invalid port") from None

    netloc = f"[{host}]" if ":" in host else host
    if port is not None and port != _DEFAULT_PORTS[scheme]:
        netloc = f"{netloc}:{port}"
    return f"{scheme}://{netloc}"


def _normalize_all(origins: tuple[str, ...] | list[str]) -> tuple[str, ...]:
    # dict.fromkeys removes duplicates while keeping the configured order.
    return tuple(dict.fromkeys(normalize_origin(origin) for origin in origins if origin.strip()))


def parse_cors_origins(origins: str | None, extra_origins: str | None) -> tuple[str, ...]:
    """Build the allowed origins from two comma-separated environment values.

    ``origins`` (``CH_CORS_ORIGINS``) replaces the defaults when set; ``extra_origins``
    (``CH_CORS_EXTRA_ORIGINS``, e.g. the Amplify branch URL) is appended to whichever list applies.
    """
    base = _normalize_all(origins.split(",")) if origins and origins.strip() else DEFAULT_CORS_ORIGINS
    extra = _normalize_all(extra_origins.split(",")) if extra_origins else ()
    return tuple(dict.fromkeys(base + extra))


# The Mission Assistant (POST /assistant): a language model on Amazon Bedrock, off unless switched on.
DEFAULT_ASSISTANT_MODEL_ID = "openai.gpt-oss-120b-1:0"
DEFAULT_ASSISTANT_REGION = "us-east-1"
DEFAULT_ASSISTANT_DAILY_CAP = 300


@dataclass(frozen=True)
class Settings:
    physics_engine: str
    cors_origins: tuple[str, ...]
    # Data folders of the real engine. None: the engine's defaults (see app/physics/engine_adapter.py).
    spice_kernel_dir: str | None = None
    horizon_profile_dir: str | None = None
    # POST /assistant. Off by default; /health reports assistant_available equal to assistant_enabled.
    assistant_enabled: bool = False
    assistant_model_id: str = DEFAULT_ASSISTANT_MODEL_ID
    assistant_region: str = DEFAULT_ASSISTANT_REGION
    # Model calls per UTC day, counted in memory by each running copy of the app (not across copies).
    assistant_daily_cap: int = DEFAULT_ASSISTANT_DAILY_CAP

    def __post_init__(self) -> None:
        # Settings built in code (tests, create_app callers) get the same normalisation and wildcard ban.
        object.__setattr__(self, "cors_origins", _normalize_all(self.cors_origins))


def _optional_path(raw: str | None) -> str | None:
    return raw.strip() if raw and raw.strip() else None


_TRUE = frozenset({"1", "true", "yes", "on"})
_FALSE = frozenset({"", "0", "false", "no", "off"})


def parse_bool(name: str, raw: str | None, default: bool) -> bool:
    """``true``/``false`` (also 1/0, yes/no, on/off, any case). Anything else fails at start-up."""
    if raw is None:
        return default
    value = raw.strip().lower()
    if value in _TRUE:
        return True
    if value in _FALSE:
        return False
    raise ValueError(f"{name}={raw!r}: expected true or false")


def parse_non_negative_int(name: str, raw: str | None, default: int) -> int:
    if raw is None or not raw.strip():
        return default
    try:
        value = int(raw.strip())
    except ValueError:
        raise ValueError(f"{name}={raw!r}: expected a whole number") from None
    if value < 0:
        raise ValueError(f"{name}={raw!r}: must be 0 or more")
    return value


def _text(raw: str | None, default: str) -> str:
    return raw.strip() if raw and raw.strip() else default


@lru_cache
def get_settings() -> Settings:
    return Settings(
        # "synthetic" (default until real results exist) or "physics" (real engine adapter).
        physics_engine=os.getenv("CH_PHYSICS_ENGINE", "synthetic").strip().lower(),
        cors_origins=parse_cors_origins(os.getenv("CH_CORS_ORIGINS"), os.getenv("CH_CORS_EXTRA_ORIGINS")),
        # Folder holding the four NAIF kernels (naif0012.tls, de440s.bsp, moon_pa_de440_200625.bpc,
        # moon_de440_250416.tf) and folder of the stored horizon profiles (backend/data/horizon).
        spice_kernel_dir=_optional_path(os.getenv("CH_SPICE_KERNEL_DIR")),
        horizon_profile_dir=_optional_path(os.getenv("CH_HORIZON_PROFILE_DIR")),
        assistant_enabled=parse_bool("CH_ASSISTANT_ENABLED", os.getenv("CH_ASSISTANT_ENABLED"), False),
        assistant_model_id=_text(os.getenv("CH_ASSISTANT_MODEL_ID"), DEFAULT_ASSISTANT_MODEL_ID),
        assistant_region=_text(os.getenv("CH_ASSISTANT_REGION"), DEFAULT_ASSISTANT_REGION),
        assistant_daily_cap=parse_non_negative_int(
            "CH_ASSISTANT_DAILY_CAP", os.getenv("CH_ASSISTANT_DAILY_CAP"), DEFAULT_ASSISTANT_DAILY_CAP
        ),
    )
