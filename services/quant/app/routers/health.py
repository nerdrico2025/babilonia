"""
Health-check do microserviço.

O Next.js chama `GET /health` para confirmar que o serviço está de pé antes de
disparar um cálculo pesado. A resposta é deliberadamente simples e NÃO toca no
banco — é um liveness check barato e rápido.
"""

from fastapi import APIRouter
from pydantic import BaseModel

from app.core.config import get_settings

router = APIRouter(tags=["health"])


class HealthResponse(BaseModel):
    status: str
    service: str
    environment: str


@router.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    """Liveness check simples (não consulta o banco)."""
    settings = get_settings()
    return HealthResponse(
        status="ok",
        service=settings.service_name,
        environment=settings.environment,
    )
