# PRD — Babilônia

**Documento de Requisitos de Produto (Product Requirements Document)**
Versão 1.0 — preparado para desenvolvimento assistido com **Cursor + Claude Code**

> **Aviso de produto:** O Babilônia é uma ferramenta pessoal de *análise e montagem* de operações com opções. Ele **não é consultoria de investimentos**, **não emite recomendações personalizadas** e **não executa ordens**. Todas as ordens são digitadas manualmente pelo usuário no home broker. O app apresenta cenários e estruturas; a decisão final é sempre do usuário.

---

## 1. Visão geral

### 1.1 O que é
O **Babilônia** é um web app pessoal, hospedado na nuvem, para **analisar e montar operações exclusivamente com OPÇÕES** do mercado brasileiro (B3). Ele reúne, num só lugar, os dados que hoje estão espalhados entre home broker, sites de cotação e plataformas de opções, e entrega ao usuário:

1. Análise de um ativo-objeto (técnica + fundamentalista + volatilidade).
2. Visualização da cadeia de opções com gregas e IV.
3. Um **montador de estruturas** (travas, borboletas, condores, straddle/strangle, venda coberta) com **payoff visual** e cálculo de risco/retorno/breakeven.
4. **Checagem automática de gestão de risco e capital**.
5. Geração de um **TICKET DE OPERAÇÃO** padronizado, pronto para copiar e digitar no home broker.

### 1.2 Problema que resolve
Operar opções como iniciante exige cruzar muita informação (preço, IV, gregas, vencimento, liquidez, fundamentos) e traduzir isso em uma estrutura com risco controlado. Hoje isso é manual, propenso a erro e intimidador. O Babilônia **organiza, calcula e explica** — em linguagem simples — para que o usuário decida com clareza e digite a ordem certa.

### 1.3 Usuário
- **Único usuário** (o próprio dono do projeto).
- Opera **exclusivamente opções** (não opera ações à vista).
- **Iniciante / leigo em opções** — a linguagem e a interface devem ser simples, didáticas e à prova de jargão.
- Executa ordens **manualmente** no home broker.

---

## 2. Princípios de produto (não-negociáveis)

Estes princípios guiam toda decisão de design e implementação. Quando houver conflito, eles têm prioridade.

1. **Para leigos, sempre.** Linguagem em português claro, sem jargão sem explicação. Todo termo técnico (greg­as, IV Rank, skew, breakeven) tem tooltip e/ou link para um glossário. Onde fizer sentido, há um modo "explicar como funciona".
2. **Risco antes do ganho.** Em qualquer tela, ticket ou resumo, o **risco máximo aparece primeiro e com destaque**, antes do potencial de ganho. Toda estrutura é rotulada como **risco DEFINIDO** ou **risco INDEFINIDO**.
3. **Decisão é do usuário.** O app apresenta cenários, nunca "compre" / "venda". Disclaimers visíveis de que não é consultoria.
4. **Dados reais primeiro.** As análises se baseiam nos dados das integrações (brapi.dev para cotação; COTAHIST/B3 para a cadeia; BCB SGS para a taxa) ou colados pelo usuário. Se faltar dado essencial (preço, prêmio, taxa), o app pede explicitamente em vez de inventar — e gregas/IV são **calculadas**, não inventadas (§18.1).
5. **Liquidez importa.** Séries com pouco volume/poucos negócios ou spread largo recebem alerta — porque a ordem precisa ser executável no home broker. ⚠️ Não há open interest na fonte (§6.2/§6.4): liquidez = volume + nº de negócios + spread.
6. **Começar leve, evoluir depois.** Arquitetura simples no MVP, com fronteiras limpas para adicionar cálculo quant pesado (serviço Python) no futuro sem reescrever o app.

---

## 3. Escopo

### 3.1 Dentro do escopo
- Operações **exclusivamente com opções**.
- Análise de ativo-objeto (técnico, fundamentalista, volatilidade).
- Cadeia de opções (fechamento/EOD via COTAHIST/B3) com gregas e IV **calculadas** (§18.1).
- Montagem de estruturas de risco definido e indefinido.
- Cálculo de payoff, risco máximo, ganho máximo e breakeven.
- Regras de gestão de risco e capital (concentração, vencimento).
- Geração de ticket de operação.
- Diário/histórico de operações montadas (book pessoal).
- Modo educativo / glossário.

### 3.2 Fora do escopo (não-objetivos)
- **Operações com ações à vista** — nunca sugeridas nem consideradas.
- **Execução automática de ordens** / integração de roteamento com corretora.
- **Recomendações personalizadas de investimento** ("compre X").
- Multiusuário, planos pagos, área administrativa.
- Backtesting pesado e cálculo de gregas próprias **no MVP** (previsto como evolução — ver §13).

---

## 4. Stack técnica (decidida)

| Camada | Escolha | Motivo |
|---|---|---|
| Frontend + Backend | **Next.js (App Router) + React + TypeScript** | Uma só linguagem, full-stack, ótimo suporte do Claude Code, deploy simples |
| UI / componentes | **Tailwind CSS + shadcn/ui** | UI limpa e acessível, rápida de montar, fácil deixar "para leigos" |
| Gráficos (payoff) | **Recharts** | Simples, declarativo, suficiente para curvas de payoff |
| Lógica de backend | **Route Handlers / Server Actions** do Next.js | Sem servidor separado no MVP |
| Banco de dados | **Postgres gerenciado (Neon)** *(alt.: Supabase)* | Serverless, casa bem com Vercel; Supabase se quiser auth/storage prontos |
| ORM | **Drizzle ORM** | Leve, SQL-first, excelente DX com Claude Code |
| Validação | **Zod** | Validação de dados de API e formulários, tipos seguros |
| Autenticação | **Auth.js (NextAuth)** com credencial única *(alt.: Clerk)* | App mono-usuário; basta proteger o acesso |
| Cache de APIs externas | Tabela de cache no Postgres com TTL no MVP *(upgrade: Upstash Redis)* | brapi tem rate limit; COTAHIST é ingerido em job; cache é obrigatório |
| Hospedagem | **Vercel** | Deploy contínuo, env vars para chaves de API, acesso de qualquer lugar |
| Testes | **Vitest** | Cobrir o módulo `options-math` com casos conhecidos |

### 4.1 Fronteira para evolução (quant em Python)
O cálculo de estruturas fica isolado num módulo `options-math` (TypeScript puro, sem dependência de UI ou banco). Toda integração externa fica numa camada `lib/integrations`. Quando surgir necessidade de quant pesado (backtesting, gregas próprias, screening em toda a cadeia, superfície de IV), extrai-se um **microserviço Python (FastAPI)** consumido via HTTP, **sem tocar na UI**. O MVP não implementa isso, apenas mantém as fronteiras limpas.

---

## 5. Arquitetura

```
┌─────────────────────────────────────────────────────────────┐
│                      Babilônia (Next.js)                     │
│                                                              │
│  app/  (App Router — telas e rotas)                          │
│   ├─ (telas) dashboard, ativo, cadeia, montador, ticket...   │
│   └─ api/   (Route Handlers: proxy + cache das integrações)  │
│                                                              │
│  lib/                                                        │
│   ├─ integrations/                                           │
│   │    ├─ brapi.ts        (cotação do ativo-objeto)          │
│   │    ├─ b3-cotahist.ts  (download/parse da cadeia EOD)     │
│   │    └─ bcb-sgs.ts      (taxa livre de risco — Selic)      │
│   ├─ options-math/      (payoff, risco, breakeven,           │  ← núcleo testável
│   │                      Black-Scholes, IV, gregas)          │
│   ├─ risk-rules/        (regras de capital e concentração)   │
│   └─ ticket/            (geração e formatação do ticket)     │
│                                                              │
│  db/  (Drizzle: schema + migrations)                         │
└─────────────────────────────────────────────────────────────┘
        │                 │                    │
        ▼                 ▼                    ▼
   brapi.dev API   B3 COTAHIST (.ZIP)      BCB SGS API
 (cotação objeto)  (cadeia de opções EOD)  (Selic / risk-free)
        │                 │                    │
        ▼                 ▼                    ▼
        Postgres (Neon) ── cache + cadeia + iv_history + book + tickets
```

### 5.1 Princípios de arquitetura
- **`options-math` é puro e testado.** Recebe parâmetros (strikes, prêmios, quantidades, tipo), devolve números. Sem efeitos colaterais. É o coração do app — não pode ter bug.
- **Integrações sempre via camada própria + cache.** Nenhuma tela chama brapi/COTAHIST/SGS direto; tudo passa por `lib/integrations` com cache e tratamento de erro.
- **Chaves de API só no servidor.** Nunca expor chaves no cliente. As rotas `api/` atuam como proxy.

---

## 6. Integrações externas

> **Status:** ✅ Contratos confirmados em `docs/apis/`: **`brapi.md`** (cotação), **`b3-cotahist.md`** (cadeia de opções EOD) e **`bcb-sgs.md`** (taxa livre de risco). Desenho do motor de gregas/IV em **`docs/design/options-math-black-scholes.md`**. ⚠️ **`docs/apis/oplab.md` é histórico** — a OpLab saiu de cogitação em 2026-06-16 (ver §6.2); o doc fica como registro da avaliação. Lacunas marcadas com ⚠️ abaixo e em §6.4.

### 6.1 brapi.dev — cotações (atualizado)

**Decisão de produto (2026-06-15):** o Babilônia usa o **brapi Free (com token)** apenas para **cotação do ativo-objeto** (preço, variação, volume). Fundamentos (P/L, EV/EBITDA, P/VP, margens, lucros por trimestre, dividend yield) e calendário de proventos/resultados **não são buscados automaticamente no MVP** — o usuário **cola esses dados manualmente** na tela de Análise de ativo (§8.2), conforme o princípio "dados reais primeiro, sem inventar" (§2, item 4). O upgrade para o plano **Startup (~R$ 100/mês)**, que desbloqueia fundamentos e proventos automáticos, fica documentado como **evolução opcional (Fase 2, §15)** — sem mudança de arquitetura, já que `lib/integrations/brapi.ts` isola essa fonte.

- **Base URL:** `https://brapi.dev/api` · **Auth:** header `Authorization: Bearer TOKEN` (ou `?token=`).
- **Endpoint usado no MVP:** `GET /api/quote/{ticker}?token=...` — preço atual (`regularMarketPrice`), variação (`regularMarketChange`/`regularMarketChangePercent`), volume (`regularMarketVolume`). **1 ticker por request** (limite do plano Free). Envelope: `results[]`, `requestedAt`, `took`.
- **Cache:** TTL curto (minutos). O plano Free já entrega dados com **atraso de ~30 min**, então cache agressivo ajuda e não prejudica. Cota de **15.000 req/mês** no Free — folgada para uso mono-usuário com cache.

**Não implementado no MVP (input manual no §8.2):**
- Fundamentos: P/L, EV/EBITDA, P/VP, margens, lucros por trimestre, dividend yield.
- Calendário de proventos.
- ⚠️ Calendário de **resultados** (brapi não fornece em nenhum plano — ver §6.4).

**Evolução futura (Fase 2, opcional):** migrar para **brapi Startup** para automatizar fundamentos/proventos, **sem alterar a UI** — apenas trocar a implementação interna de `lib/integrations/brapi.ts`. Endpoints prontos para esse upgrade (documentados em `docs/apis/brapi.md`): `?fundamental=true`, `?modules=summaryProfile,defaultKeyStatistics,financialData,balanceSheetHistory,incomeStatementHistory,incomeStatementHistoryQuarterly,cashflowHistory` e `?dividends=true` (`dividendsData.cashDividends[]`).

### 6.2 Cadeia de opções, gregas e volatilidade — COTAHIST (B3) + BCB SGS + Black-Scholes próprio

> **Decisão de produto (2026-06-16):** a **OpLab saiu de cogitação** (assinatura
> cara, sem plano gratuito equivalente via API). A cadeia de opções passa a vir
> dos arquivos públicos **COTAHIST da B3** (cotação de **fechamento do dia / EOD**)
> e **gregas, IV e IV Rank são calculados por nós** com um Black-Scholes próprio em
> `lib/options-math`, usando a taxa livre de risco do **BCB SGS**. EOD é suficiente
> porque o app **não opera day trade** (monta no fechamento; o usuário digita a
> ordem manualmente no pregão seguinte). Contratos detalhados em
> **`docs/apis/b3-cotahist.md`**, **`docs/apis/bcb-sgs.md`** e o desenho do motor em
> **`docs/design/options-math-black-scholes.md`**.

- **Fonte da cadeia — COTAHIST (B3):** arquivo texto largura-fixa, 245 bytes/registro.
  Filtrar `TIPREG=01` + `TPMERC ∈ {070=CALL, 080=PUT}`. Campos usados: `CODNEG`
  (ticker da opção), `NOMRES` (linka ao objeto), `DATAPREGAO`, `PREEXE` (strike),
  `DATVEN` (vencimento), preços `PREABE/PREMIN/PREMED/PREMAX/PREULT` (fechamento),
  `PREOFC`/`PREOFV` (bid/ask → spread), `VOLTOT`, `QUATOT`, `TOTNEG` (liquidez),
  `FATCOT`. O preço **spot** do ativo-objeto sai do registro à vista (`TPMERC=010`)
  do mesmo pregão. **Download automático por URL direta** (anual p/ backfill, diário
  p/ incremental), com **fallback manual** (formulário com captcha) — detalhes em
  `b3-cotahist.md`.
- **Gregas (delta/gamma/theta/vega) e IV por opção — CALCULADAS por nós.** Não há
  fonte pronta: a partir do prêmio de fechamento (`PREULT`), do spot, do strike, do
  prazo (base 252) e da taxa livre de risco, `lib/options-math/black-scholes.ts`
  resolve a **IV implícita** (Newton-Raphson + bisseção) e deriva as gregas. Modelo
  **europeu, sem dividendos** no MVP (simplificação consciente; revisão na Fase 3 —
  ver §18 e o design doc).
- **Taxa livre de risco — BCB SGS, série `432` (Meta Selic Copom, % a.a.).** Sem
  autenticação. Substitui o antigo `interest_rates` da OpLab. Justificativa da
  escolha (vs. séries 11/12 diárias e 1178) em `bcb-sgs.md`.
- **IV representativa por ativo-objeto:** média da IV das opções **ATM** do
  vencimento de **menor prazo com liquidez mínima**, por pregão (definição precisa
  no design doc).
- **IV Rank / Percentil — calculados por nós sobre 252 pregões**, via **job de
  backfill retroativo único** (para funcionarem desde o primeiro uso) + atualização
  diária. Exige a nova tabela **`iv_history`** (§7).
- ⚠️ **OPEN INTEREST (contratos em aberto) NÃO existe no COTAHIST** — só `VOLTOT`,
  `QUATOT` e `TOTNEG` (do dia). Mesmo gap que a OpLab tinha (§6.4 item 1): liquidez
  fica baseada em **volume + número de negócios + spread** (§8.3, §9, §11).
- **Cache/ingestão:** COTAHIST é processado em job (stream, filtrando antes de
  persistir); a leitura da cadeia sai do Postgres, não de chamada externa por
  request. SGS cacheado com TTL longo. Falha de download degrada com aviso (§6.3).

### 6.3 Estratégia de cache e rate limit
- Toda resposta de API é cacheada com TTL por tipo de dado.
- Se a cota estourar ou a API falhar, a tela mostra o dado em cache com aviso de "dado de HH:MM" + opção de forçar atualização.
- Erros de rede/cota nunca derrubam a tela; degradam graciosamente.

### 6.4 ⚠️ Lacunas confirmadas (o PRD assumia, mas a API NÃO entrega)

Itens que precisam de decisão de produto/arquitetura antes da implementação:

| # | O que o PRD assume | Realidade da API | Impacto | Encaminhamento sugerido |
|---|--------------------|------------------|---------|--------------------------|
| 1 | **Open interest por série** (§6.2, §8.3, §9, §11) para o filtro de liquidez | **COTAHIST não fornece OI** (nem a OpLab fornecia). Só `VOLTOT`, `QUATOT`, `TOTNEG` (do pregão). | Filtro de liquidez fica sem OI | **Resolvido por decisão (§6.2):** liquidez baseada em **volume + número de negócios + spread bid/ask**. OI fica para fase futura (fonte B3/UP2DATA paga), sem mudar arquitetura. |
| 2 | **Gregas "já calculadas"** na cadeia (§6.2, §8.3) | Nenhuma fonte gratuita entrega gregas prontas. | Cadeia precisa de gregas | **Resolvido por decisão (§6.2/§18.1):** gregas/IV **calculadas por nós** em `lib/options-math/black-scholes.ts` a partir do fechamento (COTAHIST) + Selic (BCB SGS). |
| 3 | **IV Rank/percentil** disponível (§6.2, §8.2, §8.3) | Sem fonte pronta após sair a OpLab. | Leitura de volatilidade (§8.2) precisa do IV Rank | **Resolvido por decisão (§6.2/§18.1):** IV representativa por pregão + IV Rank/Percentil calculados sobre 252 pregões, via **backfill retroativo** na tabela `iv_history`. |
| 4 | **Calendário de resultados** (datas de divulgação de balanço) (§6.1, §8.2, §9, §11 "Eventos próximos: resultados em __") | **brapi não tem agenda de resultados futuros** em nenhum plano. Só histórico de DRE e datas de proventos já anunciados. | Alerta "resultados próximos" não tem fonte automática | **Resolvido por decisão (§6.1):** data de resultado é **input manual** do usuário no MVP. Fonte externa/inferência fica para evolução. |
| 5 | Fundamentos e proventos automáticos (EV/EBITDA, P/VP, dividend yield, calendário) (§6.1, §8.2) | Disponíveis no brapi, mas **só nos planos pagos** (Startup+). EV/EBITDA e P/VP podem ainda precisar ser derivados dos módulos. | Custo (~R$ 100/mês) | **Resolvido por decisão (§6.1):** no MVP o usuário **cola fundamentos/proventos manualmente** (brapi Free). Automatização opcional na Fase 2 via brapi Startup, sem mudar a UI. |

> Dois campos ficaram "a confirmar ao vivo" por instabilidade do brapi.dev (502/504) durante a coleta: os sub-campos exatos de `cashDividends` e a estrutura interna dos módulos de fundamentos. Fechar com 1 chamada real assim que houver token (ver §6.1 de `docs/apis/brapi.md`).

---

## 7. Modelo de dados (MVP)

Entidades principais (Drizzle/Postgres):

- **settings** — configurações do usuário, incluindo **capital total** (base para as regras de risco), preferências de exibição.
- **position** (o "book") — operações montadas/abertas: ativo-objeto, tipo de estrutura, pernas (legs), data de montagem, vencimento, status (aberta/encerrada/rolada), risco máximo, ganho máximo, breakevens.
- **leg** — perna individual de uma estrutura: ticker da opção, call/put, strike, vencimento, compra/venda, quantidade, prêmio.
- **ticket** — tickets gerados (histórico), vinculados a uma position.
- **watchlist** — ativos-objeto acompanhados.
- **iv_history** — IV representativa por ativo-objeto por pregão (`ativo`, `data_pregao`, `iv_representativa`, `prazo_dias`, `vencimento`, `n_opcoes`, `fonte`). Base para IV Rank/Percentil (252 pregões), populada por backfill retroativo + atualização diária (ver §18.1 e `docs/design/options-math-black-scholes.md`).
- **api_cache** — cache genérico (chave, payload JSON, TTL/expiração) das integrações.

> Quantidades sempre em **lotes/contratos**; preços em BRL. Gregas/IV **calculadas por nós** (Black-Scholes, §18.1) e armazenadas com o **timestamp do pregão (EOD)** que as originou.

---

## 8. Funcionalidades / módulos

### 8.1 Dashboard (book de opções)
- Visão do book aberto: posições, vencimento mais próximo, risco total em aberto.
- **Indicadores de gestão de risco** (ver §10): % de capital em risco, concentração por ativo, concentração por vencimento — com semáforo (verde/amarelo/vermelho).
- **Alertas de vencimento:** posições a ≤5 dias úteis do vencimento destacadas, com sugestão de encerrar ou rolar.

### 8.2 Análise de ativo
Entrada: ticker do ativo-objeto (ou dados colados). Saída organizada em três blocos, em linguagem simples:
- **Técnico:** preço vs. suporte/resistência, médias móveis, RSI/MACD, padrões em zonas-chave, volume. *(Indicadores calculados a partir do histórico ou colados pelo usuário.)*
- **Fundamentalista:** P/L, EV/EBITDA, P/VP, tendência de lucros/margens, dividend yield, calendário de proventos e de **resultados**. *(No MVP, estes dados são **colados manualmente** pelo usuário — o brapi Free não os fornece; ver decisão em §6.1. Automatização fica para a Fase 2 com brapi Startup.)*
- **Volatilidade:** IV atual e **IV Rank/percentil** (alto → favorece estruturas vendidas; baixo → favorece compradas), assimetrias de skew put/call.
- Cada bloco termina com uma leitura em linguagem de iniciante ("IV está alta vs. o histórico — estruturas vendidas tendem a ser favorecidas, mas atenção a resultados próximos").

### 8.3 Cadeia de opções (chain viewer)
- Tabela de calls/puts por vencimento e strike: prêmio (fechamento), delta, gama, theta, vega, IV (calculados — §18.1), volume, nº de negócios. *(Sem open interest — não existe na fonte; §6.2.)*
- **Filtro de liquidez:** destaca/filtra séries com volume/nº de negócios relevantes e spread estreito.
- Seleção de séries direto para o montador.

### 8.4 Montador de estruturas (núcleo)
Wizard guiado, pensado para iniciante. Suporta:
- Trava de alta (débito/crédito)
- Trava de baixa (débito/crédito)
- Borboleta
- Condor
- Straddle (comprado/vendido)
- Strangle (comprado/vendido)
- Venda coberta *(observação: o app trata só a perna de opção; o usuário gerencia o ativo à vista por fora — o Babilônia não opera ações)*

Para cada estrutura, em destaque e nesta ordem:
1. **Risco máximo** + rótulo **DEFINIDO / INDEFINIDO**.
2. Ganho máximo.
3. Ponto(s) de equilíbrio (breakeven).
4. **Gráfico de payoff** (Recharts) ao longo de uma faixa de preços do ativo no vencimento.
5. Explicação em linguagem de iniciante: quando essa estrutura faz sentido, o que pode dar errado.

### 8.5 Gestão de risco e capital
Roda automaticamente ao montar/avaliar qualquer estrutura — ver regras em §10. Bloqueia ou alerta (sem impedir, mas com aviso forte) quando os limites são ultrapassados.

### 8.6 Gerador de ticket de operação
Gera o ticket padronizado (formato em §11), pronto para copiar. Validações: vencimento, liquidez da série, eventos próximos (resultados/dividendos).

### 8.7 Modo educativo / glossário
- Glossário de termos com explicações curtas.
- Tooltips contextuais em toda a interface.
- "O que é uma trava de alta?" e similares, acessível dentro do montador.

---

## 9. Critérios de análise (regras de negócio de análise)

Usados para identificar e justificar oportunidades, sempre apresentados em linguagem de iniciante.

- **Técnicos:** rompimento de resistência/suporte com volume; cruzamento de médias móveis; divergências preço vs. RSI/MACD; padrões de candle em zonas-chave.
- **Volatilidade:** IV em percentil alto vs. histórico → favorece estruturas **vendidas** (travas de crédito, venda coberta); IV em percentil baixo → favorece estruturas **compradas**; assimetrias de skew put/call.
- **Fundamentalista:** valuation (P/L, EV/EBITDA, P/VP); tendência de lucros/margens nos últimos trimestres; dividend yield e calendário de proventos; **calendário de resultados** (IV costuma subir antes da divulgação).
- **Liquidez:** priorizar séries com volume e número de negócios relevantes e spread bid-ask estreito, para garantir execução no home broker. *(Sem open interest na fonte — §6.2/§6.4.)*

---

## 10. Gestão de risco e capital (regras aplicadas a todo ticket)

Estas regras são verificadas automaticamente. O **capital total** vem de `settings`.

- **Risco definido** (travas, borboletas, condores): risco máximo da estrutura **até 5% do capital total**.
- **Risco indefinido** (venda nua, straddle/strangle vendido): margem requerida **até 10% do capital total**; **alertar que o risco real pode superar o prêmio recebido**.
- **Concentração por ativo-objeto:** **máx. 20%** do book de opções aberto.
- **Concentração por vencimento:** **máx. 30%** do book de opções aberto.
- **Proximidade de vencimento:** ao chegar nos **últimos ~5 dias úteis**, alertar para encerrar ou rolar a posição (evitar exercício/atribuição inesperado).

Apresentação: semáforo + texto claro ("Esta operação usaria 7% do seu capital em risco — acima do limite de 5% para risco definido").

---

## 11. Formato do TICKET DE OPERAÇÃO

Gerado ao final de cada montagem/ajuste, pronto para copiar. Estrutura padronizada:

```
═══════════════════════════════════
        TICKET DE OPERAÇÃO
═══════════════════════════════════
Estrutura: [ex.: Trava de Alta com CALLs]
Risco: [DEFINIDO / INDEFINIDO]

RISCO MÁXIMO:  R$ ____   (___% do capital)
GANHO MÁXIMO:  R$ ____
BREAKEVEN(S):  ____

PERNAS:
 1) [Ativo-objeto] | [Ticker exato da opção]
    [Compra/Venda] [Abertura/Encerramento]
    Qtd: ___ contratos
    Tipo de ordem: [Mercado/Limitada/Stop]
    Preço-limite/faixa: R$ ____
    Validade: [Dia / Até cancelar]
 2) ...

STOP DE PERDA: ____      ALVO: ____  (se aplicável)

OBSERVAÇÕES:
 - Vencimento: ____ (faltam __ dias úteis)
 - Liquidez da série: [OK / baixa — atenção]
 - Eventos próximos: [resultados em __ / proventos em __]
═══════════════════════════════════
```

Campos obrigatórios em todo ticket: ativo-objeto e **ticker exato** da opção; compra/venda + abertura/encerramento; quantidade em contratos; tipo de ordem; preço-limite/faixa; validade; stop/alvo se aplicável; observações (vencimento, liquidez, eventos).

---

## 12. Formato de saída das análises (fluxos de resposta)

- **Análise de oportunidade:** contexto (técnico + fundamentalista + volatilidade) → tese → estrutura → risco × retorno → **ticket**.
- **Revisão de operação existente:** o que está montado → situação atual (incl. proximidade do vencimento) → ajustes possíveis → ticket de ajuste (se houver).
- **Tarefa de desenvolvimento:** entender requisito → propor abordagem/arquitetura → implementar → próximos passos.

---

## 13. Requisitos não-funcionais

- **Segurança:** chaves de API (brapi) apenas em env vars no servidor (Vercel); nunca no cliente. (COTAHIST e BCB SGS são públicos, sem chave.) Acesso ao app protegido por login (mono-usuário).
- **Privacidade:** app pessoal; dados do book ficam no Postgres do usuário.
- **Performance:** cache obrigatório das APIs; payoff e cálculos rodam client-side ou em server action, com resposta percebida < 1s.
- **Resiliência:** falha/cota de API degrada para cache com aviso, nunca quebra a tela.
- **Acessibilidade e clareza:** UI legível, linguagem simples, tooltips — coerente com o princípio "para leigos".
- **Disclaimers:** aviso visível e recorrente de que não é consultoria e que a execução é manual e de responsabilidade do usuário.

---

## 14. Telas (wireframe textual)

1. **Login** — acesso único.
2. **Dashboard / Book** — posições, indicadores de risco (semáforo), alertas de vencimento.
3. **Configurações** — capital total, preferências, chaves (se aplicável).
4. **Análise de ativo** — busca por ticker; blocos técnico / fundamentalista / volatilidade.
5. **Cadeia de opções** — tabela com filtro de liquidez; seleção de séries.
6. **Montador de estruturas** — wizard; risco-first; gráfico de payoff; explicações.
7. **Ticket** — preview do ticket gerado + botão copiar; validações.
8. **Histórico / Diário** — tickets e operações passadas.
9. **Glossário / Modo educativo** — termos e explicações.

---

## 15. Roadmap em fases

**Fase 0 — Fundação**
Setup Next.js + TS + Tailwind + shadcn/ui; Drizzle + Postgres (Neon); Auth.js; deploy na Vercel; `CLAUDE.md` do projeto.

**Fase 1 — MVP (núcleo de valor)**
- Camada de integração brapi (cotação) + COTAHIST/B3 (cadeia EOD) + BCB SGS (taxa) com cache/ingestão.
- `options-math` (payoff, risco, retorno, breakeven, **Black-Scholes + IV + gregas**, §18.1) com testes.
- Job de backfill de `iv_history` (IV Rank/Percentil sobre 252 pregões).
- Montador para trava de alta/baixa, borboleta, condor, straddle, strangle, venda coberta.
- Gráfico de payoff + risco-first + rótulo definido/indefinido.
- Regras de risco/capital + alertas de vencimento.
- Gerador de ticket.
- Glossário/tooltips básicos.

**Fase 2 — Análise rica**
- Telas de análise técnica/fundamentalista/volatilidade completas.
- Filtro de liquidez avançado, skew, IV Rank visual.
- Histórico/diário de operações.

**Fase 3 — Evolução quant (opcional)**
- Microserviço Python (FastAPI) para backtesting, gregas próprias, screening de cadeia, superfície de IV — consumido via HTTP, sem mexer na UI.

---

## 16. Critérios de aceite do MVP

- [ ] Usuário faz login e vê o dashboard com o book vazio.
- [ ] App busca cotação (brapi), ingere a cadeia EOD (COTAHIST) e a taxa (BCB SGS), e **calcula gregas/IV** (§18.1) com cache funcionando.
- [ ] Montador calcula corretamente risco máximo, ganho máximo e breakeven para cada estrutura suportada (validado contra casos conhecidos).
- [ ] Gráfico de payoff renderiza coerente com os números.
- [ ] Risco máximo aparece **antes** do ganho, com rótulo DEFINIDO/INDEFINIDO.
- [ ] Regras de risco/capital disparam alertas nos limites (5% / 10% / 20% / 30% / 5 dias úteis).
- [ ] Ticket é gerado no formato padrão e pode ser copiado.
- [ ] Termos técnicos têm tooltip/glossário.
- [ ] Disclaimer de "não é consultoria" visível.

---

## 17. Riscos e dependências

- **Fontes de dados:** brapi (cotação), COTAHIST/B3 (cadeia EOD) e BCB SGS (taxa) — contratos confirmados em `docs/apis/`. Riscos próprios da nova estratégia: a URL direta do COTAHIST é legada (ter fallback manual), o vínculo opção→ativo-objeto exige heurística (§`b3-cotahist.md`), e a **precisão do nosso Black-Scholes** (modelo europeu/sem dividendos) precisa ser validada contra casos conhecidos.
- **Liquidez de séries na B3:** muitas séries são ilíquidas; o filtro de liquidez é essencial para que o ticket seja executável.
- **Precisão do `options-math`:** erro aqui gera ticket errado — cobertura de testes é obrigatória.
- **Custos de cloud:** Vercel + Neon têm planos gratuitos generosos para uso pessoal; monitorar cota.

---

## 18. Apêndice — Fórmulas das estruturas (para o `options-math`)

Referência para implementar e testar o núcleo. Todas em BRL, por contrato; multiplicar pela quantidade de contratos × tamanho do lote.

- **Trava de alta com calls (débito):** compra call strike menor (K1), vende call strike maior (K2), K1<K2.
  - Risco máx. = débito pago. Ganho máx. = (K2−K1) − débito. Breakeven = K1 + débito. **Risco DEFINIDO.**
- **Trava de baixa com puts (débito):** compra put K2, vende put K1, K1<K2.
  - Risco máx. = débito. Ganho máx. = (K2−K1) − débito. Breakeven = K2 − débito. **DEFINIDO.**
- **Travas de crédito:** análogas; risco máx. = (largura entre strikes) − crédito recebido; ganho máx. = crédito. **DEFINIDO.**
- **Borboleta (com calls):** compra K1, vende 2× K2, compra K3, equidistantes.
  - Risco máx. = débito líquido. Ganho máx. = (K2−K1) − débito. Breakevens = K1+débito e K3−débito. **DEFINIDO.**
- **Condor:** quatro strikes; risco/ganho análogos à borboleta com plateau de ganho entre os strikes internos. **DEFINIDO.**
- **Straddle comprado:** compra call e put no mesmo strike K.
  - Risco máx. = soma dos prêmios. Ganho = ilimitado para cima / grande para baixo. Breakevens = K ± (prêmios). **Risco DEFINIDO (comprado).**
- **Strangle comprado:** compra call K2 e put K1, K1<K2. Breakevens = K2+prêmios e K1−prêmios. **DEFINIDO (comprado).**
- **Straddle/Strangle vendido:** vende as pernas → recebe prêmio, **risco INDEFINIDO** (pode superar o prêmio). Margem conforme corretora; aplicar regra de 10%.
- **Venda coberta (perna de opção):** vende call contra ativo detido. O app trata só a perna de opção; alerta que o usuário gerencia o ativo à vista por fora. Prêmio recebido define o ganho da perna; risco de "perder o ativo" no exercício.

> Para todos: o gráfico de payoff é calculado varrendo uma faixa de preços do ativo no vencimento e somando o resultado de cada perna naquele preço.

### 18.1 Motor Black-Scholes, IV implícita e gregas (em `lib/options-math/black-scholes.ts`)

Com a saída da OpLab (§6.2), **gregas, IV e IV Rank passam a ser calculados pelo próprio `options-math`** a partir do fechamento (COTAHIST) e da taxa livre de risco (BCB SGS, série 432). O módulo é puro e testado. Desenho completo em **`docs/design/options-math-black-scholes.md`**; resumo da abordagem:

- **Pricing — Black-Scholes europeu, sem dividendos** (simplificação do MVP):
  - `d1 = [ln(S/K) + (r + σ²/2)·T] / (σ·√T)`; `d2 = d1 − σ·√T`.
  - Call: `C = S·N(d1) − K·e^(−rT)·N(d2)`. Put: `P = K·e^(−rT)·N(−d2) − S·N(−d1)`.
  - Unidades fixas: `T` em **base 252** (`du/252`); `r` **contínua** (`ln(1+Selic)`); `σ` anual decimal.
  - ⚠️ **Simplificação a revisar (Fase 3):** as opções da B3 são **americanas** e pode haver **dividendos** no intervalo — o MVP ignora ambos (aproximação consciente, boa para EOD destinado a leigos). Fase 3: modelo binomial/americano + `q` de dividendos, no microserviço Python, sem tocar na UI.
- **Solver de IV implícita** a partir do prêmio observado (`PREULT`): **Newton-Raphson** (usando vega) com **fallback de bisseção** onde vega→0 / não converge; chute inicial de Brenner-Subrahmanyam. Retorna `null` (não inventa) quando o prêmio é inviável (no-arbitrage) ou a série não negociou no pregão.
- **Gregas a partir da σ resolvida:** `delta = N(d1)` (call) / `N(d1)−1` (put); `gamma = n(d1)/(S·σ·√T)`; `vega = S·n(d1)·√T`; `theta` (call/put) conforme fórmula padrão; `rho` opcional. Exibir em unidades amigáveis ao leigo (vega por 1% de vol, theta por dia base 252).
- **IV representativa por ativo-objeto:** média da IV das opções **ATM** do vencimento de **menor prazo com liquidez mínima**, por pregão.
- **IV Rank / Percentil:** sobre **252 pregões** da IV representativa — `IV Rank = (IV_hoje − IV_min) / (IV_max − IV_min)·100`; `IV Percentil = % de pregões com IV < IV_hoje`. Populados por **job de backfill retroativo** (para já funcionarem no primeiro uso) na tabela **`iv_history`** (§7), com atualização diária.

---

## 19. Próximos passos (para preparar Cursor + Claude Code)

1. **Confirmar as fontes:** documentação de **brapi.dev** (§6.1), **COTAHIST/B3** e **BCB SGS** (§6.2) — feito em `docs/apis/`. A OpLab foi descontinuada da estratégia (2026-06-16).
2. **Gerar o `CLAUDE.md`** do repositório a partir deste PRD (princípios, stack, convenções, estrutura de pastas).
3. **Quebrar em tarefas** por fase (§15) para o Claude Code executar incrementalmente, começando por `options-math` + testes.
4. **Definir o schema Drizzle** a partir do §7.
5. **Ler a skill `frontend-design`** quando começar a UI, para manter um visual intencional e "para leigos".

---

*Fim do PRD — Babilônia v1.0*
