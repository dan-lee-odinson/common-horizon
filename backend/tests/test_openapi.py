"""The OpenAPI schema is the contract the frontend generates its types from."""

import json

from openapi_spec_validator import validate

from app.models.mission import MissionInput
from app.models.results import MissionEvaluation
from scripts.export_contract import EXAMPLE_REQUEST_PATH, EXAMPLE_RESPONSE_PATH, OPENAPI_PATH


def test_generated_schema_is_valid_openapi(app):
    validate(app.openapi())


def test_schema_exposes_contract_endpoints_and_models(client):
    schema = client.get("/openapi.json").json()

    assert set(schema["paths"]) == {
        "/health", "/api/v1/missions/evaluate", "/sites", "/catalog", "/check", "/evaluate", "/horizon", "/assistant"
    }
    assert {"200", "422", "503"} <= set(schema["paths"]["/assistant"]["post"]["responses"])
    for path in ("/check", "/evaluate"):
        assert {"200", "422", "502", "503"} <= set(schema["paths"][path]["post"]["responses"])
    evaluate = schema["paths"]["/api/v1/missions/evaluate"]["post"]
    assert {"200", "422", "502", "503"} <= set(evaluate["responses"])
    components = schema["components"]["schemas"]
    for name in (
        "LandingSite",
        "HardwareRequirements",
        "MissionEvaluation",
        "Timeseries",
        "ObstructionState",
        "SiteListResponse",
        "CatalogResponse",
        "CheckResponse",
        "EvaluateResponse",
    ):
        assert name in components


def test_committed_openapi_matches_code(app):
    committed = json.loads(OPENAPI_PATH.read_text(encoding="utf-8"))

    assert committed == app.openapi(), (
        "backend/contract/openapi.json is stale. Run `python -m scripts.export_contract` from backend/ "
        "and commit the result so the frontend sees the change."
    )


def test_committed_examples_are_valid_and_labelled_synthetic():
    request = MissionInput.model_validate_json(EXAMPLE_REQUEST_PATH.read_text(encoding="utf-8"))
    response = MissionEvaluation.model_validate_json(EXAMPLE_RESPONSE_PATH.read_text(encoding="utf-8"))

    assert response.provenance.is_synthetic is True
    assert response.mission == request
