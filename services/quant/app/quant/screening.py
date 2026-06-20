"""
screening — varredura da cadeia inteira e ranking de estruturas por risco/retorno
(§15 Fase 3). Núcleo PURO: recebe a cadeia já carregada (sem banco/rede) e a
configuração, devolve as melhores estruturas ranqueadas.

O que faz (o usuário não monta uma a uma):
  1. Filtra a cadeia para séries LÍQUIDAS e precificáveis (filtro ANTES de
     ranquear — `liquidez.avaliar_liquidez`, reaproveitando a regra do Next.js).
  2. Limita o universo para manter a resposta em SEGUNDOS (vencimentos próximos
     primeiro + janela de strikes em torno do spot — ver caps em `ConfigScreening`).
  3. Gera as combinações plausíveis de strikes para cada estrutura pedida (só
     formas de risco DEFINIDO — risco-first §2; nada de venda a descoberto).
  4. Calcula risco/ganho/breakevens com `options_math` (mesmas fórmulas do §18).
  5. Ranqueia por `ganho_maximo / risco_maximo` (risco definido) e devolve top N
     com TUDO que o ticket precisa (tickers exatos, strikes, prêmios, vencimento).

⚠️ Ferramenta de TRIAGEM, não recomendação — a decisão é sempre do usuário (§2).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum

from app.quant import options_math as om
from app.quant.liquidez import OpcaoLiquidez, avaliar_liquidez, preco_referencia


class TipoEstrutura(str, Enum):
    """Famílias de estrutura que o screening sabe gerar (todas risco DEFINIDO)."""

    TRAVA_ALTA = "trava_alta"
    TRAVA_BAIXA = "trava_baixa"
    BORBOLETA = "borboleta"
    CONDOR = "condor"
    STRADDLE = "straddle"
    STRANGLE = "strangle"


#: Conjunto padrão quando o request não especifica `tipos` (todas as famílias).
TIPOS_PADRAO: tuple[TipoEstrutura, ...] = tuple(TipoEstrutura)

#: Aviso obrigatório no payload (§2 princípio 3 — não é recomendação).
AVISO_TRIAGEM = (
    "Esta é uma ferramenta de TRIAGEM automática, NÃO uma recomendação. O Babilônia "
    "não é consultoria e não decide ordens por você: ele apenas varre a cadeia e "
    "ordena estruturas por risco/retorno para você analisar. A decisão final, a "
    "conferência dos preços e a digitação da ordem no home broker são suas (§2)."
)


# ── Entrada: cadeia já carregada do banco (uma por ativo) ────────────────────


@dataclass(frozen=True)
class OpcaoSerie:
    """Uma série de opção num pregão (linha de `opcao_cotahist` já convertida)."""

    option_symbol: str  # CODNEG — ticker exato (ex.: "PETRF336")
    kind: om.TipoOpcao  # call | put
    strike: float
    expires_at: datetime
    bid: float | None  # 0/None = sem oferta
    ask: float | None
    volume: float  # QUATOT — contratos no dia (proxy de volume)
    volume_financeiro: float  # VOLTOT (BRL)
    numero_negocios: int  # TOTNEG


@dataclass(frozen=True)
class CadeiaAtivo:
    """Cadeia EOD de UM ativo-objeto num pregão (as-of)."""

    ativo: str
    as_of: datetime | None  # data-base (frescor); None = sem cadeia ingerida
    spot: float | None  # fechamento do objeto (acao_cotahist) na data-base
    opcoes: list[OpcaoSerie] = field(default_factory=list)


# ── Configuração do screening (com os caps de performance) ───────────────────


@dataclass
class ConfigScreening:
    tipos: tuple[TipoEstrutura, ...] = TIPOS_PADRAO
    top_n: int = 10
    tamanho_lote: int = om.TAMANHO_LOTE_PADRAO
    # Caps de performance (task 6): mantêm a varredura em segundos, não minutos.
    max_vencimentos: int = 2  # nº de vencimentos mais próximos a considerar
    max_strikes_por_lado: int = 8  # strikes acima/abaixo do spot na janela
    # Faixa de vencimento opcional (dias corridos a partir do as-of).
    vencimento_min_dias: int | None = None
    vencimento_max_dias: int | None = None
    # Filtro de capital (§10): descarta estrutura com risco acima do limite.
    capital_total: float | None = None
    risco_max_pct: float | None = None  # fração (0.05 = 5%)


# ── Saída: estrutura candidata pronta para o ticket ──────────────────────────


@dataclass
class PernaResultado:
    """Perna detalhada — leva o ticker EXATO para o ticket montar sem recalcular."""

    option_symbol: str
    tipo: om.TipoOpcao
    lado: om.LadoOperacao
    strike: float
    premio: float  # mid (bid+ask)/2 usado no cálculo
    bid: float | None
    ask: float | None
    quantidade: int


@dataclass
class EstruturaCandidata:
    ativo: str
    tipo_estrutura: TipoEstrutura
    nome: str
    vencimento: datetime
    data_referencia: datetime | None  # frescor (as-of da cadeia)
    risco_maximo: float
    rotulo_risco: om.RotuloRisco
    ganho_maximo: float | str  # BRL ou "ilimitado"
    breakevens: list[float]
    razao_ganho_risco: float | None  # métrica de ranking; None se ganho ilimitado
    risco_pct_capital: float | None  # fração do capital, se informado
    pernas: list[PernaResultado]
    avisos: list[str] = field(default_factory=list)


# ── Janela de strikes / seleção de vencimentos (caps de performance) ─────────


def _selecionar_vencimentos(cadeia: CadeiaAtivo, config: ConfigScreening) -> list[datetime]:
    """Vencimentos a varrer: dentro da faixa de dias (se houver) e os mais próximos."""
    vencs = sorted({op.expires_at for op in cadeia.opcoes})
    if cadeia.as_of is not None and (
        config.vencimento_min_dias is not None or config.vencimento_max_dias is not None
    ):
        filtrados = []
        for v in vencs:
            dias = (v - cadeia.as_of).days
            if config.vencimento_min_dias is not None and dias < config.vencimento_min_dias:
                continue
            if config.vencimento_max_dias is not None and dias > config.vencimento_max_dias:
                continue
            filtrados.append(v)
        vencs = filtrados
    return vencs[: config.max_vencimentos]


def _janela_strikes(strikes: list[float], spot: float | None, max_por_lado: int) -> list[float]:
    """Restringe os strikes a uma janela em torno do spot (cap de combinações)."""
    ordenados = sorted(set(strikes))
    if not ordenados:
        return []
    if spot is None:
        # Sem spot: pega a janela central por índice.
        meio = len(ordenados) // 2
        inicio = max(0, meio - max_por_lado)
        return ordenados[inicio : inicio + 2 * max_por_lado + 1]
    abaixo = [s for s in ordenados if s <= spot][-max_por_lado:]
    acima = [s for s in ordenados if s > spot][:max_por_lado]
    return abaixo + acima


def _mid(op: OpcaoSerie) -> float | None:
    """Prêmio de referência (mid) da série — mesmo critério de `lib/liquidez.ts`."""
    return preco_referencia(op.bid, op.ask)


def _liquida(op: OpcaoSerie) -> bool:
    """Série é considerada para o screening? Reaproveita a regra de liquidez do app."""
    aval = avaliar_liquidez(
        OpcaoLiquidez(
            bid=op.bid,
            ask=op.ask,
            spread=(op.ask - op.bid) if (op.bid and op.ask) else None,
            volume=op.volume,
            market_maker=None,  # COTAHIST não informa (conservador)
        )
    )
    # Precisa ser líquida E precificável (sem mid não dá para montar nada).
    return aval.nivel == "ok" and _mid(op) is not None


# ── Geração de candidatas por estrutura ──────────────────────────────────────


def _indexar(opcoes: list[OpcaoSerie]) -> dict[tuple[om.TipoOpcao, float], OpcaoSerie]:
    """Índice (kind, strike) → série, para mapear pernas de volta ao ticker exato."""
    return {(op.kind, op.strike): op for op in opcoes}


def _finalizar(
    ativo: str,
    tipo: TipoEstrutura,
    res: om.ResultadoEstrutura,
    vencimento: datetime,
    as_of: datetime | None,
    indice: dict[tuple[om.TipoOpcao, float], OpcaoSerie],
    config: ConfigScreening,
) -> EstruturaCandidata | None:
    """
    Converte um `ResultadoEstrutura` em candidata pronta para o ticket. Aplica o
    filtro de capital (§10) e descarta estruturas degeneradas (risco ≤ 0).
    """
    risco = res.risco_maximo
    # Risco ≤ 0 (débito ≤ 0 / dados cruzados) não é executável de forma confiável.
    if not (risco > om.EPS) or risco == float("inf"):
        return None

    # Filtro de capital (§10): risco acima do limite aceitável → fora.
    risco_pct = None
    if config.capital_total and config.capital_total > 0:
        risco_pct = risco / config.capital_total
        if config.risco_max_pct is not None and risco_pct > config.risco_max_pct + om.EPS:
            return None

    # Métrica de ranking: ganho/risco (definido). None quando o ganho é ilimitado.
    razao = None
    if isinstance(res.ganho_maximo, (int, float)):
        razao = res.ganho_maximo / risco

    # Mapeia cada perna de volta à série de origem (ticker exato, bid/ask).
    pernas: list[PernaResultado] = []
    for leg in res.legs:
        op = indice[(leg.tipo, leg.strike)]
        pernas.append(
            PernaResultado(
                option_symbol=op.option_symbol,
                tipo=leg.tipo,
                lado=leg.lado,
                strike=leg.strike,
                premio=leg.premio,
                bid=op.bid if (op.bid and op.bid > 0) else None,
                ask=op.ask if (op.ask and op.ask > 0) else None,
                quantidade=leg.quantidade,
            )
        )

    return EstruturaCandidata(
        ativo=ativo,
        tipo_estrutura=tipo,
        nome=res.nome,
        vencimento=vencimento,
        data_referencia=as_of,
        risco_maximo=risco,
        rotulo_risco=res.rotulo_risco,
        ganho_maximo=res.ganho_maximo,
        breakevens=res.breakevens,
        razao_ganho_risco=razao,
        risco_pct_capital=risco_pct,
        pernas=pernas,
        avisos=res.avisos,
    )


def _gerar_por_vencimento(
    ativo: str,
    opcoes_venc: list[OpcaoSerie],
    vencimento: datetime,
    as_of: datetime | None,
    config: ConfigScreening,
) -> list[EstruturaCandidata]:
    """Gera todas as candidatas pedidas para UM vencimento (já filtrado/janelado)."""
    indice = _indexar(opcoes_venc)
    calls = {op.strike: op for op in opcoes_venc if op.kind == "call"}
    puts = {op.strike: op for op in opcoes_venc if op.kind == "put"}
    strikes_call = sorted(calls)
    strikes_put = sorted(puts)
    lote = config.tamanho_lote
    out: list[EstruturaCandidata] = []

    def add(tipo: TipoEstrutura, res: om.ResultadoEstrutura) -> None:
        cand = _finalizar(ativo, tipo, res, vencimento, as_of, indice, config)
        if cand is not None:
            out.append(cand)

    tipos = set(config.tipos)

    # Travas verticais (pares K1<K2). Alta = bull call débito (calls) ou bull put
    # crédito (puts); baixa = bear put débito (puts) ou bear call crédito (calls).
    for i in range(len(strikes_call)):
        for j in range(i + 1, len(strikes_call)):
            k1, k2 = strikes_call[i], strikes_call[j]
            p1, p2 = _mid(calls[k1]), _mid(calls[k2])
            if p1 is None or p2 is None:
                continue
            if TipoEstrutura.TRAVA_ALTA in tipos:
                add(TipoEstrutura.TRAVA_ALTA, om.trava_alta_call_debito(k1, k2, p1, p2, 1, lote))
            if TipoEstrutura.TRAVA_BAIXA in tipos:
                add(TipoEstrutura.TRAVA_BAIXA, om.trava_baixa_call_credito(k1, k2, p1, p2, 1, lote))

    for i in range(len(strikes_put)):
        for j in range(i + 1, len(strikes_put)):
            k1, k2 = strikes_put[i], strikes_put[j]
            p1, p2 = _mid(puts[k1]), _mid(puts[k2])
            if p1 is None or p2 is None:
                continue
            if TipoEstrutura.TRAVA_ALTA in tipos:
                add(TipoEstrutura.TRAVA_ALTA, om.trava_alta_put_credito(k1, k2, p1, p2, 1, lote))
            if TipoEstrutura.TRAVA_BAIXA in tipos:
                add(TipoEstrutura.TRAVA_BAIXA, om.trava_baixa_put_debito(k1, k2, p1, p2, 1, lote))

    # Borboleta (calls) — triplas equidistantes K1<K2<K3 (K2−K1 == K3−K2).
    if TipoEstrutura.BORBOLETA in tipos:
        conj = set(strikes_call)
        for idx_c, k2 in enumerate(strikes_call):
            for k1 in strikes_call[:idx_c]:
                w = k2 - k1
                k3 = k2 + w
                if any(abs(k3 - s) < om.EPS for s in conj):
                    k3 = next(s for s in strikes_call if abs(s - k3) < om.EPS)
                    p1, p2, p3 = _mid(calls[k1]), _mid(calls[k2]), _mid(calls[k3])
                    if None in (p1, p2, p3):
                        continue
                    add(TipoEstrutura.BORBOLETA, om.borboleta_calls(k1, k2, k3, p1, p2, p3, 1, lote))

    # Condor (calls) — K1<K2<K3<K4. Para não explodir (O(n⁴)), geramos só condores
    # SIMÉTRICOS: asas de mesma largura `w` em torno de um par interno (K2,K3).
    if TipoEstrutura.CONDOR in tipos:
        conj = set(strikes_call)
        for a in range(len(strikes_call)):
            for b in range(a + 1, len(strikes_call)):
                k2, k3 = strikes_call[a], strikes_call[b]
                # Larguras de asa candidatas: passos disponíveis abaixo de K2.
                for k1 in strikes_call[:a]:
                    w = k2 - k1
                    k4 = k3 + w
                    if not any(abs(k4 - s) < om.EPS for s in conj):
                        continue
                    k4 = next(s for s in strikes_call if abs(s - k4) < om.EPS)
                    p1, p2 = _mid(calls[k1]), _mid(calls[k2])
                    p3, p4 = _mid(calls[k3]), _mid(calls[k4])
                    if None in (p1, p2, p3, p4):
                        continue
                    add(TipoEstrutura.CONDOR, om.condor_calls(k1, k2, k3, k4, p1, p2, p3, p4, 1, lote))

    # Straddle COMPRADO — mesmo strike com call e put (risco definido, ganho ilimitado).
    if TipoEstrutura.STRADDLE in tipos:
        for k in strikes_call:
            if k in puts:
                pc, pp = _mid(calls[k]), _mid(puts[k])
                if pc is None or pp is None:
                    continue
                add(TipoEstrutura.STRADDLE, om.straddle_comprado(k, pc, pp, 1, lote))

    # Strangle COMPRADO — put K1 + call K2, K1<K2 (risco definido, ganho ilimitado).
    if TipoEstrutura.STRANGLE in tipos:
        for k1 in strikes_put:
            for k2 in strikes_call:
                if k2 <= k1:
                    continue
                pp, pc = _mid(puts[k1]), _mid(calls[k2])
                if pp is None or pc is None:
                    continue
                add(TipoEstrutura.STRANGLE, om.strangle_comprado(k1, k2, pp, pc, 1, lote))

    return out


# ── Ranking ──────────────────────────────────────────────────────────────────


def _chave_ordenacao(c: EstruturaCandidata) -> tuple[int, float]:
    """
    Ordena por `ganho/risco` (DESC). Estruturas com ganho ILIMITADO não têm razão
    finita: ficam num grupo à parte, ordenado por MENOR risco (entrada mais barata).
    """
    if c.razao_ganho_risco is not None:
        return (1, c.razao_ganho_risco)
    return (0, -c.risco_maximo)


def ranquear(candidatas: list[EstruturaCandidata], top_n: int) -> list[EstruturaCandidata]:
    """Ordena pela métrica e devolve as top N."""
    ordenadas = sorted(candidatas, key=_chave_ordenacao, reverse=True)
    return ordenadas[:top_n]


# ── Orquestração pura por ativo ──────────────────────────────────────────────


def gerar_candidatas(cadeia: CadeiaAtivo, config: ConfigScreening) -> list[EstruturaCandidata]:
    """
    Varre a cadeia de UM ativo e gera TODAS as candidatas (sem cortar em top N).
    Filtra liquidez ANTES de gerar (nunca usa série ilíquida) e aplica os caps de
    performance (vencimentos próximos + janela de strikes).
    """
    if not cadeia.opcoes:
        return []

    # Filtro de liquidez ANTES de qualquer combinação (task 4).
    liquidas = [op for op in cadeia.opcoes if _liquida(op)]
    if not liquidas:
        return []

    vencimentos = _selecionar_vencimentos(
        CadeiaAtivo(cadeia.ativo, cadeia.as_of, cadeia.spot, liquidas), config
    )

    candidatas: list[EstruturaCandidata] = []
    for venc in vencimentos:
        do_venc = [op for op in liquidas if op.expires_at == venc]
        strikes = _janela_strikes(
            [op.strike for op in do_venc], cadeia.spot, config.max_strikes_por_lado
        )
        janela = {round(s, 6) for s in strikes}
        do_venc = [op for op in do_venc if round(op.strike, 6) in janela]
        candidatas.extend(
            _gerar_por_vencimento(cadeia.ativo, do_venc, venc, cadeia.as_of, config)
        )
    return candidatas


def screenar_ativo(cadeia: CadeiaAtivo, config: ConfigScreening) -> list[EstruturaCandidata]:
    """Gera e ranqueia as candidatas de um ativo (top N)."""
    return ranquear(gerar_candidatas(cadeia, config), config.top_n)
