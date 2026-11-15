"""Models of ``POST /horizon``: the terrain skyline, the Sun's path and the Earth's box for one site.

They follow the website's ``HorizonRequest`` and ``HorizonResponse`` in ``web/src/api/types.ts`` field
for field. ``provenance``, ``warnings``, ``time_step_s`` and ``skyline_source`` are added beside the
website's own fields, as ``/evaluate`` does. ``backend/docs/WEBSITE_API.md`` lists the differences.
"""

from datetime import timedelta
from typing import Any, Literal

from pydantic import Field, field_validator, model_validator

from app.models import limits
from app.models.results import DataProvenance
from app.models.types import UtcDatetime
from app.models.website import SiteRef, _InputModel, _OutputModel, parse_iso_utc

# The longest window one request may ask for. The website asks from the planned landing to the end of
# the delayed stay, so the window is the stay plus the launch delay: the longest stay /evaluate accepts
# plus the longest delay it accepts (365.25 + 30 = 395.25 days).
HORIZON_MAX_WINDOW_DAYS = limits.STAY_DURATION_MAX_DAYS + limits.LAUNCH_DELAY_MAX_DAYS
# At most this many Sun path samples per request; a finer step is coarsened in whole minutes.
# The website asks for up to 3,600 steps in one request (STEPS_PER_REQUEST in
# web/src/state/horizonLoad.ts, sized for an answer of at most 4,000 points), so the bound is 4,000:
# the website gets the spacing it asked for.
HORIZON_MAX_SAMPLES = 4_000

SunState = Literal["above", "hidden"]
SkylineSource = Literal["stored_profile", "smooth_sphere"]


class HorizonRequest(_InputModel):
    site: SiteRef
    start_utc: UtcDatetime
    end_utc: UtcDatetime
    step_hours: float = Field(
        ge=limits.TIME_STEP_MIN_S / 3600,
        le=limits.TIME_STEP_MAX_S / 3600,
        description=(
            "Wanted spacing of sun_path samples, hours (one minute to one day). Rounded to whole minutes, and "
            f"coarsened when the window would need more than {HORIZON_MAX_SAMPLES} samples (see time_step_s)."
        ),
    )

    @field_validator("start_utc", "end_utc", mode="before")
    @classmethod
    def _parse_times(cls, value: Any) -> Any:
        return parse_iso_utc(value)

    @model_validator(mode="after")
    def _check_window(self) -> "HorizonRequest":
        if not self.start_utc < self.end_utc:
            raise ValueError("start_utc must be before end_utc")
        if self.end_utc - self.start_utc > timedelta(days=HORIZON_MAX_WINDOW_DAYS):
            raise ValueError(f"the window from start_utc to end_utc must be at most {HORIZON_MAX_WINDOW_DAYS} days")
        if self.start_utc < limits.MISSION_WINDOW_START_UTC:
            raise ValueError(f"start_utc must be on or after {limits.MISSION_WINDOW_START_UTC.isoformat()}")
        if self.end_utc > limits.MISSION_WINDOW_END_UTC:
            raise ValueError(f"end_utc must be on or before {limits.MISSION_WINDOW_END_UTC.isoformat()}")
        return self


class SkyPoint(_OutputModel):
    az: float = Field(description="Azimuth, degrees clockwise from local north, 0..360.")
    el: float = Field(description="Elevation of the skyline above the local horizontal plane, degrees.")


class SunPathPoint(_OutputModel):
    t: UtcDatetime
    az: float = Field(description="Azimuth of the Sun's centre, degrees clockwise from local north, 0..360.")
    el: float = Field(description="Elevation of the Sun's centre above the local horizontal plane, degrees.")
    state: SunState = Field(
        description=(
            "'above' when the engine says any part of the Sun's disc is visible above the terrain (the rule "
            "/evaluate uses for sunlight), else 'hidden'."
        )
    )


class SkyBox(_OutputModel):
    """Part of the sky the Earth moves through. az_min greater than az_max means it wraps past north."""

    az_min: float
    az_max: float
    el_min: float
    el_max: float


class HorizonResponse(_OutputModel):
    site_id: str
    skyline: list[SkyPoint] = Field(description="Skyline sorted by azimuth, evenly spaced, degrees.")
    sun_path: list[SunPathPoint]
    earth_box: SkyBox | None = Field(
        description=(
            "Box around the Earth's sampled directions above the local horizontal plane. Null when the Earth "
            "never rises above level during the window."
        )
    )
    skyline_source: SkylineSource = Field(
        description=(
            "stored_profile: the site's stored terrain horizon profile, at its own spacing. smooth_sphere: no "
            "terrain, only the geometric dip of a sphere through the site (see warnings)."
        )
    )
    time_step_s: int = Field(description="Spacing of sun_path actually used, seconds (whole minutes).")
    provenance: DataProvenance
    warnings: list[str]
