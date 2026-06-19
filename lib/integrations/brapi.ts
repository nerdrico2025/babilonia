/**
 * Integração brapi.dev — cotação, fundamentos e proventos do ativo-objeto.
 *
 * Contrato confirmado em `docs/apis/brapi.md` e §6.1/§6.3 do PRD.
 *
 * Regras de arquitetura (§5.1, §13):
 *  - Nenhuma tela chama o brapi direto; tudo passa por aqui + cache (§6.3).
 *  - A chave de API (`BRAPI_TOKEN`) só existe no SERVIDOR (lida de `process.env`).
 *    Este módulo é server-only: importe-o apenas em Route Handlers / Server
 *    Actions, nunca em código de cliente.
 *  - Falha/cota degrada para o cache com aviso; NUNCA derruba a tela (§6.3).
 *
 * Escopo por plano (docs/apis/brapi.md):
 *  - `getCotacao` funciona no plano **Free** (e nos tickers de teste sem token).
 *  - `getFundamentos` e `getCalendarioProventos` exigem o plano **Startup**
 *    (no Free a brapi não devolve esses blocos). No MVP os fundamentos/proventos
 *    são INPUT MANUAL (§6.1); estas funções existem para a evolução da Fase 2
 *    sem tocar na UI — basta o token do plano pago.
 *  - `getCalendarioResultados` NÃO existe no brapi em nenhum plano (§6.4).
 */

import { z } from "zod";

import { cacheGetOrFetch, storePadrao } from "./cache";
import type { OpcoesBusca, ResultadoIntegracao } from "./cache";

// Reexporta o núcleo de cache para os consumidores/testes que importam a partir
// de `brapi.ts`.
export {
  criarCacheStoreDrizzle,
  IntegracaoIndisponivelError as BrapiIndisponivelError,
} from "./cache";
export type {
  OpcoesBusca,
  ResultadoIntegracao,
  CacheStore,
  RegistroCache,
} from "./cache";

// ── TTL por tipo de dado (§6.3) ──────────────────────────────────────────────

/** TTL de cache, em segundos, por tipo de dado. */
export const TTL_SEGUNDOS = {
  /** Cotação: curto. O Free já atrasa ~30 min, então cache agressivo ajuda. */
  cotacao: 5 * 60,
  /** Fundamentos: longo (mudam pouco no intraday). */
  fundamentos: 12 * 60 * 60,
  /** Proventos: longo (agenda muda no máximo algumas vezes ao dia). */
  proventos: 24 * 60 * 60,
} as const;

const BASE_URL = "https://brapi.dev/api";

// ── Erros ────────────────────────────────────────────────────────────────────

/** A brapi respondeu com erro (status HTTP ou envelope `{ error: true }`). */
export class BrapiErroResposta extends Error {
  constructor(
    public readonly status: number,
    mensagem?: string,
    public readonly codigo?: string,
  ) {
    super(`brapi respondeu ${status}${mensagem ? `: ${mensagem}` : ""}`);
    this.name = "BrapiErroResposta";
  }
}

// ── Tipos de domínio (normalizados, JSON-safe p/ cache) ──────────────────────

/** Cotação do ativo-objeto (§6.1). */
export interface BrapiCotacao {
  ticker: string;
  /** Preço atual em BRL. */
  preco: number;
  /** Variação absoluta no dia (BRL). */
  variacao: number;
  /** Variação percentual no dia. */
  variacaoPercent: number;
  /** Volume negociado no dia. */
  volume: number;
  /** Horário da cotação (ISO) como veio da fonte, ou null. */
  horaCotacao: string | null;
  moeda: string;
}

/** Lucro líquido de um trimestre (DRE trimestral). */
export interface LucroTrimestre {
  /** Fim do trimestre (data ISO), como veio da fonte. */
  fim: string | null;
  lucroLiquido: number | null;
}

/** Fundamentos resumidos (§6.1) — exigem plano Startup. */
export interface BrapiFundamentos {
  ticker: string;
  /** P/L. */
  precoLucro: number | null;
  /** EV/EBITDA. */
  evEbitda: number | null;
  /** P/VP. */
  precoValorPatrimonial: number | null;
  margemBruta: number | null;
  margemOperacional: number | null;
  margemLiquida: number | null;
  dividendYield: number | null;
  lucrosPorTrimestre: LucroTrimestre[];
}

/** Provento (dividendo/JCP) já anunciado (`dividendsData.cashDividends[]`). */
export interface BrapiProvento {
  ativoEmitido: string | null;
  dataPagamento: string | null;
  valor: number | null;
  referente: string | null;
  aprovadoEm: string | null;
  isin: string | null;
  tipo: string | null;
}

/** Calendário de resultados não existe no brapi (§6.4) — resposta honesta. */
export interface ResultadosIndisponivel {
  disponivel: false;
  motivo: string;
  fonteAlternativa: string;
}

// ── Chamada HTTP + validação (Zod) ───────────────────────────────────────────

/** Envelope da brapi: `{ results: [...], requestedAt, took }`. */
function envelope<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    results: z.array(item),
    requestedAt: z.string().optional(),
    took: z.number().optional(),
  });
}

/** Número opcional tolerante (ausente/null/tipo errado → null). */
const numeroOpcional = z.number().nullish().catch(null);
const textoOpcional = z.string().nullish().catch(null);

const itemCotacaoSchema = z.object({
  symbol: z.string(),
  regularMarketPrice: z.number(),
  regularMarketChange: z.number(),
  regularMarketChangePercent: z.number(),
  regularMarketVolume: z.number(),
  regularMarketTime: z.string().optional(),
  currency: z.string().optional(),
});

// ⚠️ Estrutura interna dos módulos de fundamentos "a confirmar ao vivo"
// (docs/apis/brapi.md). Schemas tolerantes: campo ausente vira null.
const itemFundamentosSchema = z.object({
  symbol: z.string(),
  priceEarnings: numeroOpcional,
  defaultKeyStatistics: z
    .object({
      enterpriseToEbitda: numeroOpcional,
      priceToBook: numeroOpcional,
      dividendYield: numeroOpcional,
    })
    .nullish()
    .catch(null),
  financialData: z
    .object({
      grossMargins: numeroOpcional,
      operatingMargins: numeroOpcional,
      profitMargins: numeroOpcional,
    })
    .nullish()
    .catch(null),
  incomeStatementHistoryQuarterly: z
    .object({
      incomeStatementHistory: z
        .array(z.object({ endDate: textoOpcional, netIncome: numeroOpcional }))
        .nullish()
        .catch(null),
    })
    .nullish()
    .catch(null),
});

const cashDividendoSchema = z.object({
  assetIssued: textoOpcional,
  paymentDate: textoOpcional,
  rate: numeroOpcional,
  relatedTo: textoOpcional,
  approvedOn: textoOpcional,
  isinCode: textoOpcional,
  label: textoOpcional,
});

const itemProventosSchema = z.object({
  symbol: z.string(),
  dividendsData: z
    .object({ cashDividends: z.array(cashDividendoSchema).nullish().catch(null) })
    .nullish()
    .catch(null),
});

/** Chama a brapi e devolve o JSON cru; lança `BrapiErroResposta` em erro/cota. */
async function chamarBrapi(
  caminho: string,
  params: Record<string, string>,
  fetchImpl: typeof fetch,
): Promise<unknown> {
  const url = new URL(`${BASE_URL}${caminho}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  // Token só no servidor, via header (não vai na query para não vazar em logs).
  const token = process.env.BRAPI_TOKEN;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  const resp = await fetchImpl(url.toString(), { headers });
  const json: unknown = await resp.json().catch(() => null);

  // Erro por status (inclui 429 de cota) ou pelo envelope `{ error: true }`.
  const envErro =
    json && typeof json === "object" && "error" in json
      ? (json as { error?: unknown; message?: string; code?: string })
      : null;
  if (!resp.ok || (envErro && envErro.error)) {
    throw new BrapiErroResposta(resp.status, envErro?.message, envErro?.code);
  }
  return json;
}

// ── Fetchers (HTTP + parse → domínio) ────────────────────────────────────────

async function buscarCotacao(
  ticker: string,
  fetchImpl: typeof fetch,
): Promise<BrapiCotacao> {
  const json = await chamarBrapi(`/quote/${encodeURIComponent(ticker)}`, {}, fetchImpl);
  const env = envelope(itemCotacaoSchema).parse(json);
  const r = env.results[0];
  if (!r) throw new BrapiErroResposta(404, "ticker sem resultado", "NOT_FOUND");
  return {
    ticker: r.symbol,
    preco: r.regularMarketPrice,
    variacao: r.regularMarketChange,
    variacaoPercent: r.regularMarketChangePercent,
    volume: r.regularMarketVolume,
    horaCotacao: r.regularMarketTime ?? null,
    moeda: r.currency ?? "BRL",
  };
}

async function buscarFundamentos(
  ticker: string,
  fetchImpl: typeof fetch,
): Promise<BrapiFundamentos> {
  const json = await chamarBrapi(
    `/quote/${encodeURIComponent(ticker)}`,
    {
      fundamental: "true",
      modules:
        "defaultKeyStatistics,financialData,incomeStatementHistoryQuarterly,summaryProfile",
    },
    fetchImpl,
  );
  const env = envelope(itemFundamentosSchema).parse(json);
  const r = env.results[0];
  if (!r) throw new BrapiErroResposta(404, "ticker sem resultado", "NOT_FOUND");

  const dks = r.defaultKeyStatistics ?? null;
  const fin = r.financialData ?? null;
  const trimestres =
    r.incomeStatementHistoryQuarterly?.incomeStatementHistory ?? [];

  return {
    ticker: r.symbol,
    precoLucro: r.priceEarnings ?? null,
    evEbitda: dks?.enterpriseToEbitda ?? null,
    precoValorPatrimonial: dks?.priceToBook ?? null,
    margemBruta: fin?.grossMargins ?? null,
    margemOperacional: fin?.operatingMargins ?? null,
    margemLiquida: fin?.profitMargins ?? null,
    dividendYield: dks?.dividendYield ?? null,
    lucrosPorTrimestre: trimestres.map((t) => ({
      fim: t.endDate ?? null,
      lucroLiquido: t.netIncome ?? null,
    })),
  };
}

async function buscarProventos(
  ticker: string,
  fetchImpl: typeof fetch,
): Promise<BrapiProvento[]> {
  const json = await chamarBrapi(
    `/quote/${encodeURIComponent(ticker)}`,
    { dividends: "true" },
    fetchImpl,
  );
  const env = envelope(itemProventosSchema).parse(json);
  const r = env.results[0];
  if (!r) throw new BrapiErroResposta(404, "ticker sem resultado", "NOT_FOUND");
  const lista = r.dividendsData?.cashDividends ?? [];
  return lista.map((d) => ({
    ativoEmitido: d.assetIssued ?? null,
    dataPagamento: d.paymentDate ?? null,
    valor: d.rate ?? null,
    referente: d.relatedTo ?? null,
    aprovadoEm: d.approvedOn ?? null,
    isin: d.isinCode ?? null,
    tipo: d.label ?? null,
  }));
}

// ── API pública ──────────────────────────────────────────────────────────────

/** Cotação do ativo-objeto (preço, variação, volume) — §6.1, plano Free. */
export function getCotacao(
  ticker: string,
  opcoes: OpcoesBusca = {},
): Promise<ResultadoIntegracao<BrapiCotacao>> {
  const fetchImpl = opcoes.fetchImpl ?? globalThis.fetch;
  return cacheGetOrFetch({
    chave: `brapi:quote:${ticker.toUpperCase()}`,
    ttlSegundos: TTL_SEGUNDOS.cotacao,
    buscar: () => buscarCotacao(ticker.toUpperCase(), fetchImpl),
    store: opcoes.store ?? storePadrao(),
    agora: opcoes.agora ?? new Date(),
    forcar: opcoes.forcar ?? false,
  });
}

/** Fundamentos resumidos — §6.1 (exige plano Startup; ver cabeçalho). */
export function getFundamentos(
  ticker: string,
  opcoes: OpcoesBusca = {},
): Promise<ResultadoIntegracao<BrapiFundamentos>> {
  const fetchImpl = opcoes.fetchImpl ?? globalThis.fetch;
  return cacheGetOrFetch({
    chave: `brapi:fundamentos:${ticker.toUpperCase()}`,
    ttlSegundos: TTL_SEGUNDOS.fundamentos,
    buscar: () => buscarFundamentos(ticker.toUpperCase(), fetchImpl),
    store: opcoes.store ?? storePadrao(),
    agora: opcoes.agora ?? new Date(),
    forcar: opcoes.forcar ?? false,
  });
}

/** Calendário de proventos (dividendos/JCP anunciados) — §6.1 (Startup). */
export function getCalendarioProventos(
  ticker: string,
  opcoes: OpcoesBusca = {},
): Promise<ResultadoIntegracao<BrapiProvento[]>> {
  const fetchImpl = opcoes.fetchImpl ?? globalThis.fetch;
  return cacheGetOrFetch({
    chave: `brapi:proventos:${ticker.toUpperCase()}`,
    ttlSegundos: TTL_SEGUNDOS.proventos,
    buscar: () => buscarProventos(ticker.toUpperCase(), fetchImpl),
    store: opcoes.store ?? storePadrao(),
    agora: opcoes.agora ?? new Date(),
    forcar: opcoes.forcar ?? false,
  });
}

/**
 * Calendário de RESULTADOS (datas de divulgação de balanços). O brapi NÃO
 * fornece isso em nenhum plano (§6.4). Não inventamos (§2.4): devolvemos uma
 * resposta honesta apontando a fonte alternativa (input manual no §8.2).
 */
export function getCalendarioResultados(_ticker: string): ResultadosIndisponivel {
  return {
    disponivel: false,
    motivo:
      "O brapi não fornece calendário de divulgação de resultados em nenhum plano (§6.4).",
    fonteAlternativa:
      "Use input manual (§8.2) ou fonte externa (RI da empresa, B3, Status Invest).",
  };
}
