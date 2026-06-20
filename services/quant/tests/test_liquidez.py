"""Testes do port de liquidez — mesmos limites/semântica do `lib/liquidez.ts`."""

from app.quant.liquidez import OpcaoLiquidez, avaliar_liquidez, preco_referencia


def _op(bid=None, ask=None, volume=None, market_maker=None):
    spread = (ask - bid) if (bid and ask) else None
    return OpcaoLiquidez(bid=bid, ask=ask, spread=spread, volume=volume, market_maker=market_maker)


def test_preco_referencia_mid():
    assert preco_referencia(1.0, 1.2) == 1.1
    assert preco_referencia(0, 1.2) == 1.2  # só ask
    assert preco_referencia(1.0, 0) == 1.0  # só bid
    assert preco_referencia(0, 0) is None


def test_serie_liquida_ok():
    aval = avaliar_liquidez(_op(bid=1.0, ask=1.05, volume=500))
    assert aval.nivel == "ok"
    assert aval.spread_relativo is not None


def test_volume_baixo_alerta():
    aval = avaliar_liquidez(_op(bid=1.0, ask=1.05, volume=10))
    assert aval.nivel == "baixa"


def test_spread_largo_alerta():
    # spread 0,5 sobre mid ~1,25 = 40% > 10% → baixa.
    aval = avaliar_liquidez(_op(bid=1.0, ask=1.5, volume=500))
    assert aval.nivel == "baixa"


def test_sem_dados_alerta():
    aval = avaliar_liquidez(_op())
    assert aval.nivel == "baixa"


def test_market_maker_reduz_volume_minimo():
    # 30 contratos < 100, mas com market maker o mínimo cai para 20 → ok.
    aval = avaliar_liquidez(_op(bid=1.0, ask=1.05, volume=30, market_maker=True))
    assert aval.nivel == "ok"
