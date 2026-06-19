# brapi.dev API — Contrato Confirmado

> ⚠️ **HISTÓRICO (2026-06-19): o brapi saiu de cogitação e o `lib/integrations/brapi.ts`
> foi removido.** Fundamentos passaram para a **bolsai** (`docs/migracao-fundamentos.md`),
> preço do objeto para **COTAHIST EOD** (`acao_cotahist`) e proventos/resultados são
> **manuais**. Este documento fica só como registro da avaliação anterior — não
> reintroduzir o brapi.

> Fonte: documentação oficial https://brapi.dev/docs/acoes e https://brapi.dev/pricing (raspadas em 2026-06-15).
> Status de teste: **não testado ao vivo com token nosso**. Os tickers de teste (PETR4, VALE3, ITUB4, MGLU3) funcionam sem token. Campos do `quote` confirmados pelo exemplo oficial; estrutura de dividendos/fundamentos validada por presença dos nomes na doc (ver "Confiança").

## Visão geral

- **Base URL:** `https://brapi.dev/api`
- Cotações da B3 (ações, FIIs, BDRs), além de cripto, moedas e indicadores. Maioria dos endpoints aceita múltiplos ativos por vírgula (`PETR4,VALE3,MGLU3`).

## Autenticação

| Forma | Como |
|-------|------|
| Header (recomendado) | `Authorization: Bearer SEU_TOKEN` |
| Query string | `?token=SEU_TOKEN` |

Tickers de teste (`PETR4`, `VALE3`, `ITUB4`, `MGLU3`) respondem sem token. Demais ativos exigem token.

## Rate limit / cotas (plano)

A doc **não publica rate limit por minuto/segundo** explicitamente (há código `429` na resposta). Cotas por plano:

| Plano | Custo | Req/mês | Ativos/req | Atualização | Histórico | Dividendos | Fundamentos |
|-------|-------|---------|-----------|-------------|-----------|------------|-------------|
| **Teste (sem token)** | grátis | — | só 4 tickers¹ | 5 min | 2 anos | ✓ | ✓ (módulos) |
| **Free (com token)** | grátis | 15.000 | 1 | 30 min (atraso) | 3 meses | ✗ | ✗ |
| Startup | ~R$ 99,99/mês | 150.000 | 10 | 15 min | até 1 ano | ✓ | ✓ |
| Pro | ~R$ 116,66/mês | 500.000 | 20 | 5 min | 10+ anos | ✓ | ✓ |

¹ Tickers de teste com acesso completo e sem token: **PETR4, MGLU3, VALE3, ITUB4** (qualquer mistura com outro ticker passa a exigir token).

> ⚠️ **Implicação para o Babilônia:** o plano **Free com token cobre só cotação** — **não** entrega dividendos nem fundamentos e o histórico é de 3 meses, com atraso de 30 min e 1 ticker por request. Para usar §6.1 (proventos + fundamentos) em qualquer ticker é preciso o **Startup pago** ou uma fonte alternativa de fundamentos/dividendos.
> Existe `429 Too Many Requests` no envelope de erro — confirmar limite por minuto com teste real.

---

## Endpoints que vamos usar

### 1. Cotação + histórico + fundamentos — `GET /api/quote/{tickers}`

Endpoint principal. `{tickers}` separados por vírgula (ex.: `PETR4,VALE3`).

**Parâmetros (query):**

| Param | Obrig. | Descrição |
|-------|--------|-----------|
| `range` | não | Período do histórico: `1d,5d,1mo,3mo,6mo,1y,2y,5y,10y,ytd,max` |
| `interval` | não | Granularidade: `1m,2m,5m,15m,30m,60m,90m,1h,1d,5d,1wk,1mo,3mo` |
| `fundamental` | não | `true`/`false` — inclui dados fundamentalistas resumidos no objeto |
| `dividends` | não | `true`/`false` — inclui histórico de dividendos e JCP |
| `modules` | não | Módulos adicionais separados por vírgula (ver lista abaixo) |
| `token` | não | Token (alternativa ao header `Authorization`) |
| `startDate`/`endDate` | não | Faixa de datas do histórico (YYYY-MM-DD) |

**Exemplo de request:**
```bash
curl -X GET "https://brapi.dev/api/quote/PETR4,VALE3?range=1mo&interval=1d&fundamental=true&dividends=true" \
  -H "Authorization: Bearer SEU_TOKEN"
```

**Response (cotação) — campos confirmados pelo exemplo oficial:**
```json
{
  "results": [
    {
      "symbol": "PETR4",
      "shortName": "PETR4",
      "longName": "Petroleo Brasileiro SA Pfd",
      "currency": "BRL",
      "regularMarketPrice": 36.65,
      "regularMarketDayHigh": 37.27,
      "regularMarketDayLow": 36.45,
      "regularMarketDayRange": "36.45 - 37.27",
      "regularMarketChange": -0.35,
      "regularMarketChangePercent": -0.95,
      "regularMarketTime": "2026-02-08T16:24:54.000Z",
      "marketCap": 483937892568,
      "regularMarketVolume": 27681100,
      "regularMarketPreviousClose": 36.7,
      "regularMarketOpen": 37.21,
      "fiftyTwoWeekRange": "28.86 - 38.66",
      "fiftyTwoWeekLow": 28.86,
      "fiftyTwoWeekHigh": 38.66,
      "priceEarnings": 6.09,
      "earningsPerShare": 6.01,
      "logourl": "https://icons.brapi.dev/icons/PETR4.svg"
    }
  ],
  "requestedAt": "2026-02-08T16:25:28.170Z",
  "took": 3
}
```

Envelope: `results[]`, `requestedAt`, `took`. Campos de preço acima são os que vamos consumir para cotação.

**Histórico (`range`/`interval`):** adiciona ao objeto o array `historicalDataPrice[]` com `date` (epoch), `open`, `high`, `low`, `close`, `volume`, `adjustedClose`.

**Dividendos (`dividends=true`):** adiciona `dividendsData` com:
```json
"dividendsData": {
  "cashDividends": [
    { "assetIssued": "BRPETRACNPR6", "paymentDate": "2026-05-20", "rate": 0.95,
      "relatedTo": "1º trimestre 2026", "approvedOn": "2026-05-08",
      "isinCode": "BRPETRACNPR6", "label": "DIVIDENDO" }
  ],
  "stockDividends": [],
  "subscriptions": []
}
```
Campos por item: `assetIssued`, `paymentDate`, `rate`, `relatedTo`, `approvedOn`, `isinCode`, `label`.

---

### 2. Fundamentos (módulos) — `GET /api/quote/{tickers}?modules=...`

Valores de `modules` confirmados como presentes na doc:

| Módulo | Conteúdo |
|--------|----------|
| `summaryProfile` | Perfil da empresa (setor, indústria, descrição) |
| `defaultKeyStatistics` | Estatísticas-chave (múltiplos, valuation) |
| `financialData` | Dados financeiros atuais (margens, dívida, caixa) |
| `balanceSheetHistory` | Balanço patrimonial anual |
| `balanceSheetHistoryQuarterly` | Balanço trimestral |
| `incomeStatementHistory` | DRE anual |
| `incomeStatementHistoryQuarterly` | DRE trimestral |
| `cashflowHistory` | Fluxo de caixa |

Exemplo:
```bash
curl -X GET "https://brapi.dev/api/quote/PETR4?modules=summaryProfile,financialData,balanceSheetHistory" \
  -H "Authorization: Bearer SEU_TOKEN"
```

---

### 3. Lista de ativos / busca — `GET /api/quote/list`

Lista/screening de ativos com paginação e ordenação. Útil para popular tickers e busca.

**Parâmetros (query, todos opcionais):** `search`, `sortBy` (ex.: `volume`, `market_cap_basic`, `change`), `sortOrder` (`asc`/`desc`), `limit`, `page`, `type` (`stock`/`fund`/`bdr`), `sector`.

Retorna `stocks[]` com `stock` (ticker), `name`, `close`, `change`, `volume`, `market_cap`, `logo`, `sector`, e metadados de paginação.

---

### 4. Disponíveis — `GET /api/available?search=`

Retorna lista de todos os tickers válidos (`stocks[]`, `indexes[]`) para validação/autocomplete.

---

## Códigos de erro

Envelope: `{ "error": true, "message": "...", "code": "..." }`. Códigos: `400 BAD_REQUEST`, `401 UNAUTHORIZED`, `403 FORBIDDEN`, `404 NOT_FOUND`, `429` (too many requests), `500`.

## Confiança dos dados deste doc

- ✅ **Confirmado pelo exemplo oficial:** todos os campos de cotação do item 1, parâmetros de query, envelope (`results`/`requestedAt`/`took`), códigos de erro.
- ✅ **Confirmado por presença na doc** (nomes existem na página `/docs/acoes`): `dividendsData`, `cashDividends`, `summaryProfile`, `defaultKeyStatistics`, `financialData`, `balanceSheetHistory`, `incomeStatementHistory`, `historicalDataPrice`, `modules`.
- ⚠️ **A confirmar ao vivo:** nomes exatos dos sub-campos dentro de `cashDividends` (segue o schema v2 público do brapi) e a estrutura interna de cada módulo de fundamentos. brapi.dev estava instável (502/504) no momento da coleta; rodar uma chamada real com token assim que disponível para fechar 100%.

## ⚠️ Dados que o PRD pode assumir, mas o brapi NÃO fornece direto

1. **Calendário de RESULTADOS (datas de divulgação de balanços / earnings date)** — o brapi **não tem** endpoint de calendário de resultados futuros. Há histórico de DRE (`incomeStatementHistory*`) e datas de dividendos (`paymentDate`/`approvedOn`), mas **não** uma agenda de datas de divulgação de resultados. Se o PRD precisa disso, buscar outra fonte (RI das empresas, B3, Status Invest) ou derivar de padrão trimestral.
2. **Calendário de proventos FUTUROS completo** — `dividendsData` traz proventos já anunciados/aprovados (com `paymentDate` futura quando já declarado), mas não projeta proventos não anunciados.
3. **Cota gratuita ilimitada** — fora os 4 tickers de teste, tudo exige token de plano pago.
