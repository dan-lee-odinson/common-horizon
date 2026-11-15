"""Shared helpers for the website API tests: a scripted engine whose metrics the test chooses."""

from collections.abc import Callable
from datetime import datetime
from typing import Any

from app.physics.interface import EngineInfo, SimulationRequest, SimulationResult
from app.physics.synthetic import SyntheticPhysicsEngine

Script = Callable[[float, float, datetime], dict[str, Any]]

LAUNCH = "2027-02-10T15:00:00Z"


class ScriptedEngine:
    """The synthetic engine's series, with metrics and slope replaced by what ``script`` returns.

    ``script(latitude_deg, longitude_deg, start_utc)`` returns any of: sunlight_percentage,
    longest_darkness_hours, earth_visibility_percentage, sky_visibility_fraction, slope_deg.
    """

    def __init__(self, script: Script, *, synthetic: bool = False) -> None:
        self._script = script
        self._synthetic = synthetic
        self.calls: list[SimulationRequest] = []

    @property
    def info(self) -> EngineInfo:
        return EngineInfo(name="scripted-test-engine", version="0", is_synthetic=self._synthetic)

    def simulate(self, request: SimulationRequest) -> SimulationResult:
        self.calls.append(request)
        base = SyntheticPhysicsEngine().simulate(request)
        wanted = self._script(request.latitude_deg, request.longitude_deg, request.start_utc)
        stay_hours = request.duration_s / 3600.0
        metric_updates = {
            key: wanted[key]
            for key in (
                "sunlight_percentage",
                "longest_darkness_hours",
                "earth_visibility_percentage",
                "sky_visibility_fraction",
            )
            if key in wanted
        }
        if "sunlight_percentage" in wanted:
            metric_updates["sunlight_hours"] = stay_hours * wanted["sunlight_percentage"] / 100.0
        if "earth_visibility_percentage" in wanted:
            metric_updates["earth_visibility_hours"] = stay_hours * wanted["earth_visibility_percentage"] / 100.0
        return base.model_copy(
            update={
                "metrics": base.metrics.model_copy(update=metric_updates),
                "site": base.site.model_copy(update={"slope_deg": wanted.get("slope_deg")}),
                "warnings": [],
            }
        )


def site_ref(site_id: str, lat: float, lon_east: float, name: str | None = None) -> dict[str, Any]:
    return {"id": site_id, "name": name or site_id, "lat": lat, "lon_east": lon_east}


def evaluate_body(sites: list[dict[str, Any]], **overrides: Any) -> dict[str, Any]:
    body = {
        "sites": sites,
        "launch_utc": LAUNCH,
        "slip_days": 0,
        "stay_days": 2,
        "hardware": [{"id": "griffin", "count": 1}, {"id": "comms_relay", "count": 1}, {"id": "vsat", "count": 1}],
        "storage_kwh": 50,
    }
    body.update(overrides)
    return body
