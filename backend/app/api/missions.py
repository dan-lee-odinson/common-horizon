from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status

from app.models.mission import MissionInput
from app.models.results import ErrorResponse, MissionEvaluation
from app.physics.factory import get_physics_engine
from app.physics.interface import EngineContractError, PhysicsEngine, PhysicsEngineUnavailable
from app.services.evaluation import evaluate_mission

router = APIRouter(prefix="/api/v1", tags=["missions"])


@router.post(
    "/missions/evaluate",
    response_model=MissionEvaluation,
    summary="Evaluate one landing site and mission window",
    responses={
        status.HTTP_502_BAD_GATEWAY: {"model": ErrorResponse, "description": "Engine output violated the contract"},
        status.HTTP_503_SERVICE_UNAVAILABLE: {"model": ErrorResponse, "description": "Physics engine unavailable"},
    },
)
def evaluate(
    mission: MissionInput,
    response: Response,
    engine: Annotated[PhysicsEngine, Depends(get_physics_engine)],
) -> MissionEvaluation:
    """Returns Sun/Earth time series, mission metrics, communication windows,
    requirement checks and (optionally) a launch-delay comparison.

    Check ``provenance.is_synthetic`` (also sent as the ``X-Data-Source`` header):
    synthetic fixtures are placeholders, not physics results.
    """
    try:
        evaluation = evaluate_mission(mission, engine)
    except PhysicsEngineUnavailable as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    except EngineContractError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
    response.headers["X-Data-Source"] = evaluation.provenance.source.value
    return evaluation
