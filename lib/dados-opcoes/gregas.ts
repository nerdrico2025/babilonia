/**
 * dados-opcoes/gregas — GREGAS + IV de UMA opção, on-demand, a partir do COTAHIST
 * (§6.4 #2 do PRD).
 *
 * SUBSTITUTA de `getGregas` da OpLab (`lib/integrations/oplab.ts`): em vez da
 * calculadora BS remota, usa o nosso Black-Scholes PURO (`lib/options-math`),
 * devolvendo o MESMO tipo neutro `GregasOpcao` (`lib/opcoes/tipos.ts`). As gregas
 * NÃO vêm na cadeia (§6.4 #2): são calculadas por opção, sob demanda. ADITIVO: não
 * liga rotas/UI nem toca na OpLab.
 *
 * De onde vem cada número (documentado; nada inventado §2.4):
 *  - Série em `opcao_cotahist` pelo `symbol` (pregão mais recente, ou o passado):
 *    `tipo` (kind), `strike`, vencimento, prêmio MID = (bid+ask)/2, e o ativo-objeto.
 *  - `spot`: `preco_fechamento` do objeto em `acao_cotahist` na data (ou override).
 *  - `r`: SELIC CONTÍNUA do BCB-SGS na data (auto), ou override `r`.
 *  - `T`: (vencimento − data)/365 (dias corridos), alinhado à IV representativa.
 *  - `sigma`: IV resolvida pelo prêmio (`volImplicita`); se `vol` (override) vier,
 *    usa-o direto. Gregas/preço por `lib/options-math` (Black-Scholes europeu, MVP).
 *
 * UNIDADES expostas em `GregasOpcao` (alinhadas à UI):
 *  - `iv`: PERCENTUAL (28.16) — mesma unidade que `fmtIV` consome (não decimal).
 *  - `delta`/`gamma`: por +R$ 1,00 no spot. `vega`: por +1 ponto percentual de IV
 *    (convenção BR de exibição). `theta`: por PREGÃO (base 252). `rho`: por +100 p.p.
 *  - `probExercicio`: % (N(d2) para call, N(−d2) para put).
 *  - `moneyness`: rótulo ITM/ATM/OTM (string).
 *
 * NÃO calculável por esta stack → `null` (documentado):
 *  - `margem`: depende de regra de margem da B3/corretora, fora do Black-Scholes.
 *  - tudo que dependa de `sigma` quando não há IV viável NEM `vol` (não inventa).
 */

import { and, desc, eq } from "drizzle-orm";

import {
  gregas as calcularGregas,
  normalCDF,
  precoBS,
  volImplicita,
} from "@/lib/options-math";
import { getDb } from "@/db";
import { opcaoCotahist } from "@/db/schema";
import type { GregasOpcao, TipoOpcao } from "@/lib/opcoes/tipos";

import { buscarSelicContinuaNaData, buscarSpot, type Db } from "./comum";

/** Base de anualização de `T`: dias corridos / 365 (igual à IV representativa). */
const DIAS_POR_ANO = 365;
const MS_POR_DIA = 86_400_000;

/** Tolerância (relativa ao strike) para rotular ATM. */
const TOL_ATM = 0.005;

/** Rótulo de moneyness (ITM/ATM/OTM) conforme tipo, spot e strike. */
function moneynessLabel(tipo: TipoOpcao, spot: number, strike: number): string {
  if (Math.abs(spot / strike - 1) <= TOL_ATM) return "ATM";
  const itm = tipo === "call" ? spot > strike : spot < strike;
  return itm ? "ITM" : "OTM";
}

/** Entrada da montagem pura das gregas (números já resolvidos). */
export interface ParametrosMontarGregas {
  symbol: string;
  tipo: TipoOpcao;
  /** Spot do objeto (BRL/ação); `null` se indisponível. */
  spot: number | null;
  /** Strike (BRL/ação). */
  strike: number;
  /** Prêmio MID (BRL/ação) para resolver a IV; `null` se sem oferta dos dois lados. */
  premio: number | null;
  /** Tempo até o vencimento em ANOS (dias corridos/365). */
  T: number;
  /** Taxa contínua a.a. (ln(1+Selic)); `null` se indisponível. */
  r: number | null;
  /** Vol anual em PERCENTUAL (override). Se ausente, resolve a IV pelo prêmio. */
  vol?: number | null;
}

/**
 * MONTA `GregasOpcao` a partir de números já resolvidos. FUNÇÃO PURA (sem
 * banco/rede): roda o Black-Scholes do núcleo. Exportada para teste direto.
 *
 * Degrada SEM inventar: faltando spot/r/T válido, ou IV inviável sem `vol`, os
 * campos dependentes de `sigma` ficam `null` (devolve só o que se sabe: strike,
 * spot, moneyness).
 */
export function montarGregas(p: ParametrosMontarGregas): GregasOpcao {
  const base: GregasOpcao = {
    symbol: p.symbol,
    moneyness: p.spot != null ? moneynessLabel(p.tipo, p.spot, p.strike) : null,
    precoTeorico: null,
    delta: null,
    gamma: null,
    vega: null,
    theta: null,
    rho: null,
    iv: null,
    probExercicio: null,
    spotPrice: p.spot,
    strike: p.strike,
    margem: null, // regra de margem da B3/corretora — fora do Black-Scholes.
  };

  if (p.spot == null || p.r == null || !(p.T > 0) || !(p.strike > 0)) return base;

  // sigma (decimal): override `vol` (em %) tem prioridade; senão resolve pelo prêmio.
  let sigma: number | null = null;
  if (p.vol != null) {
    sigma = p.vol / 100;
  } else if (p.premio != null && p.premio > 0) {
    sigma = volImplicita({
      tipo: p.tipo,
      S: p.spot,
      K: p.strike,
      T: p.T,
      r: p.r,
      premio: p.premio,
    });
  }
  if (sigma == null || !(sigma > 0)) return base; // sem IV viável e sem vol.

  const bs = { tipo: p.tipo, S: p.spot, K: p.strike, T: p.T, r: p.r, sigma };
  const g = calcularGregas(bs);

  // d2 para a probabilidade de exercício: N(d2) (call) / N(−d2) (put).
  const vsqrtT = sigma * Math.sqrt(p.T);
  const d1 =
    (Math.log(p.spot / p.strike) + (p.r + (sigma * sigma) / 2) * p.T) / vsqrtT;
  const d2 = d1 - vsqrtT;
  const poe = p.tipo === "call" ? normalCDF(d2) : normalCDF(-d2);

  return {
    ...base,
    precoTeorico: precoBS(bs),
    delta: g.delta,
    gamma: g.gama,
    vega: g.vegaPorPonto, // por +1 p.p. de IV (convenção de exibição BR)
    theta: g.thetaPorPregao, // por pregão (base 252)
    rho: g.rho,
    iv: sigma * 100, // decimal → percentual (unidade da UI)
    probExercicio: poe * 100, // %
  };
}

/** Overrides/ajustes de `getGregasCotahist` (todos opcionais). */
export interface OpcoesGregas {
  db?: Db;
  /** Pregão a usar (default: o mais recente do `symbol` em `opcao_cotahist`). */
  tradeDate?: Date;
  /**
   * Taxa CONTÍNUA a.a. (`r` do Black-Scholes, ex.: ln(1+Selic) ≈ 0.0953). Se
   * omitida, busca a SELIC contínua do BCB-SGS na data (auto-preenchimento).
   */
  r?: number;
  /** Vol anual em PERCENTUAL (override) — se ausente, IV resolvida pelo prêmio. */
  vol?: number;
  /** Spot do objeto (BRL/ação) — override do `acao_cotahist`. */
  spotprice?: number;
  /** Strike (BRL/ação) — override. */
  strike?: number;
  /** Prêmio (BRL/ação) — override do MID. */
  premium?: number;
  /** Dias corridos até o vencimento — override (T = dtm/365). */
  dtm?: number;
  /** Tipo (call/put) — override. */
  tipo?: TipoOpcao;
  /** `fetch` injetável para o BCB-SGS (teste). */
  fetchImpl?: typeof fetch;
}

/**
 * Gregas + IV de UMA opção a partir do COTAHIST, sob demanda. Ver o cabeçalho do
 * módulo para a origem de cada número e as unidades. Lança se o `symbol` não existe
 * em `opcao_cotahist` (deve vir da cadeia); demais ausências degradam para `null`.
 */
export async function getGregasCotahist(
  symbol: string,
  opcoes: OpcoesGregas = {},
): Promise<GregasOpcao> {
  const db = opcoes.db ?? getDb();
  const sym = symbol.toUpperCase();

  // 1) Série pelo symbol: a do pregão passado, ou a mais recente do symbol.
  const cond = opcoes.tradeDate
    ? and(
        eq(opcaoCotahist.optionSymbol, sym),
        eq(opcaoCotahist.tradeDate, opcoes.tradeDate),
      )
    : eq(opcaoCotahist.optionSymbol, sym);

  const linhas = await db
    .select({
      kind: opcaoCotahist.kind,
      strike: opcaoCotahist.strike,
      expiresAt: opcaoCotahist.expiresAt,
      tradeDate: opcaoCotahist.tradeDate,
      bid: opcaoCotahist.bid,
      ask: opcaoCotahist.ask,
      underlying: opcaoCotahist.underlying,
    })
    .from(opcaoCotahist)
    .where(cond)
    .orderBy(desc(opcaoCotahist.tradeDate))
    .limit(1);

  const row = linhas[0];
  if (!row) {
    throw new Error(`opção não encontrada em opcao_cotahist: ${sym}`);
  }

  const tipo = opcoes.tipo ?? row.kind;
  const strike = opcoes.strike ?? Number(row.strike);
  const tradeDate = row.tradeDate;

  // 2) Prêmio MID (override > MID com oferta dos DOIS lados > null).
  const bid = Number(row.bid);
  const ask = Number(row.ask);
  const mid = bid > 0 && ask > 0 ? (bid + ask) / 2 : null;
  const premio = opcoes.premium ?? mid;

  // 3) Spot: override > acao_cotahist do objeto na data (null se sem vínculo/linha).
  let spot: number | null = opcoes.spotprice ?? null;
  if (spot == null && row.underlying) {
    spot = await buscarSpot(row.underlying, tradeDate, db);
  }

  // 4) r: override > SELIC contínua do BCB-SGS na data.
  let r: number | null = opcoes.r ?? null;
  if (r == null) {
    r = await buscarSelicContinuaNaData(tradeDate, { fetchImpl: opcoes.fetchImpl });
  }

  // 5) T (anos, dias corridos/365): dtm override, senão (vencimento − data)/365.
  const T =
    opcoes.dtm != null
      ? opcoes.dtm / DIAS_POR_ANO
      : (row.expiresAt.getTime() - tradeDate.getTime()) / MS_POR_DIA / DIAS_POR_ANO;

  return montarGregas({ symbol: sym, tipo, spot, strike, premio, T, r, vol: opcoes.vol });
}
