"""``POST /assistant``: the Mission Assistant (``web/src/api/client.ts``, ``api.ask``).

Every 503 here means "the assistant is unavailable"; the website shows its own sentence for it and keeps
everything else working. The body carries a plain ``detail`` sentence like the backend's other errors.
"""

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.exceptions import RequestValidationError
from pydantic import ValidationError

from app.api.website import _run
from app.config import Settings
from app.models.assistant import AskRequest, AskResponse
from app.models.results import ErrorResponse
from app.physics.factory import get_physics_engine
from app.physics.interface import PhysicsEngine
from app.services import assistant as service

router = APIRouter(tags=["assistant"])

SWITCHED_OFF = "The assistant is switched off on this server."
CAP_REACHED = "The assistant has answered all the questions it may answer today. It will be back after 00:00 UTC."
MODEL_UNAVAILABLE = "The assistant's language model did not answer. Try again later."

_RESPONSES: dict[int | str, dict[str, Any]] = {
    status.HTTP_422_UNPROCESSABLE_CONTENT: {
        "description": "Invalid request (for example a question over 500 characters) or hardware the planner cannot use"
    },
    status.HTTP_502_BAD_GATEWAY: {"model": ErrorResponse, "description": "Engine output violated the contract"},
    status.HTTP_503_SERVICE_UNAVAILABLE: {
        "model": ErrorResponse,
        "description": (
            "Assistant unavailable: switched off, today's cap reached, Bedrock refused or timed out, "
            "or the physics engine is unavailable"
        ),
    },
}


def get_settings_of_app(request: Request) -> Settings:
    return request.app.state.settings


def get_daily_cap(request: Request) -> service.DailyCap:
    return request.app.state.assistant_cap


def bedrock_client(request: Request, settings: Settings) -> Any:
    """Built on first use and kept for the life of this copy of the app. Tests set ``app.state.bedrock_client``."""
    client = getattr(request.app.state, "bedrock_client", None)
    if client is None:
        client = service.build_bedrock_client(settings.assistant_region)
        request.app.state.bedrock_client = client
    return client


def _unavailable(message: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=message)


@router.post("/assistant", response_model=AskResponse, summary="Mission Assistant (text only)", responses=_RESPONSES)
def assistant(
    body: AskRequest,
    request: Request,
    engine: Annotated[PhysicsEngine, Depends(get_physics_engine)],
    settings: Annotated[Settings, Depends(get_settings_of_app)],
    cap: Annotated[service.DailyCap, Depends(get_daily_cap)],
) -> AskResponse:
    """Answers one question about the visitor's mission, from the same evaluation ``POST /evaluate`` runs over
    the 17 preset sites (and the selected custom point). A language model on Amazon Bedrock words the answer;
    it is told to use only the numbers in those results. Text only, at most about 120 words.

    503 when the assistant is switched off (``CH_ASSISTANT_ENABLED``), today's cap is reached, or Bedrock
    refuses or times out. The cap is counted in memory per running copy and resets each UTC day.
    """
    if not settings.assistant_enabled:
        raise _unavailable(SWITCHED_OFF)
    if cap.exhausted():  # before the engine runs, so a spent cap costs nothing
        raise _unavailable(CAP_REACHED)

    try:
        evaluate_request, note = service.evaluation_request(body.context)
    except ValidationError as exc:
        # The same 422 shape as any other invalid request (for example a stay ending after 2100).
        raise RequestValidationError(
            [{**e, "loc": ("body", "context", *e["loc"])} for e in exc.errors(include_url=False, include_context=False)]
        ) from exc
    results = _run(lambda: service.mission_results(evaluate_request, body.context.site_id, note, engine))
    payload = service.results_for_model(results, evaluate_request)

    if not cap.take():
        raise _unavailable(CAP_REACHED)
    try:
        answer = service.ask_model(
            bedrock_client(request, settings), settings.assistant_model_id, body.question, payload
        )
    except service.AssistantUnavailable as exc:
        raise _unavailable(MODEL_UNAVAILABLE) from exc
    return AskResponse(answer=answer)
