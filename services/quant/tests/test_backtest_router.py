"""
Teste do endpoint POST /backtest (wiring), com a camada de banco mockada — não
toca no Postgres real. Confirma o disclaimer, a série, o resumo e a tradução de
"dados insuficientes" para HTTP 422 apontando o que falta (§2.4).
"""

from datetime import datetime, timedelta

import pytest

from app.quant import dados
from app.quant.backtest import (
    DadosInsuficientesError,
    EntradaBacktest,
    PernaBacktest,
    PontoPreco,
)

ENTRADA = datetime(2026, 1, 5)
VENCIMENTO = datetime(2026, 2, 20)


def _entrada_trava(*_args, **_kwargs) -> EntradaBacktest:
    """Trava de alta 21/22 (débito 0,30) levada ao vencimento com spot 22 → ganho 70."""
    historico = {
        "C21": [PontoPreco(ENTRADA, 0.55), PontoPreco(ENTRADA + timedelta(days=14), 0.70)],
        "C22": [PontoPreco(ENTRADA, 0.25), PontoPreco(ENTRADA + timedelta(days=14), 0.34)],
    }
    return EntradaBacktest(
        ativo="TESTE3",
        pernas=[
            PernaBacktest("C21", "call", "compra", 21.0, 1),
            PernaBacktest("C22", "call", "venda", 22.0, 1),
        ],
        historico=historico,
        data_entrada=ENTRADA,
        data_saida=VENCIMENTO,
        vencimento=VENCIMENTO,
        spot_vencimento=22.0,
    )


def test_post_backtest_ok(client, monkeypatch):
    monkeypatch.setattr(dados, "carregar_backtest", _entrada_trava)

    resp = client.post(
        "/backtest",
        json={
            "pernas": [
                {"option_symbol": "C21", "lado": "compra", "quantidade": 1},
                {"option_symbol": "C22", "lado": "venda", "quantidade": 1},
            ],
            "data_entrada": "2026-01-05",
        },
    )
    assert resp.status_code == 200
    body = resp.json()

    # Disclaimer obrigatório de SIMULAÇÃO HISTÓRICA (§2).
    assert "SIMULAÇÃO HISTÓRICA" in body["aviso"]
    assert body["ativo"] == "TESTE3"

    # Risco antes do ganho, com os números da trava conhecida.
    resumo = body["resumo"]
    assert resumo["rotulo_risco"] == "DEFINIDO"
    assert resumo["risco_maximo"] == pytest.approx(30.0)
    assert resumo["ganho_maximo"] == pytest.approx(70.0)
    assert resumo["pl_final"] == pytest.approx(70.0)
    assert resumo["liquidado_no_vencimento"] is True

    # Série não vazia, terminando na liquidação do vencimento.
    serie = body["serie"]
    assert len(serie) >= 2
    assert serie[-1]["fonte"] == "vencimento"


def test_post_backtest_dados_insuficientes_retorna_422(client, monkeypatch):
    def _faltam(*_args, **_kwargs):
        raise DadosInsuficientesError(
            ["ZZZZ1: ticker não encontrado na base de opções."],
            "Algumas pernas não existem na base ingerida. Confira os tickers.",
        )

    monkeypatch.setattr(dados, "carregar_backtest", _faltam)

    resp = client.post(
        "/backtest",
        json={
            "pernas": [{"option_symbol": "ZZZZ1", "lado": "compra", "quantidade": 1}],
            "data_entrada": "2026-01-05",
        },
    )
    assert resp.status_code == 422
    detail = resp.json()["detail"]
    assert "faltam" in detail
    assert any("ZZZZ1" in item for item in detail["faltam"])


def test_post_backtest_estrutura_invalida_retorna_400(client, monkeypatch):
    def _venc_misto(*_args, **_kwargs):
        raise ValueError("As pernas têm vencimentos diferentes — uma estrutura tem um único vencimento.")

    monkeypatch.setattr(dados, "carregar_backtest", _venc_misto)

    resp = client.post(
        "/backtest",
        json={
            "pernas": [
                {"option_symbol": "C21", "lado": "compra", "quantidade": 1},
                {"option_symbol": "D22", "lado": "venda", "quantidade": 1},
            ],
            "data_entrada": "2026-01-05",
        },
    )
    assert resp.status_code == 400
    assert "vencimentos diferentes" in resp.json()["detail"]["erro"]
