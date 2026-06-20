"""
Testes do núcleo de backtest (puro): marcação a mercado dia a dia, reuso do payoff
no vencimento, proteção contra look-ahead, recusa por dados insuficientes (§2.4) e
um teste de performance básico.

Os preços usados na trava de referência são os mesmos casos já validados no
screening (trava de alta com calls 21/22, débito 0,30 → risco 30, ganho 70).
"""

from datetime import datetime, timedelta

import pytest

from app.quant import options_math as om
from app.quant.backtest import (
    DadosInsuficientesError,
    EntradaBacktest,
    PernaBacktest,
    PontoPreco,
    _marcar_perna,
    simular,
)

ENTRADA = datetime(2026, 1, 5)
VENCIMENTO = datetime(2026, 2, 20)


def _dia(n: int) -> datetime:
    """ENTRADA + n dias (n=0 é o pregão de entrada)."""
    return ENTRADA + timedelta(days=n)


# Trava de alta com calls 21/22: compra K1=21 @ 0,55; vende K2=22 @ 0,25.
# Débito 0,30 → risco 30; ganho 70; razão 70/30. (mesmos números do screening.)
def _trava_alta_entrada(data_saida: datetime, spot_vencimento: float | None) -> EntradaBacktest:
    historico = {
        "C21": [
            PontoPreco(_dia(0), 0.55),  # fechamento de entrada → prêmio de entrada
            PontoPreco(_dia(7), 0.62),
            PontoPreco(_dia(14), 0.70),
            PontoPreco(_dia(21), 0.50),
            PontoPreco(_dia(28), 0.80),
        ],
        "C22": [
            PontoPreco(_dia(0), 0.25),
            PontoPreco(_dia(7), 0.30),
            PontoPreco(_dia(14), 0.34),
            PontoPreco(_dia(21), 0.22),
            PontoPreco(_dia(28), 0.40),
        ],
    }
    return EntradaBacktest(
        ativo="TESTE3",
        pernas=[
            PernaBacktest("C21", "call", "compra", 21.0, 1),
            PernaBacktest("C22", "call", "venda", 22.0, 1),
        ],
        historico=historico,
        data_entrada=ENTRADA,
        data_saida=data_saida,
        vencimento=VENCIMENTO,
        spot_vencimento=spot_vencimento,
    )


# ── Ponta a ponta: P&L final bate com o payoff no vencimento ─────────────────


def test_pl_final_bate_com_payoff_no_vencimento():
    # Spot no vencimento = 22 (acima de K2) → melhor caso da trava = ganho máximo 70.
    entrada = _trava_alta_entrada(data_saida=VENCIMENTO, spot_vencimento=22.0)
    res = simular(entrada)

    # Risco SEMPRE antes do ganho (§2), com os números conhecidos da trava.
    assert res.resumo.rotulo_risco == "DEFINIDO"
    assert res.resumo.risco_maximo == pytest.approx(30.0)
    assert res.resumo.ganho_maximo == pytest.approx(70.0)

    # P&L final = payoff intrínseco no vencimento, reusando options_math (sem duplicar).
    legs = [
        om.Leg("call", "compra", 21.0, 0.55, 1),
        om.Leg("call", "venda", 22.0, 0.25, 1),
    ]
    esperado = om.payoff_estrutura(legs, 22.0, om.TAMANHO_LOTE_PADRAO)
    assert esperado == pytest.approx(70.0)
    assert res.resumo.pl_final == pytest.approx(esperado)
    assert res.resumo.liquidado_no_vencimento is True
    assert res.resumo.pl_final_pct_risco == pytest.approx(70.0 / 30.0)
    assert res.resumo.dias_ate_vencimento == (VENCIMENTO - ENTRADA).days

    # O último ponto da série é a liquidação no vencimento (payoff, não mercado).
    ultimo = res.serie[-1]
    assert ultimo.fonte == "vencimento"
    assert ultimo.data == VENCIMENTO
    assert ultimo.pl_acumulado == pytest.approx(70.0)

    # No pregão de entrada o P&L é zero (prêmio de entrada = fechamento de entrada).
    primeiro = res.serie[0]
    assert primeiro.data == ENTRADA
    assert primeiro.pl_acumulado == pytest.approx(0.0)

    # Disclaimer obrigatório de SIMULAÇÃO HISTÓRICA (§2).
    assert "SIMULAÇÃO HISTÓRICA" in res.aviso


def test_pl_final_perda_maxima_quando_spot_abaixo():
    # Spot no vencimento = 20 (abaixo de K1) → ambas as calls viram pó → perde o débito.
    entrada = _trava_alta_entrada(data_saida=VENCIMENTO, spot_vencimento=20.0)
    res = simular(entrada)
    # Perde o risco máximo (débito pago): -30.
    assert res.resumo.pl_final == pytest.approx(-30.0)
    assert res.serie[-1].pl_acumulado == pytest.approx(-30.0)


# ── Proteção explícita contra look-ahead ─────────────────────────────────────


def test_marcar_perna_nunca_usa_pregao_futuro():
    # Há um preço ENORME no futuro (dia 2); ao marcar até o dia 1 ele JAMAIS é usado.
    pontos = [
        PontoPreco(_dia(0), 1.0),
        PontoPreco(_dia(1), 2.0),
        PontoPreco(_dia(2), 999.0),  # "veneno" do futuro
    ]
    marc = _marcar_perna(pontos, [_dia(0), _dia(1)])
    assert marc == [(1.0, True), (2.0, True)]  # 999.0 nunca aparece


def test_marcar_perna_carry_forward_sem_negociacao():
    # Sem ponto no dia 1 → mantém o preço do dia 0 com flag de "sem negociação".
    pontos = [PontoPreco(_dia(0), 1.0), PontoPreco(_dia(2), 3.0)]
    marc = _marcar_perna(pontos, [_dia(0), _dia(1), _dia(2)])
    assert marc == [(1.0, True), (1.0, False), (3.0, True)]


def test_simular_saida_antecipada_ignora_dados_futuros():
    # Saída antecipada no dia 14; pregões futuros (21, 28) NÃO podem influenciar nada.
    entrada = _trava_alta_entrada(data_saida=_dia(14), spot_vencimento=22.0)
    res = simular(entrada)

    # Nenhum ponto além da data de saída; nada de liquidação por vencimento.
    assert all(p.data <= _dia(14) for p in res.serie)
    assert all(p.fonte == "mercado" for p in res.serie)
    assert res.resumo.liquidado_no_vencimento is False

    # P&L final = marcação no dia 14: compra (0,70−0,55) + venda −(0,34−0,25) = 0,06/ação.
    esperado = ((0.70 - 0.55) - (0.34 - 0.25)) * om.TAMANHO_LOTE_PADRAO
    assert res.serie[-1].pl_acumulado == pytest.approx(esperado)
    assert res.resumo.pl_final == pytest.approx(esperado)


# ── Recusa por dados insuficientes (§2.4) ────────────────────────────────────


def test_recusa_quando_perna_sem_preco_na_entrada():
    entrada = _trava_alta_entrada(data_saida=VENCIMENTO, spot_vencimento=22.0)
    # Remove o fechamento de entrada da perna C22 (passa a negociar só depois).
    entrada.historico["C22"] = [p for p in entrada.historico["C22"] if p.data != ENTRADA]

    with pytest.raises(DadosInsuficientesError) as exc:
        simular(entrada)
    assert any("C22" in item for item in exc.value.faltantes)


def test_recusa_data_entrada_depois_da_saida():
    entrada = _trava_alta_entrada(data_saida=ENTRADA - timedelta(days=1), spot_vencimento=22.0)
    with pytest.raises(ValueError):
        simular(entrada)


# ── Aviso de dia sem negociação (carry-forward) no resumo ────────────────────


def test_aviso_quando_perna_passa_dia_sem_negocio():
    entrada = _trava_alta_entrada(data_saida=VENCIMENTO, spot_vencimento=22.0)
    # C21 deixa de negociar no dia 14 (buraco no meio da janela).
    entrada.historico["C21"] = [p for p in entrada.historico["C21"] if p.data != _dia(14)]
    res = simular(entrada)
    assert any("C21" in aviso for aviso in res.resumo.avisos)


def test_sem_spot_no_vencimento_cai_na_ultima_marcacao_com_aviso():
    entrada = _trava_alta_entrada(data_saida=VENCIMENTO, spot_vencimento=None)
    res = simular(entrada)
    # Sem o preço do objeto no vencimento, não liquida por payoff — usa MTM e avisa.
    assert res.resumo.liquidado_no_vencimento is False
    assert any("ativo-objeto no vencimento" in aviso for aviso in res.resumo.avisos)
    assert all(p.fonte == "mercado" for p in res.serie)


# ── Performance básica (janela de alguns meses) ──────────────────────────────


def test_performance_janela_de_meses():
    import time

    # ~6 meses de pregões diários (130 dias úteis) × 4 pernas (um condor).
    base = datetime(2026, 1, 2)
    dias = [base + timedelta(days=i) for i in range(130)]
    venc = dias[-1] + timedelta(days=1)

    def serie_precos(p0: float) -> list[PontoPreco]:
        # Preço determinístico, sempre positivo, variando suavemente.
        return [PontoPreco(d, p0 + 0.01 * (i % 7)) for i, d in enumerate(dias)]

    entrada = EntradaBacktest(
        ativo="TESTE3",
        pernas=[
            PernaBacktest("K1", "call", "compra", 18.0, 1),
            PernaBacktest("K2", "call", "venda", 20.0, 1),
            PernaBacktest("K3", "call", "venda", 22.0, 1),
            PernaBacktest("K4", "call", "compra", 24.0, 1),
        ],
        historico={
            "K1": serie_precos(2.50),
            "K2": serie_precos(1.20),
            "K3": serie_precos(0.55),
            "K4": serie_precos(0.20),
        },
        data_entrada=base,
        data_saida=venc,
        vencimento=venc,
        spot_vencimento=21.0,
    )

    inicio = time.perf_counter()
    res = simular(entrada)
    decorrido = time.perf_counter() - inicio

    assert len(res.serie) >= 130  # um ponto por pregão + liquidação no vencimento
    assert decorrido < 1.0  # janela de meses tem de responder em fração de segundo
