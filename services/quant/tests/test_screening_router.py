"""
Teste do endpoint POST /screening (wiring), com a camada de banco mockada — não
toca no Postgres real. Confirma o aviso de TRIAGEM, o frescor e o ranking.
"""

from datetime import datetime, timedelta

from app.quant import dados
from app.quant.screening import CadeiaAtivo, OpcaoSerie

AS_OF = datetime(2026, 6, 19)
VENC = AS_OF + timedelta(days=30)

_MIDS_CALL = {18: 2.45, 19: 1.65, 20: 1.00, 21: 0.55, 22: 0.25}
_MIDS_PUT = {18: 0.25, 19: 0.55, 20: 1.00, 21: 1.65, 22: 2.45}


def _serie(strike, kind):
    mid = (_MIDS_CALL if kind == "call" else _MIDS_PUT)[strike]
    return OpcaoSerie(
        option_symbol=f"TESTE{int(strike)}{kind[0].upper()}",
        kind=kind,
        strike=float(strike),
        expires_at=VENC,
        bid=mid * 0.98,
        ask=mid * 1.02,
        volume=500,
        volume_financeiro=mid * 500 * 100,
        numero_negocios=500,
    )


def _fake_cadeia(ativo):
    opcoes = [_serie(k, "call") for k in _MIDS_CALL] + [_serie(k, "put") for k in _MIDS_PUT]
    return CadeiaAtivo(ativo=ativo.upper(), as_of=AS_OF, spot=20.0, opcoes=opcoes)


def test_post_screening_ticker_unico(client, monkeypatch):
    monkeypatch.setattr(dados, "carregar_cadeia", _fake_cadeia)

    resp = client.post("/screening", json={"tickers": ["TESTE3"], "top_n": 5})
    assert resp.status_code == 200
    body = resp.json()

    # Aviso de TRIAGEM obrigatório (§2 princípio 3).
    assert "TRIAGEM" in body["aviso"]
    assert "não" in body["aviso"].lower()

    # Frescor carimbado (data de referência do dado).
    assert body["frescor"][0]["ativo"] == "TESTE3"
    assert body["frescor"][0]["data_referencia"] is not None

    # Ranking não vazio, ordenado, com tickers exatos nas pernas.
    ranking = body["ranking"]
    assert 0 < len(ranking) <= 5
    razoes = [r["razao_ganho_risco"] for r in ranking if r["razao_ganho_risco"] is not None]
    assert razoes == sorted(razoes, reverse=True)
    primeira = ranking[0]
    assert primeira["rotulo_risco"] == "DEFINIDO"
    assert all(p["option_symbol"].startswith("TESTE") for p in primeira["pernas"])


def test_post_screening_usa_watchlist_quando_sem_tickers(client, monkeypatch):
    chamados = {}

    def _fake_watchlist():
        chamados["watchlist"] = True
        return ["TESTE3"]

    monkeypatch.setattr(dados, "buscar_watchlist", _fake_watchlist)
    monkeypatch.setattr(dados, "carregar_cadeia", _fake_cadeia)

    resp = client.post("/screening", json={})
    assert resp.status_code == 200
    assert chamados.get("watchlist") is True
