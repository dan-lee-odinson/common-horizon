from app.config import CONTRACT_VERSION


def test_health_reports_ok_and_contract_version(client):
    response = client.get("/health")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["contract_version"] == CONTRACT_VERSION


def test_health_flags_synthetic_engine_by_default(client):
    engine = client.get("/health").json()["physics_engine"]

    assert engine["is_synthetic"] is True
    assert engine["available"] is True


def test_cors_allows_local_frontend_origin(client):
    response = client.options(
        "/api/v1/missions/evaluate",
        headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "POST"},
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"
