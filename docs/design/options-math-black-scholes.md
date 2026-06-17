# Design — motor Black-Scholes + IV + gregas (`lib/options-math/black-scholes.ts`)

> **Status: DESIGN, não implementado.** Documento de confirmação/desenho, igual ao
> "Prompt A" das integrações. Define o contrato e a matemática antes de codar.
> Confirmado em 2026-06-16.
>
> Contexto: com a saída da OpLab (ver `docs/apis/b3-cotahist.md`,
> `docs/apis/bcb-sgs.md`), **passamos a calcular gregas, IV e IV Rank por conta
> própria** a partir do preço de fechamento (COTAHIST) e da taxa livre de risco
> (BCB SGS, série 432). Este módulo é o coração quant do MVP.

## Fronteiras (PRD §5.1, CLAUDE.md)

`lib/options-math` é **puro e testado**: recebe números, devolve números. Sem
rede, sem banco, sem UI, sem ler env. A taxa `r`, o spot `S`, o prêmio observado e
o prazo `T` chegam **como parâmetros** (quem busca COTAHIST/SGS é
`lib/integrations`). Cobertura de teste obrigatória (Vitest), validada contra
casos conhecidos.

## Convenções e unidades (fixar para não ter bug de unidade)

| Símbolo | Significado | Unidade |
|--------|-------------|---------|
| `S` | preço do ativo-objeto (spot, do COTAHIST à vista) | BRL |
| `K` | strike (`PREEXE`) | BRL |
| `T` | tempo até o vencimento | **anos, base 252** → `du / 252` |
| `r` | taxa livre de risco **contínua** | a.a., `ln(1 + selic/100)` |
| `sigma` (σ) | volatilidade | a.a., decimal (0.45 = 45%) |
| `premium` | prêmio observado (`PREULT`/`PREMED` do COTAHIST) | BRL |

- **`T` em base 252 (dias úteis), não 365.** Convenção do mercado brasileiro,
  coerente com a Selic anualizada base 252. Precisa de um **contador de dias úteis
  B3** (feriados ANBIMA) — utilitário separado em `lib/options-math` ou
  `lib/utils`; não inventar feriado.
- Sem ajuste de dividendos no MVP (ver "Simplificações").
- Tamanho do contrato (100) e `FATCOT` são tratados na camada de prêmio/ticket,
  **não** dentro do BS (que opera por unidade do ativo).

## Escopo do módulo

```ts
// Esboço de contrato (NÃO implementação)
type OptionType = 'call' | 'put'

interface BSInputs {
  type: OptionType
  S: number        // spot
  K: number        // strike
  T: number        // anos (du/252)
  r: number        // taxa contínua a.a.
  sigma: number    // vol a.a. decimal
}

interface Greeks {
  delta: number
  gamma: number
  theta: number    // por ano; expor também theta/dia = theta/252
  vega: number     // por 1.00 de vol (=100%); expor vega/1% = vega/100
  rho?: number     // opcional no MVP
}

// 1) Preço teórico
function bsPrice(i: BSInputs): number

// 2) IV implícita a partir do prêmio observado
function impliedVol(args: Omit<BSInputs,'sigma'> & { premium: number }): number | null

// 3) Gregas a partir da IV resolvida
function greeks(i: BSInputs): Greeks
```

## 1. Pricing — Black-Scholes europeu, sem dividendos

```
d1 = [ ln(S/K) + (r + σ²/2)·T ] / (σ·√T)
d2 = d1 − σ·√T

Call:  C = S·N(d1) − K·e^(−rT)·N(d2)
Put:   P = K·e^(−rT)·N(−d2) − S·N(−d1)
```

- `N(·)` = CDF da normal padrão; `n(·)` = PDF. Implementar `N` por aproximação
  (ex.: Abramowitz-Stegun 7.1.26 ou Hart) — testar contra valores tabelados.
- **Casos de borda:** `T ≤ 0` → valor intrínseco (`max(S−K,0)` / `max(K−S,0)`);
  `σ ≤ 0` → idem (sem tempo/vol não há valor extrínseco); validar `S,K > 0`.

## 2. Solver de volatilidade implícita

Resolve `σ` tal que `bsPrice(σ) = premium` (preço observado no COTAHIST).

**Algoritmo: Newton-Raphson com fallback para bisseção.**

- **Newton-Raphson** (rápido — usa vega como derivada):
  `σ_{n+1} = σ_n − (bsPrice(σ_n) − premium) / vega(σ_n)`
- **Chute inicial:** aproximação de Brenner-Subrahmanyam para ATM
  `σ₀ ≈ √(2π/T) · (premium/S)`, limitada a um intervalo são (ex.: `[0.01, 5.0]`).
- **Fallback bisseção** em `[σ_lo, σ_hi] = [0.001, 5.0]` quando: vega ~0 (deep
  ITM/OTM, Newton diverge), passos saem dos limites, ou não converge em ~50
  iterações. Bisseção é lenta mas robusta — garante convergência se houver raiz.
- **Critério de parada:** `|bsPrice(σ) − premium| < ε` (ex.: R$ 0,005) ou
  `|Δσ| < 1e-6`.
- **Sanidade / no-arbitrage — retorna `null` quando não dá pra resolver:**
  - prêmio abaixo do valor intrínseco descontado ou acima de `S` (call) → sem σ
    válido;
  - série **sem negócios** no pregão (`PREULT=0`, `TOTNEG=0`) → não calcular IV
    (lixo); marcar como "sem dado" (PRD §2.4 — não inventar);
  - prêmio = bid/ask muito largo → IV pouco confiável; calcular mas **sinalizar**.
- Retornar `null` em vez de chutar — a UI pede o dado ou marca indisponível.

> **Por que NR + bisseção e não só uma:** NR converge em poucas iterações no grosso
> dos casos (ATM/NTM), mas explode onde vega→0; a bisseção cobre exatamente esses
> casos a custo de velocidade. Combinação é o padrão de mercado.

## 3. Gregas (a partir da σ resolvida)

Sem dividendos:

```
delta_call = N(d1)            delta_put = N(d1) − 1
gamma      = n(d1) / (S·σ·√T)                       (igual call/put)
vega       = S·n(d1)·√T                             (igual call/put; por +1.00 de vol)
theta_call = −[S·n(d1)·σ / (2√T)] − r·K·e^(−rT)·N(d2)
theta_put  = −[S·n(d1)·σ / (2√T)] + r·K·e^(−rT)·N(−d2)
rho_call   =  K·T·e^(−rT)·N(d2)        rho_put = −K·T·e^(−rT)·N(−d2)
```

- **Expor em unidades amigáveis ao leigo (PRD §2):** `vega` por **1%** de vol
  (`vega/100`), `theta` por **dia** (`theta/252`, base 252). Documentar a unidade
  no tooltip.
- `rho` é secundária no MVP (pouco relevante p/ opções curtas) — calcular mas pode
  ficar oculta na UI.

## Simplificações do MVP (explícitas) e revisão futura

1. **Modelo europeu para opções que são americanas.** As opções de ações na B3
   são majoritariamente **americanas** (ver `maturity_type`/COTAHIST). Usamos
   Black-Scholes **europeu** no MVP. Justificativa: para ações **sem dividendos no
   intervalo** e opções não muito ITM, o valor americano ≈ europeu (exercício
   antecipado raramente é ótimo para calls; para puts e perto de dividendo a
   diferença cresce). É uma **aproximação consciente**, suficiente para
   gregas/IV/payoff de EOD destinados a leigos.
   - 🔭 **Fase 3 (quant):** modelo binomial/trinomial (Cox-Ross-Rubinstein) ou
     Bjerksund-Stensland para precificação americana — no microserviço Python, sem
     tocar na UI (PRD §15, §4.1).
2. **Sem ajuste de dividendos** (`q = 0`). Dividendos/JCP entre hoje e o
   vencimento deslocam preço e gregas (sobretudo para puts e exercício
   antecipado).
   - 🔭 **Fase 3:** incorporar `q` (dividend yield) ou descontar proventos
     discretos conhecidos; depende de termos calendário de proventos confiável
     (hoje é input manual — PRD §6.1).
3. **`T` base 252 com calendário de feriados B3** — precisa de tabela de feriados
   mantida; sem ela, cai para corrida/365 com pior precisão. Decidir a fonte de
   feriados antes de implementar.

## IV representativa por ativo-objeto

Para a leitura de volatilidade (PRD §8.2) e como insumo do IV Rank, definimos **um
número de IV por ativo-objeto por pregão**:

> **IV representativa = média da IV das opções mais próximas do dinheiro (ATM) do
> vencimento de menor prazo com liquidez mínima, por pregão.**

Regras concretas (parametrizáveis em `lib/risk-rules`/constantes):

1. **Vencimento:** o **mais curto** que tenha `du ≥ 10` dias úteis (evita a semana
   de vencimento, onde a IV fica ruidosa) **e** com liquidez mínima na faixa ATM.
2. **Faixa ATM:** strikes com `|ln(K/S)| ≤ ~5%` (ou os 2 strikes imediatamente
   acima e 2 abaixo do spot). Usar **call e put** dessa faixa.
3. **Liquidez mínima por opção:** `TOTNEG ≥ piso` e `VOLTOT ≥ piso` (mesmos pisos
   do filtro de §8.3) — descartar séries sem negócio.
4. **Agregação:** média (simples no MVP; ponderar por volume é evolução) das IVs
   válidas resolvidas pelo solver. Se nenhuma série ATM tiver liquidez → IV
   representativa = `null` naquele pregão (não inventar; marcar lacuna).

Resultado por pregão → persistido em `iv_history` (abaixo).

## IV Rank / IV Percentil — backfill retroativo

A OpLab entregava `iv_1y_rank`/`iv_1y_percentile` prontos. Agora calculamos:

```
IV Rank (%)       = (IV_hoje − IV_min_252) / (IV_max_252 − IV_min_252) · 100
IV Percentil (%)  = (nº de pregões nos últimos 252 com IV < IV_hoje) / 252 · 100
```

sobre a janela dos **252 pregões** (≈ 1 ano útil) da `iv_representativa` do ativo.

**Estratégia: backfill retroativo único** (recomendado). Em vez de esperar a
métrica "nascer" ao longo de um ano de uso, rodar **um job de backfill** que:

1. baixa o COTAHIST anual dos últimos ~252+ pregões (ver `b3-cotahist.md`);
2. para cada pregão e cada ativo da watchlist, calcula a `iv_representativa`
   (usando a `r` da `432` vigente naquele dia);
3. grava em `iv_history`.

Assim **IV Rank/Percentil funcionam desde o primeiro uso real**. Depois, o job
diário só **acrescenta** o pregão novo (rolling window de 252).

### Nova tabela: `iv_history`

```
iv_history
─────────────────────────────────────────────
  id                serial / uuid   PK
  ativo             text            ticker do objeto (ex.: "PETR4")   ┐ índice único
  data_pregao       date            pregão                            ┘ (ativo, data_pregao)
  iv_representativa numeric         IV anual decimal (ex.: 0.4812) — pode ser null
  prazo_dias        int             du do vencimento usado
  vencimento        date            vencimento usado no cálculo
  n_opcoes          int             nº de opções ATM que entraram na média
  fonte             text            "cotahist-backfill" | "cotahist-diario"
  created_at        timestamptz     default now()
```

- **IV Rank/Percentil NÃO são colunas** — derivam de uma janela de 252 linhas;
  calcular on-read (ou materializar num cache se virar gargalo).
- Guardar `iv_representativa` como **decimal anual** (coerente com `sigma` do BS).
- `null` quando não houve liquidez ATM no pregão (preserva o "não inventar").

## Casos de teste obrigatórios (Vitest)

- `bsPrice`: comparar com valores tabelados/QuantLib para call e put ATM, ITM, OTM.
- Paridade put-call: `C − P = S − K·e^(−rT)` (tolerância numérica).
- `impliedVol`: round-trip — preço a σ conhecido → resolver → recuperar σ
  (ATM, ITM, OTM, T curto/longo). Conferir `null` em prêmio inviável e série sem
  negócio.
- `greeks`: sinais (delta call ∈ [0,1], put ∈ [−1,0]; gamma,vega ≥ 0; theta ≤ 0
  para comprado), e checagem numérica de delta/vega por diferença finita.
- `iv_representativa`: seleção correta de vencimento/faixa ATM e tratamento de
  liquidez zero.

## Resumo das decisões

| Tema | Decisão MVP | Revisão futura |
|------|-------------|----------------|
| Modelo | BS **europeu** | binomial/americano (Fase 3) |
| Dividendos | **ignorados** (`q=0`) | incorporar `q`/proventos discretos |
| Day count | **base 252** (du/252) | — |
| `r` | SGS **432** contínua | SGS 1178 (realizada) |
| Solver IV | **Newton-Raphson + bisseção** | — |
| IV representativa | **média ATM, venc. curto líquido** | ponderar por volume |
| IV Rank/Perc. | **backfill 252 pregões** → `iv_history` | materializar cache |
