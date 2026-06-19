# Relatório de Aceite do MVP — Babilônia

**Data:** 16/06/2026 · **Escopo:** §13 (requisitos não-funcionais) e §16 (critérios de aceite) do PRD.

> Legenda: ✅ Atendido · ⚠️ Atendido com ressalva · ⛔ Não atendido.

## Resumo

| Portão | Resultado |
|---|---|
| `npm test` (Vitest) | ✅ **207 testes, 17 arquivos — todos passam** |
| `npm run typecheck` (tsc) | ✅ sem erros |
| `npm run lint` (ESLint) | ✅ sem problemas |
| `npm run build` (Next 16 / Turbopack) | ✅ compila e gera as 14 rotas |

## 1. Deploy na Vercel (preparação)

O projeto é um app Next.js (App Router) — deploy **zero-config** na Vercel (framework
autodetectado). O build de produção está **verde**. A conexão com o banco é **lazy**
(`getDb()` só conecta em runtime) e as páginas são dinâmicas (`ƒ`), então o build
**não exige** `DATABASE_URL`.

**Variáveis de ambiente (todas server-only, §13/§5.1)** — configurar em
*Project → Settings → Environment Variables* (Production/Preview), conforme `.env.example`:

| Variável | Uso |
|---|---|
| `BOLSAI_API_KEY` | Fundamentos (bolsai); preço/cadeia vêm do COTAHIST (público) |
| `DATABASE_URL` | Postgres no **Neon** (use a connection string *pooled*) |
| `AUTH_SECRET` | Assinatura da sessão (`openssl rand -base64 32`) |
| `AUTH_USERNAME` / `AUTH_PASSWORD` | Único usuário (mono-usuário) |

**Passos:**
1. Provisionar o Postgres no **Neon** (Vercel Marketplace ou conta Neon) e copiar a
   `DATABASE_URL`.
2. Definir as 5 variáveis acima no projeto da Vercel. (A cadeia COTAHIST/B3 e a taxa
   BCB-SGS são fontes públicas, sem chave.)
3. Rodar as migrations contra o Neon: `npm run db:migrate` (e, se for o primeiro
   deploy, `npm run db:seed` para criar a linha de `settings` com o capital).
4. `git push` na branch de produção → build automático. (O `vercel deploy` é um passo
   **manual** do responsável — não executado por este relatório.)

> Não há `vercel.json`/`vercel.ts`: a detecção padrão do Next basta e evita
> dependência extra.

## 2. Nenhuma chave de API vaza para o cliente (§13/§5.1) — ✅

- `process.env.{BOLSAI_API_KEY,AUTH_SECRET,AUTH_PASSWORD}` só aparece
  em **código de servidor**: `lib/integrations/bolsai.ts`, `lib/env.ts`,
  `auth.ts` e a Server Action/route da tela de Configurações.
- **Nenhuma** variável `NEXT_PUBLIC_*` (que vazaria ao cliente).
- Os componentes `"use client"` que tocam tipos das integrações usam **`import type`**
  (apagado em build — não empacota o módulo server-only).
- Varredura do bundle client gerado (`.next/static`) **não** encontra os nomes dos
  segredos. A tela de Configurações mostra só *Configurada/Faltando*, nunca o valor.

## 3. Testes e build (§16) — ✅

Todos os testes do Vitest passam (207) e o build de produção conclui sem erros
(ver tabela do Resumo). Nada a corrigir.

## 4. Critérios de aceite do §16

- [x] **Login → dashboard com book vazio.** — ✅
  Auth.js v5 com provider Credentials e comparação em tempo constante
  (`timingSafeEqual`, `auth.ts`); `proxy.ts` protege tudo exceto `/api/auth`,
  `/api/health` e estáticos. Dashboard com estado vazio amigável
  (`app/(app)/page.tsx`, "Seu book está vazio").
  *Ressalva:* o login real exige `AUTH_*`/`DATABASE_URL` no ambiente — confirmar no
  smoke test pós-deploy.

- [x] **Integrações com cache funcionando (migração da OpLab e do brapi concluída).** — ✅
  A cadeia/IV/gregas e o preço do objeto vêm do COTAHIST/B3 (ingestão em job) +
  Black-Scholes próprio; os fundamentos vêm da **bolsai** com frescor pela tabela
  `fundamentos` (degradação para a linha antiga com aviso). As telas chamam os
  proxies `app/api/*`. Coberto por `bolsai.test.ts`, `repositorio.test.ts`,
  `routes.test.ts` e os testes de `lib/dados-opcoes/*` (cadeia, volatilidade, gregas).
  *Ressalva:* os fundamentos dependem do `BOLSAI_API_KEY` — validar no smoke test; o
  preço/cadeia (COTAHIST) e a resiliência estão testados.

- [x] **Montador calcula risco máx., ganho máx. e breakeven corretos (casos
  conhecidos).** — ✅
  Núcleo puro `lib/options-math` validado contra os valores do §18 em
  `estruturas.test.ts` (travas débito/crédito, borboleta, condor, straddle/strangle
  comprado/vendido, venda coberta) e `payoff.test.ts`.

- [x] **Payoff coerente com os números.** — ✅
  O gráfico (`grafico-payoff.tsx`, Recharts) consome a **mesma** `curva` do motor
  (`curvaPayoff`) que gera risco/ganho/breakeven — uma só fonte da verdade.

- [x] **Risco máximo ANTES do ganho, com rótulo DEFINIDO/INDEFINIDO.** — ✅
  No montador (passo de resumo), no ticket (`linhaRiscoMaximo` precede
  `linhaGanhoMaximo`) e no book/histórico. Selo `RotuloRisco` (DEFINIDO/INDEFINIDO)
  em destaque.

- [x] **Regras de risco disparam alertas nos limites (5% / 10% / 20% / 30% / 5
  dias úteis).** — ✅
  `RISK_LIMITS` em `lib/risk-rules`: `definedRiskMaxFraction 0.05`,
  `undefinedRiskMaxFraction 0.1`, `concentrationPerUnderlying 0.2`,
  `concentrationPerExpiry 0.3`, `expiryWarningBusinessDays 5`. Semáforo
  verde/amarelo/vermelho com banda de alerta a 80%; coberto por `index.test.ts`.
  Aplicado no montador, no dashboard (§8.1) e nos alertas de vencimento.

- [x] **Ticket no formato padrão e copiável.** — ✅
  `lib/ticket` gera o formato do §11 (validações de vencimento/liquidez/eventos que
  **bloqueiam** a cópia se faltar dado); `ticket-cliente.tsx` copia via
  `navigator.clipboard` e persiste a posição no book.

- [x] **Termos técnicos com tooltip/glossário.** — ✅
  `<TermoTecnico>` (tooltip + link) sobre o glossário único (`lib/glossario.ts`),
  usado em todas as telas; tela `/glossario` lista tudo por categoria.

- [x] **Disclaimer "não é consultoria" visível.** — ✅
  `DisclaimerBar` fixa no rodapé de **todo** o app (`AppShell`) e `DisclaimerNota`
  reforçada nas telas de decisão (montador, ticket, análise).

## 5. Requisitos não-funcionais (§13)

- **Segurança:** chaves só no servidor; app protegido por login mono-usuário. ✅ (ver §2)
- **Privacidade:** book/tickets no Postgres do usuário (Neon). ✅
- **Performance:** cache obrigatório das APIs; payoff/cálculos client-side ou em
  Server Action. ✅
- **Resiliência:** falha/cota degrada para cache com aviso; telas tratam DB/integração
  indisponível sem quebrar. ✅
- **Clareza/acessibilidade:** linguagem simples, tooltips, rótulos de risco. ✅
- **Disclaimers:** visíveis e recorrentes. ✅

## 6. Smoke test manual recomendado (pós-deploy, com credenciais)

1. Abrir a URL → redireciona para `/login`; entrar com `AUTH_USERNAME/PASSWORD` → cai
   no dashboard com book vazio.
2. `/analise` e `/cadeia`: buscar `PETR4` → cotação (brapi) e cadeia/IV/gregas
   (COTAHIST, fechamento EOD) aparecem; a cotação tem cache (frescor "em cache") e
   cortar a rede mostra o aviso de fallback.
3. `/montador`: montar uma trava de alta → conferir risco/ganho/breakeven e o payoff;
   gerar ticket → copiar → confirmar (entra no book e no histórico).
4. `/configuracoes`: ajustar capital → ver os indicadores do dashboard recalcularem.

**Conclusão:** o MVP atende aos critérios do §16 e aos requisitos do §13 no nível de
código, testes e build. Restam apenas as validações ao vivo (itens 1 e 2), que
dependem de credenciais/Neon e devem ser confirmadas no smoke test após configurar as
variáveis na Vercel.
