# Babilônia Quant — microserviço FastAPI

Microserviço de **quant pesado** do Babilônia, isolado do app Next.js e
consumido por **HTTP**. Existe por causa da fronteira de arquitetura do PRD
(§4.1 / §15 Fase 3): quando surge cálculo pesado que o Next.js não deve fazer,
ele é extraído para um serviço Python — **sem tocar na UI**.

> Mono-repo leve: este serviço mora em `services/quant/`, dentro do repositório
> do Babilônia, mas é **independente** (Python próprio, deps próprias, deploy
> próprio). Não compartilha runtime com o Next.js.

## Para que serve (e para que NÃO serve)

**Faz:**

- ✅ **Screening da cadeia inteira** (implementado — ver seção abaixo): varre toda
  a `opcao_cotahist` de um ativo (ou da watchlist) e ranqueia estruturas por
  risco/retorno, sem o usuário montar uma a uma.
- **Backtesting** de estruturas (prompts futuros).
- **Superfície de IV** (vol surface) (prompts futuros).

**NUNCA faz** — a fronteira de responsabilidade é dura:

- ❌ **Não decide ordens nem recomenda** nada. Decisão é sempre do usuário; o
  Babilônia não é consultoria (princípio não-negociável do CLAUDE.md). O screening
  é **TRIAGEM**, e o payload diz isso explicitamente.
- ❌ **Não persiste positions/book/tickets.** Toda escrita no banco é do Next.js.
  Este serviço acessa o Postgres **somente para leitura**.
- ❌ **Não duplica o motor Black-Scholes do TS** (gregas, IV, IV Rank). Esse
  motor é a fonte da verdade do app; aqui não se reimplementa pricing/IV.

⚠️ **Cópia paralela necessária do `options-math`.** Para varrer a cadeia inteira
em Python, o serviço REIMPLEMENTA em paralelo a parte de **payoff/risco/ganho/
breakeven** do `lib/options-math` (TS) em `app/quant/options_math.py`, e o filtro
de liquidez de `lib/liquidez.ts` em `app/quant/liquidez.py`. **O TS continua sendo
a fonte da verdade**; estas cópias existem só porque o screening não pode chamar o
motor TS. **As duas implementações PRECISAM ser mantidas consistentes** — por isso
os testes Python usam **exatamente os mesmos casos numéricos do §18** que os testes
do TS (`lib/options-math/estruturas.test.ts`). Mudou uma fórmula de um lado, muda
do outro e os dois conjuntos de testes têm de continuar verdes.

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

## Screening de cadeia — `POST /screening`

Dado um ativo (ou a watchlist inteira), varre toda a cadeia em `opcao_cotahist` e
ranqueia as melhores estruturas por **risco/retorno**. (A Route Handler do Next.js
que consome este endpoint **ainda não existe** — próximo prompt.)

**Corpo da requisição** (todos opcionais):

| Campo | Default | Significado |
|---|---|---|
| `tickers` | watchlist inteira | Um ou vários ativos-objeto. |
| `tipos` | todas | `trava_alta`, `trava_baixa`, `borboleta`, `condor`, `straddle`, `strangle`. |
| `top_n` | 10 | Quantas estruturas devolver. |
| `capital_total` | — | Capital (BRL) para o filtro de risco (§10). |
| `risco_max_pct` | — | Risco máx. aceitável como fração (`0.05` = 5%). |
| `vencimento_min_dias` / `vencimento_max_dias` | — | Faixa de vencimento (dias do as-of). |
| `max_vencimentos` | 2 | Cap: nº de vencimentos mais próximos a varrer. |
| `max_strikes_por_lado` | 8 | Cap: strikes acima/abaixo do spot na janela. |

```bash
curl -X POST localhost:8000/screening -H 'content-type: application/json' \
  -d '{"tickers":["PETR4"],"tipos":["trava_alta","borboleta"],"top_n":5,
       "capital_total":100000,"risco_max_pct":0.05}'
```

**O que o screening garante** (decisões de design):

- **Só risco DEFINIDO.** Gera apenas travas (alta/baixa, débito e crédito),
  borboletas, condores e straddle/strangle **comprados** — todas de risco
  definido. Nunca gera venda a descoberto (risco indefinido) — risco-first (§2).
- **Liquidez ANTES do ranking.** Cada série passa por `avaliar_liquidez` (mesma
  regra do Next.js: volume + spread, sem open interest — §6.4); séries ilíquidas
  são descartadas **antes** de qualquer combinação. Nunca se sugere série ilíquida.
- **Métrica de ranking:** `razao_ganho_risco = ganho_máximo / risco_máximo` (risco
  definido), maior é melhor. Estruturas de **ganho ilimitado** (straddle/strangle
  comprados) não têm razão finita → vão para o fim do ranking, ordenadas por menor
  risco (`razao_ganho_risco: null` no payload).
- **Prêmio = mid** `(bid+ask)/2` de cada série (mesmo `precoReferencia` do app).
- **Pronto para o ticket:** cada perna traz o **ticker exato** da opção
  (`option_symbol`), strike, lado, prêmio, bid/ask e quantidade — o Next.js monta
  o ticket **sem recalcular nada**.
- **Frescor + aviso:** o payload carimba a `data_referencia` (último pregão usado,
  de `opcao_cotahist`) por ativo e inclui um `aviso` de que isto é **TRIAGEM, não
  recomendação** — a decisão é do usuário (§2 princípio 3).

**Performance (task 6).** A `opcao_cotahist` tem ~939K linhas (todos os pregões),
mas o screening lê só **um pregão (as-of) de um ativo** e ainda aplica caps
(vencimentos próximos + janela de strikes em torno do spot). Medições locais numa
cadeia sintética pesada (240 séries líquidas, 3 vencimentos):

- Config **default** (`max_strikes_por_lado=8`, `max_vencimentos=2`): **~40 ms**.
- Janela ampla (`max_strikes_por_lado=20`, `max_vencimentos=3`): **~320 ms**.

Ou seja, resposta em **segundos no pior caso**, não minutos. Se uma cadeia real
ficar lenta, baixe `max_strikes_por_lado` / `max_vencimentos` ou restrinja
`vencimento_max_dias` — o custo dominante é a geração de condores (par interno ×
largura de asa), já limitada à janela.

## Rodar os testes

```bash
cd services/quant
uv run pytest
```

Nenhum teste toca no Postgres real (o `conftest.py` injeta um `DATABASE_URL`
placeholder; o router é testado com a camada de banco mockada). Cobertura:

- `test_options_math.py` — os **mesmos casos numéricos do §18** dos testes do TS
  (ex.: trava de alta K1=20, K2=22, débito=0,80 → risco 0,80; ganho 1,20; BE
  20,80), para cada estrutura suportada. É o que garante que a cópia paralela não
  divergiu do `lib/options-math`.
- `test_liquidez.py` — mesmos limites/semântica do `lib/liquidez.ts`.
- `test_screening.py` — geração, **exclusão de série ilíquida** do ranking,
  **ordem do ranking** pela métrica e **filtro de capital** (§10).
- `test_db_readonly.py` — confirma que a conexão abre **read-only** e que a camada
  de dados **não tem SQL de escrita** (nenhuma escrita é tentada).
- `test_screening_router.py` — o endpoint `POST /screening` (com o banco mockado).

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
    schemas.py         contrato HTTP (Pydantic) do /screening
    routers/
      health.py        GET /health (liveness, não toca no banco)
      screening.py     POST /screening (orquestra: banco → núcleo puro → payload)
    core/
      config.py        config tipada (pydantic-settings, lê DATABASE_URL)
      db.py            conexão Postgres SOMENTE LEITURA
    quant/
      options_math.py  CÓPIA PARALELA do lib/options-math (TS) — §18, puro
      liquidez.py      CÓPIA PARALELA do lib/liquidez.ts — filtro de liquidez
      screening.py     núcleo do screening (varredura + ranking), PURO
      dados.py         acesso de LEITURA (watchlist/opcao_cotahist/acao_cotahist)
  tests/
    test_options_math.py    casos numéricos do §18 (espelham os testes do TS)
    test_liquidez.py        filtro de liquidez
    test_screening.py       geração, liquidez, ranking, capital
    test_db_readonly.py     conexão read-only / sem SQL de escrita
    test_screening_router.py  endpoint POST /screening (banco mockado)
    test_health.py          sobe o app e bate no /health
  Dockerfile           imagem de produção (uv + Python 3.12)
  pyproject.toml       deps + config do pytest
  .env.example         template de variáveis (sem valores reais)
```
