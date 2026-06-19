# Migração de fundamentos: brapi → bolsai (inventário + de-para)

> **Status:** inventário read-only (retrato do código em 2026-06-19). Nenhum código
> alterado. Padrão de migração ADITIVO (igual ao da OpLab): cria-se a fonte nova ao
> lado, troca-se o consumo, e só então remove-se o brapi.
>
> ⚠️ A lista de campos da **bolsai** abaixo é a fornecida na tarefa; ela **ainda não
> foi validada ao vivo** (o teste `scripts/teste-bolsai.ts` não rodou — faltou a
> `BOLSAI_API_KEY`). Confirmar nomes/unidades reais antes de codar o cliente.

## 1. Exports reais de `lib/integrations/brapi.ts`

Funções: `getCotacao`, `getFundamentos`, `getCalendarioProventos`,
`getCalendarioResultados`.
Tipos: `BrapiCotacao`, `BrapiFundamentos`, `LucroTrimestre`, `BrapiProvento`,
`ResultadosIndisponivel`. Const `TTL_SEGUNDOS`. Reexports de cache
(`criarCacheStoreDrizzle`, `BrapiIndisponivelError`, tipos `OpcoesBusca`, etc.).

## 2. Consumidores (arquivo + linha)

**Runtime — apenas 2 rotas** (confirmado por grep do módulo E de cada função):

| Consumidor | Linha | Usa |
|---|---|---|
| `app/api/ativo/[ticker]/route.ts` | 12, 43, 48 | `getCotacao` (essencial → 503), `getFundamentos` (best-effort → null) |
| `app/api/calendario/[ticker]/route.ts` | 12–13, 41, 44 | `getCalendarioProventos`, `getCalendarioResultados` |

**Somente tipos (`import type`, apagado em runtime):**

| Consumidor | Linha | Tipo |
|---|---|---|
| `app/(app)/analise/tipos.ts` | 9–11 | `BrapiCotacao`, `BrapiFundamentos`, `BrapiProvento` |
| `app/(app)/analise/bloco-tecnico.tsx` | 16, 31 | `BrapiCotacao` |
| `app/(app)/analise/bloco-fundamentalista.tsx` | 20, 54–55 | `BrapiFundamentos`, `BrapiProvento` |

**Testes:** `app/api/routes.test.ts` (mock), `lib/integrations/brapi.test.ts` (unit).

**Confirmação:** NÃO há consumidor de runtime além de `/api/ativo` e `/api/calendario`.
A tela `/analise` é a única que renderiza esses dados (via as 2 rotas). O **ticket
NÃO consome brapi**: o "próximo provento / eventos próximos" do ticket é **input
manual** (campo de data em `ticket-cliente.tsx`; tipo `EventosProximos` em
`lib/ticket/index.ts`). `lib/analise/fundamentos.ts` tem o seu PRÓPRIO
`LucroTrimestre` (não importa do brapi).

## 3. O que cada campo alimenta na UI

### `getCotacao` → `BrapiCotacao` (Bloco Técnico, `bloco-tecnico.tsx`)
| Campo | Alimenta |
|---|---|
| `preco` | cotação grande + `precoAtual` de `analisarTecnico` (suporte/resistência) |
| `variacao` | "+X,XX" do dia |
| `variacaoPercent` | "(X,XX%)" do dia |
| `volume` | "Volume do dia" |
| `ticker` | (símbolo; eco do parâmetro) |
| `horaCotacao` | **não exibido** (só no tipo) |
| `moeda` | **não exibido** (assume BRL) |

> Indicadores técnicos (SMA20/50, RSI, MACD, suporte/resistência) **não vêm do brapi**:
> são calculados em `lib/analise/tecnico` a partir do **histórico COLADO** pelo usuário.

### `getFundamentos` → `BrapiFundamentos` (Bloco Fundamentalista)
| Campo | Alimenta |
|---|---|
| `precoLucro` | Indicador **P/L** + leitura |
| `evEbitda` | Indicador **EV/EBITDA** + leitura |
| `precoValorPatrimonial` | Indicador **P/VP** + leitura |
| `margemLiquida` | Indicador **Margem líq.** + leitura |
| `dividendYield` | Indicador **Div. yield** + leitura |
| `margemBruta` | **só** leitura de iniciante (`lerFundamentos`); sem indicador visível |
| `margemOperacional` | **só** leitura de iniciante; sem indicador visível |
| `lucrosPorTrimestre[]` (`fim`, `lucroLiquido`) | tendência de lucros (`tendenciaLucros`) → leitura |

> Todos os múltiplos/margens/DY têm campo manual que **sobrescreve** a fonte
> (`bloco-fundamentalista.tsx`, "Colar / editar manualmente"). No plano Free do brapi
> já vinham `null` e eram digitados.

### `getCalendarioProventos` → `BrapiProvento[]`
| Campo | Alimenta |
|---|---|
| `dataPagamento` | filtro/sort + exibição "Proventos"; e o flag **`eventoProximo`** (pagamento futuro) repassado ao **Bloco Volatilidade** (reforça o alerta) |
| `tipo` | rótulo do item ("Provento") |
| `valor` | valor do provento (formatado) |
| `ativoEmitido`, `referente`, `aprovadoEm`, `isin` | **não consumidos** na UI |

### `getCalendarioResultados` → `ResultadosIndisponivel`
| Campo | Alimenta |
|---|---|
| `motivo`, `fonteAlternativa` | texto de ajuda sob "Próximo resultado (balanço)" — **já é input manual** (§6.4) |

## 4. TABELA DE-PARA (dado consumido hoje → origem nova)

Legenda da origem: **bolsai** = campo exato do JSON · **acao_cotahist** = EOD ·
**MANUAL** = digitado na tela · **sem equivalente / a decidir**.

| # | Dado consumido hoje (brapi) | UI | Origem NOVA | Observação |
|---|---|---|---|---|
| 1 | `cotacao.preco` | Técnico: preço | **acao_cotahist** `preco_fechamento` (PREULT) | vira **EOD**, não "ao vivo" (perde intraday) |
| 2 | `cotacao.variacao` | Técnico: variação R$ | **acao_cotahist** (derivável: fechamento − fechamento anterior) | precisa de 2 pregões; não é campo pronto |
| 3 | `cotacao.variacaoPercent` | Técnico: variação % | **acao_cotahist** (derivável, idem #2) | EOD day-over-day |
| 4 | `cotacao.volume` | Técnico: volume | **acao_cotahist** `quantidade_titulos` (QUATOT) ou `volume_financeiro` (VOLTOT) | brapi = qtde de papéis ≈ `quantidade_titulos` |
| 5 | `cotacao.horaCotacao` | — (não exibido) | descartável | não usado na UI |
| 6 | `cotacao.moeda` | — (não exibido) | descartável (BRL) | não usado na UI |
| 7 | `fundamentos.precoLucro` (P/L) | Fund.: P/L | **bolsai** `pl` | |
| 8 | `fundamentos.evEbitda` | Fund.: EV/EBITDA | **bolsai** `ev_ebitda` | |
| 9 | `fundamentos.precoValorPatrimonial` (P/VP) | Fund.: P/VP | **bolsai** `pvp` | |
| 10 | `fundamentos.margemLiquida` | Fund.: Margem líq. | **bolsai** `net_margin` | conferir UNIDADE (decimal vs %) |
| 11 | `fundamentos.dividendYield` | Fund.: Div. yield | **MANUAL** ⚠️ | **bolsai NÃO fornece DY** |
| 12 | `fundamentos.margemBruta` | leitura | **sem equivalente / a decidir** ⚠️ | não há `gross_margin` na lista bolsai → MANUAL ou dropar |
| 13 | `fundamentos.margemOperacional` | leitura | **sem equivalente / a decidir** ⚠️ | não há `operating_margin` na lista bolsai → MANUAL ou dropar |
| 14 | `fundamentos.lucrosPorTrimestre[]` | leitura (tendência) | **sem equivalente direto** ⚠️ | bolsai tem `net_income` **pontual**, não série trimestral → tendência fica sem fonte (MANUAL ou remover o sinal) |
| 15 | `proventos[].dataPagamento` | Fund.: lista + `eventoProximo` | **MANUAL** ⚠️ | **bolsai NÃO fornece proventos** |
| 16 | `proventos[].tipo` | Fund.: rótulo | **MANUAL** ⚠️ | idem |
| 17 | `proventos[].valor` | Fund.: valor | **MANUAL** ⚠️ | idem |
| 18 | `resultados.{motivo,fonteAlternativa}` | Fund.: ajuda | **MANUAL** (inalterado) | já era indisponível por design (§6.4) |

### O que a bolsai NÃO fornece (vira MANUAL ou fica órfão)
- **Dividend yield** (#11) → MANUAL.
- **Proventos** (datas/valores) (#15–17) → MANUAL.
- **Calendário de resultados** (#18) → MANUAL (já era).
- **Margem bruta / operacional** (#12–13) → não estão na lista bolsai → a decidir.
- **Lucro por trimestre / tendência** (#14) → bolsai só tem `net_income` pontual.

### Campos bolsai DISPONÍVEIS hoje sem uso (oportunidade, não obrigatório)
`roe`, `roic`, `roa`, `lpa`, `vpa`, `market_cap`, `net_income`, `ebitda`,
`reference_date` (carimbar frescor dos fundamentos), `corporate_name` (nome da
empresa). Decidir se enriquecem o Bloco Fundamentalista.

## 4-bis. Campos do brapi consumidos hoje que o de-para da tarefa NÃO citou
(para não perder nada na troca)

1. **`cotacao.variacao` / `cotacao.variacaoPercent`** — a variação do dia (Técnico).
   Vira derivação EOD de `acao_cotahist`, ou some.
2. **`cotacao.volume`** — mapeável a `quantidade_titulos`/`volume_financeiro`.
3. **`fundamentos.margemBruta` e `margemOperacional`** — alimentam a leitura
   fundamentalista; sem campo na lista bolsai informada.
4. **`fundamentos.lucrosPorTrimestre[]`** (`fim`, `lucroLiquido`) — base da TENDÊNCIA
   de lucros; bolsai (lista informada) só tem valor pontual.
5. **`proventos[].tipo` e `proventos[].valor`** (além da data) — exibidos na lista.
6. **`eventoProximo`** (derivado de `proventos[].dataPagamento` futura) — reforça o
   alerta do Bloco Volatilidade; sem proventos automáticos, vira manual/desligado.
7. **`cotacao.horaCotacao` e `cotacao.moeda`** — presentes no tipo mas **não exibidos**
   (podem ser descartados sem impacto de UI).

## Resumo da decisão pendente (não implementado aqui)
- **bolsai** cobre bem os MÚLTIPLOS (P/L, EV/EBITDA, P/VP) e `net_margin`.
- **acao_cotahist** assume o PREÇO (vira EOD; perde "ao vivo" e exige derivar variação).
- **MANUAL** absorve DY, proventos e resultados (a bolsai não os tem).
- **A decidir:** margem bruta/operacional, tendência de lucros trimestral, e se a
  cotação EOD é aceitável no Bloco Técnico (que hoje mostra preço "ao vivo").
