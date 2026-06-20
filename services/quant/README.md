# Babilônia Quant — microserviço FastAPI

Microserviço de **quant pesado** do Babilônia, isolado do app Next.js e
consumido por **HTTP**. Existe por causa da fronteira de arquitetura do PRD
(§4.1 / §15 Fase 3): quando surge cálculo pesado que o Next.js não deve fazer,
ele é extraído para um serviço Python — **sem tocar na UI**.

> Mono-repo leve: este serviço mora em `services/quant/`, dentro do repositório
> do Babilônia, mas é **independente** (Python próprio, deps próprias, deploy
> próprio). Não compartilha runtime com o Next.js.

## Para que serve (e para que NÃO serve)

**Faz** (em prompts futuros — aqui só está a fundação):

- Screening da **cadeia inteira** de opções.
- **Backtesting** de estruturas.
- **Superfície de IV** (vol surface).

**NUNCA faz** — a fronteira de responsabilidade é dura:

- ❌ **Não decide ordens nem recomenda** nada. Decisão é sempre do usuário; o
  Babilônia não é consultoria (princípio não-negociável do CLAUDE.md).
- ❌ **Não persiste positions/book/tickets.** Toda escrita no banco é do Next.js.
  Este serviço acessa o Postgres **somente para leitura**.
- ❌ **Não duplica o `lib/options-math`** (payoff/risco/ganho/breakeven, em TS).
- ❌ **Não duplica o motor Black-Scholes do TS** (gregas, IV, IV Rank). Esse
  motor é a fonte da verdade do app; aqui não se reimplementa pricing/IV "porque
  era conveniente".

## Acesso ao banco — somente leitura

Lê o **mesmo Neon Postgres** do Next.js (via `DATABASE_URL` própria, lida do
`.env` / do ambiente — nunca hardcoded). Tabelas de leitura previstas:
`opcao_cotahist`, `acao_cotahist`, `iv_history`.

Cada conexão é aberta com `default_transaction_read_only=on`
(`app/core/db.py`), então qualquer escrita acidental falha no próprio Postgres.
A defesa definitiva, recomendada em produção, é um **usuário/role de banco com
permissão apenas de `SELECT`**.

## Stack

- **Python 3.12** + **FastAPI** + **uvicorn**.
- **uv** como gerenciador de dependências e ambiente (ver abaixo).
- **psycopg 3** para o Postgres (leitura).
- **pytest** + **httpx** (`TestClient`) para testes.

### Por que `uv` (e não Poetry)

- **Uma ferramenta só**: resolve dependências, cria o venv **e** baixa o próprio
  Python 3.12 (`uv python install`) — não dependemos de ter 3.12 instalado na
  máquina.
- **Rápido e reprodutível**: lockfile (`uv.lock`) + `uv sync --frozen` dão
  builds determinísticos, ótimos para a imagem Docker do Railway.
- **Imagem oficial pronta** (`ghcr.io/astral-sh/uv:python3.12-...`), o que deixa
  o `Dockerfile` enxuto e portável.

## Rodar localmente

Pré-requisito: [uv](https://docs.astral.sh/uv/) instalado
(`curl -LsSf https://astral.sh/uv/install.sh | sh`).

```bash
cd services/quant

# 1) Configurar o ambiente
cp .env.example .env        # preencha DATABASE_URL (mesmo Neon do Next.js)

# 2) Instalar deps (uv baixa o Python 3.12 se necessário) + subir o servidor
uv sync
uv run uvicorn app.main:app --reload
```

Servidor em `http://localhost:8000`:

- `GET /health` → `{"status":"ok","service":"babilonia-quant","environment":"local"}`
- `GET /docs` → Swagger UI (FastAPI)

O Next.js usa o `/health` para confirmar que o serviço está de pé **antes** de
disparar qualquer cálculo pesado.

## Rodar os testes

```bash
cd services/quant
uv run pytest
```

Os testes da fundação **não** tocam no banco (o `conftest.py` injeta um
`DATABASE_URL` placeholder só para a validação da config passar).

## Deploy (Railway)

O `Dockerfile` está otimizado para o Railway, mas é portável (qualquer runtime
de container serve):

- Railway injeta a porta em `$PORT`; o `CMD` a respeita (cai para `8000` local).
- Definir `DATABASE_URL` (e, opcionalmente, `ENVIRONMENT=railway`) nas variáveis
  do projeto no painel — **nunca** commitar valores reais.

```bash
# build/run local do container para validar
docker build -t babilonia-quant services/quant
docker run --rm -p 8000:8000 --env-file services/quant/.env babilonia-quant
```

## Estrutura

```
services/quant/
  app/
    main.py            entrypoint FastAPI (monta routers)
    routers/
      health.py        GET /health (liveness, não toca no banco)
    core/
      config.py        config tipada (pydantic-settings, lê DATABASE_URL)
      db.py            conexão Postgres SOMENTE LEITURA
  tests/
    test_health.py     sobe o app e bate no /health
  Dockerfile           imagem de produção (uv + Python 3.12)
  pyproject.toml       deps + config do pytest
  .env.example         template de variáveis (sem valores reais)
```
