"""
Testes do `options_math` — MESMOS casos numéricos do §18 usados nos testes do
`lib/options-math` em TS (`lib/options-math/estruturas.test.ts`). Se um número
divergir aqui, as duas implementações saíram de sincronia (ver aviso no módulo).

Os casos usam `tamanho_lote=1` para conferir os valores POR AÇÃO direto das
fórmulas do §18; um teste à parte cobre o lote padrão (100).
"""

import math

import pytest

from app.quant import options_math as om


# ── Travas verticais ─────────────────────────────────────────────────────────


def test_trava_alta_debito():
    # K1=20, K2=22, débito=0,80 → risco 0,80; ganho 1,20; BE 20,80.
    r = om.trava_alta_call_debito(20, 22, premio_k1=1.0, premio_k2=0.2, tamanho_lote=1)
    assert r.risco_maximo == pytest.approx(0.8)
    assert r.rotulo_risco == "DEFINIDO"
    assert r.ganho_maximo == pytest.approx(1.2)
    assert len(r.breakevens) == 1
    assert r.breakevens[0] == pytest.approx(20.8)


def test_trava_alta_credito():
    # bull put, crédito=0,80 → risco 1,20; ganho 0,80; BE 21,20.
    r = om.trava_alta_put_credito(20, 22, premio_k1=0.2, premio_k2=1.0, tamanho_lote=1)
    assert r.risco_maximo == pytest.approx(1.2)
    assert r.rotulo_risco == "DEFINIDO"
    assert r.ganho_maximo == pytest.approx(0.8)
    assert r.breakevens[0] == pytest.approx(21.2)


def test_trava_baixa_debito():
    # puts, débito=0,80 → risco 0,80; ganho 1,20; BE K2−débito=21,20.
    r = om.trava_baixa_put_debito(20, 22, premio_k1=0.2, premio_k2=1.0, tamanho_lote=1)
    assert r.risco_maximo == pytest.approx(0.8)
    assert r.rotulo_risco == "DEFINIDO"
    assert r.ganho_maximo == pytest.approx(1.2)
    assert r.breakevens[0] == pytest.approx(21.2)


def test_trava_baixa_credito():
    # bear call, crédito=0,80 → risco 1,20; ganho 0,80; BE K1+crédito=20,80.
    r = om.trava_baixa_call_credito(20, 22, premio_k1=1.0, premio_k2=0.2, tamanho_lote=1)
    assert r.risco_maximo == pytest.approx(1.2)
    assert r.rotulo_risco == "DEFINIDO"
    assert r.ganho_maximo == pytest.approx(0.8)
    assert r.breakevens[0] == pytest.approx(20.8)


def test_escala_com_lote_padrao():
    # lote 100: risco 80, ganho 120; breakeven é preço e independe do lote.
    r = om.trava_alta_call_debito(20, 22, premio_k1=1.0, premio_k2=0.2)
    assert r.risco_maximo == pytest.approx(80)
    assert r.ganho_maximo == pytest.approx(120)
    assert r.breakevens[0] == pytest.approx(20.8)


# ── Borboleta e condor ───────────────────────────────────────────────────────


def test_borboleta():
    # 18/20/22; débito=0,30 → risco 0,30; ganho 1,70; BEs 18,30 e 21,70.
    r = om.borboleta_calls(18, 20, 22, premio_k1=1.2, premio_k2=0.6, premio_k3=0.3, tamanho_lote=1)
    assert r.risco_maximo == pytest.approx(0.3)
    assert r.rotulo_risco == "DEFINIDO"
    assert r.ganho_maximo == pytest.approx(1.7)
    assert len(r.breakevens) == 2
    assert r.breakevens[0] == pytest.approx(18.3)
    assert r.breakevens[1] == pytest.approx(21.7)


def test_condor():
    # 18/20/22/24; débito=1,10 → risco 1,10; ganho 0,90; BEs 19,10 e 22,90.
    r = om.condor_calls(
        18, 20, 22, 24,
        premio_k1=3.0, premio_k2=1.5, premio_k3=0.7, premio_k4=0.3,
        tamanho_lote=1,
    )
    assert r.risco_maximo == pytest.approx(1.1)
    assert r.rotulo_risco == "DEFINIDO"
    assert r.ganho_maximo == pytest.approx(0.9)
    assert r.breakevens[0] == pytest.approx(19.1)
    assert r.breakevens[1] == pytest.approx(22.9)
    # Platô de ganho entre os strikes internos: resultado igual em K2 e K3.
    assert om.payoff_estrutura(r.legs, 20, 1) == pytest.approx(0.9)
    assert om.payoff_estrutura(r.legs, 22, 1) == pytest.approx(0.9)


# ── Straddle e strangle ──────────────────────────────────────────────────────


def test_straddle_comprado():
    # K=20; prêmios 1,0+1,2 → risco 2,20; ganho ilimitado; BEs 17,8 e 22,2.
    r = om.straddle_comprado(20, premio_call=1.0, premio_put=1.2, tamanho_lote=1)
    assert r.risco_maximo == pytest.approx(2.2)
    assert r.rotulo_risco == "DEFINIDO"
    assert r.ganho_maximo == "ilimitado"
    assert len(r.breakevens) == 2
    assert r.breakevens[0] == pytest.approx(17.8)
    assert r.breakevens[1] == pytest.approx(22.2)


def test_strangle_comprado():
    # put 18 / call 22; prêmios 0,5+0,6 → risco 1,10; ilimitado; BEs 16,9 e 23,1.
    r = om.strangle_comprado(18, 22, premio_put=0.5, premio_call=0.6, tamanho_lote=1)
    assert r.risco_maximo == pytest.approx(1.1)
    assert r.rotulo_risco == "DEFINIDO"
    assert r.ganho_maximo == "ilimitado"
    assert r.breakevens[0] == pytest.approx(16.9)
    assert r.breakevens[1] == pytest.approx(23.1)


def test_straddle_vendido_risco_indefinido():
    # Risco INDEFINIDO (Infinity), NUNCA um número bonito; ganho = prêmios.
    r = om.straddle_vendido(20, premio_call=1.0, premio_put=1.2, tamanho_lote=1)
    assert r.rotulo_risco == "INDEFINIDO"
    assert r.risco_maximo == math.inf
    assert not math.isfinite(r.risco_maximo)
    assert r.ganho_maximo == pytest.approx(2.2)
    assert len(r.avisos) > 0


def test_strangle_vendido_risco_indefinido():
    r = om.strangle_vendido(18, 22, premio_put=0.5, premio_call=0.6, tamanho_lote=1)
    assert r.rotulo_risco == "INDEFINIDO"
    assert r.risco_maximo == math.inf
    assert r.ganho_maximo == pytest.approx(1.1)
    assert len(r.avisos) > 0


# ── Validações de entrada ────────────────────────────────────────────────────


def test_rejeita_strikes_fora_de_ordem():
    with pytest.raises(ValueError):
        om.trava_alta_call_debito(22, 20, premio_k1=1.0, premio_k2=0.2)


def test_rejeita_borboleta_nao_equidistante():
    with pytest.raises(ValueError, match="equidistantes"):
        om.borboleta_calls(18, 20, 23, premio_k1=1.2, premio_k2=0.6, premio_k3=0.3)


def test_rejeita_condor_fora_de_ordem():
    with pytest.raises(ValueError):
        om.condor_calls(18, 20, 19, 24, premio_k1=3, premio_k2=1.5, premio_k3=0.7, premio_k4=0.3)
