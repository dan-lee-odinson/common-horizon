"""Regenerate the committed contract artefacts for the frontend.

Run from ``backend/``::

    python -m scripts.export_contract

Writes:
    contract/openapi.json                              OpenAPI schema (generate TS types from it)
    contract/examples/evaluate_request.json            example request body
    contract/examples/evaluate_response.SYNTHETIC.json example response from the SYNTHETIC fixture

``tests/test_openapi.py`` fails if ``contract/openapi.json`` drifts from the code.
"""

import json
from pathlib import Path

from fastapi.testclient import TestClient

from app.main import create_app

BACKEND_DIR = Path(__file__).resolve().parents[1]
CONTRACT_DIR = BACKEND_DIR / "contract"
OPENAPI_PATH = CONTRACT_DIR / "openapi.json"
EXAMPLE_REQUEST_PATH = CONTRACT_DIR / "examples" / "evaluate_request.json"
EXAMPLE_RESPONSE_PATH = CONTRACT_DIR / "examples" / "evaluate_response.SYNTHETIC.json"

EXAMPLE_REQUEST = {
    "landing_site": {"latitude_deg": -89.5, "longitude_deg": -45.0, "altitude_m": None},
    "observer_height_m": 2.0,
    "mission_start_utc": "2027-01-15T00:00:00Z",
    "stay_duration_days": 2,
    "time_step_s": 3600,
    "launch_delay_days": 2,
    "launch_delay_step_days": 1,
    "hardware_id": "example-lander-01",
    "hardware_requirements": {"min_sunlight_percentage": 50, "max_darkness_hours": 72},
}


def _write_json(path: Path, data: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")


def main() -> None:
    app = create_app()
    _write_json(OPENAPI_PATH, app.openapi())
    _write_json(EXAMPLE_REQUEST_PATH, EXAMPLE_REQUEST)

    with TestClient(app) as client:
        response = client.post("/api/v1/missions/evaluate", json=EXAMPLE_REQUEST)
    response.raise_for_status()
    body = response.json()
    if not body["provenance"]["is_synthetic"]:
        raise SystemExit("Refusing to write a SYNTHETIC example from a non-synthetic engine.")
    _write_json(EXAMPLE_RESPONSE_PATH, body)

    for path in (OPENAPI_PATH, EXAMPLE_REQUEST_PATH, EXAMPLE_RESPONSE_PATH):
        print(f"wrote {path.relative_to(BACKEND_DIR)}")


if __name__ == "__main__":
    main()
