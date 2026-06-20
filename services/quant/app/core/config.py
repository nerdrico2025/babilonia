"""
Configuração do microserviço (lida de variáveis de ambiente / `.env`).

Princípios herdados do CLAUDE.md / AGENTS.md do Babilônia:
- Nenhum segredo hardcoded — tudo vem do ambiente (Railway injeta as vars;
  localmente lemos de `.env`, que está no `.gitignore`).
- `DATABASE_URL` aponta para o MESMO Neon Postgres do app Next.js, mas este
  serviço usa o banco de forma SOMENTE-LEITURA (ver `core/db.py`).
"""

from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Configuração tipada e validada do serviço."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # String de conexão do Neon Postgres (mesma base do Next.js, acesso de leitura).
    database_url: str = Field(..., alias="DATABASE_URL")

    # Nome/versão expostos no health-check e nos logs.
    service_name: str = Field("babilonia-quant", alias="SERVICE_NAME")

    # Ambiente lógico (local | railway | ...), só para logs/diagnóstico.
    environment: str = Field("local", alias="ENVIRONMENT")


@lru_cache
def get_settings() -> Settings:
    """Lê e valida o ambiente uma única vez (cacheado)."""
    return Settings()  # type: ignore[call-arg]  # campos vêm do ambiente
