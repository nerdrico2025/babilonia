"""
Controle SEM provento — par do caso PETR4 (`test_backtest_provento.py`).

Usa o caso real validado à mão: VALE3, calls do vencimento 15/05/2026, entrada
15/04/2026, spot no vencimento 83,50. Nenhuma série mudou de strike na janela
(verificado na base), então a sinalização de provento tem de ficar SILENCIOSA:
`ajustes_provento` vazio e nenhum ponto da série com `evento="ajuste_provento"`.

Três travas de alta cobrindo os regimes de payoff, com os P&L conferidos à mão:
  - ganho máximo  (spot acima das duas pernas): +R$ 32
  - parcial       (spot entre os strikes):      −R$ 69
  - perda máxima  (spot abaixo das duas pernas): −R$ 126

Fixture PURA (sem banco), como os demais testes do núcleo. O pl_final depende só
do prêmio de entrada + payoff no vencimento; o ponto intermediário (23/04, a
data-ex do PETR4) entra de propósito para provar que, sem mudança de strike, ele
NÃO é marcado como evento.
"""

from datetime import datetime

import pytest

from app.quant.backtest import (
    EntradaBacktest,
    PernaBacktest,
    PontoPreco,
    PontoStrike,
    simular,
)

ENTRADA = datetime(2026, 4, 15)
MEIO = datetime(2026, 4, 23)  # a data-ex do PETR4 — aqui deve passar SEM evento
VENCIMENTO = datetime(2026, 5, 15)
SPOT_VENCIMENTO = 83.50  # fechamento real de VALE3 em 15/05/2026

_PREGOES = [ENTRADA, MEIO, VENCIMENTO]

# (ticker, strike, prêmio de entrada real em 15/04/2026)
VALEE804 = ("VALEE804", 80.40, 9.25)
VALEE824 = ("VALEE824", 82.40, 7.57)
VALEE844 = ("VALEE844", 84.40, 5.78)
VALEE864 = ("VALEE864", 86.40, 4.46)
VALEE884 = ("VALEE884", 88.40, 3.20)


def _trava(compra: tuple, venda: tuple) -> EntradaBacktest:
    """Trava de alta (compra strike menor, vende strike maior) — strikes CONSTANTES."""
    pernas = [
        PernaBacktest(compra[0], "call", "compra", compra[1], 1),
        PernaBacktest(venda[0], "call", "venda", venda[1], 1),
    ]
    # Prêmio constante na janela: o valor intermediário não afeta o pl_final (que sai
    # do payoff no vencimento), serve só para o ponto 23/04 existir na série.
    historico = {
        compra[0]: [PontoPreco(d, compra[2]) for d in _PREGOES],
        venda[0]: [PontoPreco(d, venda[2]) for d in _PREGOES],
    }
    # Strike constante em todos os pregões → sem ajuste por provento (controle).
    strikes = {
        compra[0]: [PontoStrike(d, compra[1]) for d in _PREGOES],
        venda[0]: [PontoStrike(d, venda[1]) for d in _PREGOES],
    }
    return EntradaBacktest(
        ativo="VALE3",
        pernas=pernas,
        historico=historico,
        data_entrada=ENTRADA,
        data_saida=VENCIMENTO,
        vencimento=VENCIMENTO,
        spot_vencimento=SPOT_VENCIMENTO,
        strikes=strikes,
    )


CASOS = [
    pytest.param(VALEE804, VALEE824, 32.0, id="ganho_maximo"),
    pytest.param(VALEE824, VALEE844, -69.0, id="parcial"),
    pytest.param(VALEE864, VALEE884, -126.0, id="perda_maxima"),
]


@pytest.mark.parametrize("compra, venda, pl_esperado", CASOS)
def test_controle_vale3_pl_final_bate(compra, venda, pl_esperado):
    res = simular(_trava(compra, venda))
    assert res.resumo.pl_final == pytest.approx(pl_esperado)
    assert res.resumo.rotulo_risco == "DEFINIDO"
    assert res.resumo.liquidado_no_vencimento is True


@pytest.mark.parametrize("compra, venda, pl_esperado", CASOS)
def test_controle_vale3_sem_sinalizacao_de_provento(compra, venda, pl_esperado):
    res = simular(_trava(compra, venda))
    # Sem mudança de strike na janela → nenhum ajuste reportado...
    assert res.resumo.ajustes_provento == []
    # ...e nenhum dia da série marcado (nem 23/04, que no PETR4 era a data-ex).
    assert all(p.evento is None for p in res.serie)
