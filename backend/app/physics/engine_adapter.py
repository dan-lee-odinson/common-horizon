"""Adapter for the real physics engine (SPICE + LOLA), owned by the physics lead.

NOT INTEGRATED YET. Selecting it (``CH_PHYSICS_ENGINE=physics``) makes the
evaluate endpoint answer 503 instead of silently falling back to synthetic data.

Integration plan, once the engine's Python functions and output shapes are agreed:

1. Import the engine package lazily inside ``simulate`` (keeps startup fast and
   lets the service run without the heavy SPICE/LOLA dependencies installed).
2. Map ``SimulationRequest`` onto the engine's inputs (units are already SI-like
   and named with unit suffixes).
3. Convert the engine's outputs (e.g. numpy arrays, dicts) into a
   ``SimulationResult``. Pydantic validation then enforces array alignment,
   angle ranges, unit vectors and metric ranges at this boundary.
4. Report ``EngineInfo(name=..., version=<engine version>, is_synthetic=False)``.
"""

from app.physics.interface import EngineInfo, PhysicsEngineUnavailable, SimulationRequest, SimulationResult


class PhysicsEngineAdapter:
    info = EngineInfo(name="physics-engine", version="unintegrated", is_synthetic=False, available=False)

    def simulate(self, request: SimulationRequest) -> SimulationResult:
        raise PhysicsEngineUnavailable(
            "The real physics engine is not integrated yet. Set CH_PHYSICS_ENGINE=synthetic to use "
            "clearly labelled synthetic fixtures."
        )
