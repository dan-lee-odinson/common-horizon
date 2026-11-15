"""Models of the website API (``GET /sites``, ``GET /catalog``, ``POST /check``, ``POST /evaluate``).

They follow the website's provisional types in ``web/src/api/types.ts`` field for field. Where that
file promises a number the backend cannot know honestly (slope, sky visibility, net energy, ...),
the field is nullable here and documented; ``backend/docs/WEBSITE_API.md`` lists every such change
so the website can adapt. Fields the website does not know yet are additive.
"""

from datetime import datetime, timedelta
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.models import limits
from app.models.results import DataProvenance
from app.models.types import UtcDatetime


class _InputModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class _OutputModel(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)


def normalize_lon_east(lon: float) -> float:
    """East-positive longitude in [0, 360)."""
    value = lon % 360.0
    return 0.0 if value == 360.0 else value + 0.0  # (-0.0 % 360 is 0.0; + 0.0 drops a negative zero)


def lon_east_to_signed(lon_east: float) -> float:
    """[0, 360) east longitude -> (-180, 180], the range the physics request uses."""
    return lon_east - 360.0 if lon_east > 180.0 else lon_east


def parse_iso_utc(value: Any) -> Any:
    if isinstance(value, datetime):
        return value
    if not isinstance(value, str):
        raise ValueError("must be an ISO 8601 string, e.g. 2027-01-15T00:00:00Z")  # noqa: TRY004 (pydantic needs ValueError)
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        raise ValueError("must be an ISO 8601 string, e.g. 2027-01-15T00:00:00Z") from None
    if parsed.tzinfo is None:
        raise ValueError("must include a timezone, e.g. a trailing 'Z' for UTC")
    return parsed


# ---------------------------------------------------------------- sites


class Site(_OutputModel):
    id: str
    name: str
    lat: float = Field(ge=-90, le=90)
    lon_east: float = Field(ge=0, lt=360, description="Degrees east, 0..360.")
    note: str | None = None
    default_hardware: list[str] = Field(default_factory=list)


class SiteListResponse(_OutputModel):
    sites: list[Site]


class SiteRef(_InputModel):
    """A site as the website sends it: a preset, a saved point or a typed coordinate."""

    id: str = Field(pattern=limits.SITE_ID_PATTERN)
    name: str = Field(min_length=1, max_length=limits.SITE_NAME_MAX_LENGTH)
    lat: float = Field(ge=limits.LATITUDE_MIN_DEG, le=limits.LATITUDE_MAX_DEG)
    lon_east: float = Field(
        ge=limits.LON_EAST_MIN_DEG,
        le=limits.LON_EAST_MAX_DEG,
        description="Degrees east. 0..360 as the website sends it; -180..0 is accepted and normalised to 0..360.",
    )

    @field_validator("lon_east")
    @classmethod
    def _normalize(cls, value: float) -> float:
        return normalize_lon_east(value)


class HardwareChoice(_InputModel):
    id: str = Field(pattern=limits.HARDWARE_ID_PATTERN)
    count: int = Field(ge=0, le=limits.MAX_HARDWARE_COUNT)


def _check_unique_hardware(hardware: list[HardwareChoice]) -> list[HardwareChoice]:
    seen: set[str] = set()
    for choice in hardware:
        if choice.id in seen:
            raise ValueError(f"hardware id {choice.id!r} is listed twice; send it once with its total count")
        seen.add(choice.id)
    return hardware


StorageField = Field(
    ge=0, le=limits.MAX_STORAGE_KWH, description="Battery storage typed by the visitor, kWh. 0 = none."
)


# ---------------------------------------------------------------- catalog


class CatalogFigure(_OutputModel):
    """One figure exactly as the planner catalog stores it (published unit, status labels, source)."""

    value: float | list[float] | None
    unit: str
    status: list[str]
    source: str
    qualifier: str | None = None
    note: str | None = None


class CapacityOption(_OutputModel):
    option: str
    label: str
    capacity_kg: float = Field(description="The value a fit check uses (the low end of a published range).")
    figure: CatalogFigure


HardwareKind = Literal["lander", "cargo", "power", "load"]


class CatalogItem(_OutputModel):
    id: str
    name: str
    kind: HardwareKind = Field(
        description="lander, cargo (payload mass), power (a power source) or load (a power load). 'load' is new."
    )
    countable: bool
    default_count: int
    max_count: int
    mass_kg: float | None = Field(
        description="Payload mass. Null when not published, and for landers, sources and loads (no mass here)."
    )
    capacity_kg: float | None = Field(
        default=None, description="Landers only. Null when there are several published figures: see capacity_options."
    )
    capacity_options: list[CapacityOption] = Field(default_factory=list)
    max_slope_deg: float | None = Field(
        default=None, description="Landers only. Null when no slope limit is published for this lander."
    )
    load_day_kw: float | None = Field(description="Loads only: power drawn in sunlight. Null for other kinds.")
    load_night_kw: float | None = Field(description="Loads only: power drawn in darkness. Null for other kinds.")
    energy_per_night_kwh: float | None = None
    gen_kw: float | None = Field(description="Sources only: power produced per unit. Null for other kinds.")
    gen_needs_sun: bool | None = Field(description="Sources only: true when it works in sunlight only.")
    picture: str | None = None
    note: str | None = None
    figures: dict[str, CatalogFigure] = Field(
        default_factory=dict, description="The planner's figures behind the numbers above, with status and source."
    )


class CatalogResponse(_OutputModel):
    items: list[CatalogItem]
    status_labels: list[str]


# ---------------------------------------------------------------- check

PowerStatus = Literal["green", "yellow", "red", "none"]
NightBasis = Literal["energy", "power", "power only", "no darkness"]


class DayCheck(_OutputModel):
    needed: bool
    generation_kw: float
    load_kw: float
    refill_kw: float
    refill_kwh: float
    refill_hours: float | None
    margin_percent: float | None
    status: PowerStatus
    passes: bool


class NightCheck(_OutputModel):
    needed: bool
    basis: NightBasis
    generation_kw: float
    load_kw: float
    per_night_kwh: float
    longest_darkness_h: float | None
    storage_kwh: float
    storage_needed_kwh: float | None
    available_kwh: float | None
    load_kwh: float | None
    margin_percent: float | None
    status: PowerStatus
    passes: bool


class PowerBalance(_OutputModel):
    margin_percent: float | None
    status: PowerStatus
    limiting: Literal["day", "night", "day and night"] | None


class SiteEnergy(_OutputModel):
    """The planner's ``site_energy``: the energy a site's darkness adds (night load plus heating)."""

    dark_hours: float
    nights: int
    night_penalty_kwh: float
    heating_penalty_kwh: float
    total_kwh: float


FitVerdict = Literal["fits", "does not fit", "depends on capacity figure", "mass needed", "no lander", "nothing to fit"]


class CheckResponse(_OutputModel):
    fits: bool | None = Field(
        description="Null when the planner cannot decide (several capacity figures, a mass missing)."
    )
    fit_verdict: FitVerdict
    fit_notes: list[str]
    day: DayCheck
    night: NightCheck
    balance: PowerBalance
    power_notes: list[str]
    energy_added_kwh: float | None = Field(
        description=(
            "Null: the planner has no net generation-minus-load figure. The energy the site's darkness adds "
            "is in site_energy."
        )
    )
    site_energy: SiteEnergy | None = Field(description="Null when no site is given (no darkness length).")
    provenance: DataProvenance | None = Field(description="Where the darkness length came from. Null without a site.")
    warnings: list[str]


class CheckRequest(_InputModel):
    site: SiteRef | None
    landing_utc: UtcDatetime
    stay_days: float = Field(ge=limits.STAY_MIN_DAYS, le=limits.STAY_DURATION_MAX_DAYS)
    hardware: list[HardwareChoice] = Field(max_length=64)
    storage_kwh: float = StorageField

    @field_validator("landing_utc", mode="before")
    @classmethod
    def _parse_landing(cls, value: Any) -> Any:
        return parse_iso_utc(value)

    @field_validator("hardware")
    @classmethod
    def _unique_hardware(cls, hardware: list[HardwareChoice]) -> list[HardwareChoice]:
        return _check_unique_hardware(hardware)

    @model_validator(mode="after")
    def _check_window(self) -> "CheckRequest":
        _check_stay_window(self.landing_utc, self.stay_days)
        return self


def _check_stay_window(start: datetime, stay_days: float) -> None:
    if not limits.MISSION_WINDOW_START_UTC <= start < limits.MISSION_WINDOW_END_UTC:
        raise ValueError(
            f"the landing must be on or after {limits.MISSION_WINDOW_START_UTC.isoformat()} "
            f"and before {limits.MISSION_WINDOW_END_UTC.isoformat()}"
        )
    if start + timedelta(days=stay_days) > limits.MISSION_WINDOW_END_UTC:
        raise ValueError(f"the stay must end on or before {limits.MISSION_WINDOW_END_UTC.isoformat()}")


# ---------------------------------------------------------------- evaluate

EarthLink = Literal["clear", "intermittent", "none"]
VerdictResult = Literal["pass", "fail", "unknown"]


class Verdict(_OutputModel):
    result: VerdictResult = Field(description="'unknown' (new) when no requirement fails but one cannot be checked.")
    requirement: str | None = Field(
        description="fail: the first requirement that failed. unknown: the first that could not be checked."
    )
    unknown_requirements: list[str] = Field(description="Every requirement that could not be checked, in order.")


class RequirementCheck(_OutputModel):
    requirement: str
    passed: bool | None
    detail: str


class ScoreComponents(_OutputModel):
    """The four 0..100 terms of the score; null when the input is unknown."""

    sunlight: float
    darkness: float
    earth: float
    slope: float | None


class SiteEvaluation(_OutputModel):
    site_id: str
    rank: int = Field(ge=1, description="Position in this response, 1 = best. The backend owns the order.")
    score: float | None = Field(description="0..100. Null when a term is unknown (today: slope); see score_min/max.")
    score_min: float = Field(description="The score with every unknown term at its worst (0).")
    score_max: float = Field(description="The score with every unknown term at its best (100).")
    score_components: ScoreComponents
    sunlight_hours: float
    sunlight_percent: float
    longest_darkness_hours: float
    earth_visible_percent: float
    clear_sky_percent: float | None = Field(description="Null when no terrain skyline is available for the site.")
    slope_deg: float | None
    earth_link: EarthLink
    hardware_fits: bool | None
    energy_added_kwh: float | None
    site_energy: SiteEnergy | None
    power_margin_percent: float | None
    power_status: PowerStatus
    verdict: Verdict
    requirements: list[RequirementCheck]
    elevation_m: float
    elevation_source: str
    warnings: list[str]


class Geometry(_OutputModel):
    subsolar_lat: float
    subsolar_lon_east: float
    subearth_lat: float
    subearth_lon_east: float


class EvaluateRequest(_InputModel):
    sites: list[SiteRef] = Field(min_length=1, max_length=limits.MAX_SITES_PER_EVALUATION)
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
            "Launch-to-landing time, days (new, optional). The team has not fixed one: when it is left out the "
            "stay starts at launch_utc + slip_days and the response says so in warnings."
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

    @field_validator("sites")
    @classmethod
    def _unique_sites(cls, sites: list[SiteRef]) -> list[SiteRef]:
        ids = [site.id for site in sites]
        duplicates = sorted({site_id for site_id in ids if ids.count(site_id) > 1})
        if duplicates:
            raise ValueError(f"site ids must be unique; repeated: {', '.join(duplicates)}")
        return sites

    @model_validator(mode="after")
    def _check_window(self) -> "EvaluateRequest":
        if not limits.MISSION_WINDOW_START_UTC <= self.launch_utc < limits.MISSION_WINDOW_END_UTC:
            raise ValueError(
                f"launch_utc must be on or after {limits.MISSION_WINDOW_START_UTC.isoformat()} "
                f"and before {limits.MISSION_WINDOW_END_UTC.isoformat()}"
            )
        _check_stay_window(self.landing_utc, self.stay_days)
        return self

    @property
    def landing_utc(self) -> datetime:
        return self.launch_utc + timedelta(days=(self.transit_days or 0.0) + self.slip_days)


class EvaluateResponse(_OutputModel):
    launch_utc: UtcDatetime
    landing_utc: UtcDatetime = Field(description="launch_utc + transit_days + slip_days.")
    transit_days: float | None = Field(description="As sent; null means not stated (counted as 0, with a warning).")
    slip_days: int
    stay_days: float
    time_step_s: int = Field(description="Sampling step the backend chose for every site in this response.")
    geometry: Geometry | None = Field(description="Sub-solar and sub-Earth points at landing_utc, from the engine.")
    results: list[SiteEvaluation] = Field(description="Best first, ranked by the backend.")
    provenance: DataProvenance
    warnings: list[str]
