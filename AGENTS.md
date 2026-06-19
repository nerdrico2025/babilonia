<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Estratégia de dados de opções (decisão 2026-06-16)

> A fonte da verdade é o PRD (`docs/PRD_Babilonia.md` §6.2/§18.1) e o `CLAUDE.md`.
> Este resumo evita que decisões já fechadas sejam reintroduzidas erradas.

**A OpLab e o brapi saíram de cogitação.** Não consumir OpLab (`Access-Token`,
plano PRO, `/market/options/bs`) nem brapi (`BRAPI_TOKEN`, `getCotacao`,
`getFundamentos`, `getCalendario*` — o `brapi.ts` foi removido). Fontes atuais:

- **Fundamentos:** **bolsai** (`lib/integrations/bolsai.ts`, chave `BOLSAI_API_KEY`),
  gravados na tabela `fundamentos`. **Dividend yield removido do produto.**
  Percentuais em **pontos** (não normalizar). Detalhes: `docs/migracao-fundamentos.md`.
- **Preço do ativo-objeto:** **COTAHIST EOD** (`acao_cotahist`) — não cotação ao
  vivo; a UI mostra aviso datado de fechamento.
- **Proventos e calendário de resultados:** **manuais** (busca automática desligada).
- **Cadeia de opções:** arquivos públicos **COTAHIST (B3)** — dado de **fechamento
  (EOD), não tempo real**. Ingerido em **job** (download + parse → Postgres), não
  por request-por-tela. Filtrar `TPMERC ∈ {070 CALL, 080 PUT}`.
- **Taxa livre de risco:** **BCB SGS série 432** (Meta Selic, % a.a.) — público.
- **Gregas, IV e IV Rank:** **calculados por nós** em
  `lib/options-math/black-scholes.ts` (nada vem pronto). BS **europeu, sem
  dividendos** = simplificação do MVP (revisão na Fase 3: americano/binomial +
  dividendos). IV Rank via **backfill retroativo** de 252 pregões → tabela
  `iv_history`.
- **Sem open interest na fonte** — liquidez = volume + nº de negócios + spread.
- **Vínculo opção→ativo-objeto** é heurístico e **restrito à watchlist** no MVP.

Detalhes: `docs/apis/b3-cotahist.md`, `docs/apis/bcb-sgs.md`,
`docs/design/options-math-black-scholes.md`.

# Princípios não-negociáveis (inalterados)

Só **opções**, nunca ações à vista. **Risco antes do ganho**, com rótulo
**DEFINIDO/INDEFINIDO**. **Decisão é sempre do usuário** (não é consultoria).
**Nenhuma chave/segredo no cliente** (`BOLSAI_API_KEY` server-only; COTAHIST e SGS
são públicos).
