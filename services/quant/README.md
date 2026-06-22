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
- `POST /screening` → triagem da cadeia (ver abaixo)
- `POST /backtest` → simulação histórica de uma estrutura (ver abaixo)
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

## Backtest de estrutura — `POST /backtest`

Dada uma **estrutura escolhida** (pernas com tickers exatos) e uma **data de
entrada** histórica, simula o **mark-to-market diário** da posição até o vencimento
(ou até uma data de saída informada), usando os fechamentos reais de
`opcao_cotahist`. O usuário escolhe a estrutura e a data; o serviço mostra **como
ela teria evoluído**. (A Route Handler do Next.js que consome este endpoint **ainda
não existe** — próximo prompt.)

> ⚠️ **Não** é uma engine de "estratégia automática" decidindo entradas ao longo do
> tempo. É **SIMULAÇÃO HISTÓRICA** — passado não garante futuro; a decisão é do
> usuário (§2). O payload carrega esse aviso explícito.

**Corpo da requisição:**

| Campo | Default | Significado |
|---|---|---|
| `pernas[]` | — (≥1) | `{ option_symbol, lado: compra\|venda, quantidade }`. `tipo`/`strike` **não** vêm do cliente — a base os resolve pelo ticker (nada inventado, §2.4). |
| `data_entrada` | — | Pregão de entrada (`YYYY-MM-DD`). |
| `data_saida` | vencimento | Saída opcional; ausente = levar ao vencimento. |
| `tamanho_lote` | 100 | Tamanho do lote da B3. |

```bash
curl -X POST localhost:8000/backtest -H 'content-type: application/json' \
  -d '{"pernas":[{"option_symbol":"PETRA21","lado":"compra","quantidade":1},
                 {"option_symbol":"PETRA22","lado":"venda","quantidade":1}],
       "data_entrada":"2026-01-05"}'
```

**O que o backtest garante** (decisões de design):

- **Nenhum dado inventado (§2.4).** O **prêmio de entrada** é o fechamento real de
  cada perna no pregão de entrada; cada dia usa o fechamento real daquele pregão. Em
  dia **sem negociação** (fechamento 0,00 no COTAHIST), mantém-se o **último preço
  conhecido** com a flag `sem_negociacao=true` — nunca se inventa um preço. Faltando
  o preço de entrada de uma perna, o serviço **recusa** (HTTP 422) e aponta o que
  falta.
- **Sem look-ahead.** Cada dia simulado usa **apenas** pregões ≤ aquele dia (cursor
  estritamente cronológico). Há teste explícito de proteção.
- **Payoff reusado no vencimento.** No vencimento, o resultado final é o **payoff
  intrínseco** da estrutura ao spot do objeto, calculado por `options_math` (não se
  duplica fórmula). Em saída antecipada, o final é a última marcação a mercado.
- **Risco antes do ganho (§2).** O `resumo` traz `risco_maximo`/`rotulo_risco`
  (teóricos no momento da entrada) antes de `ganho_maximo` e do `pl_final`.
- **Resposta:** `serie[]` de `{ data, valor_posicao, pl_acumulado, sem_negociacao,
  fonte }` + `resumo` (P&L final, risco máximo, dias até o vencimento, avisos de
  dados faltantes) + `aviso` de simulação histórica.

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
- `test_backtest.py` — núcleo do backtest: P&L final = **payoff no vencimento**,
  **proteção contra look-ahead**, **recusa por dados insuficientes** (§2.4),
  carry-forward de dia sem negócio e um **teste de performance** (janela de meses).
- `test_backtest_router.py` — o endpoint `POST /backtest` (banco mockado), incl. a
  tradução de "dados insuficientes" → **422** e estrutura inválida → **400**.

## Deploy (Railway)

O `Dockerfile` está otimizado para o Railway, mas é portável (qualquer runtime
de container serve). O `railway.json` (ao lado do Dockerfile) fixa o builder
Dockerfile e usa `/health` como healthcheck de gating do deploy.

- Railway injeta a porta em `$PORT`; o `CMD` a respeita (cai para `8000` local).
- Definir `DATABASE_URL` (e, opcionalmente, `ENVIRONMENT=railway`) nas variáveis
  do projeto — **nunca** commitar valores reais.

```bash
# build/run local do container para validar (precisa do Docker daemon de pé)
docker build -t babilonia-quant services/quant
docker run --rm -p 8000:8000 --env-file services/quant/.env babilonia-quant
```

### ⚠️ Pegadinha do Neon: use o endpoint DIRETO, NÃO o `-pooler`

A `DATABASE_URL` deste serviço **tem de apontar para o endpoint DIRETO do Neon**
(host **sem** o sufixo `-pooler`, ex.: `ep-xxx.sa-east-1.aws.neon.tech`), **não**
para o endpoint com pooler (`ep-xxx-pooler...`).

**Por quê:** `app/core/db.py` abre cada conexão com o startup option
`-c default_transaction_read_only=on` (defesa em camadas — força transações
somente-leitura no próprio Postgres). O **PgBouncer** que fica atrás do endpoint
`-pooler` do Neon roda em *transaction pooling* e **rejeita opções de startup
arbitrárias via `-c`**, então a conexão falha logo no boot. O endpoint direto
fala com o Postgres real e aceita a opção. **Descoberto em desenvolvimento — não
se perca de novo: se o serviço não conectar no boot, cheque primeiro se a URL tem
`-pooler`.**

> O `services/quant/.env` local já está com o endpoint **direto** — copie esse
> mesmo valor para a variável do Railway.

### Passo a passo — deploy via Railway CLI (recomendado)

Conta usada: **Click Hero (`rafael@clickhero.com.br`)**. Rode tudo de dentro de
`services/quant/` (o build context é essa pasta).

```bash
cd services/quant

# 0) Confirme a conta e que não há projeto linkado ainda
railway whoami
railway status

# 1) Crie o projeto e linke esta pasta (nome sugerido: babilonia-quant)
railway init --name babilonia-quant

# 2) Variáveis de ambiente.
#    DATABASE_URL: leia o valor do .env local SEM ecoar na tela (--stdin):
grep '^DATABASE_URL=' .env | sed 's/^DATABASE_URL=//' | railway variables set DATABASE_URL --stdin
railway variables set ENVIRONMENT railway
#    (Confirme que o host NÃO tem "-pooler" — ver pegadinha acima.)

# 3) Deploy (sobe a pasta, Railway builda o Dockerfile e roda o healthcheck /health)
railway up

# 4) Gere o domínio público do serviço
railway domain
#    → anote a URL https://babilonia-quant-production-XXXX.up.railway.app
```

Se `railway init` reclamar de workspace, repita com
`railway init --name babilonia-quant --workspace "Click Hero"`.

### Alternativa — deploy pelo painel (GitHub)

1. **New Project → Deploy from GitHub repo** → escolha o repositório do Babilônia.
2. Em **Settings → Source**, defina **Root Directory = `services/quant`** (o
   repo é mono-repo; o Railway precisa buildar só essa pasta). O `railway.json`
   e o `Dockerfile` são detectados a partir daí.
3. **Variables:** adicione `DATABASE_URL` (endpoint **direto** do Neon, sem
   `-pooler`) e `ENVIRONMENT=railway`.
4. **Settings → Networking → Generate Domain** para expor publicamente.

### Validação pós-deploy (troque `$URL` pela URL pública)

```bash
URL=https://babilonia-quant-production-XXXX.up.railway.app

# /health → 200
curl -i $URL/health
# espera: {"status":"ok","service":"babilonia-quant","environment":"railway"}

# /screening (triagem PETR4) → ranking de estruturas de risco DEFINIDO
curl -X POST $URL/screening -H 'content-type: application/json' \
  -d '{"tickers":["PETR4"],"tipos":["trava_alta","borboleta"],"top_n":5,
       "capital_total":100000,"risco_max_pct":0.05}'

# /backtest (Caso C: trava de alta PETR4, entrada 15/04/2026) → série + resumo
curl -X POST $URL/backtest -H 'content-type: application/json' \
  -d '{"pernas":[{"option_symbol":"PETRE450","lado":"compra","quantidade":1},
                 {"option_symbol":"PETRE455","lado":"venda","quantidade":1}],
       "data_entrada":"2026-04-15"}'
# espera (Caso C): débito de entrada ≈ 0,30; resumo.ajustes_provento com a
# data-ex 23/04/2026 (valor_ajuste_por_acao 0,54) — bate com test_backtest_provento.py.
```

### Ligar ao Next.js (Vercel)

No projeto **babilonia** do Vercel, configure a env var
**`QUANT_SERVICE_URL`** = a URL pública do Railway (sem barra no fim), em
**Production** (e Preview, se quiser testar em preview):

```bash
# pela CLI, na raiz do repo:
vercel env add QUANT_SERVICE_URL production
# cole a URL https://babilonia-quant-production-XXXX.up.railway.app
vercel --prod   # redeploy para a env entrar em vigor
```

`lib/integrations/quant-service.ts` lê `QUANT_SERVICE_URL` (server-only; default
`http://localhost:8000` em dev). Sem essa var, as telas de screening/backtest em
produção caem no fallback "ferramenta de triagem indisponível".

### Cold start (Railway free hiberna)

O free tier hiberna o container quando ocioso; o **1º request acorda** o serviço
(cold start de alguns segundos). O timeout do Next.js
(`TIMEOUT_PADRAO_MS = 25_000` em `lib/integrations/quant-service.ts`) é generoso
de propósito por causa disso. Meça o cold start real após o deploy:

```bash
# deixe ocioso ~alguns min e cronometre a 1ª chamada:
time curl -s -o /dev/null $URL/health
```

Se o cold start observado se aproximar de 25 s, aumente `TIMEOUT_PADRAO_MS`.

### Role read-only no Postgres — script pronto, aplicação manual pendente

A conexão já abre em `default_transaction_read_only=on` (runtime), mas a **defesa
definitiva** é um usuário/role do Postgres com **apenas `SELECT`** nas tabelas
lidas (`watchlist`, `opcao_cotahist`, `acao_cotahist` — e `iv_history` como
reserva para a superfície de IV futura). Hoje a `DATABASE_URL` usa a role padrão
(read/write).

**Status:** o script SQL (CREATE ROLE + GRANTs de SELECT) e o passo a passo da
nova connection string (formato direto, não-pooler) estão prontos em
[`docs/neon-readonly-role.md`](docs/neon-readonly-role.md). **Falta aplicar à
mão**: criar a role no console Neon e trocar a `DATABASE_URL` do Railway para ela
(precisa de acesso ao console Neon + Railway). Após trocar e validar a env var,
marcar como concluído.

## Estrutura

```
services/quant/
  app/
    main.py            entrypoint FastAPI (monta routers)
    schemas.py         contrato HTTP (Pydantic) do /screening e /backtest
    routers/
      health.py        GET /health (liveness, não toca no banco)
      screening.py     POST /screening (orquestra: banco → núcleo puro → payload)
      backtest.py      POST /backtest (orquestra: banco → núcleo puro → payload)
    core/
      config.py        config tipada (pydantic-settings, lê DATABASE_URL)
      db.py            conexão Postgres SOMENTE LEITURA
    quant/
      options_math.py  CÓPIA PARALELA do lib/options-math (TS) — §18, puro
      liquidez.py      CÓPIA PARALELA do lib/liquidez.ts — filtro de liquidez
      screening.py     núcleo do screening (varredura + ranking), PURO
      backtest.py      núcleo do backtest (mark-to-market diário), PURO
      dados.py         acesso de LEITURA (watchlist/opcao_cotahist/acao_cotahist)
  tests/
    test_options_math.py    casos numéricos do §18 (espelham os testes do TS)
    test_liquidez.py        filtro de liquidez
    test_screening.py       geração, liquidez, ranking, capital
    test_db_readonly.py     conexão read-only / sem SQL de escrita
    test_screening_router.py  endpoint POST /screening (banco mockado)
    test_backtest.py        núcleo do backtest (payoff/look-ahead/dados/perf)
    test_backtest_router.py   endpoint POST /backtest (banco mockado)
    test_health.py          sobe o app e bate no /health
  Dockerfile           imagem de produção (uv + Python 3.12)
  pyproject.toml       deps + config do pytest
  .env.example         template de variáveis (sem valores reais)
```

## Superfície de IV — adiada (Fase 3)

Prevista na Fase 3, a **superfície de IV** foi **adiada** (não descartada).
Implementar quando o usuário começar a operar **calendários/diagonais** —
estruturas cuja tese depende da relação de IV entre vencimentos. Até lá, o IV Rank
+ skew já cobrem as decisões; a fronteira de leitura (`iv_history`) já está
reservada em `dados.py`/`db.py` para essa implementação futura.
