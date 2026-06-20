"""
backtest — SIMULAÇÃO HISTÓRICA (mark-to-market) de uma estrutura de opções (§15
Fase 3). Núcleo PURO: recebe as pernas (com tickers exatos), o histórico de preços
de cada perna já carregado do banco e as datas; devolve a evolução dia a dia da
posição (valor e P&L acumulado) até o vencimento (ou até uma data de saída).

⚠️ O QUE ISTO **NÃO** É
───────────────────────
NÃO é uma engine de "estratégia automática" que decide entradas/saídas ao longo do
tempo. O usuário escolhe a estrutura e a data de entrada; o serviço apenas mostra
como ELA teria evoluído com os preços reais de fechamento (`opcao_cotahist`). É uma
ferramenta de ANÁLISE, não recomendação — a decisão é sempre do usuário (§2).

Princípios (§2):
  - **Nenhum dado inventado** (§2.4). O prêmio de entrada é o FECHAMENTO REAL da
    perna na data de entrada; cada marcação diária usa o fechamento real daquele
    pregão. Em dia sem negociação (série sem negócio → fechamento 0,00 no COTAHIST,
    aqui ausente do histórico), MANTÉM-SE o último preço conhecido com a flag
    `sem_negociacao=True` — nunca se inventa um preço.
  - **Sem look-ahead.** Cada dia simulado usa APENAS dados com pregão ≤ aquele dia.
    A varredura é estritamente cronológica (cursor que só avança).
  - **Reaproveita o payoff** de `options_math` no vencimento (não duplica fórmula):
    no vencimento o resultado é o payoff intrínseco da estrutura ao spot do objeto.

Puro: recebe dataclasses, devolve dataclasses. Sem banco, sem rede. A camada de
banco (`quant/dados.py`) carrega o histórico e monta a `EntradaBacktest`.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Literal

from app.quant import options_math as om

# ── Disclaimer obrigatório no payload (§2 princípio 3) ───────────────────────

AVISO_BACKTEST = (
    "Esta é uma SIMULAÇÃO HISTÓRICA com dados de fechamento já passados. Desempenho "
    "passado NÃO garante resultado futuro. O Babilônia não é consultoria e não decide "
    "ordens por você: ele só mostra como a estrutura escolhida teria evoluído. A "
    "decisão de operar, a conferência dos preços e a digitação da ordem são suas (§2)."
)


# ── Erro tipado de dados insuficientes (§2.4 — não rodar com dado inventado) ──


class DadosInsuficientesError(Exception):
    """
    Faltam dados reais para simular com honestidade (perna sem preço de entrada,
    ticker inexistente na base, etc.). A rota traduz para HTTP 422 apontando
    EXATAMENTE o que falta — nunca produzimos um resultado com dado inventado.
    """

    def __init__(self, faltantes: list[str], mensagem: str | None = None) -> None:
        self.faltantes = faltantes
        self.mensagem = mensagem or "Dados insuficientes para rodar a simulação."
        super().__init__(self.mensagem)


# ── Entrada (montada por quant/dados.py a partir do banco) ───────────────────


@dataclass(frozen=True)
class PernaBacktest:
    """Perna da estrutura, já enriquecida com tipo/strike vindos da base."""

    option_symbol: str  # ticker exato (ex.: "PETRF336")
    tipo: om.TipoOpcao  # call | put (kind da base)
    lado: om.LadoOperacao  # compra | venda (escolha do usuário)
    strike: float
    quantidade: int  # contratos (lotes)


@dataclass(frozen=True)
class PontoPreco:
    """Um fechamento real de uma perna num pregão (já filtrado: preço > 0)."""

    data: datetime
    preco: float


@dataclass(frozen=True)
class EntradaBacktest:
    """
    Tudo que a simulação pura precisa, SEM banco. O `historico` traz, por ticker, a
    lista de fechamentos reais (ordenada por data, só pregões com negócio) na janela.
    """

    ativo: str  # ativo-objeto (underlying) — só rótulo/frescor, não entra na conta
    pernas: list[PernaBacktest]
    historico: dict[str, list[PontoPreco]]
    data_entrada: datetime
    data_saida: datetime  # já resolvida (default = vencimento) pela camada de dados
    vencimento: datetime
    spot_vencimento: float | None  # fechamento do objeto no vencimento (p/ payoff)
    tamanho_lote: int = om.TAMANHO_LOTE_PADRAO


# ── Saída ─────────────────────────────────────────────────────────────────────

FontePonto = Literal["mercado", "vencimento"]


@dataclass(frozen=True)
class PontoSerie:
    """Um dia da simulação. Risco-first não se aplica aqui (é evolução temporal)."""

    data: datetime
    valor_posicao: float  # valor de liquidação da posição a mercado (BRL)
    pl_acumulado: float  # P&L desde a entrada (BRL)
    sem_negociacao: bool  # True = ao menos uma perna sem negócio no dia (carry-forward)
    fonte: FontePonto  # "mercado" (fechamento real) | "vencimento" (payoff intrínseco)


@dataclass
class ResumoBacktest:
    """Resumo da simulação. Risco SEMPRE antes do ganho (§2)."""

    risco_maximo: float  # teórico no momento da entrada (BRL); inf se indefinido
    rotulo_risco: om.RotuloRisco
    ganho_maximo: float | str  # BRL ou "ilimitado"
    pl_final: float  # P&L no fim (payoff no vencimento, ou última marcação se saída antecipada)
    pl_final_pct_risco: float | None  # pl_final / risco (None se risco indefinido)
    dias_ate_vencimento: int  # dias corridos entrada → vencimento
    liquidado_no_vencimento: bool  # True = levado ao vencimento (payoff); False = saída antecipada
    avisos: list[str] = field(default_factory=list)


@dataclass
class ResultadoBacktest:
    aviso: str  # disclaimer de SIMULAÇÃO HISTÓRICA (§2)
    ativo: str
    data_entrada: datetime
    data_saida: datetime
    vencimento: datetime
    serie: list[PontoSerie]
    resumo: ResumoBacktest


# ── Helpers ───────────────────────────────────────────────────────────────────


def _sinal(lado: om.LadoOperacao) -> int:
    """+1 para perna comprada (ativo), -1 para vendida (passivo)."""
    return 1 if lado == "compra" else -1


def _fmt(data: datetime) -> str:
    """Data → 'DD/MM/AAAA' (mensagens de erro em português, público leigo §2)."""
    return data.strftime("%d/%m/%Y")


def _preco_exato(pontos: list[PontoPreco], data: datetime) -> float | None:
    """Fechamento EXATAMENTE no pregão `data` (ou None se não negociou nesse dia)."""
    for p in pontos:
        if p.data == data:
            return p.preco
    return None


def _legs_om(pernas: list[PernaBacktest], premios: dict[str, float]) -> list[om.Leg]:
    """Converte as pernas para `om.Leg` com o PRÊMIO DE ENTRADA real de cada uma."""
    return [
        om.Leg(p.tipo, p.lado, p.strike, premios[p.option_symbol], p.quantidade)
        for p in pernas
    ]


def _marcar_perna(
    pontos: list[PontoPreco], grid: list[datetime]
) -> list[tuple[float | None, bool]]:
    """
    Para cada dia do `grid` (ordenado ASC), devolve `(preco_vigente, negociou_no_dia)`
    usando SOMENTE pregões ≤ aquele dia (sem look-ahead). Carry-forward do último
    fechamento conhecido em dias sem negócio. `preco_vigente` é None só enquanto não
    houver nenhum pregão ≤ o dia (não deve ocorrer após a validação de entrada).

    A proteção contra look-ahead é estrutural: o cursor `i` só avança enquanto
    `pontos[i].data <= dia`; jamais lemos um ponto de pregão futuro.
    """
    saida: list[tuple[float | None, bool]] = []
    i = 0
    ultimo: float | None = None
    for dia in grid:
        negociou = False
        while i < len(pontos) and pontos[i].data <= dia:
            ultimo = pontos[i].preco
            if pontos[i].data == dia:
                negociou = True
            i += 1
        saida.append((ultimo, negociou))
    return saida


# ── Validação (§2.4 — recusa rodar sem dado real) ─────────────────────────────


def validar(entrada: EntradaBacktest) -> None:
    """
    Garante que dá para simular SEM inventar dado. Lança `DadosInsuficientesError`
    (apontando o que falta) ou `ValueError` (entrada estruturalmente inválida).
    """
    if not entrada.pernas:
        raise ValueError("A estrutura precisa de ao menos uma perna.")
    if entrada.data_entrada > entrada.data_saida:
        raise ValueError("A data de entrada não pode ser depois da data de saída.")
    if entrada.data_entrada > entrada.vencimento:
        raise ValueError("A data de entrada não pode ser depois do vencimento.")

    # Cada perna PRECISA do fechamento real na data de entrada (prêmio de entrada).
    faltantes: list[str] = []
    for p in entrada.pernas:
        pontos = entrada.historico.get(p.option_symbol, [])
        if _preco_exato(pontos, entrada.data_entrada) is None:
            faltantes.append(
                f"{p.option_symbol}: sem preço de fechamento no pregão de entrada "
                f"({_fmt(entrada.data_entrada)})."
            )
    if faltantes:
        raise DadosInsuficientesError(
            faltantes,
            "Não dá para simular sem o preço real de entrada de todas as pernas. "
            "Escolha uma data de entrada em que todas as séries tenham negociado.",
        )


# ── Simulação ─────────────────────────────────────────────────────────────────


def simular(entrada: EntradaBacktest) -> ResultadoBacktest:
    """
    Roda a simulação histórica completa: valida, monta a série diária de marcação a
    mercado e o resumo (risco teórico de entrada, P&L final, dias até o vencimento,
    avisos de dados faltantes). NÃO inventa preço; NÃO usa dado futuro.
    """
    validar(entrada)

    lote = entrada.tamanho_lote
    pernas = entrada.pernas
    # Prêmio de entrada = fechamento REAL de cada perna no pregão de entrada (§2.4).
    # `validar()` já garantiu que existe (não é None) para toda perna.
    premios: dict[str, float] = {}
    for p in pernas:
        preco = _preco_exato(entrada.historico[p.option_symbol], entrada.data_entrada)
        assert preco is not None  # garantido por validar()
        premios[p.option_symbol] = preco

    legs = _legs_om(pernas, premios)
    risco, indefinido = om.risco_maximo(legs, lote)
    ganho, ilimitado = om.ganho_maximo(legs, lote)
    rotulo: om.RotuloRisco = "INDEFINIDO" if indefinido else "DEFINIDO"

    # Levada ao vencimento? (saída ≥ vencimento → liquida no vencimento por payoff).
    liquidado = entrada.data_saida >= entrada.vencimento

    # Grade de pregões a marcar a mercado: união das datas com negócio de TODAS as
    # pernas, dentro da janela. Quando se leva ao vencimento, a marcação a mercado
    # vai até ANTES do vencimento (o ponto do vencimento é o payoff intrínseco).
    limite_mercado = entrada.vencimento if liquidado else entrada.data_saida
    datas: set[datetime] = set()
    for p in pernas:
        for ponto in entrada.historico.get(p.option_symbol, []):
            if entrada.data_entrada <= ponto.data < limite_mercado or (
                not liquidado and ponto.data == limite_mercado
            ):
                datas.add(ponto.data)
    datas.add(entrada.data_entrada)  # entrada sempre presente (validado)
    grid = sorted(datas)

    # Marcação por perna ao longo da grade (carry-forward, sem look-ahead).
    marcacoes = {p.option_symbol: _marcar_perna(entrada.historico[p.option_symbol], grid) for p in pernas}

    serie: list[PontoSerie] = []
    for idx, dia in enumerate(grid):
        valor = 0.0
        pl = 0.0
        sem_negociacao = False
        for p in pernas:
            preco, negociou = marcacoes[p.option_symbol][idx]
            assert preco is not None  # garantido por validar() + entrada na grade
            s = _sinal(p.lado)
            valor += s * preco * p.quantidade * lote
            pl += s * (preco - premios[p.option_symbol]) * p.quantidade * lote
            if not negociou:
                sem_negociacao = True
        serie.append(
            PontoSerie(
                data=dia,
                valor_posicao=valor,
                pl_acumulado=pl,
                sem_negociacao=sem_negociacao,
                fonte="mercado",
            )
        )

    avisos: list[str] = []
    _avisar_sem_negociacao(pernas, marcacoes, grid, avisos)

    # Ponto final: no vencimento, reusa o PAYOFF de options_math (não duplica fórmula).
    liquidado_efetivo = liquidado
    if liquidado:
        if entrada.spot_vencimento is not None:
            spot = entrada.spot_vencimento
            valor_venc = sum(
                _sinal(p.lado) * om.valor_intrinseco(p.tipo, p.strike, spot) * p.quantidade * lote
                for p in pernas
            )
            pl_venc = om.payoff_estrutura(legs, spot, lote)
            serie.append(
                PontoSerie(
                    data=entrada.vencimento,
                    valor_posicao=valor_venc,
                    pl_acumulado=pl_venc,
                    sem_negociacao=False,
                    fonte="vencimento",
                )
            )
        else:
            # Sem spot do objeto no vencimento não dá para liquidar por payoff: cai
            # na última marcação a mercado e avisa (não inventa o preço do objeto).
            liquidado_efetivo = False
            avisos.append(
                "Sem preço de fechamento do ativo-objeto no vencimento: o resultado "
                "final usa a última marcação a mercado, não o payoff de vencimento."
            )

    pl_final = serie[-1].pl_acumulado if serie else 0.0
    pl_final_pct_risco = (
        pl_final / risco if (risco > om.EPS and risco != float("inf")) else None
    )

    resumo = ResumoBacktest(
        risco_maximo=risco,
        rotulo_risco=rotulo,
        ganho_maximo="ilimitado" if ilimitado else float(ganho or 0.0),
        pl_final=pl_final,
        pl_final_pct_risco=pl_final_pct_risco,
        dias_ate_vencimento=(entrada.vencimento - entrada.data_entrada).days,
        liquidado_no_vencimento=liquidado_efetivo,
        avisos=avisos,
    )

    return ResultadoBacktest(
        aviso=AVISO_BACKTEST,
        ativo=entrada.ativo,
        data_entrada=entrada.data_entrada,
        data_saida=entrada.data_saida,
        vencimento=entrada.vencimento,
        serie=serie,
        resumo=resumo,
    )


def _avisar_sem_negociacao(
    pernas: list[PernaBacktest],
    marcacoes: dict[str, list[tuple[float | None, bool]]],
    grid: list[datetime],
    avisos: list[str],
) -> None:
    """Acrescenta um aviso por perna que passou dias sem negócio (carry-forward)."""
    total = len(grid)
    for p in pernas:
        dias_sem = sum(1 for _, negociou in marcacoes[p.option_symbol] if not negociou)
        # O 1º dia (entrada) sempre tem negócio; contamos só os demais carry-forward.
        if dias_sem > 0:
            avisos.append(
                f"{p.option_symbol}: {dias_sem} de {total} pregões sem negócio na "
                "janela — usamos o último preço conhecido nesses dias (não inventamos preço)."
            )
