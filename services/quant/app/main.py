"""
Entrypoint do microserviço de quant pesado do Babilônia (FastAPI).

Fronteira (PRD §4.1 / §15 Fase 3): este serviço existe SÓ para o quant pesado
que o Next.js não deve fazer (screening de cadeia inteira, backtesting,
superfície de IV — implementados em prompts futuros). Ele NÃO duplica o
`lib/options-math` nem o motor Black-Scholes (TS) do app, NÃO decide ordens e
NÃO persiste positions. Ver `README.md`.

Rodar local:  uvicorn app.main:app --reload
"""

from fastapi import FastAPI

from app.core.config import get_settings
from app.routers import health, screening

settings = get_settings()

app = FastAPI(
    title="Babilônia Quant",
    version="0.1.0",
    summary="Microserviço de quant pesado (screening, backtest, superfície de IV).",
)

app.include_router(health.router)
app.include_router(screening.router)


@app.get("/", tags=["root"])
def root() -> dict[str, str]:
    """Raiz informativa — aponta para o health-check e os docs."""
    return {
        "service": settings.service_name,
        "docs": "/docs",
        "health": "/health",
    }
