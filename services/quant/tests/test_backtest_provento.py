"""
Sinalização de ajuste por provento no /backtest (sem alterar o cálculo, §2).

Usa o próprio Caso C (PETR4, PETRE450/PETRE455, entrada 15/04/2026): o strike das
duas pernas cai de 45,00/45,50 para 44,46/44,96 em 23/04/2026 (provento em dinheiro
de R$ 0,54/ação, data-ex 23/04). Confirma que:
  - o ajuste é DETECTADO e reportado em `resumo.ajustes_provento` (data-ex, valor,
    pernas afetadas);
  - o dia 23/04 da série recebe a flag `evento="ajuste_provento"`, os demais não;
  - sem mudança de strike, nada é sinalizado (controle);
  - o campo trafega pela resposta HTTP do endpoint.
"""

from datetime import datetime

from app.quant import dados
from app.quant.backtest import (
    EntradaBacktest,
    PernaBacktest,
    PontoPreco,
    PontoStrike,
    simular,
)

# Janela do Caso C.
ENTRADA = datetime(2026, 4, 15)
EX = datetime(2026, 4, 23)  # data-ex do provento (1º pregão com strike ajustado)
VENCIMENTO = datetime(2026, 5, 15)

# Pregões usados na fixture (subconjunto suficiente: antes e depois do ex).
_PREGOES = [ENTRADA, datetime(2026, 4, 22), EX, datetime(2026, 4, 24), VENCIMENTO]


def _strikes(antes: float, depois: float) -> list[PontoStrike]:
    """Linha do tempo do strike: `antes` até 22/04, `depois` a partir de 23/04 (ex)."""
    return [PontoStrike(d, antes if d < EX else depois) for d in _PREGOES]


def _caso_c() -> EntradaBacktest:
    """Trava de alta PETRE450/PETRE455 com ajuste de -0,54 na data-ex 23/04."""
    # Prêmios reais do Caso C na entrada (15/04): 3,27 e 2,97 → débito 0,30.
    historico = {
        "PETRE450": [PontoPreco(d, 3.27) for d in _PREGOES],
        "PETRE455": [PontoPreco(d, 2.97) for d in _PREGOES],
    }
    return EntradaBacktest(
        ativo="PETR4",
        pernas=[
            PernaBacktest("PETRE450", "call", "compra", 44.46, 1),  # strike resolvido (pós-ajuste)
            PernaBacktest("PETRE455", "call", "venda", 44.96, 1),
        ],
        historico=historico,
        data_entrada=ENTRADA,
        data_saida=VENCIMENTO,
        vencimento=VENCIMENTO,
        spot_vencimento=45.47,
        strikes={
            "PETRE450": _strikes(45.00, 44.46),
            "PETRE455": _strikes(45.50, 44.96),
        },
    )


def test_detecta_ajuste_de_provento_caso_c():
    res = simular(_caso_c())

    ajustes = res.resumo.ajustes_provento
    assert len(ajustes) == 1, "um único provento na janela atinge as duas pernas juntas"
    aj = ajustes[0]
    assert aj.data_ex == EX
    assert aj.valor_ajuste_por_acao == 0.54  # 45,00→44,46 e 45,50→44,96
    assert aj.pernas_afetadas == ["PETRE450", "PETRE455"]
    assert "provento" in aj.explicacao.lower()


def test_marca_a_data_ex_na_serie_e_so_ela():
    res = simular(_caso_c())

    dias_marcados = [p.data for p in res.serie if p.evento == "ajuste_provento"]
    assert dias_marcados == [EX], "só o dia 23/04 é a data-ex"
    # Todo o resto da série é pregão comum (sem evento), inclusive a liquidação.
    assert all(p.evento is None for p in res.serie if p.data != EX)


def test_sem_mudanca_de_strike_nao_sinaliza_nada():
    entrada = _caso_c()
    # Reescreve a linha do tempo SEM ajuste (strike constante nas duas pernas).
    entrada = EntradaBacktest(
        ativo=entrada.ativo,
        pernas=entrada.pernas,
        historico=entrada.historico,
        data_entrada=entrada.data_entrada,
        data_saida=entrada.data_saida,
        vencimento=entrada.vencimento,
        spot_vencimento=entrada.spot_vencimento,
        strikes={
            "PETRE450": [PontoStrike(d, 44.46) for d in _PREGOES],
            "PETRE455": [PontoStrike(d, 44.96) for d in _PREGOES],
        },
    )
    res = simular(entrada)
    assert res.resumo.ajustes_provento == []
    assert all(p.evento is None for p in res.serie)


def test_sem_linha_do_tempo_de_strike_nao_quebra():
    """`strikes` ausente (default vazio) → simula igual, sem detecção (campo opcional)."""
    entrada = _caso_c()
    entrada = EntradaBacktest(
        ativo=entrada.ativo,
        pernas=entrada.pernas,
        historico=entrada.historico,
        data_entrada=entrada.data_entrada,
        data_saida=entrada.data_saida,
        vencimento=entrada.vencimento,
        spot_vencimento=entrada.spot_vencimento,
    )
    res = simular(entrada)
    assert res.resumo.ajustes_provento == []


def test_ajuste_de_provento_trafega_pela_resposta_http(client, monkeypatch):
    monkeypatch.setattr(dados, "carregar_backtest", lambda *a, **k: _caso_c())

    resp = client.post(
        "/backtest",
        json={
            "pernas": [
                {"option_symbol": "PETRE450", "lado": "compra", "quantidade": 1},
                {"option_symbol": "PETRE455", "lado": "venda", "quantidade": 1},
            ],
            "data_entrada": "2026-04-15",
        },
    )
    assert resp.status_code == 200
    body = resp.json()

    ajustes = body["resumo"]["ajustes_provento"]
    assert len(ajustes) == 1
    assert ajustes[0]["valor_ajuste_por_acao"] == 0.54
    assert ajustes[0]["pernas_afetadas"] == ["PETRE450", "PETRE455"]
    # A data-ex aparece marcada na série exposta ao Next.js.
    marcados = [p for p in body["serie"] if p["evento"] == "ajuste_provento"]
    assert len(marcados) == 1
    assert marcados[0]["data"].startswith("2026-04-23")
