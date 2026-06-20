"""
options_math — REIMPLEMENTAÇÃO PARALELA (em Python) do núcleo `lib/options-math`
do app Next.js (TypeScript). Fórmulas de referência: §18 do PRD.

⚠️ FONTE DA VERDADE × CÓPIA PARALELA
────────────────────────────────────
O `lib/options-math` em TS é a FONTE DA VERDADE do app (montador, ticket, payoff).
Este módulo é uma CÓPIA paralela, necessária porque o screening de cadeia inteira
roda neste microserviço Python e não pode chamar o motor TS. As duas
implementações calculam as MESMAS coisas (risco máximo, ganho máximo, breakevens,
rótulo DEFINIDO/INDEFINIDO) e PRECISAM ser mantidas consistentes.

Garantia de consistência: os testes (`tests/test_options_math.py`) usam EXATAMENTE
os mesmos casos numéricos do §18 que os testes do TS (`lib/options-math/
estruturas.test.ts`). Se uma fórmula mudar de um lado, o outro tem de mudar junto e
os dois conjuntos de testes têm de continuar verdes.

Espelha:
  - lib/options-math/index.ts       (motor genérico sobre lista de pernas)
  - lib/options-math/estruturas.ts  (estruturas nomeadas: travas, borboleta, …)

Convenções de unidade (idênticas ao TS, §7/§18):
  - `strike` e `premio` são valores POR AÇÃO, em BRL.
  - `quantidade` é o número de CONTRATOS (lotes).
  - Todo resultado financeiro é total em BRL = (valor por ação) × quantidade ×
    TAMANHO DO LOTE (100 na B3, parametrizável).

Puro: recebe números, devolve números. Sem banco, sem rede, sem efeito colateral.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Literal

# ── Tipos base (espelham index.ts) ───────────────────────────────────────────

TipoOpcao = Literal["call", "put"]
LadoOperacao = Literal["compra", "venda"]
RotuloRisco = Literal["DEFINIDO", "INDEFINIDO"]

#: Tamanho do lote padrão da B3 para opções sobre ações (TAMANHO_LOTE_PADRAO no TS).
TAMANHO_LOTE_PADRAO = 100

#: Tolerância para comparações de ponto flutuante (idêntica ao EPS do TS).
EPS = 1e-9

#: Aviso padrão de estrutura com perna vendida a descoberto (§10, regra dos 10%).
AVISO_RISCO_INDEFINIDO = (
    "Risco INDEFINIDO: a perda pode superar o prêmio recebido. Exige margem na "
    "corretora (regra de ~10% do capital, §10) e atenção redobrada."
)


@dataclass(frozen=True)
class Leg:
    """Perna individual de uma estrutura (§7, §18). Espelha `Leg` do index.ts."""

    tipo: TipoOpcao
    lado: LadoOperacao
    strike: float  # BRL, por ação
    premio: float  # BRL, por ação
    quantidade: int  # contratos (lotes)


@dataclass
class ResultadoEstrutura:
    """
    Resultado padronizado de uma estrutura nomeada (§8.4). Campos na ORDEM de
    importância: risco SEMPRE antes do ganho (§2). Espelha `ResultadoEstrutura`
    de estruturas.ts — menos a `curva` de payoff, que o screening não usa.
    """

    nome: str
    risco_maximo: float  # BRL, positivo; math.inf se indefinido
    rotulo_risco: RotuloRisco
    ganho_maximo: float | str  # BRL, ou a string "ilimitado"
    breakevens: list[float]  # preços do ativo, ordem crescente
    legs: list[Leg]
    avisos: list[str] = field(default_factory=list)


# ── Payoff (espelha index.ts) ────────────────────────────────────────────────


def valor_intrinseco(tipo: TipoOpcao, strike: float, preco: float) -> float:
    """Valor intrínseco de UMA opção no vencimento, por ação (≥ 0)."""
    if tipo == "call":
        return max(preco - strike, 0.0)
    return max(strike - preco, 0.0)


def payoff_perna(leg: Leg, preco: float, tamanho_lote: int = TAMANHO_LOTE_PADRAO) -> float:
    """Resultado financeiro TOTAL de UMA perna a um preço do ativo no vencimento."""
    intrinseco = valor_intrinseco(leg.tipo, leg.strike, preco)
    sinal = 1 if leg.lado == "compra" else -1
    return sinal * (intrinseco - leg.premio) * leg.quantidade * tamanho_lote


def payoff_estrutura(
    legs: list[Leg], preco: float, tamanho_lote: int = TAMANHO_LOTE_PADRAO
) -> float:
    """Resultado financeiro TOTAL da estrutura (soma das pernas) a um dado preço."""
    return sum(payoff_perna(leg, preco, tamanho_lote) for leg in legs)


# ── Análise (risco / ganho / breakeven) — espelha index.ts ───────────────────
#
# O payoff de uma soma de opções é uma função CONTÍNUA e LINEAR POR PARTES do
# preço, com "joelhos" só nos strikes. Por isso os extremos finitos ocorrem em
# S = 0, nos strikes, ou nas caudas; e a cauda S → +∞ tem inclinação constante.


def _precos_criticos(legs: list[Leg]) -> list[float]:
    """Preços críticos a avaliar: 0 e cada strike distinto, em ordem crescente."""
    strikes = sorted({leg.strike for leg in legs})
    return [0.0, *strikes]


def _inclinacao_no_infinito(legs: list[Leg], tamanho_lote: int) -> float:
    """
    Inclinação do payoff TOTAL (BRL por unidade de preço) quando S → +∞.
    Só as calls continuam "no dinheiro" no infinito; puts não contribuem.
    """
    total = 0.0
    for leg in legs:
        if leg.tipo != "call":
            continue
        sinal = 1 if leg.lado == "compra" else -1
        total += sinal * leg.quantidade * tamanho_lote
    return total


def risco_maximo(
    legs: list[Leg], tamanho_lote: int = TAMANHO_LOTE_PADRAO
) -> tuple[float, bool]:
    """
    Risco máximo (perda máxima) como número POSITIVO em BRL. Devolve
    `(math.inf, True)` quando a perda cresce sem limite (cauda S → +∞ negativa).
    """
    if not legs:
        return (0.0, False)
    if _inclinacao_no_infinito(legs, tamanho_lote) < -EPS:
        return (math.inf, True)
    pior = min(payoff_estrutura(legs, s, tamanho_lote) for s in _precos_criticos(legs))
    return (max(0.0, -pior), False)


def ganho_maximo(
    legs: list[Leg], tamanho_lote: int = TAMANHO_LOTE_PADRAO
) -> tuple[float | None, bool]:
    """
    Ganho máximo em BRL. Devolve `(None, True)` quando o ganho cresce sem limite
    (cauda S → +∞ positiva, ex.: compra de call).
    """
    if not legs:
        return (0.0, False)
    if _inclinacao_no_infinito(legs, tamanho_lote) > EPS:
        return (None, True)
    melhor = max(payoff_estrutura(legs, s, tamanho_lote) for s in _precos_criticos(legs))
    return (melhor, False)


def breakevens(legs: list[Leg], tamanho_lote: int = TAMANHO_LOTE_PADRAO) -> list[float]:
    """
    Ponto(s) de equilíbrio (preços do ativo onde o resultado é zero), em ordem
    crescente. Estratégia exata idêntica ao TS: zero sobre um vértice, troca de
    sinal entre vértices consecutivos (interpolação linear) e cauda além do maior
    strike (via inclinação no infinito).
    """
    if not legs:
        return []

    vertices = _precos_criticos(legs)

    def P(s: float) -> float:
        return payoff_estrutura(legs, s, tamanho_lote)

    resultado: list[float] = []

    def adicionar(x: float) -> None:
        if not any(abs(v - x) < 1e-6 for v in resultado):
            resultado.append(x)

    for i, s in enumerate(vertices):
        p = P(s)
        if abs(p) < EPS:
            adicionar(s)  # zero exatamente sobre o vértice
            continue
        if i < len(vertices) - 1:
            s2 = vertices[i + 1]
            p2 = P(s2)
            if p * p2 < 0:  # troca estrita de sinal → cruzamento no segmento
                adicionar(s + (s2 - s) * (0 - p) / (p2 - p))

    # Cauda além do maior strike: segmento linear com inclinação no infinito.
    ultimo = vertices[-1]
    inclinacao = _inclinacao_no_infinito(legs, tamanho_lote)
    if abs(inclinacao) > EPS:
        candidato = ultimo - P(ultimo) / inclinacao
        if candidato > ultimo + EPS:
            adicionar(candidato)

    return sorted(resultado)


# ── Helpers de montagem (espelham montarResultado/exigirCrescente do TS) ──────


def _exigir_crescente(rotulo: str, *strikes: float) -> None:
    """Garante que os strikes estão em ordem estritamente crescente."""
    for i in range(1, len(strikes)):
        if not strikes[i] > strikes[i - 1]:
            raise ValueError(f"{rotulo}: os strikes devem ser estritamente crescentes.")


def _montar_resultado(
    nome: str,
    legs: list[Leg],
    tamanho_lote: int,
    avisos: list[str] | None = None,
) -> ResultadoEstrutura:
    """Monta o resultado padronizado a partir das pernas (igual ao TS, sem curva)."""
    risco_val, indefinido = risco_maximo(legs, tamanho_lote)
    ganho_val, ilimitado = ganho_maximo(legs, tamanho_lote)
    return ResultadoEstrutura(
        nome=nome,
        risco_maximo=risco_val,
        rotulo_risco="INDEFINIDO" if indefinido else "DEFINIDO",
        ganho_maximo="ilimitado" if ilimitado else float(ganho_val or 0.0),
        breakevens=breakevens(legs, tamanho_lote),
        legs=legs,
        avisos=avisos or [],
    )


# ── Travas verticais (espelham estruturas.ts) ────────────────────────────────


def trava_alta_call_debito(
    k1: float,
    k2: float,
    premio_k1: float,
    premio_k2: float,
    quantidade: int = 1,
    tamanho_lote: int = TAMANHO_LOTE_PADRAO,
) -> ResultadoEstrutura:
    """Trava de ALTA com calls (DÉBITO): compra call K1, vende call K2, K1<K2."""
    _exigir_crescente("Trava de alta (débito)", k1, k2)
    legs = [
        Leg("call", "compra", k1, premio_k1, quantidade),
        Leg("call", "venda", k2, premio_k2, quantidade),
    ]
    return _montar_resultado("Trava de alta (débito, calls)", legs, tamanho_lote)


def trava_alta_put_credito(
    k1: float,
    k2: float,
    premio_k1: float,
    premio_k2: float,
    quantidade: int = 1,
    tamanho_lote: int = TAMANHO_LOTE_PADRAO,
) -> ResultadoEstrutura:
    """Trava de ALTA de CRÉDITO (bull put): vende put K2, compra put K1, K1<K2."""
    _exigir_crescente("Trava de alta (crédito)", k1, k2)
    legs = [
        Leg("put", "venda", k2, premio_k2, quantidade),
        Leg("put", "compra", k1, premio_k1, quantidade),
    ]
    return _montar_resultado("Trava de alta (crédito, puts)", legs, tamanho_lote)


def trava_baixa_put_debito(
    k1: float,
    k2: float,
    premio_k1: float,
    premio_k2: float,
    quantidade: int = 1,
    tamanho_lote: int = TAMANHO_LOTE_PADRAO,
) -> ResultadoEstrutura:
    """Trava de BAIXA com puts (DÉBITO): compra put K2, vende put K1, K1<K2."""
    _exigir_crescente("Trava de baixa (débito)", k1, k2)
    legs = [
        Leg("put", "compra", k2, premio_k2, quantidade),
        Leg("put", "venda", k1, premio_k1, quantidade),
    ]
    return _montar_resultado("Trava de baixa (débito, puts)", legs, tamanho_lote)


def trava_baixa_call_credito(
    k1: float,
    k2: float,
    premio_k1: float,
    premio_k2: float,
    quantidade: int = 1,
    tamanho_lote: int = TAMANHO_LOTE_PADRAO,
) -> ResultadoEstrutura:
    """Trava de BAIXA de CRÉDITO (bear call): vende call K1, compra call K2, K1<K2."""
    _exigir_crescente("Trava de baixa (crédito)", k1, k2)
    legs = [
        Leg("call", "venda", k1, premio_k1, quantidade),
        Leg("call", "compra", k2, premio_k2, quantidade),
    ]
    return _montar_resultado("Trava de baixa (crédito, calls)", legs, tamanho_lote)


# ── Borboleta e condor (espelham estruturas.ts) ──────────────────────────────


def borboleta_calls(
    k1: float,
    k2: float,
    k3: float,
    premio_k1: float,
    premio_k2: float,
    premio_k3: float,
    quantidade: int = 1,
    tamanho_lote: int = TAMANHO_LOTE_PADRAO,
) -> ResultadoEstrutura:
    """BORBOLETA com calls: compra K1, vende 2× K2, compra K3, equidistantes."""
    _exigir_crescente("Borboleta", k1, k2, k3)
    if abs((k2 - k1) - (k3 - k2)) > 1e-9:
        raise ValueError("Borboleta: os strikes devem ser equidistantes (K2−K1 = K3−K2).")
    legs = [
        Leg("call", "compra", k1, premio_k1, quantidade),
        Leg("call", "venda", k2, premio_k2, 2 * quantidade),
        Leg("call", "compra", k3, premio_k3, quantidade),
    ]
    return _montar_resultado("Borboleta (calls)", legs, tamanho_lote)


def condor_calls(
    k1: float,
    k2: float,
    k3: float,
    k4: float,
    premio_k1: float,
    premio_k2: float,
    premio_k3: float,
    premio_k4: float,
    quantidade: int = 1,
    tamanho_lote: int = TAMANHO_LOTE_PADRAO,
) -> ResultadoEstrutura:
    """CONDOR com calls: compra K1, vende K2, vende K3, compra K4 (K1<K2<K3<K4)."""
    _exigir_crescente("Condor", k1, k2, k3, k4)
    legs = [
        Leg("call", "compra", k1, premio_k1, quantidade),
        Leg("call", "venda", k2, premio_k2, quantidade),
        Leg("call", "venda", k3, premio_k3, quantidade),
        Leg("call", "compra", k4, premio_k4, quantidade),
    ]
    return _montar_resultado("Condor (calls)", legs, tamanho_lote)


# ── Straddle e strangle (espelham estruturas.ts) ─────────────────────────────


def straddle_comprado(
    k: float,
    premio_call: float,
    premio_put: float,
    quantidade: int = 1,
    tamanho_lote: int = TAMANHO_LOTE_PADRAO,
) -> ResultadoEstrutura:
    """STRADDLE COMPRADO: compra call e put no mesmo strike K. Ganho ilimitado."""
    legs = [
        Leg("call", "compra", k, premio_call, quantidade),
        Leg("put", "compra", k, premio_put, quantidade),
    ]
    return _montar_resultado("Straddle comprado", legs, tamanho_lote)


def straddle_vendido(
    k: float,
    premio_call: float,
    premio_put: float,
    quantidade: int = 1,
    tamanho_lote: int = TAMANHO_LOTE_PADRAO,
) -> ResultadoEstrutura:
    """STRADDLE VENDIDO: vende call e put no mesmo strike K. Risco INDEFINIDO."""
    legs = [
        Leg("call", "venda", k, premio_call, quantidade),
        Leg("put", "venda", k, premio_put, quantidade),
    ]
    return _montar_resultado(
        "Straddle vendido", legs, tamanho_lote, avisos=[AVISO_RISCO_INDEFINIDO]
    )


def strangle_comprado(
    k1: float,
    k2: float,
    premio_put: float,
    premio_call: float,
    quantidade: int = 1,
    tamanho_lote: int = TAMANHO_LOTE_PADRAO,
) -> ResultadoEstrutura:
    """STRANGLE COMPRADO: compra put K1 e call K2, K1<K2. Ganho ilimitado."""
    _exigir_crescente("Strangle", k1, k2)
    legs = [
        Leg("put", "compra", k1, premio_put, quantidade),
        Leg("call", "compra", k2, premio_call, quantidade),
    ]
    return _montar_resultado("Strangle comprado", legs, tamanho_lote)


def strangle_vendido(
    k1: float,
    k2: float,
    premio_put: float,
    premio_call: float,
    quantidade: int = 1,
    tamanho_lote: int = TAMANHO_LOTE_PADRAO,
) -> ResultadoEstrutura:
    """STRANGLE VENDIDO: vende put K1 e call K2, K1<K2. Risco INDEFINIDO."""
    _exigir_crescente("Strangle", k1, k2)
    legs = [
        Leg("put", "venda", k1, premio_put, quantidade),
        Leg("call", "venda", k2, premio_call, quantidade),
    ]
    return _montar_resultado(
        "Strangle vendido", legs, tamanho_lote, avisos=[AVISO_RISCO_INDEFINIDO]
    )
