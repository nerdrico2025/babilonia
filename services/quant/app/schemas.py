"""
Schemas (Pydantic) da API do microserviço — contrato HTTP com o Next.js.

O screening devolve TUDO que o ticket precisa para montar sem recalcular nada:
tickers exatos das opções, strikes, prêmios, vencimento, risco/ganho/breakevens.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.quant.screening import TipoEstrutura


class ScreeningRequest(BaseModel):
    """Corpo do POST /screening."""

    # Ticker único, lista de tickers, ou nada (None → watchlist inteira).
    tickers: list[str] | None = Field(
        default=None, description="Ativos-objeto. Vazio/ausente = watchlist inteira."
    )
    tipos: list[TipoEstrutura] | None = Field(
        default=None, description="Estruturas a considerar. Ausente = todas."
    )
    top_n: int = Field(default=10, ge=1, le=100, description="Quantas estruturas devolver.")
    capital_total: float | None = Field(
        default=None, gt=0, description="Capital total (BRL) para o filtro de risco (§10)."
    )
    risco_max_pct: float | None = Field(
        default=None, gt=0, le=1, description="Risco máx. aceitável como fração (0.05 = 5%)."
    )
    vencimento_min_dias: int | None = Field(default=None, ge=0)
    vencimento_max_dias: int | None = Field(default=None, ge=0)
    max_vencimentos: int = Field(default=2, ge=1, le=12)
    max_strikes_por_lado: int = Field(default=8, ge=1, le=50)
    tamanho_lote: int = Field(default=100, ge=1)


class PernaOut(BaseModel):
    option_symbol: str
    tipo: Literal["call", "put"]
    lado: Literal["compra", "venda"]
    strike: float
    premio: float
    bid: float | None
    ask: float | None
    quantidade: int


class EstruturaOut(BaseModel):
    ativo: str
    tipo_estrutura: TipoEstrutura
    nome: str
    vencimento: datetime
    data_referencia: datetime | None
    # Risco SEMPRE antes do ganho (§2).
    risco_maximo: float
    rotulo_risco: Literal["DEFINIDO", "INDEFINIDO"]
    ganho_maximo: float | Literal["ilimitado"]
    breakevens: list[float]
    razao_ganho_risco: float | None
    risco_pct_capital: float | None
    pernas: list[PernaOut]
    avisos: list[str]


class FrescorOut(BaseModel):
    """Carimbo de frescor por ativo (último pregão usado)."""

    ativo: str
    data_referencia: datetime | None
    opcoes_na_cadeia: int


class ScreeningResponse(BaseModel):
    aviso: str  # TRIAGEM, não recomendação (§2)
    gerado_em: datetime
    frescor: list[FrescorOut]
    ranking: list[EstruturaOut]


# ── Backtest (§15 Fase 3) — simulação histórica de uma estrutura ─────────────


class PernaBacktestIn(BaseModel):
    """Uma perna da estrutura. tipo/strike NÃO vêm do cliente: a base os resolve
    pelo ticker (nada inventado, §2.4)."""

    option_symbol: str
    lado: Literal["compra", "venda"]
    quantidade: int = Field(ge=1)


class BacktestRequest(BaseModel):
    """Corpo do POST /backtest: a estrutura (pernas) + as datas."""

    pernas: list[PernaBacktestIn] = Field(min_length=1)
    data_entrada: date
    # Saída opcional: ausente = levar ao vencimento (default).
    data_saida: date | None = None
    tamanho_lote: int = Field(default=100, ge=1)


class PontoSerieOut(BaseModel):
    data: datetime
    valor_posicao: float
    pl_acumulado: float
    sem_negociacao: bool  # True = ao menos uma perna sem negócio (carry-forward)
    fonte: Literal["mercado", "vencimento"]
    # None = pregão comum; "ajuste_provento" = data-ex de um ajuste de strike (o salto
    # nesse dia é evento corporativo, não movimento de mercado).
    evento: Literal["ajuste_provento"] | None = None


class AjusteProventoOut(BaseModel):
    """Ajuste de strike por provento detectado na janela — só sinalização (§2)."""

    data_ex: datetime
    valor_ajuste_por_acao: float  # quanto o strike caiu por ação (BRL)
    pernas_afetadas: list[str]
    explicacao: str  # linguagem simples para o usuário leigo


class ResumoBacktestOut(BaseModel):
    # Risco SEMPRE antes do ganho (§2).
    risco_maximo: float
    rotulo_risco: Literal["DEFINIDO", "INDEFINIDO"]
    ganho_maximo: float | Literal["ilimitado"]
    pl_final: float
    pl_final_pct_risco: float | None
    dias_ate_vencimento: int
    liquidado_no_vencimento: bool
    avisos: list[str]
    # Ajustes por provento detectados (vazio = nenhum). Não entra no P&L.
    ajustes_provento: list[AjusteProventoOut] = []


class BacktestResponse(BaseModel):
    aviso: str  # SIMULAÇÃO HISTÓRICA — passado não garante futuro (§2)
    ativo: str
    data_entrada: datetime
    data_saida: datetime
    vencimento: datetime
    serie: list[PontoSerieOut]
    resumo: ResumoBacktestOut
