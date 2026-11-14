"""Mission input models (website -> backend -> physics engine).

Field names carry their unit as a suffix (``_deg``, ``_m``, ``_s``, ``_days``,
``_utc``) so the contract is unambiguous in JSON and in generated TypeScript.
"""

from datetime import datetime, timedelta
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.models import limits
from app.models.types import UtcDatetime
from app.timegrid import SECONDS_PER_DAY, count_samples


class _InputModel(BaseModel):
    # Unknown fields are rejected so frontend typos (e.g. "lat") fail loudly
    # instead of being silently ignored. NaN/Infinity are never valid inputs.
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class LandingSite(_InputModel):
    latitude_deg: float = Field(
        ge=limits.LATITUDE_MIN_DEG,
        le=limits.LATITUDE_MAX_DEG,
        description="Selenographic latitude in degrees, north positive (MOON_ME frame).",
        examples=[-89.5],
    )
    longitude_deg: float = Field(
        ge=limits.LONGITUDE_MIN_DEG,
        le=limits.LONGITUDE_MAX_DEG,
        description="Selenographic longitude in degrees, east positive, range -180..180 (MOON_ME frame).",
        examples=[-45.0],
    )
    altitude_m: float | None = Field(
        default=None,
        ge=limits.ALTITUDE_MIN_M,
        le=limits.ALTITUDE_MAX_M,
        description=(
            "Site elevation in metres relative to the 1737.4 km lunar reference sphere. "
            "Null means the engine derives it from terrain data."
        ),
        examples=[1200.0],
    )


class HardwareRequirements(_InputModel):
    """Pass/fail thresholds for a lander or payload. Every field is optional."""

    min_sunlight_percentage: float | None = Field(
        default=None, ge=0, le=100, description="Minimum share of the stay with the Sun visible, percent."
    )
    min_sunlight_hours: float | None = Field(
        default=None, ge=0, description="Minimum total hours with the Sun visible during the stay."
    )
    max_darkness_hours: float | None = Field(
        default=None, ge=0, description="Longest continuous darkness the hardware can survive, hours."
    )
    min_earth_visibility_percentage: float | None = Field(
        default=None, ge=0, le=100, description="Minimum share of the stay with Earth visible, percent."
    )
    min_earth_visibility_hours: float | None = Field(
        default=None, ge=0, description="Minimum total hours with Earth visible during the stay."
    )
    max_slope_deg: float | None = Field(
        default=None, ge=0, le=90, description="Maximum landing-site slope the hardware tolerates, degrees."
    )


_EXAMPLE_MISSION: dict[str, Any] = {
    "landing_site": {"latitude_deg": -89.5, "longitude_deg": -45.0, "altitude_m": None},
    "observer_height_m": 2.0,
    "mission_start_utc": "2027-01-15T00:00:00Z",
    "stay_duration_days": 14,
    "time_step_s": 3600,
    "launch_delay_days": 5,
    "launch_delay_step_days": 1,
    "hardware_id": "example-lander-01",
    "hardware_requirements": {
        "min_sunlight_percentage": 50,
        "max_darkness_hours": 72,
        "min_earth_visibility_percentage": 30,
    },
}


class MissionInput(_InputModel):
    model_config = ConfigDict(
        extra="forbid",
        allow_inf_nan=False,
        json_schema_extra={"examples": [_EXAMPLE_MISSION]},
    )

    landing_site: LandingSite
    observer_height_m: float = Field(
        default=0.0,
        ge=limits.OBSERVER_HEIGHT_MIN_M,
        le=limits.OBSERVER_HEIGHT_MAX_M,
        description="Height of the observer (camera, antenna, panel) above the local surface, metres.",
    )
    mission_start_utc: UtcDatetime = Field(
        description=(
            "Mission start as an ISO 8601 string with an explicit timezone, e.g. 2027-01-15T00:00:00Z. "
            "Normalised to UTC."
        ),
    )
    stay_duration_days: float = Field(
        gt=0, le=limits.STAY_DURATION_MAX_DAYS, description="Length of the surface stay, days."
    )
    time_step_s: int = Field(
        ge=limits.TIME_STEP_MIN_S,
        le=limits.TIME_STEP_MAX_S,
        description="Simulation resolution: seconds between samples.",
    )
    launch_delay_days: int = Field(
        default=0,
        ge=0,
        le=limits.LAUNCH_DELAY_MAX_DAYS,
        description=(
            "Maximum launch slip to analyse, whole days. 0 disables the analysis; otherwise the mission is "
            "re-evaluated for delays 0, step, 2*step, ... up to this value."
        ),
    )
    launch_delay_step_days: int = Field(
        default=1,
        ge=1,
        le=limits.LAUNCH_DELAY_STEP_MAX_DAYS,
        description="Spacing between analysed launch delays, whole days.",
    )
    hardware_id: str | None = Field(
        default=None,
        pattern=limits.HARDWARE_ID_PATTERN,
        description="Identifier of the selected lander or payload (letters, digits, '.', '_', '-').",
    )
    hardware_requirements: HardwareRequirements | None = None

    @field_validator("mission_start_utc", mode="before")
    @classmethod
    def _parse_iso_8601(cls, value: Any) -> Any:
        if isinstance(value, datetime):
            return value
        if not isinstance(value, str):
            # ValueError on purpose: Pydantic turns it into a 422; a TypeError would escape as a 500.
            raise ValueError("must be an ISO 8601 string, e.g. 2027-01-15T00:00:00Z")  # noqa: TRY004
        try:
            parsed = datetime.fromisoformat(value)
        except ValueError:
            raise ValueError("must be an ISO 8601 string, e.g. 2027-01-15T00:00:00Z") from None
        if parsed.tzinfo is None:
            raise ValueError("must include a timezone, e.g. a trailing 'Z' for UTC")
        return parsed

    @field_validator("mission_start_utc")
    @classmethod
    def _check_supported_window(cls, value: datetime) -> datetime:
        # Runs after UtcDatetime has normalised the value to UTC (or rejected it if that overflows).
        # Bounding the start here also keeps the end-of-mission arithmetic below from overflowing.
        if not limits.MISSION_WINDOW_START_UTC <= value < limits.MISSION_WINDOW_END_UTC:
            raise ValueError(
                f"mission_start_utc must be on or after {limits.MISSION_WINDOW_START_UTC.isoformat()} "
                f"and before {limits.MISSION_WINDOW_END_UTC.isoformat()}"
            )
        return value

    @model_validator(mode="after")
    def _check_mission_window(self) -> "MissionInput":
        duration_s = self.stay_duration_days * SECONDS_PER_DAY
        if self.time_step_s > duration_s:
            raise ValueError("time_step_s must not exceed the stay duration")

        samples = count_samples(duration_s, self.time_step_s)
        if samples > limits.MAX_SAMPLES:
            raise ValueError(
                f"stay_duration_days and time_step_s produce {samples} samples; the maximum is "
                f"{limits.MAX_SAMPLES}. Increase time_step_s or shorten the stay."
            )

        if self.launch_delay_days > 0 and self.launch_delay_step_days > self.launch_delay_days:
            raise ValueError("launch_delay_step_days must not exceed launch_delay_days")

        # Cannot overflow: the start is bounded by the field validator and delay/stay are capped in limits.
        latest_end = self.mission_start_utc + timedelta(days=self.launch_delay_days + self.stay_duration_days)
        if latest_end > limits.MISSION_WINDOW_END_UTC:
            raise ValueError(
                "mission (including the maximum launch delay) must end on or before "
                f"{limits.MISSION_WINDOW_END_UTC.isoformat()}"
            )
        return self

    @property
    def stay_duration_s(self) -> float:
        return self.stay_duration_days * SECONDS_PER_DAY

    def launch_delays(self) -> list[int]:
        """Delays (days) to analyse; empty when the launch-delay analysis is disabled."""
        if self.launch_delay_days == 0:
            return []
        return list(range(0, self.launch_delay_days + 1, self.launch_delay_step_days))
