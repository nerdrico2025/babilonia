# OpLab REST API — Contrato Confirmado

> Fonte: documentação oficial https://apidocs.oplab.com.br/ (raspada em 2026-06-15) e client oficial `oplab-team/oplab-client-python`.
> Status de teste: **não testado ao vivo** — não temos `Access-Token` do plano PRO. Ver seção "Pendências".

## Visão geral

- **Base URL:** `https://api.oplab.com.br/v3`
- A API divide-se em **Domain** (dados do usuário: portfólios, ordens, watchlists) e **Market** (dados de mercado: cotações, séries de opções, taxas de juros, instrumentos). Para o Babilônia só usamos **Market**.
- **Acesso:** disponível **somente no plano PRO** do OpLab (segundo material de marketing; a doc técnica não restringe por rota, mas o erro `403 Forbidden` é retornado quando o plano não cobre o recurso).

## Autenticação

Toda requisição é *stateless*. Envie a chave em **uma** das formas:

| Forma | Como |
|-------|------|
| Header (recomendado) | `Access-Token: {access-token}` |
| Query string | `?access_token={access-token}` |

A chave é obtida em https://go.oplab.com.br/api ou via `GET /v3/domain/users/authorize`.

```bash
curl -i -X GET 'https://api.oplab.com.br/v3/market/quote?tickers=PETR4' \
  -H 'Access-Token: SEU_TOKEN'
```

## Rate limit / cota

A doc oficial **não publica números** de rate limit. Ela apenas define os códigos:

- `429 Too Many Requests` — "Requisição repetitiva. O dado já está sendo processado, aguarde."
- `503 Service Unavailable` — "Não foi possível processar a requisição no momento, aguarde."
- `402 Payment Required` — assinatura expirada.
- `403 Forbidden` — plano não cobre o recurso (precisa de upgrade).

> ⚠️ Fontes secundárias (resumos de busca) citam **50 req/s → 503** e **100 req/min → 429**, mas **não consegui confirmar esses números na doc oficial**. Tratar como não confirmado até validar com token real.

---

## Endpoints que vamos usar

### 1. Cotação de instrumentos — `GET /market/quote`

Cotação simples (ação ou opção) por lista de tickers.

- **Parâmetros (query):** `tickers` (obrigatório, separados por vírgula) — ex.: `tickers=PETR4,PETRE100`
- **Response (array):**

```json
[
  {
    "symbol": "PETR4", "close": 29.32, "strike": 0, "variation": -1.18,
    "volume": 93745300, "financial_volume": 2735250760,
    "bid": 29.31, "ask": 29.32, "bid_volume": 2900, "ask_volume": 200,
    "time": 1664393428685, "open": 29.67, "high": 29.82, "low": 28.58
  }
]
```

Campos: `symbol`, `close`, `strike`, `variation`, `volume`, `financial_volume`, `bid`, `ask`, `bid_volume`, `ask_volume`, `time` (epoch ms), `open`, `high`, `low`.

---

### 2. Cadeia de opções (lista plana) — `GET /market/options/{symbol}`

Lista **todas as opções** de um ativo-objeto. `{symbol}` = ação (ex.: `PETR4`).

- **Parâmetros (path):** `symbol` (obrigatório).
- **Response (array)** — campos por opção:

```json
[
  {
    "symbol": "PETRE100", "name": "PETROBRAS ON R$ 9.21 21-05-2021",
    "open": 0, "high": 0, "low": 0, "close": 0, "volume": 0,
    "financial_volume": 0, "trades": 0, "bid": 0.02, "ask": 0,
    "category": "CALL", "due_date": "2021-05-21", "maturity_type": "AMERICAN",
    "strike": 9.21, "contract_size": 100, "exchange_id": "BOVESPA",
    "created_at": "2021-05-07T22:03:01.160Z", "updated_at": "2021-05-07T22:03:01.160Z",
    "variation": 0, "spot_price": 23.93, "isin": "BRPETR3E05L7",
    "security_category": 7, "market_maker": false,
    "block_date": "2021-05-20T00:00:00.000Z", "days_to_maturity": 10,
    "cnpj": "33000167000101", "bid_volume": 0, "ask_volume": 0,
    "time": 1620423900000, "type": "CALL", "last_trade_at": 1620438635404,
    "strike_eod": 9.21
  }
]
```

Campos relevantes: `symbol`, `type`/`category` (CALL/PUT), `due_date`, `maturity_type` (AMERICAN/EUROPEAN), `strike`, `contract_size`, `bid`/`ask`, `bid_volume`/`ask_volume`, `volume`, `financial_volume`, `trades`, `spot_price`, `days_to_maturity`, `variation`, `last_trade_at`.

> ⚠️ **Esta rota NÃO retorna gregas, IV nem open interest.** Só preço/volume/strike/vencimento.

---

### 3. Cadeia estruturada por série/strike — `GET /market/instruments/series/{symbol}`

Melhor formato para montar a **grade de strikes (call/put lado a lado)**. Traz dados do ativo-objeto + array `series[].strikes[].call/put`.

- **Parâmetros (path):** `symbol` (ação).
- **Response (objeto):** dados do ativo incluem `iv_current`, `ewma_current`, `stdv_1y`, `beta_ibov`, `short_term_trend`, `middle_term_trend`, e:

```json
{
  "symbol": "PETR4", "name": "PETROBRAS PN N2", "close": 27.15,
  "iv_current": 54.08, "ewma_current": 59.57, "beta_ibov": 1.128,
  "series": [
    {
      "due_date": "2022-11-18", "days_to_maturity": 6, "call": "K", "put": "W",
      "strikes": [
        {
          "strike": 5.77,
          "call": { "symbol": "PETRK221", "close": 21.9, "bid": 0.01, "ask": 0,
                    "volume": 100, "financial_volume": 2190, "maturity_type": "AMERICAN",
                    "contract_size": 100, "category": "CALL", "strike": 5.77 },
          "put":  { "symbol": "PETRW221", "close": 0, "bid": 0, "ask": 0.01,
                    "volume": 0, "maturity_type": "EUROPEAN", "category": "PUT", "strike": 5.77 }
        }
      ]
    }
  ]
}
```

> ⚠️ Por opção (dentro de `strikes`) **também não há gregas/IV por opção nem open interest**. IV vem agregada no ativo (`iv_current`).

---

### 4. IV, IV Rank, IV Percentile (no ativo-objeto) — `GET /market/stocks` e `GET /market/instruments/{symbol}`

É **aqui** que mora IV Rank/Percentile — a nível de **ativo-objeto** (a ação), não por opção.

- `GET /market/stocks` — params: `rank_by`, `sort`, `limit`, `financial_volume_start` (todos opcionais).
- `GET /market/instruments/{symbol}` — objeto único do instrumento.

Campos de volatilidade retornados no objeto da ação:

| Campo | Descrição |
|-------|-----------|
| `iv_current` | Volatilidade implícita atual |
| `iv_1y_rank` | **IV Rank** (classificação) em 1 ano |
| `iv_1y_percentile` | IV percentil em 1 ano |
| `iv_1y_max` / `iv_1y_min` | IV máx/mín em 1 ano |
| `iv_6m_rank` / `iv_6m_percentile` / `iv_6m_max` / `iv_6m_min` | idem em 6 meses |
| `ewma_current` | Volatilidade EWMA atual |
| `ewma_1y_rank` / `ewma_1y_percentile` / `ewma_1y_max` / `ewma_1y_min` | EWMA histórica 1 ano |
| `ewma_6m_*` | EWMA histórica 6 meses |
| `stdv_1y` / `stdv_5d` | desvio-padrão dos retornos |
| `garch11_1y` | volatilidade GARCH(1,1) 1 ano |
| `beta_ibov`, `correl_ibov` | beta / correlação com IBOV |
| `has_options` | tem opções listadas |
| `oplab_score` | objeto de score fundamentalista |
| `highest_options_volume_rank` | ranking de maior volume de opções (D-1) |

> ✅ **IV Rank/Percentile NÃO precisam ser calculados por nós** — o OpLab entrega `iv_1y_rank`/`iv_1y_percentile`/`iv_6m_rank`/`iv_6m_percentile` prontos no nível do ativo.

---

### 5. Gregas, IV por opção, preço teórico, PoE — `GET /market/options/bs` (calculadora Black-Scholes)

As **gregas e a IV por opção NÃO vêm prontas** na cadeia ao vivo. Esta é uma **calculadora**: você passa a taxa de juros e parâmetros, e ela devolve as gregas.

- **Parâmetros (query):**
  - `symbol` (obrigatório) — código da opção
  - `irate` (obrigatório) — taxa de juros (%) — usar `GET /market/interest_rates` (SELIC)
  - `type` (CALL/PUT — obrigatório se `symbol` não informado)
  - `spotprice` (default 0), `strike` (default 0), `premium` (default 0), `dtm` (dias p/ vencimento, default 0), `vol` (volatilidade %, default 0), `duedate` (date), `amount` (default 0)
- **Response (objeto):**

```json
{
  "moneyness": "OTM", "price": 0.0317, "delta": 0.03, "gamma": 0.0254,
  "vega": 0.0033, "theta": -0.0096, "rho": 0.0003, "volatility": 0,
  "poe": 2.37, "spotprice": 24.06, "strike": 30, "margin": 3000
}
```

Campos: `moneyness` (OTM/ITM/ATM), `price` (preço teórico BS), `delta`, `gamma`, `vega`, `theta`, `rho`, `volatility` (IV), `poe` (probabilidade de exercício), `spotprice`, `strike`, `margin`.

---

### 6. Histórico de opções com gregas — `GET /market/historical/options/{spot}/{from}/{to}`

Esta rota **SIM** traz gregas + IV + PoE + preço BS por opção, mas **historicamente** (não tempo real).

- **Parâmetros:** path `spot` (ativo), `from`, `to` (YYYY-MM-DD); query `symbol` (opcional, filtra uma opção).
- **Response (array):**

```json
[
  {
    "symbol": "PETRA230", "time": "2021-05-17T00:00:00.000Z",
    "spot": { "price": 26.66, "symbol": "PETR4" },
    "type": "CALL", "due_date": "2023-01-20T00:00:00.000Z",
    "strike": 22.21, "premium": 8.85, "maturity_type": "AMERICAN",
    "days_to_maturity": 438, "moneyness": "ITM",
    "delta": 0.75, "gamma": 0.0192, "vega": 0.1128, "theta": -0.007,
    "rho": 0.1916, "volatility": 47.438, "poe": 51.39, "bs": 8.85
  }
]
```

Campos: `delta`, `gamma`, `vega`, `theta`, `rho`, `volatility` (IV), `poe`, `bs` (preço teórico), além de `premium`, `strike`, `moneyness`, `days_to_maturity`.

---

### 7. Apoio

- `GET /market/interest_rates` → `[{ "uid": "SELIC", "name": "Taxa Selic", "value": 3.40, "updated_at": "..." }]` (também `CETIP`/Taxa DI). Necessário para alimentar `irate` no BS.
- `GET /market/instruments/search?expr=PETR&limit=10&type=STOCK,OPTION&has_options=true&add_info=true` — busca/autocomplete. Com `add_info=true` o retorno inclui `close`, `variation`, `volume`, `iv_current`, `iv_1y_rank`, `iv_1y_percentile`.
- `GET /market/options/details/{symbol}` — detalhe de uma opção (mesmos campos do item 2, sem gregas).
- `GET /market/options/strategies/covered?underlying=PETR4,ABEV3` — opções com strike ≤ preço (lançamentos cobertos).
- `GET /market/options/powders` — "pozinhos" (opções de baixo prêmio); inclui `spot-volatility`, `ewma_current`, `series_id`/`series_name`.
- `GET /market/historical/{symbol}/{resolution}?amount=&from=&to=&fill=business_days` — candles históricos do ativo.

---

## Códigos de erro (oficiais)

`400` parâmetro inválido · `401` token ausente/inválido · `402` assinatura expirada · `403` plano não cobre o recurso · `404` rota não encontrada · `412`/`422` falha de processamento · `429` requisição repetitiva/em processamento · `500` erro servidor · `503` indisponível.

## ⚠️ Dados que o PRD pode assumir, mas o OpLab NÃO fornece direto

1. **Open Interest / contratos em aberto** — **NÃO EXISTE** em nenhum endpoint da API. Só há `volume` (negócios do dia), `financial_volume`, `bid_volume`, `ask_volume` e `trades`. Se o PRD depende de OI, precisamos de outra fonte (B3/UP2DATA) ou remover o requisito.
2. **Gregas/IV por opção em tempo real** — não vêm prontas na cadeia ao vivo. Opções:
   - calcular via `GET /market/options/bs` (1 chamada por opção, passando `irate` e `vol`), ou
   - usar o histórico (`/market/historical/options/...`) que já traz gregas, mas com defasagem (não é tempo real).
3. **IV Rank por opção** — só existe IV Rank no **ativo-objeto** (`iv_1y_rank`/`iv_6m_rank`). Não há IV Rank por contrato.
