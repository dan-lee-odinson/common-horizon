"""``POST /assistant``: field for field the website's ``AskRequest`` and ``AskResponse`` (``web/src/api/types.ts``)."""

from typing import Any

from pydantic import Field, field_validator

from app.models import limits
from app.models.types import UtcDatetime
from app.models.website import (
    HardwareChoice,
    StorageField,
    _check_unique_hardware,
    _InputModel,
    _OutputModel,
    parse_iso_utc,
)

QUESTION_MAX_CHARS = 500
# The website's launch-to-landing estimate: TRANSIT_DAYS in web/src/util/transit.ts, which the website sends
# with every POST /evaluate. Used when an assistant request leaves transit_days out, so the assistant evaluates
# the same landing date the page shows. tests/test_assistant.py fails when the two differ.
WEBSITE_TRANSIT_DAYS = 5.0


class AskContext(_InputModel):
    """The visitor's current mission, as the website holds it. The same bounds as ``POST /evaluate``."""

    site_id: str | None = Field(
        description=(
            "The site the visitor has selected: a preset id, a custom point (custom:<lat>:<lon_east>) or null."
        ),
        max_length=80,
    )
    launch_utc: UtcDatetime
    slip_days: int = Field(ge=0, le=limits.LAUNCH_DELAY_MAX_DAYS)
    stay_days: float = Field(ge=limits.STAY_MIN_DAYS, le=limits.STAY_DURATION_MAX_DAYS)
    hardware: list[HardwareChoice] = Field(max_length=64)
    storage_kwh: float = StorageField
    transit_days: float | None = Field(
        default=None,
        ge=0,
        le=limits.TRANSIT_MAX_DAYS,
        description=(
            "Launch-to-landing time, days (optional; the website does not send it yet). Left out or null: "
            f"the website's own value, {WEBSITE_TRANSIT_DAYS:g} days, as on every POST /evaluate it sends."
        ),
    )

    @field_validator("launch_utc", mode="before")
    @classmethod
    def _parse_launch(cls, value: Any) -> Any:
        return parse_iso_utc(value)

    @field_validator("hardware")
    @classmethod
    def _unique_hardware(cls, hardware: list[HardwareChoice]) -> list[HardwareChoice]:
        return _check_unique_hardware(hardware)


class AskRequest(_InputModel):
    question: str = Field(
        min_length=1,
        max_length=QUESTION_MAX_CHARS,
        description=f"The visitor's question, 1..{QUESTION_MAX_CHARS} characters. Longer: 422.",
    )
    context: AskContext

    @field_validator("question")
    @classmethod
    def _not_blank(cls, question: str) -> str:
        if not question.strip():
            raise ValueError("the question is empty")
        return question


class AskResponse(_OutputModel):
    """The website's optional ``example`` flag marks its own mock answers; the backend never sends it."""

    answer: str = Field(description="Plain text from the language model, at most about 120 words.")
