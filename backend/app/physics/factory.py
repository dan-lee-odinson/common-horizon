"""Chooses the physics engine implementation from configuration."""

from functools import lru_cache

from fastapi import Request

from app.physics.engine_adapter import PhysicsEngineAdapter
from app.physics.interface import PhysicsEngine
from app.physics.synthetic import SyntheticPhysicsEngine

_ENGINES = {
    "synthetic": SyntheticPhysicsEngine,
    "physics": PhysicsEngineAdapter,
}


@lru_cache
def build_engine(
    name: str, spice_kernel_dir: str | None = None, horizon_profile_dir: str | None = None
) -> PhysicsEngine:
    """One engine instance per configuration (the real engine loads its kernels and profiles once)."""
    if name not in _ENGINES:
        raise ValueError(f"Unknown CH_PHYSICS_ENGINE {name!r}; expected one of {sorted(_ENGINES)}")
    if name == "physics":
        return PhysicsEngineAdapter(spice_kernel_dir=spice_kernel_dir, horizon_profile_dir=horizon_profile_dir)
    return _ENGINES[name]()


def get_physics_engine(request: Request) -> PhysicsEngine:
    """FastAPI dependency: the engine chosen by the ``Settings`` given to ``create_app``.

    Tests override it with ``app.dependency_overrides``.
    """
    return request.app.state.physics_engine
