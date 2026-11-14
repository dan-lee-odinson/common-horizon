"""Physics output models (physics engine -> backend -> website).

Time series are column-oriented (one array per quantity, all aligned with
``timestamps_utc``). That maps directly onto chart libraries and keeps payloads
small enough for AWS Lambda's 6 MB synchronous response limit.
"""

import math
from enum import StrEnum
from itertools import pairwise
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.models.mission import MissionInput
from app.models.types import UtcDatetime

Vector3 = Annotated[list[float], Field(min_length=3, max_length=3)]
AzimuthDeg = Annotated[float, Field(ge=0, lt=360)]
ElevationDeg = Annotated[float, Field(ge=-90, le=90)]
Fraction = Annotated[float, Field(ge=0, le=1)]

_UNIT_VECTOR_TOLERANCE = 1e-3


class _OutputModel(BaseModel):
    # NaN/Infinity are never valid physics output: they would serialise as JSON null where the
    # schema promises a number. Rejecting them turns bad engine data into a 502 (see evaluation.py).
    model_config = ConfigDict(allow_inf_nan=False)


class DataSource(StrEnum):
    SYNTHETIC = "synthetic"
    PHYSICS_ENGINE = "physics_engine"


class ObstructionState(StrEnum):
    """Why a body is (not) visible from the observer."""

    VISIBLE = "visible"  # whole disc above the terrain horizon
    PARTIAL = "partial"  # disc partly above the terrain horizon
    TERRAIN_BLOCKED = "terrain_blocked"  # above the local horizontal plane but hidden by terrain
    BELOW_HORIZON = "below_horizon"  # below the local horizontal plane


class DataProvenance(_OutputModel):
    source: DataSource
    is_synthetic: bool = Field(description="True when the numbers are placeholder fixtures, not physics results.")
    engine_name: str
    engine_version: str
    notice: str = Field(description="Human-readable statement of where the numbers come from.")


class BodyTimeseries(_OutputModel):
    """Sun or Earth as seen from the observer, one entry per timestamp."""

    position_km: list[Vector3] = Field(description="Body position, km, MOON_ME frame, origin at the Moon's centre.")
    direction_unit: list[Vector3] = Field(description="Unit vector from the observer to the body, MOON_ME frame.")
    azimuth_deg: list[AzimuthDeg] = Field(description="Azimuth, degrees clockwise from local north, 0..360.")
    elevation_deg: list[ElevationDeg] = Field(description="Elevation above the local horizontal plane, degrees.")
    visibility_fraction: list[Fraction] = Field(description="Fraction of the body's disc visible above terrain, 0..1.")
    obstruction_state: list[ObstructionState]

    @model_validator(mode="after")
    def _check_shape(self) -> "BodyTimeseries":
        lengths = {
            len(self.position_km),
            len(self.direction_unit),
            len(self.azimuth_deg),
            len(self.elevation_deg),
            len(self.visibility_fraction),
            len(self.obstruction_state),
        }
        if len(lengths) != 1:
            raise ValueError("all per-body arrays must have the same length")
        for vector in self.direction_unit:
            if abs(math.sqrt(sum(c * c for c in vector)) - 1.0) > _UNIT_VECTOR_TOLERANCE:
                raise ValueError("direction_unit entries must be unit vectors")
        return self


class Timeseries(_OutputModel):
    frame: Literal["MOON_ME"] = "MOON_ME"
    timestamps_utc: list[UtcDatetime] = Field(min_length=2)
    sun: BodyTimeseries
    earth: BodyTimeseries

    @model_validator(mode="after")
    def _check_alignment(self) -> "Timeseries":
        n = len(self.timestamps_utc)
        if len(self.sun.azimuth_deg) != n or len(self.earth.azimuth_deg) != n:
            raise ValueError("sun and earth arrays must align with timestamps_utc")
        if any(later <= earlier for earlier, later in pairwise(self.timestamps_utc)):
            raise ValueError("timestamps_utc must be strictly increasing")
        return self


class TimeWindow(_OutputModel):
    start_utc: UtcDatetime
    end_utc: UtcDatetime
    duration_hours: float = Field(ge=0)

    @model_validator(mode="after")
    def _check_order(self) -> "TimeWindow":
        if self.end_utc < self.start_utc:
            raise ValueError("end_utc must not be before start_utc")
        return self


class SiteInfo(_OutputModel):
    latitude_deg: float
    longitude_deg: float
    elevation_m: float = Field(description="Site elevation relative to the 1737.4 km reference sphere, metres.")
    elevation_source: Literal["input", "terrain_model", "synthetic_default"]
    slope_deg: float | None = Field(default=None, ge=0, le=90, description="Local terrain slope, degrees.")


class TerrainSkyline(_OutputModel):
    """Terrain horizon profile around the site (angular elevation per azimuth)."""

    azimuth_deg: list[AzimuthDeg]
    horizon_elevation_deg: list[ElevationDeg]

    @model_validator(mode="after")
    def _check_lengths(self) -> "TerrainSkyline":
        if len(self.azimuth_deg) != len(self.horizon_elevation_deg):
            raise ValueError("azimuth_deg and horizon_elevation_deg must have the same length")
        return self


class MissionMetrics(_OutputModel):
    sunlight_hours: float = Field(ge=0)
    sunlight_percentage: float = Field(ge=0, le=100)
    longest_sunlight_hours: float = Field(ge=0)
    longest_darkness_hours: float = Field(ge=0)
    earth_visibility_hours: float = Field(ge=0)
    earth_visibility_percentage: float = Field(ge=0, le=100)
    sky_visibility_fraction: float | None = Field(
        default=None, ge=0, le=1, description="Fraction of the sky hemisphere not blocked by terrain."
    )
    time_to_sunset_hours: float | None = Field(
        default=None, ge=0, description="Hours from mission start to the first sunset; null if none occurs."
    )
    sunset_utc: UtcDatetime | None = None
    time_to_earthset_hours: float | None = Field(
        default=None, ge=0, description="Hours from mission start to the first Earthset; null if none occurs."
    )
    earthset_utc: UtcDatetime | None = None


class RequirementResult(_OutputModel):
    requirement: str = Field(description="Name of the field in hardware_requirements.")
    metric: str = Field(description="Metric the threshold is compared against.")
    comparison: Literal[">=", "<="]
    threshold: float
    actual: float | None
    unit: str
    passed: bool | None = Field(description="Null when the engine did not provide the metric.")


class LaunchDelayCase(_OutputModel):
    launch_delay_days: int = Field(ge=0)
    mission_start_utc: UtcDatetime
    metrics: MissionMetrics
    requirements_passed: bool | None


class MissionEvaluation(_OutputModel):
    """Full response of ``POST /api/v1/missions/evaluate``."""

    contract_version: str
    provenance: DataProvenance
    mission: MissionInput = Field(description="The validated, normalised request.")
    site: SiteInfo
    timeseries: Timeseries
    metrics: MissionMetrics
    communication_windows: list[TimeWindow]
    terrain_skyline: TerrainSkyline | None = None
    requirement_results: list[RequirementResult]
    requirements_passed: bool | None = Field(description="Null when no requirements were given or checkable.")
    launch_delay_results: list[LaunchDelayCase] = Field(
        description="Empty unless launch_delay_days > 0; then includes the 0-day baseline."
    )
    warnings: list[str]


class ErrorResponse(_OutputModel):
    detail: str
