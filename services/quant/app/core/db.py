"""
Conexão com o Neon Postgres — SOMENTE LEITURA.

Fronteira de responsabilidade (ver README.md):
- Este serviço LÊ `opcao_cotahist`, `acao_cotahist` e `iv_history` para os
  cálculos pesados (screening, backtest, superfície de IV — em prompts futuros).
- Ele NUNCA escreve no banco. O book/positions e toda persistência são
  responsabilidade exclusiva do app Next.js.

Para reforçar isso em runtime, cada conexão é aberta em modo read-only
(`default_transaction_read_only=on`): qualquer tentativa de INSERT/UPDATE/DELETE
falha no próprio Postgres, mesmo que o código futuro erre. A defesa definitiva,
porém, é um usuário/role de banco com permissão apenas de SELECT.
"""

from collections.abc import Iterator
from contextlib import contextmanager

import psycopg

from app.core.config import get_settings

# Opções de sessão aplicadas a TODA conexão: transações somente-leitura.
_READ_ONLY_OPTIONS = "-c default_transaction_read_only=on"


@contextmanager
def get_connection() -> Iterator[psycopg.Connection]:
    """
    Abre uma conexão read-only com o Postgres e a fecha ao final.

    Uso:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT ...")

    Observação: por enquanto abrimos uma conexão por chamada. Quando o volume de
    requests crescer, trocar por um pool (`psycopg_pool.ConnectionPool`) sem mudar
    a assinatura deste helper.
    """
    settings = get_settings()
    conn = psycopg.connect(
        settings.database_url,
        options=_READ_ONLY_OPTIONS,
        autocommit=True,
    )
    try:
        yield conn
    finally:
        conn.close()


def check_database() -> bool:
    """Faz um `SELECT 1` para confirmar que o banco está acessível."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT 1")
            return cur.fetchone() == (1,)
