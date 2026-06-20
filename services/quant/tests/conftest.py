"""
Configuração compartilhada dos testes.

Os testes de foundation NÃO tocam no banco — mas a config exige `DATABASE_URL`.
Injetamos um placeholder no ambiente ANTES de qualquer import do app, para que
`get_settings()` valide sem precisar de um Postgres real.
"""

import os

# Placeholder — não conecta a lugar nenhum; só satisfaz a validação da config.
os.environ.setdefault(
    "DATABASE_URL",
    "postgresql://test:test@localhost:5432/test",
)
os.environ.setdefault("ENVIRONMENT", "test")

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)
