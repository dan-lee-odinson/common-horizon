"""The endpoints the website calls (``web/src/api/client.ts``): ``GET /sites``, ``GET /catalog``,
``POST /check`` and ``POST /evaluate``, at the root path as the website expects them."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status

from app.models.results import ErrorResponse
from app.models.website import (
    CatalogResponse,
    CheckRequest,
    CheckResponse,
    EvaluateRequest,
    EvaluateResponse,
    SiteListResponse,
)
from app.physics.factory import get_physics_engine
from app.physics.interface import EngineContractError, PhysicsEngine, PhysicsEngineUnavailable
from app.planner_bridge import planner
from app.services.catalog import HardwareChoiceError, website_catalog
from app.services.sites import preset_sites
from app.services.website_evaluation import check_hardware, evaluate_sites

router = APIRouter(tags=["website"])

_ENGINE_ERRORS = {
    status.HTTP_422_UNPROCESSABLE_CONTENT: {"model": ErrorResponse, "description": "Hardware the planner cannot use"},
    status.HTTP_502_BAD_GATEWAY: {"model": ErrorResponse, "description": "Engine output violated the contract"},
    status.HTTP_503_SERVICE_UNAVAILABLE: {"model": ErrorResponse, "description": "Physics engine unavailable"},
}


def _run(call):
    try:
        return call()
    except (HardwareChoiceError, planner.PlannerInputError) as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)) from exc
    except PhysicsEngineUnavailable as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    except EngineContractError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.get("/sites", response_model=SiteListResponse, summary="The 17 approved preset landing sites")
def sites() -> SiteListResponse:
    """Longitudes are degrees east, 0..360. Source: the team's preset list (``web/src/api/examples/sites.json``)."""
    return preset_sites()


@router.get("/catalog", response_model=CatalogResponse, summary="Hardware catalog from the planner module")
def catalog() -> CatalogResponse:
    """Every item and figure comes from ``planner.list_catalog()``; unpublished figures are null."""
    return website_catalog()


@router.post(
    "/check", response_model=CheckResponse, summary="Fit and power checks for one site", responses=_ENGINE_ERRORS
)
def check(
    request: CheckRequest, response: Response, engine: Annotated[PhysicsEngine, Depends(get_physics_engine)]
) -> CheckResponse:
    """The planner's ``fit_check``, ``power_check`` and ``site_energy``. With a site, the darkness comes from
    the physics engine; check ``provenance.is_synthetic``."""
    result = _run(lambda: check_hardware(request, engine))
    response.headers["X-Data-Source"] = result.provenance.source.value if result.provenance else "none"
    return result


@router.post(
    "/evaluate", response_model=EvaluateResponse, summary="Evaluate and rank several sites", responses=_ENGINE_ERRORS
)
def evaluate(
    request: EvaluateRequest, response: Response, engine: Annotated[PhysicsEngine, Depends(get_physics_engine)]
) -> EvaluateResponse:
    """One physics run per site, the planner's checks, then Dan's ranking (best first, see ``rank``).

    Check ``provenance.is_synthetic`` (also the ``X-Data-Source`` header): synthetic fixtures are not physics.
    """
    result = _run(lambda: evaluate_sites(request, engine))
    response.headers["X-Data-Source"] = result.provenance.source.value
    return result
