"""
Confirma que o acesso ao banco é SOMENTE LEITURA (fronteira de responsabilidade):
nenhuma escrita é tentada e a conexão abre em modo read-only.
"""

import inspect
import re

import psycopg

import app.core.db as db
import app.quant.dados as dados


def test_conexao_abre_em_modo_read_only(monkeypatch):
    """`get_connection` deve abrir a conexão com `default_transaction_read_only=on`."""
    capturado: dict = {}

    class _FakeConn:
        def close(self):  # noqa: D401 - stub
            capturado["fechou"] = True

    def _fake_connect(conninfo, **kwargs):
        capturado["conninfo"] = conninfo
        capturado["kwargs"] = kwargs
        return _FakeConn()

    monkeypatch.setattr(psycopg, "connect", _fake_connect)

    with db.get_connection() as conn:
        assert isinstance(conn, _FakeConn)

    # A sessão é read-only e em autocommit (sem transação de escrita aberta).
    assert "default_transaction_read_only=on" in capturado["kwargs"]["options"]
    assert capturado["kwargs"]["autocommit"] is True
    assert capturado["fechou"] is True  # conexão sempre fechada ao final


def test_camada_de_dados_nao_tem_sql_de_escrita():
    """A camada `dados` só faz SELECT — nunca INSERT/UPDATE/DELETE/UPSERT/etc."""
    fonte = inspect.getsource(dados).upper()
    # Olha só o conteúdo das strings SQL (linhas com SELECT/FROM/WHERE).
    proibido = r"\b(INSERT|UPDATE|DELETE|UPSERT|MERGE|DROP|ALTER|TRUNCATE|CREATE)\b"
    achados = re.findall(proibido, fonte)
    assert achados == [], f"SQL de escrita encontrado na camada de leitura: {achados}"


def test_options_string_documentada_no_modulo():
    """O módulo declara explicitamente a opção de read-only."""
    assert "default_transaction_read_only=on" in db._READ_ONLY_OPTIONS
