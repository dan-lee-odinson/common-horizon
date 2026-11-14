"""Largest allowed request must produce a response that AWS Lambda can return."""

from app.models import limits

LAMBDA_SYNC_RESPONSE_LIMIT_BYTES = 6 * 1024 * 1024


def test_max_sample_response_fits_lambda_payload_limit(client, mission_payload):
    step_s = limits.TIME_STEP_MIN_S
    mission_payload["time_step_s"] = step_s
    mission_payload["stay_duration_days"] = (limits.MAX_SAMPLES - 1) * step_s / 86_400

    response = client.post("/api/v1/missions/evaluate", json=mission_payload)

    assert response.status_code == 200
    assert len(response.json()["timeseries"]["timestamps_utc"]) == limits.MAX_SAMPLES
    assert len(response.content) < LAMBDA_SYNC_RESPONSE_LIMIT_BYTES


def test_one_sample_over_the_cap_is_rejected(client, mission_payload):
    step_s = limits.TIME_STEP_MIN_S
    mission_payload["time_step_s"] = step_s
    mission_payload["stay_duration_days"] = limits.MAX_SAMPLES * step_s / 86_400

    assert client.post("/api/v1/missions/evaluate", json=mission_payload).status_code == 422
