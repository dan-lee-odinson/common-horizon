"""Field types shared by request and response models."""

from datetime import UTC, datetime
from typing import Annotated

from pydantic import AfterValidator, AwareDatetime


def _to_utc(value: datetime) -> datetime:
    try:
        return value.astimezone(UTC)
    except OverflowError:
        # e.g. 0001-01-01T00:00:00+01:00 or 9999-12-31T23:59:59-01:00 have no UTC equivalent.
        raise ValueError("timestamp is outside the representable range once converted to UTC") from None


UtcDatetime = Annotated[AwareDatetime, AfterValidator(_to_utc)]
"""Timezone-aware datetime normalised to UTC, so it always serialises with a ``Z`` suffix."""
