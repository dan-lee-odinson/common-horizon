from typing import Annotated, Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.config import CONTRACT_VERSION, SERVICE_NAME, SERVICE_VERSION
from app.physics.factory import get_physics_engine
from app.physics.interface import PhysicsEngine

router = APIRouter(tags=["health"])


class EngineStatus(BaseModel):
    name: str
    version: str
    is_synthetic: bool
    available: bool


class HealthResponse(BaseModel):
    status: Literal["ok"]
    service: str
    version: str
    contract_version: str
    physics_engine: EngineStatus
    assistant_available: bool = Field(
        description="False: the assistant (language model) is not part of this backend yet."
    )


@router.get("/health", response_model=HealthResponse, summary="Liveness and configuration check")
def health(engine: Annotated[PhysicsEngine, Depends(get_physics_engine)]) -> HealthResponse:
    """Always cheap: used as the AWS Lambda Web Adapter readiness check. Never runs the engine."""
    info = engine.info
    return HealthResponse(
        status="ok",
        service=SERVICE_NAME,
        version=SERVICE_VERSION,
        contract_version=CONTRACT_VERSION,
        physics_engine=EngineStatus(
            name=info.name, version=info.version, is_synthetic=info.is_synthetic, available=info.available
        ),
        assistant_available=False,
    )
