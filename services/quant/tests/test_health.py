"""Testes do health-check e da raiz — a fundação do serviço sobe e responde."""

from fastapi.testclient import TestClient


def test_health_ok(client: TestClient) -> None:
    resp = client.get("/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert body["service"] == "babilonia-quant"
    assert body["environment"] == "test"


def test_root_aponta_para_health_e_docs(client: TestClient) -> None:
    resp = client.get("/")
    assert resp.status_code == 200
    body = resp.json()
    assert body["health"] == "/health"
    assert body["docs"] == "/docs"
