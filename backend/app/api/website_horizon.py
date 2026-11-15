"""``POST /horizon``: what the website's Site stage draws (skyline, Sun path, Earth box), at the root path
like the other website routes. The logic is in ``app/services/website_horizon.py``."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status

from app.models.results import ErrorResponse
from app.models.website_horizon import HorizonRequest, HorizonResponse
from app.physics.factory import get_physics_engine
from app.physics.interface import EngineContractError, PhysicsEngine, PhysicsEngineUnavailable
from app.services.website_horizon import horizon_view

router = APIRouter(tags=["website"])


@router.post(
    "/horizon",
    response_model=HorizonResponse,
    summary="Terrain skyline, the Sun's path and the Earth's box for one site",
    responses={
        status.HTTP_502_BAD_GATEWAY: {"model": ErrorResponse, "description": "Engine output violated the contract"},
        status.HTTP_503_SERVICE_UNAVAILABLE: {"model": ErrorResponse, "description": "Physics engine unavailable"},
    },
)
def horizon(
    request: HorizonRequest, response: Response, engine: Annotated[PhysicsEngine, Depends(get_physics_engine)]
) -> HorizonResponse:
    """One physics run through the engine interface ``/evaluate`` uses. ``state`` is "above" when any part of
    the Sun's disc is visible above the terrain. Check ``provenance.is_synthetic`` (also the ``X-Data-Source``
    header): synthetic fixtures are not physics."""
    try:
        result = horizon_view(request, engine)
    except PhysicsEngineUnavailable as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    except EngineContractError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
    response.headers["X-Data-Source"] = result.provenance.source.value
    return result
