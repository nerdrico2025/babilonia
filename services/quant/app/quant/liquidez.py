"""
liquidez — REIMPLEMENTAÇÃO PARALELA (em Python) de `lib/liquidez.ts` do Next.js.

⚠️ Como `options_math.py`, é uma CÓPIA paralela de um módulo puro do app que
PRECISA ser mantida consistente com o TS. Mesmos limites, mesma semântica de
"sem preço" (0,00 = sem oferta → `None`), mesmo critério de nível ok/baixa.

Princípio §2.5: "a ordem precisa ser executável" — séries com pouco volume ou
spread largo recebem ALERTA. O COTAHIST/B3 NÃO fornece open interest (§6.4): a
liquidez usa volume (contratos no dia), spread relativo e presença de market
maker (no COTAHIST sempre `None` → exige o volume mínimo cheio).
"""

from __future__ import annotations

from dataclasses import dataclass, field

#: Limites do filtro de liquidez (MVP — espelham LIQUIDEZ_LIMITES do TS).
VOLUME_MINIMO = 100
VOLUME_MINIMO_COM_MARKET_MAKER = 20
SPREAD_RELATIVO_MAXIMO = 0.1

NivelLiquidez = str  # "ok" | "baixa"


@dataclass
class OpcaoLiquidez:
    """Shape mínimo para avaliar liquidez (espelha o que `OpcaoCadeia` expõe)."""

    bid: float | None
    ask: float | None
    spread: float | None
    volume: float | None  # contratos no dia (QUATOT)
    market_maker: bool | None


@dataclass
class AvaliacaoLiquidez:
    """Avaliação de liquidez de UMA série (sem open interest — §6.4)."""

    nivel: NivelLiquidez
    spread_relativo: float | None
    preco_referencia: float | None
    motivos: list[str] = field(default_factory=list)


def _preco_valido(valor: float | None) -> float | None:
    """Trata valores ausentes ou ≤ 0 como 'sem preço'."""
    return valor if (valor is not None and valor > 0) else None


def preco_referencia(bid: float | None, ask: float | None) -> float | None:
    """
    Preço de referência da opção: o 'meio' entre bid e ask quando ambos existem;
    senão o lado disponível. Base do prêmio sugerido e do spread relativo.
    Espelha `precoReferencia` do TS.
    """
    b = _preco_valido(bid)
    a = _preco_valido(ask)
    if b is not None and a is not None:
        return (b + a) / 2
    return a if a is not None else b


def _pct(fracao: float) -> str:
    """Formata fração como percentual pt-BR aproximado (0.12 → '12%')."""
    return f"{fracao * 100:.1f}%".replace(".", ",")


def avaliar_liquidez(op: OpcaoLiquidez) -> AvaliacaoLiquidez:
    """
    Classifica a liquidez de uma série pelos proxies disponíveis (volume + spread
    + market maker). NUNCA usa open interest. Alerta (`baixa`) quando o volume é
    baixo OU o spread é largo. Espelha `avaliarLiquidez` do TS linha a linha.
    """
    mid = preco_referencia(op.bid, op.ask)
    spread_relativo = (
        op.spread / mid if (op.spread is not None and mid is not None and mid > 0) else None
    )
    tem_market_maker = op.market_maker is True
    volume = op.volume if op.volume is not None else 0
    volume_minimo = VOLUME_MINIMO_COM_MARKET_MAKER if tem_market_maker else VOLUME_MINIMO

    # Sem volume e sem spread não há como atestar liquidez — alerta.
    if op.volume is None and op.spread is None:
        return AvaliacaoLiquidez(
            nivel="baixa",
            spread_relativo=None,
            preco_referencia=mid,
            motivos=["Sem dados de volume e de spread para avaliar a liquidez."],
        )

    motivos: list[str] = []
    nivel: NivelLiquidez = "ok"

    if volume < volume_minimo:
        nivel = "baixa"
        extra = ", mesmo com market maker" if tem_market_maker else ""
        motivos.append(
            f"Volume baixo: {volume} contrato(s) no dia (mínimo {volume_minimo}{extra})."
        )

    if spread_relativo is None:
        motivos.append("Sem bid e ask para medir o spread (preço de saída incerto).")
    elif spread_relativo > SPREAD_RELATIVO_MAXIMO:
        nivel = "baixa"
        motivos.append(
            f"Spread largo: {_pct(spread_relativo)} do preço — entrar e sair fica caro."
        )

    if nivel == "ok":
        motivos.append(
            "Volume e spread dentro do aceitável, e há market maker."
            if tem_market_maker
            else "Volume e spread dentro do aceitável."
        )

    return AvaliacaoLiquidez(
        nivel=nivel,
        spread_relativo=spread_relativo,
        preco_referencia=mid,
        motivos=motivos,
    )
