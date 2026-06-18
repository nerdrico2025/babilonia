/**
 * dados-opcoes/cadeia — CADEIA DE OPÇÕES a partir do COTAHIST (§6.2/§6.4 do PRD).
 *
 * É a SUBSTITUTA de `getCadeiaOpcoes` da OpLab (`lib/integrations/oplab.ts`): lê do
 * Postgres (`opcao_cotahist` + `acao_cotahist` + `iv_history`, ingeridos por job —
 * §5.1) e devolve o MESMO tipo neutro `CadeiaOpcoes` (`lib/opcoes/tipos.ts`), para
 * que a UI/montador não saibam de onde o dado veio. ADITIVO: nesta etapa o app
 * segue usando a OpLab; ligar rotas/UI vem depois.
 *
 * Decisões de mapeamento COTAHIST → `OpcaoCadeia` (documentadas, nada inventado §2.4):
 *  - DADO É EOD: a cadeia é do FECHAMENTO do pregão mais recente do ativo (a
 *    data-base / as-of, devolvida em `asOf` para a rota carimbar o frescor — §6.2).
 *  - `bid`/`ask`: PREOFC/PREOFV. No COTAHIST, 0,00 = SEM oferta → normalizamos para
 *    `null` (mesma semântica de "sem preço" de `lib/liquidez.ts`).
 *  - `spread = ask − bid` (≥ 0) só quando AMBOS existem; senão `null`. O prêmio MID
 *    `(bid+ask)/2` NÃO é um campo de `OpcaoCadeia` — é derivado on-demand por
 *    `precoReferencia(op)` de `lib/liquidez.ts` a partir destes `bid`/`ask`, igual
 *    ao resto do app (a OpLab também não trazia "premio" pronto na cadeia).
 *  - `volume`: QUATOT (`quantidade_titulos`) — contratos negociados no dia; é o
 *    proxy de "volume em contratos" que `lib/liquidez.ts` compara com os limites.
 *  - `volumeFinanceiro`: VOLTOT (`volume_financeiro`, BRL). `negocios`: TOTNEG.
 *  - `marketMaker`: `null` — o COTAHIST NÃO informa market maker. É o caso
 *    CONSERVADOR: `lib/liquidez.ts` só dá o desconto de volume mínimo quando
 *    `marketMaker === true`, então `null` exige o volume mínimo cheio (sem inventar
 *    um `false`/`true` que não temos).
 *  - `tipoExercicio`/`tamanhoContrato`/`bidVolume`/`askVolume`: `null` — não
 *    constam nas colunas que persistimos do COTAHIST.
 *  - `openInterestDisponivel`/`gregasNaCadeia`: sempre `false`. Gregas/IV por opção
 *    seguem ON-DEMAND pela rota `/api/gregas` (Black-Scholes), NÃO calculadas para a
 *    cadeia inteira aqui (§6.4 #2). NÃO filtramos por liquidez aqui — o filtro é da
 *    UI via `lib/liquidez.ts`; devolvemos a cadeia INTEIRA.
 *  - `precoAtivo`: spot (fechamento) do objeto na data-base. `ivAtual`: a IV
 *    representativa MAIS RECENTE do ativo em `iv_history`, CONVERTIDA de decimal
 *    (0.2816) para PERCENTUAL (28.16) — unidade que a UI consome hoje (ver `fmtIV`).
 *
 * Server-only (toca no banco). A matemática/regra continua nos módulos puros.
 */

import { and, desc, eq } from "drizzle-orm";

import { getDb } from "@/db";
import { ivHistory, opcaoCotahist } from "@/db/schema";
import type { CadeiaOpcoes, OpcaoCadeia, SerieVencimento } from "@/lib/opcoes/tipos";

import { buscarSpot, resolverDataBase, type Db } from "./comum";

/**
 * Nota de liquidez exibida na cadeia (§6.4 #1). Sem open interest na FONTE
 * (COTAHIST não tem) — a liquidez sai de volume + nº de negócios + spread.
 */
export const NOTA_LIQUIDEZ =
  "O COTAHIST/B3 não fornece open interest (§6.4). A liquidez é avaliada por " +
  "volume (contratos no dia), número de negócios e spread (ask − bid). Não há " +
  "market maker informado na fonte.";

/** Milissegundos em um dia (para os dias corridos até o vencimento). */
const MS_POR_DIA = 24 * 60 * 60 * 1000;

/** Trata preço ausente ou ≤ 0 (COTAHIST: 0,00 = sem oferta) como "sem preço". */
function precoOuNull(valor: number): number | null {
  return valor > 0 ? valor : null;
}

/**
 * Linha de opção (já com numéricos convertidos para número) consumida pelo
 * montador puro. É o shape mínimo que `montarCadeia` precisa — desacopla a função
 * pura da forma exata da query.
 */
export interface LinhaOpcaoCadeia {
  optionSymbol: string;
  kind: "call" | "put";
  strike: number;
  expiresAt: Date;
  /** PREOFC (bid). 0 = sem oferta. */
  bid: number;
  /** PREOFV (ask). 0 = sem oferta. */
  ask: number;
  /** QUATOT — contratos negociados no dia (proxy de volume). */
  quantidadeTitulos: number;
  /** VOLTOT — volume financeiro (BRL). */
  volumeFinanceiro: number;
  /** TOTNEG — número de negócios. */
  numeroNegocios: number;
}

/** Resultado da cadeia + a data-base (as-of) para a rota carimbar o frescor. */
export interface ResultadoCadeiaCotahist {
  cadeia: CadeiaOpcoes;
  /**
   * Data-base (as-of): pregão mais recente de `opcao_cotahist` do ativo. `null`
   * quando não há cadeia ingerida (degradação) — a tela avisa "sem dados".
   */
  asOf: Date | null;
}

/** Normaliza UMA linha do COTAHIST para o domínio neutro `OpcaoCadeia`. */
function mapearLinha(l: LinhaOpcaoCadeia): OpcaoCadeia {
  const bid = precoOuNull(l.bid);
  const ask = precoOuNull(l.ask);
  const spread = bid !== null && ask !== null ? Math.max(0, ask - bid) : null;
  return {
    symbol: l.optionSymbol,
    tipo: l.kind,
    strike: l.strike,
    vencimento: l.expiresAt.toISOString(),
    tipoExercicio: null,
    tamanhoContrato: null,
    bid,
    ask,
    spread,
    volume: l.quantidadeTitulos,
    volumeFinanceiro: l.volumeFinanceiro,
    bidVolume: null,
    askVolume: null,
    negocios: l.numeroNegocios,
    marketMaker: null,
  };
}

/**
 * MONTA a `CadeiaOpcoes` neutra a partir das linhas do pregão. FUNÇÃO PURA (sem
 * banco/rede): agrupa por vencimento → strike → { call, put }, ordenado por data e
 * por strike. NÃO filtra por liquidez (a UI filtra). Exportada para teste direto.
 *
 * @param ivAtual IV representativa do ativo JÁ em PERCENTUAL (28.16), ou `null`.
 */
export function montarCadeia(params: {
  ativo: string;
  asOf: Date | null;
  spot: number | null;
  ivAtual: number | null;
  linhas: readonly LinhaOpcaoCadeia[];
}): CadeiaOpcoes {
  const { ativo, asOf, spot, ivAtual, linhas } = params;

  // Agrupa por vencimento (chave = epoch ms), preservando a opção bruta por strike.
  const porVencimento = new Map<
    number,
    { vencimento: Date; strikes: Map<number, { call: OpcaoCadeia | null; put: OpcaoCadeia | null }> }
  >();

  for (const l of linhas) {
    const chaveVenc = l.expiresAt.getTime();
    let grupo = porVencimento.get(chaveVenc);
    if (!grupo) {
      grupo = { vencimento: l.expiresAt, strikes: new Map() };
      porVencimento.set(chaveVenc, grupo);
    }
    let celula = grupo.strikes.get(l.strike);
    if (!celula) {
      celula = { call: null, put: null };
      grupo.strikes.set(l.strike, celula);
    }
    const op = mapearLinha(l);
    if (l.kind === "call") celula.call = op;
    else celula.put = op;
  }

  const vencimentos: SerieVencimento[] = [...porVencimento.values()]
    .sort((a, b) => a.vencimento.getTime() - b.vencimento.getTime())
    .map((g) => ({
      vencimento: g.vencimento.toISOString(),
      // Dias corridos da data-base ao vencimento (display "Nd"); regras de risco
      // usam dias ÚTEIS por conta própria (lib/risk-rules), não este campo.
      diasAteVencimento:
        asOf != null
          ? Math.max(0, Math.round((g.vencimento.getTime() - asOf.getTime()) / MS_POR_DIA))
          : null,
      strikes: [...g.strikes.entries()]
        .sort(([a], [b]) => a - b)
        .map(([strike, c]) => ({ strike, call: c.call, put: c.put })),
    }));

  return {
    ativo: ativo.toUpperCase(),
    precoAtivo: spot,
    ivAtual,
    vencimentos,
    openInterestDisponivel: false,
    gregasNaCadeia: false,
    notaLiquidez: NOTA_LIQUIDEZ,
  };
}

/**
 * IV representativa MAIS RECENTE do ativo em `iv_history`, convertida de DECIMAL
 * (como guardamos: 0.2816) para PERCENTUAL (28.16) — a unidade que a UI consome
 * (ver `fmtIV` em `cadeia-cliente.tsx`). `null` se o ativo ainda não tem IV diária.
 */
async function buscarIvAtual(ativo: string, db: Db): Promise<number | null> {
  const linhas = await db
    .select({ iv: ivHistory.iv })
    .from(ivHistory)
    .where(eq(ivHistory.ativo, ativo.toUpperCase()))
    .orderBy(desc(ivHistory.tradeDate))
    .limit(1);
  const iv = linhas[0]?.iv;
  return iv != null ? Number(iv) * 100 : null;
}

/**
 * Cadeia de opções estruturada do ativo a partir do COTAHIST (§6.2). Substitui
 * `getCadeiaOpcoes` da OpLab devolvendo o mesmo `CadeiaOpcoes` neutro + a data-base
 * (as-of). Sem gregas/IV por opção (on-demand pela rota) e sem open interest (§6.4).
 *
 * Degradação graciosa (§2.6): ativo sem cadeia ingerida (fora da watchlist / sem
 * ingestão) → `asOf: null` e cadeia VAZIA coerente (sem `precoAtivo`/`ivAtual`),
 * nunca lança/quebra a tela.
 */
export async function getCadeiaCotahist(
  ativo: string,
  opcoes: { db?: Db } = {},
): Promise<ResultadoCadeiaCotahist> {
  const db = opcoes.db ?? getDb();
  const simbolo = ativo.toUpperCase();

  const asOf = await resolverDataBase(simbolo, db);
  if (asOf === null) {
    // Sem cadeia ingerida: cadeia vazia coerente, sem inventar nada.
    return {
      asOf: null,
      cadeia: montarCadeia({
        ativo: simbolo,
        asOf: null,
        spot: null,
        ivAtual: null,
        linhas: [],
      }),
    };
  }

  const [spot, ivAtual, brutas] = await Promise.all([
    buscarSpot(simbolo, asOf, db),
    buscarIvAtual(simbolo, db),
    db
      .select({
        optionSymbol: opcaoCotahist.optionSymbol,
        kind: opcaoCotahist.kind,
        strike: opcaoCotahist.strike,
        expiresAt: opcaoCotahist.expiresAt,
        bid: opcaoCotahist.bid,
        ask: opcaoCotahist.ask,
        quantidadeTitulos: opcaoCotahist.quantidadeTitulos,
        volumeFinanceiro: opcaoCotahist.volumeFinanceiro,
        numeroNegocios: opcaoCotahist.numeroNegocios,
      })
      .from(opcaoCotahist)
      .where(
        and(eq(opcaoCotahist.underlying, simbolo), eq(opcaoCotahist.tradeDate, asOf)),
      ),
  ]);

  const linhas: LinhaOpcaoCadeia[] = brutas.map((b) => ({
    optionSymbol: b.optionSymbol,
    kind: b.kind,
    strike: Number(b.strike),
    expiresAt: b.expiresAt,
    bid: Number(b.bid),
    ask: Number(b.ask),
    quantidadeTitulos: Number(b.quantidadeTitulos),
    volumeFinanceiro: Number(b.volumeFinanceiro),
    numeroNegocios: b.numeroNegocios,
  }));

  return {
    asOf,
    cadeia: montarCadeia({ ativo: simbolo, asOf, spot, ivAtual, linhas }),
  };
}
