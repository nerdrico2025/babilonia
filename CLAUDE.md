# CLAUDE.md — Babilônia

Guia para desenvolvimento assistido (Cursor + Claude Code). Derivado do
`docs/PRD_Babilonia.md` (a fonte da verdade). Em conflito, o PRD prevalece.

@AGENTS.md

> **Aviso de produto:** o Babilônia é uma ferramenta pessoal de *análise e
> montagem* de operações com opções. **Não é consultoria**, **não recomenda** e
> **não executa ordens**. Todas as ordens são digitadas manualmente pelo usuário
> no home broker.

## O que é (§1)

Web app pessoal, mono-usuário, para **analisar e montar operações exclusivamente
com OPÇÕES da B3**: análise do ativo-objeto, cadeia de opções (fechamento/EOD) com
gregas/IV calculadas, montador de estruturas com payoff visual, checagem de
risco/capital e geração de um TICKET DE OPERAÇÃO. Usuário é **iniciante/leigo** —
linguagem simples sempre.

## Princípios não-negociáveis (§2) — valem para todo código e UI

1. **Para leigos, sempre.** Português claro, sem jargão sem explicação. Todo
   termo técnico (gregas, IV Rank, skew, breakeven) tem tooltip/glossário.
2. **Risco antes do ganho.** Em qualquer tela/ticket/resumo, o **risco máximo
   aparece primeiro e com destaque**, antes do ganho. Toda estrutura é rotulada
   **risco DEFINIDO** ou **risco INDEFINIDO**.
3. **Decisão é do usuário.** O app mostra cenários, nunca "compre/venda".
   Disclaimers visíveis de que não é consultoria.
4. **Dados reais primeiro.** Análises usam dados das integrações (bolsai para
   fundamentos; COTAHIST/B3 para preço do objeto e cadeia; BCB SGS para a taxa) ou
   colados pelo usuário. Faltando dado essencial (preço, prêmio, taxa), **pedir
   explicitamente — nunca inventar**. Gregas/IV são **calculadas** pelo
   `options-math` (§18.1), não inventadas.
5. **Liquidez importa.** Séries com pouco volume/poucos negócios ou spread largo
   recebem alerta (a ordem precisa ser executável). ⚠️ Não há open interest na
   fonte (§6.2/§6.4) — liquidez no MVP usa **volume + nº de negócios + spread**.
6. **Começar leve, evoluir depois.** Arquitetura simples no MVP, com fronteiras
   limpas para extrair quant pesado (Python/FastAPI) no futuro.

### Regras absolutas

- **Só OPÇÕES, nunca ações à vista.** Operações com o ativo à vista estão **fora
  do escopo** (§3.2) — nunca sugerir nem considerar. Na venda coberta, o app
  trata só a perna de opção.
- **Risco antes do ganho** em toda saída (telas, ticket, resumos).
- **Decisão é sempre do usuário** — nada de recomendação personalizada.
- **Chaves de API só no servidor.** Nunca expor `BOLSAI_API_KEY` no cliente. As
  rotas `app/api/` atuam como proxy. (COTAHIST/B3 e BCB SGS são públicos, sem chave.)

## Stack (§4)

| Camada | Escolha |
|---|---|
| Full-stack | **Next.js (App Router) + React + TypeScript** |
| UI | **Tailwind CSS + shadcn/ui** |
| Gráficos (payoff) | **Recharts** |
| Backend | Route Handlers / Server Actions do Next.js |
| Banco | **Postgres (Neon)** |
| ORM | **Drizzle ORM** |
| Validação | **Zod** |
| Auth | **Auth.js (NextAuth)** — mono-usuário |
| Cache de APIs | Tabela no Postgres com TTL (upgrade futuro: Upstash Redis) |
| Hospedagem | **Vercel** |
| Testes | **Vitest** |

> ⚠️ **Next 16 / React 19 / Tailwind 4** — versões com breaking changes. Veja o
> aviso em `AGENTS.md` e consulte `node_modules/next/dist/docs/` antes de escrever
> código de Next.

> ⚠️ **shadcn/ui usa o preset Base UI (`@base-ui/react`), NÃO o Radix.** Muitos
> exemplos de componente shadcn na web assumem Radix (`@radix-ui/*`) — a API
> difere (ex.: `Tooltip.Positioner`/`Popup` no Base UI vs. `Tooltip.Content` no
> Radix). Ao copiar componentes/exemplos, **confira a fonte e não misture as duas
> bibliotecas** no mesmo componente. Em caso de dúvida, gere via `npx shadcn add`
> (que respeita o preset configurado em `components.json`) em vez de colar código.

## Fronteiras de arquitetura (§5.1)

- **`lib/options-math` é PURO e TESTADO.** Recebe parâmetros, devolve números.
  Sem efeitos colaterais, sem UI, sem banco, sem rede. É o coração — não pode ter
  bug. Cobertura de testes obrigatória (Vitest). Inclui o **Black-Scholes próprio**
  (pricing, solver de IV, gregas — §18.1; desenho em
  `docs/design/options-math-black-scholes.md`).
- **Integrações sempre via camada própria + cache.** Nenhuma tela chama
  bolsai/COTAHIST/SGS direto; tudo passa por `lib/integrations` com cache e
  tratamento de erro. Falha/cota degrada para cache com aviso, nunca quebra a tela.
  A cadeia COTAHIST é **ingerida em job** (não request-por-tela): o job baixa e
  parseia o arquivo EOD para o Postgres, e as telas leem do banco.
- **Chaves de API só no servidor** (proxy nas rotas `app/api/`).
- **Fronteira para quant em Python:** quando surgir quant pesado (backtesting,
  gregas próprias, screening, superfície de IV), extrai-se um microserviço
  FastAPI consumido via HTTP, **sem tocar na UI**. O MVP não implementa, só
  mantém as fronteiras limpas.

## Estrutura de pastas

```
app/
  api/            Route Handlers (proxy + cache das integrações)
  (telas)         dashboard, ativo, cadeia, montador, ticket...
components/ui/    componentes shadcn/ui
lib/
  integrations/   bolsai.ts (fundamentos), b3-cotahist.ts (download/parse de preço
                  do objeto + cadeia EOD), bcb-sgs.ts (taxa livre de risco)  + cache/ingestão
  options-math/   payoff, risco, breakeven, black-scholes (IV/gregas)  ← núcleo puro e testado
  risk-rules/     regras de capital e concentração (§10)
  ticket/         geração e formatação do ticket (§11)
  env.ts          validação de env com Zod (server-only)
  utils.ts        helpers de UI (shadcn)
db/               schema Drizzle + migrations (inclui iv_history, §7)
docs/             PRD, contratos de API (docs/apis/) e design (docs/design/)
```

## Convenções

- **TypeScript estrito** (`strict` + flags extras no `tsconfig.json`). Sem `any`.
- **Comentários e textos de UI em português** (público leigo, §2).
- **`options-math` puro e testado** — toda função do núcleo tem teste no Vitest.
- Imports via alias `@/` (ex.: `@/lib/options-math`).
- Validar dados externos e formulários com **Zod**.
- Quantidades em **lotes/contratos**; preços em **BRL**; gregas/IV **calculadas**
  pelo `options-math` e armazenadas com o **timestamp do pregão (EOD)** que as
  originou (§7).
- **NUNCA commitar valores reais em `.env.example`** — só placeholders óbvios (ex.:
  `DATABASE_URL=postgresql://usuario:senha@host/banco`, `AUTH_SECRET=gere-com-openssl-rand-base64-32`).
  Segredos reais vivem só no `.env.local` (que está no `.gitignore`). Um valor real
  no `.env.example` é um vazamento — fica no histórico do git e exige rotação.

## Regras de risco/capital (§10) — referência rápida

Verificadas automaticamente a todo ticket; capital total vem de `settings`.
Apresentar com semáforo + texto claro. (Constantes em `lib/risk-rules`.)

- **Risco definido** (travas, borboletas, condores): risco máx. **≤ 5%** do capital.
- **Risco indefinido** (venda nua, straddle/strangle vendido): margem **≤ 10%**;
  alertar que o risco real pode superar o prêmio recebido.
- **Concentração por ativo-objeto:** máx. **20%** do book aberto.
- **Concentração por vencimento:** máx. **30%** do book aberto.
- **Proximidade de vencimento:** alertar nos últimos **~5 dias úteis** (encerrar/rolar).

## Integrações e dados de opções — pontos de atenção (§6.2 / §6.4)

> **Decisão 2026-06-16/19:** a **OpLab** e o **brapi** saíram de cogitação (caros /
> sem cobertura no plano gratuito). Fontes atuais: **bolsai** (fundamentos do
> objeto), **COTAHIST/B3** (preço do objeto EOD + cadeia de opções EOD) e **BCB
> SGS** (taxa). Contratos em `docs/apis/b3-cotahist.md`, `docs/apis/bcb-sgs.md`,
> `docs/migracao-fundamentos.md` (bolsai); motor de gregas/IV em
> `docs/design/options-math-black-scholes.md`. (`docs/apis/oplab.md` e
> `docs/apis/brapi.md` são históricos.)

Decisões de design **já fechadas** — não reintroduzir o modelo OpLab:

- **Dado é EOD (fechamento), não tempo real.** O app monta no fechamento; o usuário
  digita a ordem no pregão seguinte (não há day trade). A UI deve **datar** o dado
  ("fechamento de DD/MM"). Não prometer cotação ao vivo da cadeia.
- **Cadeia via COTAHIST, ingerida em job.** Filtrar `TIPREG=01` + `TPMERC ∈ {070
  CALL, 080 PUT}`. Download por URL direta (anual p/ backfill, diário p/
  incremental) com **fallback manual** (formulário com captcha). Processar em
  stream e persistir só o que interessa.
- **Sem open interest na fonte** (COTAHIST não tem; OpLab também não tinha) —
  liquidez = **volume (`VOLTOT`) + nº de negócios (`TOTNEG`) + spread bid/ask**. Não
  exigir OI em tela, ticket ou filtro.
- **Gregas, IV e IV Rank são calculados por nós** em
  `lib/options-math/black-scholes.ts` a partir do prêmio de fechamento + spot
  (COTAHIST) + taxa (BCB SGS). Nada vem "pronto". Solver de IV: Newton-Raphson com
  fallback de bisseção; retorna `null` (não inventa) em prêmio inviável / série sem
  negócio.
- **Black-Scholes europeu, sem dividendos** = simplificação consciente do MVP. As
  opções da B3 são **americanas** — revisão na **Fase 3** (modelo binomial/americano
  + dividendos, no microserviço Python, sem tocar na UI).
- **Taxa livre de risco = BCB SGS série `432`** (Meta Selic, % a.a.). `T` em base
  252 dias úteis; `r` contínua (`ln(1+Selic)`). Detalhes/alternativas em
  `bcb-sgs.md`.
- **IV representativa por ativo-objeto** = média da IV das opções ATM do vencimento
  de menor prazo com liquidez mínima, por pregão.
- **IV Rank/Percentil via backfill retroativo** de 252 pregões → tabela
  **`iv_history`** (não esperar a métrica "nascer"; ela funciona desde o 1º uso).
- **Vínculo opção→ativo-objeto é heurístico** (raiz do ticker + `NOMRES`/ISIN) e
  **restrito à watchlist no MVP** — não tentar mapear toda a B3.
- **Fundamentos:** vêm da **bolsai** (P/L, EV/EBITDA, P/VP, margem líquida, ROE,
  ROIC, ROA, LPA, VPA, market cap, lucro líquido, EBITDA), gravados na tabela
  `fundamentos` (frescor por `atualizado_em`). **Dividend yield foi removido do
  produto** (a bolsai não fornece). Percentuais vêm em **pontos** (21,69 = 21,69%)
  — não normalizar.
- **Preço do objeto (Bloco Técnico):** **COTAHIST EOD** (`acao_cotahist`), não
  cotação ao vivo — a UI mostra **aviso datado** ("Preço de fechamento de DD/MM").
  Variação derivada do pregão anterior.
- **Proventos e calendário de resultados:** **manuais** (campo de data no montador
  de ticket). A busca automática (`/api/calendario`) foi **desligada** — a rota só
  sinaliza indisponibilidade tipada; nada de lista vazia silenciosa.

## Comandos

- `npm run dev` — desenvolvimento
- `npm run build` — build de produção
- `npm test` — testes (Vitest, single run) · `npm run test:watch`
- `npm run typecheck` — checagem de tipos
- `npm run db:generate` / `npm run db:migrate` — migrations Drizzle

## Acesso protegido / login (§13) — Auth.js mono-usuário

O app inteiro (telas + `app/api/`, exceto `/api/auth/*`) é protegido pelo proxy
`proxy.ts` (o `middleware` do Next 16). Quem não está logado vai para `/login`.

- **Auth.js (NextAuth) v5** com **um** provider Credentials. Um único par
  usuário/senha vem de env vars **server-only**; sessão por **JWT** (sem tabela
  de usuários). Comparação em tempo constante (`auth.ts`).
- **Arquivos:** `auth.config.ts` (edge-safe, usado pelo proxy) · `auth.ts`
  (provider, runtime Node) · `proxy.ts` · `app/api/auth/[...nextauth]/route.ts`
  · `app/login/` (tela 1, §14).
- O login **só protege o acesso**. A chave de API (`BOLSAI_API_KEY`) segue
  server-only e nunca chega ao cliente (§5.1). COTAHIST e BCB SGS são públicos, sem chave.

**Rodar local autenticado:**
1. No `.env.local` defina `AUTH_SECRET` (`openssl rand -base64 32`),
   `AUTH_USERNAME` e `AUTH_PASSWORD` (ver `.env.example`).
2. `npm run dev` → abra `http://localhost:3000` → redireciona para `/login`.
3. Entre com o `AUTH_USERNAME`/`AUTH_PASSWORD` → cai no dashboard. Botão **Sair**
   encerra a sessão e volta para `/login`.

## Dependências — `overrides` no package.json (NÃO remover sem checar)

O bloco `overrides` existe para fechar advisories de **tooling dev/build** sem o
downgrade destrutivo que o `npm audit fix --force` proporia (`drizzle-kit→0.19.1`,
`next→9.3.3`). Eram dev/build-time e não exploráveis no nosso uso, mas zeramos o
`npm audit`. `overrides` do npm **não aceitam comentários** — por isso a
justificativa mora aqui:

- **`"esbuild": "^0.28.1"`** — o `drizzle-kit` (dev-only) ainda embute o
  `@esbuild-kit/esm-loader` (deprecado), que puxava `esbuild` na faixa vulnerável
  (GHSA-gv7w-rqvm-qjhr; advisory cobre `0.17.0–0.28.0`, daí `^0.28.1`).
  ↳ **Pode sair quando** o `drizzle-kit` migrar internamente de `@esbuild-kit`
  para `tsx` (já em curso nas versões novas do kit). **Cheque ao subir o
  drizzle-kit**: se `npm ls @esbuild-kit/esm-loader` não retornar nada, remova o
  override e rode `npm audit`.
- **`"postcss": "^8.5.15"`** — o `next@16` embute um `postcss` < 8.5.10
  (GHSA-qx2v-qp2m-jg93, XSS no stringify de CSS não-confiável — fora do nosso
  caso). O Tailwind v4 já traz `^8.5.15` como dep direta.
  ↳ **Pode sair quando** um upgrade de Next/Tailwind trouxer postcss ≥ 8.5.10
  como dep direta. **Cheque com** `npm ls postcss` (todas as instâncias ≥ 8.5.10)
  e `npm audit` após remover.

Validação ao mexer aqui: `npm install && npm audit && npm run db:generate &&
npm run build` devem passar limpos (o esbuild novo roda dentro do loader antigo
do drizzle-kit — por isso `db:generate` faz parte do smoke test).

## Roadmap (§15)

- **Fase 0 — Fundação** (atual): setup do projeto, fronteiras de pastas, CLAUDE.md.
- **Fase 1 — MVP:** integrações + cache (bolsai; ingestão COTAHIST; BCB SGS),
  `options-math` testado (payoff/risco **+ Black-Scholes/IV/gregas**), backfill de
  `iv_history`, montador, payoff, regras de risco, gerador de ticket, glossário
  básico.
- **Fase 2 — Análise rica:** telas de análise completas, filtro de liquidez,
  skew, IV Rank visual, histórico/diário, fundamentos automáticos (bolsai).
- **Fase 3 — Quant (opcional):** microserviço Python — incl. **modelo
  americano/binomial e ajuste de dividendos** para o pricing (revisão da
  simplificação do MVP).
