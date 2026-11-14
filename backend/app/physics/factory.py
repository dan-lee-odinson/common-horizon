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
def build_engine(name: str) -> PhysicsEngine:
    try:
        return _ENGINES[name]()
    except KeyError:
        raise ValueError(f"Unknown CH_PHYSICS_ENGINE {name!r}; expected one of {sorted(_ENGINES)}") from None


def get_physics_engine(request: Request) -> PhysicsEngine:
    """FastAPI dependency: the engine chosen by the ``Settings`` given to ``create_app``.

    Tests override it with ``app.dependency_overrides``.
    """
    return request.app.state.physics_engine
