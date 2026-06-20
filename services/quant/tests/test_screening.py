"""
Testes do núcleo de screening (puro): geração, filtro de liquidez ANTES do
ranking, ordenação pela métrica ganho/risco e filtro de capital (§10).
"""

from datetime import datetime, timedelta

import pytest

from app.quant.screening import (
    CadeiaAtivo,
    ConfigScreening,
    EstruturaCandidata,
    OpcaoSerie,
    TipoEstrutura,
    gerar_candidatas,
    ranquear,
    screenar_ativo,
)

AS_OF = datetime(2026, 6, 19)
VENC = AS_OF + timedelta(days=30)

# Mids simétricos em torno do spot=20 (call cai com o strike; put sobe).
_MIDS_CALL = {18: 2.45, 19: 1.65, 20: 1.00, 21: 0.55, 22: 0.25}
_MIDS_PUT = {18: 0.25, 19: 0.55, 20: 1.00, 21: 1.65, 22: 2.45}


def _serie(strike, kind, volume=500):
    mid = (_MIDS_CALL if kind == "call" else _MIDS_PUT)[strike]
    # Spread PROPORCIONAL (±2% do mid) para manter o spread relativo < 10% mesmo
    # nas séries baratas; o mid é recuperado exatamente por (bid+ask)/2.
    return OpcaoSerie(
        option_symbol=f"TESTE{int(strike)}{kind[0].upper()}",
        kind=kind,
        strike=float(strike),
        expires_at=VENC,
        bid=mid * 0.98,
        ask=mid * 1.02,
        volume=volume,
        volume_financeiro=mid * volume * 100,
        numero_negocios=volume,
    )


def _cadeia(volumes_call=None, volumes_put=None):
    volumes_call = volumes_call or {}
    volumes_put = volumes_put or {}
    opcoes = [_serie(k, "call", volumes_call.get(k, 500)) for k in _MIDS_CALL]
    opcoes += [_serie(k, "put", volumes_put.get(k, 500)) for k in _MIDS_PUT]
    return CadeiaAtivo(ativo="TESTE3", as_of=AS_OF, spot=20.0, opcoes=opcoes)


# ── Geração básica ───────────────────────────────────────────────────────────


def test_gera_e_ranqueia_estruturas():
    cands = screenar_ativo(_cadeia(), ConfigScreening(top_n=50))
    assert len(cands) > 0
    # Toda candidata gerada pelo screening é de risco DEFINIDO (risco-first §2).
    assert all(c.rotulo_risco == "DEFINIDO" for c in cands)
    # E cada perna leva o ticker exato para o ticket montar sem recalcular.
    assert all(p.option_symbol.startswith("TESTE") for c in cands for p in c.pernas)


def test_trava_alta_conhecida_aparece_com_numeros_certos():
    # 21/22 (calls): débito 0,30 → risco 30; ganho 70; razão ~2,33.
    cands = gerar_candidatas(
        _cadeia(), ConfigScreening(tipos=(TipoEstrutura.TRAVA_ALTA,), top_n=50)
    )
    alvo = next(
        c
        for c in cands
        if {round(p.strike) for p in c.pernas} == {21, 22}
        and all(p.tipo == "call" for p in c.pernas)
    )
    assert alvo.risco_maximo == pytest.approx(30)
    assert alvo.ganho_maximo == pytest.approx(70)
    assert alvo.razao_ganho_risco == pytest.approx(70 / 30)


# ── Filtro de liquidez ANTES do ranking ──────────────────────────────────────


def test_serie_iliquida_excluida_do_ranking():
    # Call 18 com volume 5 (ilíquida) NÃO pode aparecer em nenhuma estrutura.
    cadeia = _cadeia(volumes_call={18: 5})
    cands = screenar_ativo(cadeia, ConfigScreening(top_n=200))
    assert len(cands) > 0  # o resto da cadeia ainda gera estruturas
    usados = {p.option_symbol for c in cands for p in c.pernas}
    assert "TESTE18C" not in usados


# ── Ranking pela métrica ─────────────────────────────────────────────────────


def _cand(razao, risco=100.0, ganho=None):
    return EstruturaCandidata(
        ativo="X",
        tipo_estrutura=TipoEstrutura.TRAVA_ALTA,
        nome="t",
        vencimento=VENC,
        data_referencia=AS_OF,
        risco_maximo=risco,
        rotulo_risco="DEFINIDO",
        ganho_maximo=ganho if ganho is not None else (razao * risco if razao else "ilimitado"),
        breakevens=[],
        razao_ganho_risco=razao,
        risco_pct_capital=None,
        pernas=[],
    )


def test_ranquear_ordem_decrescente_por_razao():
    a, b, c = _cand(2.5), _cand(1.0), _cand(1.8)
    top = ranquear([a, b, c], top_n=10)
    assert [x.razao_ganho_risco for x in top] == [2.5, 1.8, 1.0]


def test_ranquear_ganho_ilimitado_vai_para_o_fim():
    # Estruturas com razão finita vêm antes das de ganho ilimitado (razão None).
    finita = _cand(1.2)
    ilimitada = _cand(None, risco=50.0)
    top = ranquear([ilimitada, finita], top_n=10)
    assert top[0] is finita
    assert top[1] is ilimitada


def test_top_n_limita_resultado():
    cands = [_cand(r) for r in (3.0, 2.0, 1.0, 0.5)]
    assert len(ranquear(cands, top_n=2)) == 2


# ── Filtro de capital (§10) ──────────────────────────────────────────────────


def test_filtro_de_capital_descarta_acima_do_limite():
    # Capital 1000, limite 5% = 50 BRL: só estruturas com risco ≤ 50 passam.
    config = ConfigScreening(
        tipos=(TipoEstrutura.TRAVA_ALTA,),
        capital_total=1000.0,
        risco_max_pct=0.05,
        top_n=200,
    )
    cands = gerar_candidatas(_cadeia(), config)
    assert len(cands) > 0
    assert all(c.risco_maximo <= 50 + 1e-9 for c in cands)
    assert all(c.risco_pct_capital is not None and c.risco_pct_capital <= 0.05 + 1e-9 for c in cands)


# ── Degradação graciosa ──────────────────────────────────────────────────────


def test_cadeia_vazia_nao_quebra():
    vazia = CadeiaAtivo(ativo="ZZZZ3", as_of=None, spot=None, opcoes=[])
    assert screenar_ativo(vazia, ConfigScreening()) == []
