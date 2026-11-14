"""Error responses that must stay valid JSON whatever the client sent."""

import math
from typing import Any

from fastapi import Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse


def _encode_non_finite(value: Any) -> Any:
    """Replace NaN/Infinity (not representable in JSON) with the strings "NaN", "Infinity", "-Infinity"."""
    if isinstance(value, float) and not math.isfinite(value):
        if math.isnan(value):
            return "NaN"
        return "Infinity" if value > 0 else "-Infinity"
    if isinstance(value, dict):
        return {key: _encode_non_finite(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_encode_non_finite(item) for item in value]
    return value


async def request_validation_error_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    """FastAPI's standard 422 body, except that rejected non-finite inputs are echoed as strings.

    Python's JSON parser turns ``1e999`` into ``inf`` and accepts the non-standard ``NaN`` and
    ``Infinity`` tokens. The models reject those values, but FastAPI's default handler then fails
    to serialise them back in the error's ``input`` field and answers 500 instead of 422.
    """
    return JSONResponse(status_code=422, content={"detail": _encode_non_finite(jsonable_encoder(exc.errors()))})
