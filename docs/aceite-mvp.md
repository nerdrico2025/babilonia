# Relatório de Aceite do MVP — Babilônia

**Data:** 19/06/2026 · **Escopo:** §13 (requisitos não-funcionais) e §16 (critérios de aceite) do PRD.

> Legenda: ✅ Atendido · ⚠️ Atendido com ressalva · ⛔ Não atendido.
>
> Revalidação completa do checklist **após as duas migrações de fonte de dados**
> (ver "Histórico de migrações" no fim). Cada item foi reconferido contra o código
> ATUAL — não contra o relatório anterior (era OpLab+brapi).

## Portões (re-rodados em 19/06/2026)

| Portão | Resultado |
|---|---|
| `npm test` (Vitest) | ✅ **338 testes, 27 arquivos — todos passam** |
| `npm run typecheck` (tsc) | ✅ sem erros |
| `npm run lint` (ESLint) | ✅ 0 erros, 0 warnings |
| `npm run build` (Next 16 / Turbopack) | ✅ compila e gera as rotas |

## Env vars necessárias para deploy (atual)

Confirmadas contra o `.env.example` e o schema `lib/env.ts` (server-only, §5.1/§13).
**Não existem mais `BRAPI_TOKEN` nem `OPLAB_ACCESS_TOKEN`** — removidos nas migrações.

| Variável | Uso |
|---|---|
| `BOLSAI_API_KEY` | **Única chave de API.** Fundamentos do ativo-objeto (bolsai). |
| `DATABASE_URL` | Postgres no **Neon** (connection string *pooled*). |
| `AUTH_SECRET` | Assinatura da sessão (`openssl rand -base64 32`). |
| `AUTH_USERNAME` / `AUTH_PASSWORD` | Único usuário (mono-usuário). |

> COTAHIST/B3 (preço do objeto + cadeia) e BCB SGS (taxa) são **públicos, sem chave**.
> A tela de Configurações (`app/(app)/configuracoes/page.tsx`) e o `scripts/preflight.ts`
> já listam só `BOLSAI_API_KEY` como chave de API.
>
> ⚠️ **Observação de segurança (pré-existente, fora do escopo desta verificação):**
> o `.env.example` versionado contém um `DATABASE_URL` e um `AUTH_SECRET` com valores
> reais. Recomenda-se rotacionar e substituir por placeholders — não alterado aqui
> para não mascarar a decisão sem confirmação.

## Checklist do §16 — item a item (evidência atual)

- [x] **Login → dashboard com book vazio.** — ✅
  Auth.js v5, provider Credentials com comparação em tempo constante
  (`timingSafeEqual`, `auth.ts`); `proxy.ts` protege tudo exceto `/api/auth` e
  estáticos. Estado vazio amigável em `app/(app)/page.tsx` ("Seu book está vazio").
  *Ressalva:* o login real exige `AUTH_*`/`DATABASE_URL` no ambiente.

- [x] **Fontes de dados funcionando com cache.** — ✅ *(item reescrito pós-migração)*
  Hoje as fontes são **COTAHIST/B3 + BCB-SGS + Black-Scholes próprio + bolsai** (não
  mais brapi/OpLab):
  - **Cadeia / IV / IV Rank / gregas:** COTAHIST/B3 ingerido em job + Black-Scholes
    próprio (`lib/dados-opcoes/{cadeia,volatilidade,gregas}.ts`, `lib/options-math/black-scholes.ts`).
  - **Taxa livre de risco:** BCB-SGS série 432 (`lib/integrations/bcb-sgs.ts`, com `cacheGetOrFetch`).
  - **Preço do ativo-objeto (Bloco Técnico):** COTAHIST EOD (`acao_cotahist`, helper
    `buscarCotacaoEodAtivo` em `lib/dados-opcoes/comum.ts`).
  - **Fundamentos:** bolsai (`lib/integrations/bolsai.ts`), com frescor pela tabela
    `fundamentos` (`obterFundamentos`, `lib/fundamentos/repositorio.ts`, TTL 24h,
    degradação para a linha antiga com aviso).
  Coberto por `bolsai.test.ts`, `repositorio.test.ts`, `routes.test.ts`,
  `bcb-sgs.test.ts`, `b3-cotahist.test.ts` e `lib/dados-opcoes/*`. **Smoke ao vivo
  19/06** (12 ativos da watchlist, fluxo `/api/ativo` real, sem mocks): preço EOD
  **12/12**, fundamentos **12/12** (ver "Verificação pós-migração").

- [x] **Montador calcula risco máx., ganho máx. e breakeven corretos.** — ✅
  `lib/options-math/{estruturas,payoff,analysis}.ts`, validado contra casos
  conhecidos do §18 em `estruturas.test.ts`, `payoff.test.ts`, `analysis.test.ts`,
  `black-scholes.test.ts` (pricing/IV/gregas).

- [x] **Payoff coerente com os números.** — ✅
  `app/(app)/montador/grafico-payoff.tsx` (Recharts) consome os pontos de
  `lib/options-math/payoff`; mesma fonte numérica dos rótulos de risco/ganho.

- [x] **Risco máximo antes do ganho, com rótulo DEFINIDO/INDEFINIDO.** — ✅
  `components/risco/rotulo-risco.tsx` + `semaforo.tsx`; ordem risco-antes-do-ganho
  aplicada no montador/ticket/histórico. Coberto em `educativo.test.tsx`.

- [x] **Regras de risco disparam alertas nos limites (5% / 10% / 20% / 30% / 5 dias úteis).** — ✅
  `lib/risk-rules/index.ts` (`RISK_LIMITS`: `definedRiskMaxFraction 0.05`,
  `undefinedRiskMaxFraction 0.1`, `concentrationPerUnderlying 0.2`,
  `concentrationPerExpiry 0.3`, `expiryWarningBusinessDays 5`), banda amarela em 80%.
  Coberto por `lib/risk-rules/index.test.ts`.

- [x] **Ticket gerado no formato padrão e copiável.** — ✅
  `lib/ticket/index.ts` (+ `index.test.ts`); cópia via `navigator.clipboard.writeText`
  em `app/(app)/ticket/ticket-cliente.tsx` e `historico-cliente.tsx`.

- [x] **Termos técnicos com tooltip/glossário.** — ✅
  `<TermoTecnico>` (`components/educativo/termo-tecnico.tsx`) + `lib/glossario.ts`
  (43 termos, incl. os novos **ROE/ROIC/ROA**). Integridade coberta em `educativo.test.tsx`.

- [x] **Disclaimer "não é consultoria" visível.** — ✅
  `components/disclaimer.tsx` (usado na análise/montador) e na tela de login.

## Verificação específica pós-migração (além do §16)

- [x] **Nenhuma tela referencia DY / margem bruta / margem operacional / lucros por
  trimestre / eventoProximo.** — ✅ (grep, não suposição)
  `eventoProximo`: **zero** ocorrências. `dividend yield`: só um comentário no
  bloco fundamentalista. `margemBruta`/`margemOperacional`/`lucrosPorTrimestre`
  aparecem **apenas** como chaves inertes (`null`/`[]`) passadas ao contrato da lib
  pura `FundamentosEntrada` — **nada é renderizado nem buscado** (a remoção desses
  campos do tipo puro ficou fora do escopo da migração, pois `tendenciaLucros` é
  função independente com testes próprios).

- [x] **Aviso de preço EOD visível na UI.** — ✅
  `app/(app)/analise/bloco-tecnico.tsx:90` renderiza "Preço de fechamento de DD/MM —
  confira a cotação atual na sua corretora antes de montar a operação." O bloco
  fundamentalista também sinaliza a possível divergência de data-base dos múltiplos.

- [x] **Mensagem neutra de calendário indisponível renderiza (não erro/lista vazia).** — ✅
  `/api/calendario` responde `{ disponivel:false, motivo, fonteAlternativa }` tipado;
  o bloco fundamentalista mostra a mensagem neutra. Coberto por
  `bloco-fundamentalista.test.tsx` (assertion de que a mensagem aparece e que o
  texto antigo de "nenhum provento" NÃO aparece).

- [x] **Smoke ao vivo (12 ativos, bolsai + COTAHIST reais, fluxo `/api/ativo`).** — ✅
  Executado em 19/06/2026 (pregão de fechamento 17/06). Preço EOD 12/12 e
  fundamentos 12/12, todos `origem: rede`. Casos-limite corretos: MGLU3 margem 0,35%
  (sem dupla conversão), ITSA4 margem 203,91, ROE/PL negativos para empresas com
  prejuízo. Percentuais em pontos, conforme §6.4.

## §13 — Requisitos não-funcionais

- **Segurança:** única chave (`BOLSAI_API_KEY`) é server-only; COTAHIST/SGS públicos;
  acesso protegido por login (`proxy.ts`). Nenhuma `NEXT_PUBLIC_*` com segredo;
  componentes cliente usam `import type` para tipos das integrações. ✅
- **Resiliência:** falha/cota degrada para cache (cadeia/IV/gregas via `cacheGetOrFetch`)
  ou para a linha antiga de `fundamentos` com aviso; nunca quebra a tela. ✅
- **Clareza/acessibilidade e disclaimers:** linguagem simples, tooltips, disclaimer
  recorrente. ✅

## Histórico de migrações deste documento

Este checklist já passou por **duas trocas de fonte de dados**; o relatório foi
revalidado do zero a cada uma:

1. **OpLab → COTAHIST/B3 + BCB-SGS + Black-Scholes próprio** (cadeia, IV/gregas e
   taxa). Decisão 2026-06-16.
2. **brapi → bolsai + COTAHIST** (fundamentos via bolsai; preço do objeto via
   COTAHIST EOD; proventos/resultados manuais; dividend yield removido do produto).
   Passos 5.1–5.7, concluída em 2026-06-19. Ver `docs/migracao-fundamentos.md`.

Os documentos das fontes antigas (`docs/apis/oplab.md`, `docs/apis/brapi.md`) ficam
como **histórico** — não reintroduzir.

## Veredito

**MVP pronto para a Fase 2.** Todos os 9 critérios do §16 atendidos com evidência no
código atual; portões verdes; sem regressões pós-migração. Única ressalva (não
bloqueante, pré-existente): rotacionar os valores reais em `.env.example`.

## Fase 3 — Encerramento

**Data:** 22/06/2026.

**O que foi construído e validado:**

- **Microserviço de quant (FastAPI no Railway).** `POST /screening` (ranqueia
  estruturas de risco definido por ganho/risco, com filtro de liquidez/capital) e
  `POST /backtest` (mark-to-market diário **com ajuste de strike por provento**).
  Deployado e validado em produção.
- **Role read-only `quant_readonly` no Neon.** O serviço conecta com permissão
  apenas de `SELECT` nas tabelas que lê (`watchlist`, `opcao_cotahist`,
  `acao_cotahist`; `iv_history` reservada), além do `default_transaction_read_only=on`
  em runtime — defesa em duas camadas contra qualquer escrita acidental.
- **Validação em produção:** screening e backtest exercitados com dados reais de
  **PETR4** e **VALE3**.
- **Testes de banco real com timeout corrigido:** o timeout do Vitest subiu para
  15 s e o pool passou a `forks` (cold start de um arquivo não bloqueia outro) —
  commit `8326817`.

**Superfície de IV — decisão registrada:** **adiada, não descartada.** Só fará
sentido quando o usuário começar a operar **calendários ou diagonais** (estruturas
cuja tese depende da relação de IV entre vencimentos). Por ora, **IV Rank + skew**
já cobrem todas as decisões reais. A fronteira no microserviço fica pronta para a
implementação futura, sem custo de manutenção enquanto não for usada.

**Status geral:** **Fases 0, 1, 2 e 3 concluídas.** App funcional para uso.
