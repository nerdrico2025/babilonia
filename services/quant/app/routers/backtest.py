"""
Router do backtest — POST /backtest (§15 Fase 3).

Orquestra: resolve as datas → carrega histórico/metadados do banco (LEITURA,
`quant.dados.carregar_backtest`) → roda a simulação pura (`quant.backtest.simular`)
→ monta o payload com o disclaimer de SIMULAÇÃO HISTÓRICA, a série diária e o resumo.

Degradação por DADO (§2.4): dados insuficientes (ticker inexistente, sem preço de
entrada) → 422 apontando EXATAMENTE o que falta; estrutura inválida (vencimentos
mistos, datas trocadas) → 400. NUNCA gera resultado com dado inventado.

NÃO implementa a Route Handler do Next.js que consome isto (próximo prompt).
"""

from __future__ import annotations

from datetime import UTC, date, datetime

from fastapi import APIRouter, HTTPException

from app.quant import backtest, dados
from app.quant.backtest import DadosInsuficientesError, ResultadoBacktest
from app.schemas import (
    AjusteProventoOut,
    BacktestRequest,
    BacktestResponse,
    PontoSerieOut,
    ResumoBacktestOut,
)

router = APIRouter(tags=["backtest"])


def _para_dt(d: date) -> datetime:
    """Data (YYYY-MM-DD) → datetime à meia-noite UTC (casa com o trade_date EOD)."""
    return datetime(d.year, d.month, d.day, tzinfo=UTC)


def _para_response(r: ResultadoBacktest) -> BacktestResponse:
    return BacktestResponse(
        aviso=r.aviso,
        ativo=r.ativo,
        data_entrada=r.data_entrada,
        data_saida=r.data_saida,
        vencimento=r.vencimento,
        serie=[
            PontoSerieOut(
                data=p.data,
                valor_posicao=p.valor_posicao,
                pl_acumulado=p.pl_acumulado,
                sem_negociacao=p.sem_negociacao,
                fonte=p.fonte,
                evento=p.evento,
            )
            for p in r.serie
        ],
        resumo=ResumoBacktestOut(
            risco_maximo=r.resumo.risco_maximo,
            rotulo_risco=r.resumo.rotulo_risco,
            ganho_maximo=r.resumo.ganho_maximo,
            pl_final=r.resumo.pl_final,
            pl_final_pct_risco=r.resumo.pl_final_pct_risco,
            dias_ate_vencimento=r.resumo.dias_ate_vencimento,
            liquidado_no_vencimento=r.resumo.liquidado_no_vencimento,
            avisos=r.resumo.avisos,
            ajustes_provento=[
                AjusteProventoOut(
                    data_ex=a.data_ex,
                    valor_ajuste_por_acao=a.valor_ajuste_por_acao,
                    pernas_afetadas=a.pernas_afetadas,
                    explicacao=a.explicacao,
                )
                for a in r.resumo.ajustes_provento
            ],
        ),
    )


@router.post("/backtest", response_model=BacktestResponse)
def post_backtest(req: BacktestRequest) -> BacktestResponse:
    """Simula a evolução histórica (mark-to-market) de uma estrutura escolhida."""
    data_entrada = _para_dt(req.data_entrada)
    data_saida = _para_dt(req.data_saida) if req.data_saida is not None else None
    pedidos = [(p.option_symbol.upper(), p.lado, p.quantidade) for p in req.pernas]

    try:
        entrada = dados.carregar_backtest(
            pedidos, data_entrada, data_saida, req.tamanho_lote
        )
        resultado = backtest.simular(entrada)
    except DadosInsuficientesError as e:
        # Dados reais insuficientes — aponta o que falta, não inventa (§2.4).
        raise HTTPException(
            status_code=422,
            detail={"erro": e.mensagem, "faltam": e.faltantes},
        ) from e
    except ValueError as e:
        # Estrutura/datas inválidas.
        raise HTTPException(status_code=400, detail={"erro": str(e)}) from e

    return _para_response(resultado)
