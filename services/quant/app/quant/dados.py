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
from app.quant.backtest import (
    DadosInsuficientesError,
    EntradaBacktest,
    PernaBacktest,
    PontoPreco,
    PontoStrike,
)
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


# ── Backtest (§15 Fase 3) — leitura do histórico de fechamentos ──────────────


def buscar_metadados_opcoes(
    conn, symbols: list[str]
) -> dict[str, tuple[str, float, str | None, datetime]]:
    """
    Metadados constantes de cada série (tipo, strike, ativo-objeto, vencimento).
    São fixos por ticker — pegamos de qualquer pregão (o mais recente). Tickers
    inexistentes na base simplesmente não aparecem no dicionário (o chamador apura).
    """
    with conn.cursor() as cur:
        cur.execute(
            "SELECT DISTINCT ON (option_symbol) "
            "       option_symbol, kind, strike, underlying, expires_at "
            "FROM opcao_cotahist "
            "WHERE option_symbol = ANY(%s) "
            "ORDER BY option_symbol, trade_date DESC",
            (symbols,),
        )
        return {r[0]: (r[1], _f(r[2]), r[3], r[4]) for r in cur.fetchall()}


def buscar_historico_opcoes(
    conn, symbols: list[str], inicio: datetime, fim: datetime
) -> dict[str, list[PontoPreco]]:
    """
    Fechamentos reais (PREULT) de cada série na janela [inicio, fim], ordenados por
    pregão. SÓ pregões COM negócio (fechamento > 0): dia sem negócio fica ausente do
    histórico e o núcleo trata como carry-forward (§2.4 — nunca inventa preço).
    """
    historico: dict[str, list[PontoPreco]] = {s: [] for s in symbols}
    with conn.cursor() as cur:
        cur.execute(
            "SELECT option_symbol, trade_date, preco_fechamento "
            "FROM opcao_cotahist "
            "WHERE option_symbol = ANY(%s) AND trade_date BETWEEN %s AND %s "
            "ORDER BY option_symbol, trade_date",
            (symbols, inicio, fim),
        )
        for symbol, trade_date, fechamento in cur.fetchall():
            preco = _preco_ou_none(fechamento)
            if preco is not None:  # 0,00 = sem negócio → não vira ponto
                historico.setdefault(symbol, []).append(PontoPreco(data=trade_date, preco=preco))
    return historico


def buscar_strikes_opcoes(
    conn, symbols: list[str], inicio: datetime, fim: datetime
) -> dict[str, list[PontoStrike]]:
    """
    Linha do tempo do strike de cada série na janela [inicio, fim], ordenada por
    pregão. Inclui TODOS os pregões (mesmo sem negócio), porque o ajuste por provento
    muda o strike independentemente de ter havido negócio no dia — é o que permite
    cravar a data-ex. Usado só para SINALIZAR ajustes (não entra no cálculo do P&L).
    """
    strikes: dict[str, list[PontoStrike]] = {s: [] for s in symbols}
    with conn.cursor() as cur:
        cur.execute(
            "SELECT option_symbol, trade_date, strike "
            "FROM opcao_cotahist "
            "WHERE option_symbol = ANY(%s) AND trade_date BETWEEN %s AND %s "
            "ORDER BY option_symbol, trade_date",
            (symbols, inicio, fim),
        )
        for symbol, trade_date, strike in cur.fetchall():
            strikes.setdefault(symbol, []).append(
                PontoStrike(data=trade_date, strike=_f(strike))
            )
    return strikes


def buscar_spot_ate(conn, ativo: str, data: datetime) -> float | None:
    """Fechamento do ativo-objeto no pregão mais recente ATÉ `data` (≤ data)."""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT preco_fechamento FROM acao_cotahist "
            "WHERE ticker = %s AND trade_date <= %s "
            "ORDER BY trade_date DESC LIMIT 1",
            (ativo, data),
        )
        row = cur.fetchone()
        return _preco_ou_none(row[0]) if row else None


def carregar_backtest(
    pedidos: list[tuple[str, str, int]],
    data_entrada: datetime,
    data_saida: datetime | None,
    tamanho_lote: int = 100,
) -> EntradaBacktest:
    """
    Monta a `EntradaBacktest` (pura) a partir do banco: enriquece cada perna com
    tipo/strike/vencimento da base, carrega o histórico de fechamentos e o spot do
    objeto no vencimento. `pedidos` = lista de (option_symbol, lado, quantidade).

    Recusa (DadosInsuficientesError) tickers inexistentes; recusa (ValueError) uma
    estrutura com pernas de vencimentos diferentes — uma estrutura tem um vencimento.
    """
    symbols = [p[0].upper() for p in pedidos]
    with get_connection() as conn:
        meta = buscar_metadados_opcoes(conn, symbols)

        ausentes = [s for s in symbols if s not in meta]
        if ausentes:
            raise DadosInsuficientesError(
                [f"{s}: ticker não encontrado na base de opções." for s in ausentes],
                "Algumas pernas não existem na base ingerida. Confira os tickers.",
            )

        vencimentos = {meta[s][3] for s in symbols}
        if len(vencimentos) > 1:
            raise ValueError(
                "As pernas têm vencimentos diferentes — uma estrutura tem um único "
                "vencimento. Monte uma estrutura por vencimento."
            )
        vencimento = next(iter(vencimentos))
        underlyings = {meta[s][2] for s in symbols if meta[s][2] is not None}
        ativo = next(iter(underlyings)) if underlyings else "—"

        data_saida_efetiva = data_saida or vencimento
        # Carrega o histórico até o vencimento (o núcleo recorta pela data de saída).
        historico = buscar_historico_opcoes(conn, symbols, data_entrada, vencimento)
        # Linha do tempo do strike (p/ detectar ajuste por provento — só sinalização).
        strikes = buscar_strikes_opcoes(conn, symbols, data_entrada, vencimento)
        spot_vencimento = (
            buscar_spot_ate(conn, ativo, vencimento) if ativo != "—" else None
        )

    pernas = [
        PernaBacktest(
            option_symbol=symbol,
            tipo=meta[symbol][0],  # kind: "call" | "put"
            lado=lado,  # "compra" | "venda"
            strike=meta[symbol][1],
            quantidade=quantidade,
        )
        for symbol, lado, quantidade in (
            (p[0].upper(), p[1], p[2]) for p in pedidos
        )
    ]

    return EntradaBacktest(
        ativo=ativo,
        pernas=pernas,
        historico=historico,
        data_entrada=data_entrada,
        data_saida=data_saida_efetiva,
        vencimento=vencimento,
        spot_vencimento=spot_vencimento,
        tamanho_lote=tamanho_lote,
        strikes=strikes,
    )
