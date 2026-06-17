/**
 * Integração OpLab — cadeia de opções, volatilidade e gregas (§6.2/§6.3 do PRD).
 *
 * Contrato confirmado em `docs/apis/oplab.md`. Reutiliza o núcleo de cache
 * compartilhado (`./cache`): get-or-fetch com TTL, fallback resiliente e store
 * injetável. Acesso exige plano PRO; a chave (`OPLAB_ACCESS_TOKEN`) só existe
 * no SERVIDOR — importe este módulo apenas em Route Handlers / Server Actions.
 *
 * ⚠️ Lacunas confirmadas (§6.4) — sinalizadas, NUNCA inventadas (§2.4):
 *  - OPEN INTEREST não existe em NENHUM endpoint da OpLab. A cadeia expõe só
 *    volume + spread + market_maker como proxies de liquidez (§6.4 #1). O campo
 *    `openInterestDisponivel` da cadeia é sempre `false`.
 *  - GREGAS/IV por opção NÃO vêm na cadeia ao vivo. Use `getGregas`, que chama a
 *    calculadora Black-Scholes (`/market/options/bs`) por opção, passando a SELIC
 *    em `irate` (§6.4 #2). O campo `gregasNaCadeia` da cadeia é sempre `false`.
 *  - IV RANK/percentil existe só no ATIVO-OBJETO (`getVolatilidadeAtivo`), nunca
 *    por contrato (§6.4 #3).
 */

import { z } from "zod";

import { cacheGetOrFetch, storePadrao } from "./cache";
import type { OpcoesBusca, ResultadoIntegracao } from "./cache";

// Reexporta o erro do núcleo p/ os consumidores/testes do OpLab.
export { IntegracaoIndisponivelError } from "./cache";
export type { OpcoesBusca, ResultadoIntegracao } from "./cache";

const BASE_URL = "https://api.oplab.com.br/v3";

// ── TTL por tipo de dado (§6.2/§6.3) ─────────────────────────────────────────

/** TTL de cache, em segundos, por tipo de dado da OpLab. */
export const TTL_SEGUNDOS_OPLAB = {
  /** Cadeia: curto a médio — é a chamada mais pesada; cachear bem (§6.2). */
  cadeia: 3 * 60,
  /** Volatilidade do ativo (IV/IV Rank): muda devagar. */
  volatilidade: 15 * 60,
  /** Gregas (calculadora BS): dependem do spot, TTL curto. */
  gregas: 2 * 60,
  /** Taxa de juros (SELIC): muda raramente. */
  taxaJuros: 6 * 60 * 60,
} as const;

/** Nota de liquidez exibida na cadeia (§6.4 #1: sem open interest). */
export const NOTA_LIQUIDEZ =
  "A OpLab não fornece open interest (§6.4). A liquidez é avaliada por volume, " +
  "spread (ask − bid) e presença de market maker.";

// ── Erros ────────────────────────────────────────────────────────────────────

/** A OpLab respondeu com erro (status HTTP — inclui 402/403/429/503). */
export class OplabErroResposta extends Error {
  constructor(
    public readonly status: number,
    mensagem?: string,
  ) {
    super(`OpLab respondeu ${status}${mensagem ? `: ${mensagem}` : ""}`);
    this.name = "OplabErroResposta";
  }
}

// ── Tipos de domínio (normalizados, JSON-safe p/ cache) ──────────────────────

/** Tipo da opção normalizado para o domínio (CALL/PUT → call/put). */
export type TipoOpcao = "call" | "put";

/**
 * Uma opção da cadeia. SEM gregas/IV (vêm da calculadora BS) e SEM open
 * interest (não existe na OpLab — §6.4). Expõe os proxies de liquidez.
 */
export interface OpcaoCadeia {
  /** Ticker exato da opção (ex.: "PETRK221"). */
  symbol: string;
  tipo: TipoOpcao;
  strike: number;
  /** Vencimento (data ISO), como veio da fonte. */
  vencimento: string;
  /** AMERICAN/EUROPEAN, ou null. */
  tipoExercicio: string | null;
  tamanhoContrato: number | null;
  bid: number | null;
  ask: number | null;
  /** Spread ask − bid (≥ 0), proxy de liquidez (§8.3); null se faltar bid/ask. */
  spread: number | null;
  volume: number | null;
  volumeFinanceiro: number | null;
  bidVolume: number | null;
  askVolume: number | null;
  negocios: number | null;
  marketMaker: boolean | null;
}

/** Um vencimento da cadeia, com a grade de strikes (call/put lado a lado). */
export interface SerieVencimento {
  vencimento: string;
  diasAteVencimento: number | null;
  strikes: { strike: number; call: OpcaoCadeia | null; put: OpcaoCadeia | null }[];
}

/** Cadeia de opções estruturada de um ativo-objeto (§6.2). */
export interface CadeiaOpcoes {
  ativo: string;
  /** Preço do ativo-objeto (close/spot), ou null. */
  precoAtivo: number | null;
  /** IV atual do ATIVO (iv_current). IV por opção não vem aqui (§6.4 #3). */
  ivAtual: number | null;
  vencimentos: SerieVencimento[];
  /** Sempre `false`: a OpLab não fornece open interest (§6.4 #1). */
  openInterestDisponivel: false;
  /** Sempre `false`: gregas não vêm na cadeia; use `getGregas` (§6.4 #2). */
  gregasNaCadeia: false;
  /** Explicação da liquidez sem OI (volume + spread + market maker). */
  notaLiquidez: string;
}

/** Volatilidade do ATIVO-OBJETO — é onde mora o IV Rank (§6.4 #3). */
export interface VolatilidadeAtivo {
  ativo: string;
  ivAtual: number | null;
  ivRank1a: number | null;
  ivPercentil1a: number | null;
  ivRank6m: number | null;
  ivPercentil6m: number | null;
  ewmaAtual: number | null;
  /** Sempre `false`: IV Rank existe só no ativo, nunca por contrato (§6.4 #3). */
  ivRankPorContratoDisponivel: false;
}

/** Gregas + IV por opção, vindas da calculadora BS (`/market/options/bs`). */
export interface GregasOpcao {
  symbol: string;
  moneyness: string | null;
  /** Preço teórico Black-Scholes. */
  precoTeorico: number | null;
  delta: number | null;
  gamma: number | null;
  vega: number | null;
  theta: number | null;
  rho: number | null;
  /** Volatilidade implícita da opção (campo `volatility`). */
  iv: number | null;
  /** Probabilidade de exercício (%). */
  probExercicio: number | null;
  spotPrice: number | null;
  strike: number | null;
  margem: number | null;
}

/** Taxa de juros (SELIC/CETIP) — insumo de `irate` para as gregas BS. */
export interface TaxaJuros {
  uid: string;
  nome: string | null;
  valor: number | null;
  atualizadoEm: string | null;
}

// ── Schemas Zod ──────────────────────────────────────────────────────────────

const numeroOpcional = z.number().nullish().catch(null);
const textoOpcional = z.string().nullish().catch(null);
const boolOpcional = z.boolean().nullish().catch(null);

const opcaoStrikeSchema = z
  .object({
    symbol: z.string(),
    category: textoOpcional,
    type: textoOpcional,
    strike: z.number(),
    maturity_type: textoOpcional,
    contract_size: numeroOpcional,
    bid: numeroOpcional,
    ask: numeroOpcional,
    volume: numeroOpcional,
    financial_volume: numeroOpcional,
    bid_volume: numeroOpcional,
    ask_volume: numeroOpcional,
    trades: numeroOpcional,
    market_maker: boolOpcional,
  })
  .nullish()
  .catch(null);

const cadeiaSchema = z.object({
  symbol: z.string(),
  close: numeroOpcional,
  iv_current: numeroOpcional,
  series: z.array(
    z.object({
      due_date: z.string(),
      days_to_maturity: numeroOpcional,
      strikes: z.array(
        z.object({
          strike: z.number(),
          call: opcaoStrikeSchema,
          put: opcaoStrikeSchema,
        }),
      ),
    }),
  ),
});

const volatilidadeSchema = z.object({
  symbol: z.string(),
  iv_current: numeroOpcional,
  iv_1y_rank: numeroOpcional,
  iv_1y_percentile: numeroOpcional,
  iv_6m_rank: numeroOpcional,
  iv_6m_percentile: numeroOpcional,
  ewma_current: numeroOpcional,
});

const bsSchema = z.object({
  moneyness: textoOpcional,
  price: numeroOpcional,
  delta: numeroOpcional,
  gamma: numeroOpcional,
  vega: numeroOpcional,
  theta: numeroOpcional,
  rho: numeroOpcional,
  volatility: numeroOpcional,
  poe: numeroOpcional,
  spotprice: numeroOpcional,
  strike: numeroOpcional,
  margin: numeroOpcional,
});

const taxasSchema = z.array(
  z.object({
    uid: z.string(),
    name: textoOpcional,
    value: numeroOpcional,
    updated_at: textoOpcional,
  }),
);

// ── Chamada HTTP ─────────────────────────────────────────────────────────────

/** Chama a OpLab e devolve o JSON cru; lança `OplabErroResposta` em erro/cota. */
async function chamarOplab(
  caminho: string,
  params: Record<string, string>,
  fetchImpl: typeof fetch,
): Promise<unknown> {
  const url = new URL(`${BASE_URL}${caminho}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  // Token só no servidor, via header `Access-Token` (não na query, p/ não vazar).
  const token = process.env.OPLAB_ACCESS_TOKEN;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (token) headers["Access-Token"] = token;

  const resp = await fetchImpl(url.toString(), { headers });
  const json: unknown = await resp.json().catch(() => null);

  if (!resp.ok) {
    const mensagem =
      json && typeof json === "object" && "message" in json
        ? String((json as { message?: unknown }).message)
        : undefined;
    throw new OplabErroResposta(resp.status, mensagem);
  }
  return json;
}

// ── Mapeamento → domínio ─────────────────────────────────────────────────────

type OpcaoBruta = z.infer<typeof opcaoStrikeSchema>;

/** Normaliza uma opção da cadeia para o domínio (sem gregas/IV/OI). */
function mapearOpcao(
  bruta: OpcaoBruta,
  vencimento: string,
  tipoEsperado: TipoOpcao,
): OpcaoCadeia | null {
  if (!bruta) return null;
  const categoria = (bruta.category ?? bruta.type ?? "").toUpperCase();
  const tipo: TipoOpcao =
    categoria === "PUT" ? "put" : categoria === "CALL" ? "call" : tipoEsperado;
  const bid = bruta.bid ?? null;
  const ask = bruta.ask ?? null;
  const spread = bid !== null && ask !== null ? Math.max(0, ask - bid) : null;
  return {
    symbol: bruta.symbol,
    tipo,
    strike: bruta.strike,
    vencimento,
    tipoExercicio: bruta.maturity_type ?? null,
    tamanhoContrato: bruta.contract_size ?? null,
    bid,
    ask,
    spread,
    volume: bruta.volume ?? null,
    volumeFinanceiro: bruta.financial_volume ?? null,
    bidVolume: bruta.bid_volume ?? null,
    askVolume: bruta.ask_volume ?? null,
    negocios: bruta.trades ?? null,
    marketMaker: bruta.market_maker ?? null,
  };
}

// ── Fetchers (HTTP + parse → domínio) ────────────────────────────────────────

async function buscarCadeia(
  ativo: string,
  fetchImpl: typeof fetch,
): Promise<CadeiaOpcoes> {
  const json = await chamarOplab(
    `/market/instruments/series/${encodeURIComponent(ativo)}`,
    {},
    fetchImpl,
  );
  const c = cadeiaSchema.parse(json);
  return {
    ativo: c.symbol,
    precoAtivo: c.close ?? null,
    ivAtual: c.iv_current ?? null,
    vencimentos: c.series.map((s) => ({
      vencimento: s.due_date,
      diasAteVencimento: s.days_to_maturity ?? null,
      strikes: s.strikes.map((st) => ({
        strike: st.strike,
        call: mapearOpcao(st.call, s.due_date, "call"),
        put: mapearOpcao(st.put, s.due_date, "put"),
      })),
    })),
    openInterestDisponivel: false,
    gregasNaCadeia: false,
    notaLiquidez: NOTA_LIQUIDEZ,
  };
}

async function buscarVolatilidade(
  ativo: string,
  fetchImpl: typeof fetch,
): Promise<VolatilidadeAtivo> {
  const json = await chamarOplab(
    `/market/instruments/${encodeURIComponent(ativo)}`,
    {},
    fetchImpl,
  );
  const v = volatilidadeSchema.parse(json);
  return {
    ativo: v.symbol,
    ivAtual: v.iv_current ?? null,
    ivRank1a: v.iv_1y_rank ?? null,
    ivPercentil1a: v.iv_1y_percentile ?? null,
    ivRank6m: v.iv_6m_rank ?? null,
    ivPercentil6m: v.iv_6m_percentile ?? null,
    ewmaAtual: v.ewma_current ?? null,
    ivRankPorContratoDisponivel: false,
  };
}

/** Parâmetros da calculadora BS (§6.4 #2). `irate` é a SELIC. */
export interface ParamsGregas {
  /** Ticker exato da opção. */
  symbol: string;
  /** Taxa de juros (%) — SELIC, de `getTaxasJuros`. */
  irate: number;
  /** Volatilidade (%) usada no cálculo. */
  vol?: number;
  spotprice?: number;
  strike?: number;
  premium?: number;
  /** Dias para o vencimento. */
  dtm?: number;
  tipo?: TipoOpcao;
}

async function buscarGregas(
  p: ParamsGregas,
  fetchImpl: typeof fetch,
): Promise<GregasOpcao> {
  const params: Record<string, string> = {
    symbol: p.symbol,
    irate: String(p.irate),
  };
  if (p.vol != null) params.vol = String(p.vol);
  if (p.spotprice != null) params.spotprice = String(p.spotprice);
  if (p.strike != null) params.strike = String(p.strike);
  if (p.premium != null) params.premium = String(p.premium);
  if (p.dtm != null) params.dtm = String(p.dtm);
  if (p.tipo) params.type = p.tipo.toUpperCase();

  const json = await chamarOplab("/market/options/bs", params, fetchImpl);
  const g = bsSchema.parse(json);
  return {
    symbol: p.symbol,
    moneyness: g.moneyness ?? null,
    precoTeorico: g.price ?? null,
    delta: g.delta ?? null,
    gamma: g.gamma ?? null,
    vega: g.vega ?? null,
    theta: g.theta ?? null,
    rho: g.rho ?? null,
    iv: g.volatility ?? null,
    probExercicio: g.poe ?? null,
    spotPrice: g.spotprice ?? null,
    strike: g.strike ?? null,
    margem: g.margin ?? null,
  };
}

async function buscarTaxas(fetchImpl: typeof fetch): Promise<TaxaJuros[]> {
  const json = await chamarOplab("/market/interest_rates", {}, fetchImpl);
  const lista = taxasSchema.parse(json);
  return lista.map((t) => ({
    uid: t.uid,
    nome: t.name ?? null,
    valor: t.value ?? null,
    atualizadoEm: t.updated_at ?? null,
  }));
}

// ── API pública ──────────────────────────────────────────────────────────────

/**
 * Cadeia de opções estruturada (calls/puts por strike e vencimento) — §6.2.
 * É a chamada mais pesada: TTL curto a médio e cache agressivo. Sem gregas/IV
 * por opção e sem open interest (ver lacunas §6.4 no cabeçalho).
 */
export function getCadeiaOpcoes(
  ativo: string,
  opcoes: OpcoesBusca = {},
): Promise<ResultadoIntegracao<CadeiaOpcoes>> {
  const fetchImpl = opcoes.fetchImpl ?? globalThis.fetch;
  return cacheGetOrFetch({
    chave: `oplab:cadeia:${ativo.toUpperCase()}`,
    ttlSegundos: TTL_SEGUNDOS_OPLAB.cadeia,
    buscar: () => buscarCadeia(ativo.toUpperCase(), fetchImpl),
    store: opcoes.store ?? storePadrao(),
    agora: opcoes.agora ?? new Date(),
    forcar: opcoes.forcar ?? false,
  });
}

/**
 * IV, IV Rank e IV percentil do ATIVO-OBJETO (§6.2). IV Rank existe só aqui,
 * nunca por contrato (§6.4 #3).
 */
export function getVolatilidadeAtivo(
  ativo: string,
  opcoes: OpcoesBusca = {},
): Promise<ResultadoIntegracao<VolatilidadeAtivo>> {
  const fetchImpl = opcoes.fetchImpl ?? globalThis.fetch;
  return cacheGetOrFetch({
    chave: `oplab:volatilidade:${ativo.toUpperCase()}`,
    ttlSegundos: TTL_SEGUNDOS_OPLAB.volatilidade,
    buscar: () => buscarVolatilidade(ativo.toUpperCase(), fetchImpl),
    store: opcoes.store ?? storePadrao(),
    agora: opcoes.agora ?? new Date(),
    forcar: opcoes.forcar ?? false,
  });
}

/**
 * Gregas + IV de UMA opção via calculadora Black-Scholes (§6.4 #2). As gregas
 * NÃO vêm na cadeia ao vivo — esta é a forma de obtê-las (1 chamada por opção),
 * passando a SELIC em `irate` (de `getTaxasJuros`).
 */
export function getGregas(
  params: ParamsGregas,
  opcoes: OpcoesBusca = {},
): Promise<ResultadoIntegracao<GregasOpcao>> {
  const fetchImpl = opcoes.fetchImpl ?? globalThis.fetch;
  const chaveVol = params.vol != null ? params.vol : "";
  return cacheGetOrFetch({
    chave: `oplab:bs:${params.symbol.toUpperCase()}:${params.irate}:${chaveVol}`,
    ttlSegundos: TTL_SEGUNDOS_OPLAB.gregas,
    buscar: () => buscarGregas(params, fetchImpl),
    store: opcoes.store ?? storePadrao(),
    agora: opcoes.agora ?? new Date(),
    forcar: opcoes.forcar ?? false,
  });
}

/** Taxas de juros (SELIC/CETIP) — insumo de `irate` para as gregas BS. */
export function getTaxasJuros(
  opcoes: OpcoesBusca = {},
): Promise<ResultadoIntegracao<TaxaJuros[]>> {
  const fetchImpl = opcoes.fetchImpl ?? globalThis.fetch;
  return cacheGetOrFetch({
    chave: "oplab:taxas_juros",
    ttlSegundos: TTL_SEGUNDOS_OPLAB.taxaJuros,
    buscar: () => buscarTaxas(fetchImpl),
    store: opcoes.store ?? storePadrao(),
    agora: opcoes.agora ?? new Date(),
    forcar: opcoes.forcar ?? false,
  });
}

/**
 * OPEN INTEREST por série — NÃO existe na OpLab em endpoint nenhum (§6.4 #1).
 * Não inventamos (§2.4): a liquidez usa volume + spread + market maker (ver
 * `NOTA_LIQUIDEZ` e os campos de liquidez de `OpcaoCadeia`).
 */
export interface OpenInterestIndisponivel {
  disponivel: false;
  motivo: string;
  fonteAlternativa: string;
}

/** Sinaliza honestamente a ausência de open interest (§6.4 #1). */
export function getOpenInterest(_ativo: string): OpenInterestIndisponivel {
  return {
    disponivel: false,
    motivo:
      "A OpLab não fornece open interest (contratos em aberto) em nenhum endpoint (§6.4).",
    fonteAlternativa:
      "Avalie a liquidez por volume + spread + market maker, ou busque OI na B3/UP2DATA numa fase futura.",
  };
}
