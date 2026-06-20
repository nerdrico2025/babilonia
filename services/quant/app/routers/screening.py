"""
Router do screening — POST /screening.

Orquestra: resolve os tickers (request ou watchlist inteira) → carrega cada cadeia
do banco (LEITURA) → gera e ranqueia candidatas (núcleo puro `quant.screening`) →
monta o payload com aviso de TRIAGEM e carimbo de frescor.

NÃO implementa a Route Handler do Next.js que consome isto (próximo prompt).
"""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter

from app.quant import dados
from app.quant.screening import (
    AVISO_TRIAGEM,
    TIPOS_PADRAO,
    ConfigScreening,
    EstruturaCandidata,
    gerar_candidatas,
    ranquear,
)
from app.schemas import (
    EstruturaOut,
    FrescorOut,
    PernaOut,
    ScreeningRequest,
    ScreeningResponse,
)

router = APIRouter(tags=["screening"])


def _para_out(c: EstruturaCandidata) -> EstruturaOut:
    return EstruturaOut(
        ativo=c.ativo,
        tipo_estrutura=c.tipo_estrutura,
        nome=c.nome,
        vencimento=c.vencimento,
        data_referencia=c.data_referencia,
        risco_maximo=c.risco_maximo,
        rotulo_risco=c.rotulo_risco,
        ganho_maximo=c.ganho_maximo,
        breakevens=c.breakevens,
        razao_ganho_risco=c.razao_ganho_risco,
        risco_pct_capital=c.risco_pct_capital,
        pernas=[
            PernaOut(
                option_symbol=p.option_symbol,
                tipo=p.tipo,
                lado=p.lado,
                strike=p.strike,
                premio=p.premio,
                bid=p.bid,
                ask=p.ask,
                quantidade=p.quantidade,
            )
            for p in c.pernas
        ],
        avisos=c.avisos,
    )


@router.post("/screening", response_model=ScreeningResponse)
def screening(req: ScreeningRequest) -> ScreeningResponse:
    """Varre a cadeia (um ativo, vários, ou a watchlist) e ranqueia estruturas."""
    # Tickers: do request, ou a watchlist inteira (somente leitura).
    tickers = [t.upper() for t in req.tickers] if req.tickers else dados.buscar_watchlist()

    config = ConfigScreening(
        tipos=tuple(req.tipos) if req.tipos else TIPOS_PADRAO,
        top_n=req.top_n,
        tamanho_lote=req.tamanho_lote,
        max_vencimentos=req.max_vencimentos,
        max_strikes_por_lado=req.max_strikes_por_lado,
        vencimento_min_dias=req.vencimento_min_dias,
        vencimento_max_dias=req.vencimento_max_dias,
        capital_total=req.capital_total,
        risco_max_pct=req.risco_max_pct,
    )

    frescor: list[FrescorOut] = []
    todas: list[EstruturaCandidata] = []
    for ticker in tickers:
        cadeia = dados.carregar_cadeia(ticker)
        frescor.append(
            FrescorOut(
                ativo=cadeia.ativo,
                data_referencia=cadeia.as_of,
                opcoes_na_cadeia=len(cadeia.opcoes),
            )
        )
        todas.extend(gerar_candidatas(cadeia, config))

    # Ranking global entre todos os ativos pedidos (top N final).
    ranking = ranquear(todas, config.top_n)

    return ScreeningResponse(
        aviso=AVISO_TRIAGEM,
        gerado_em=datetime.now(UTC),
        frescor=frescor,
        ranking=[_para_out(c) for c in ranking],
    )
