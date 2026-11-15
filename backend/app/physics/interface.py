"""The single interface every physics engine implementation must satisfy.

The backend only ever talks to a ``PhysicsEngine``. The real engine (SPICE +
LOLA terrain) plugs in through ``app.physics.engine_adapter``; until then the
synthetic fixture in ``app.physics.synthetic`` stands in.

Output is returned as a validated ``SimulationResult``, so any shape or range
error in engine output is caught at this boundary instead of reaching the website.
"""

from collections.abc import Hashable
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Protocol

from pydantic import BaseModel, Field

from app.models.results import MissionMetrics, SiteInfo, TerrainSkyline, Timeseries, TimeWindow


@dataclass(frozen=True)
class EngineInfo:
    name: str
    version: str
    is_synthetic: bool
    available: bool = True


class EvaluationCache:
    """Per-timestamp results shared by the runs of ONE mission evaluation (baseline + launch delays).

    ``evaluate_mission`` creates one per evaluation and passes it with every request, so delayed runs
    reuse samples the baseline (or an earlier delay) already computed. Nothing outlives the
    evaluation: there is no eviction to defeat the request work budget, no entry from another HTTP
    request, and concurrent evaluations never share one. Its size is bounded by the evaluation's
    distinct timestamps, which ``MissionInput`` validation caps (``limits.MAX_TOTAL_SAMPLES``).
    Engines may ignore it.
    """

    def __init__(self) -> None:
        self._scopes: dict[Hashable, dict[Hashable, Any]] = {}

    def scope(self, key: Hashable) -> dict[Hashable, Any]:
        """The entries for one observing geometry (site, observer, terrain)."""
        return self._scopes.setdefault(key, {})

    def __len__(self) -> int:
        return sum(len(entries) for entries in self._scopes.values())


@dataclass(frozen=True)
class SimulationRequest:
    """One simulation run: a single site and a single start time.

    Launch-delay sweeps and requirement checks are orchestrated by the backend,
    which calls ``simulate`` once per analysed start date.
    """

    latitude_deg: float
    longitude_deg: float
    altitude_m: float | None  # None: engine derives elevation from terrain
    observer_height_m: float
    start_utc: datetime  # timezone-aware, UTC
    duration_s: float
    time_step_s: int
    include_timeseries: bool = True  # False for launch-delay cases, where only metrics are used
    # Shared by all runs of one evaluation; None: the engine keeps nothing between calls.
    sample_cache: EvaluationCache | None = field(default=None, compare=False, repr=False)


class SimulationResult(BaseModel):
    site: SiteInfo
    timeseries: Timeseries | None
    metrics: MissionMetrics
    communication_windows: list[TimeWindow]
    terrain_skyline: TerrainSkyline | None = None
    warnings: list[str] = Field(default_factory=list)
    # Data sets and models behind the numbers (kernels, terrain profile, citation). Copied to
    # ``provenance.sources`` of the response.
    sources: list[str] = Field(default_factory=list)


class PhysicsEngine(Protocol):
    @property
    def info(self) -> EngineInfo: ...

    def simulate(self, request: SimulationRequest) -> SimulationResult: ...


class PhysicsEngineUnavailable(RuntimeError):
    """The configured engine cannot run (not installed, not integrated yet, missing data)."""


class EngineContractError(RuntimeError):
    """The engine returned data that does not satisfy the contract."""
