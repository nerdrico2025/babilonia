"""
dados — acesso de LEITURA ao Neon Postgres para o screening.

Esta é a única camada do screening que toca no banco. Usa `core.db.get_connection`
(conexão SOMENTE LEITURA — `default_transaction_read_only=on`). Lê de
`watchlist`, `opcao_cotahist` e `acao_cotahist`. NUNCA escreve — o book/positions
é responsabilidade exclusiva do Next.js (ver README, fronteira de responsabilidade).

Converte as linhas (numéricos vêm como Decimal/str do psycopg) para os dataclasses
puros de `screening.py`, que não sabem nada de banco.
"""

from __future__ import annotations

from datetime import datetime

from app.core.db import get_connection
from app.quant.screening import CadeiaAtivo, OpcaoSerie


def _f(valor: object) -> float:
    """Converte Decimal/str/None do COTAHIST para float (0 quando nulo)."""
    return float(valor) if valor is not None else 0.0


def _preco_ou_none(valor: object) -> float | None:
    """COTAHIST: 0,00 = sem oferta → None (mesma semântica do app)."""
    f = _f(valor)
    return f if f > 0 else None


def buscar_watchlist() -> list[str]:
    """Todos os ativos-objeto da watchlist (somente leitura)."""
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT symbol FROM watchlist ORDER BY symbol")
        return [row[0] for row in cur.fetchall()]


def buscar_data_base(conn, ativo: str) -> datetime | None:
    """Pregão mais recente (as-of) de `opcao_cotahist` para o ativo."""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT MAX(trade_date) FROM opcao_cotahist WHERE underlying = %s",
            (ativo,),
        )
        row = cur.fetchone()
        return row[0] if row else None


def buscar_spot(conn, ativo: str, as_of: datetime) -> float | None:
    """Fechamento do ativo-objeto (acao_cotahist) na data-base."""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT preco_fechamento FROM acao_cotahist "
            "WHERE ticker = %s AND trade_date = %s LIMIT 1",
            (ativo, as_of),
        )
        row = cur.fetchone()
        return _preco_ou_none(row[0]) if row else None


def buscar_cadeia(conn, ativo: str, as_of: datetime) -> list[OpcaoSerie]:
    """Todas as séries de opção do ativo na data-base (sem filtrar liquidez aqui)."""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT option_symbol, kind, strike, expires_at, bid, ask, "
            "       quantidade_titulos, volume_financeiro, numero_negocios "
            "FROM opcao_cotahist "
            "WHERE underlying = %s AND trade_date = %s",
            (ativo, as_of),
        )
        linhas = cur.fetchall()
    return [
        OpcaoSerie(
            option_symbol=r[0],
            kind=r[1],
            strike=_f(r[2]),
            expires_at=r[3],
            bid=_preco_ou_none(r[4]),
            ask=_preco_ou_none(r[5]),
            volume=_f(r[6]),
            volume_financeiro=_f(r[7]),
            numero_negocios=int(r[8]),
        )
        for r in linhas
    ]


def carregar_cadeia(ativo: str) -> CadeiaAtivo:
    """
    Carrega a cadeia EOD completa de um ativo (as-of + spot + séries). Degrada com
    graça: ativo sem cadeia ingerida → `as_of=None` e cadeia vazia (nunca quebra).
    """
    simbolo = ativo.upper()
    with get_connection() as conn:
        as_of = buscar_data_base(conn, simbolo)
        if as_of is None:
            return CadeiaAtivo(ativo=simbolo, as_of=None, spot=None, opcoes=[])
        spot = buscar_spot(conn, simbolo, as_of)
        opcoes = buscar_cadeia(conn, simbolo, as_of)
    return CadeiaAtivo(ativo=simbolo, as_of=as_of, spot=spot, opcoes=opcoes)
