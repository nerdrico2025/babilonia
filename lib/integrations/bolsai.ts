/**
 * Integração bolsai (usebolsai.com) — fundamentos do ativo-objeto.
 *
 * Fonte NOVA dos fundamentos (substitui o brapi nesta frente; ver
 * `docs/migracao-fundamentos.md`). Devolve o tipo de domínio NEUTRO
 * `Fundamentos` (lib/fundamentos/tipos.ts), desacoplado da forma da API.
 *
 * Regras de arquitetura (§5.1, §13):
 *  - Nenhuma tela chama a bolsai direto; tudo passa por aqui + cache (§6.3).
 *  - A chave de API (`BOLSAI_API_KEY`) só existe no SERVIDOR (lida de
 *    `process.env`, enviada no header `X-API-Key`). Este módulo é server-only:
 *    importe-o apenas em Route Handlers / Server Actions, nunca no cliente.
 *  - Falha/cota degrada para o cache (mesmo vencido) com aviso; só lança o erro
 *    tipado `BolsaiIndisponivelError` quando NÃO há cache (§6.3) — o Route
 *    Handler trata explicitamente, sem `undefined` silencioso.
 *
 * Unidades (validado ao vivo — docs/migracao-fundamentos.md):
 *  - `net_margin`, `roe`, `roic`, `roa` vêm em PONTOS PERCENTUAIS (ex.: 21.69 =
 *    21,69%). NÃO normalizamos: o valor entra no domínio como veio.
 *  - `reference_date` é `YYYY-MM-DD` puro (sem hora/timezone).
 *  - `null` é valor REAL emitido pela API; valores negativos ou "fora da faixa"
 *    (P/L negativo, margem > 100) são dados legítimos — o schema não os rejeita.
 *
 * É a fonte ÚNICA de fundamentos do app (o brapi foi aposentado, 5.7).
 */

import { z } from "zod";

import type { Fundamentos } from "@/lib/fundamentos/tipos";

import { cacheGetOrFetch, storePadrao } from "./cache";
import type { OpcoesBusca, ResultadoIntegracao } from "./cache";

// Reexporta o núcleo de cache para os consumidores/testes que importam daqui.
export {
  criarCacheStoreDrizzle,
  IntegracaoIndisponivelError as BolsaiIndisponivelError,
} from "./cache";
export type {
  OpcoesBusca,
  ResultadoIntegracao,
  CacheStore,
  RegistroCache,
} from "./cache";

// ── TTL (§6.3) ───────────────────────────────────────────────────────────────

/** TTL de cache, em segundos. Fundamentos são EOD/trimestrais — não mudam intraday. */
export const TTL_SEGUNDOS = {
  fundamentos: 24 * 60 * 60,
} as const;

const BASE_URL = "https://api.usebolsai.com/api/v1";

// ── Erros ────────────────────────────────────────────────────────────────────

/** A bolsai respondeu com erro de status HTTP (inclui 429 de cota). */
export class BolsaiErroResposta extends Error {
  constructor(
    public readonly status: number,
    mensagem?: string,
  ) {
    super(`bolsai respondeu ${status}${mensagem ? `: ${mensagem}` : ""}`);
    this.name = "BolsaiErroResposta";
  }
}

// ── Schema Zod da resposta (§6.4) ────────────────────────────────────────────

/**
 * Número que pode vir `null` da API (valor real, não ausência). Aceita negativos
 * e valores fora de qualquer "faixa comum" — são dados legítimos.
 */
const numeroNulavel = z.number().nullable();

/**
 * Schema dos 14 campos que viram o domínio `Fundamentos`. NÃO é `.strict()`:
 * o payload traz ~30 campos extras (close_price, gross_margin, debt_equity…) que
 * o Zod simplesmente ignora (strip), sem erro. Não os validamos nem os mapeamos.
 */
const respostaSchema = z.object({
  ticker: z.string(),
  pl: numeroNulavel,
  ev_ebitda: numeroNulavel,
  pvp: numeroNulavel,
  net_margin: numeroNulavel,
  roe: numeroNulavel,
  roic: numeroNulavel,
  roa: numeroNulavel,
  lpa: numeroNulavel,
  vpa: numeroNulavel,
  market_cap: numeroNulavel,
  net_income: numeroNulavel,
  ebitda: numeroNulavel,
  reference_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "reference_date deve ser YYYY-MM-DD"),
  corporate_name: z.string().nullable(),
});

// ── Chamada HTTP + parse → domínio ───────────────────────────────────────────

/** Chama a bolsai e devolve o JSON cru; lança `BolsaiErroResposta` em erro/cota. */
async function chamarBolsai(ticker: string, fetchImpl: typeof fetch): Promise<unknown> {
  const url = `${BASE_URL}/fundamentals/${encodeURIComponent(ticker)}`;

  // Chave só no servidor, no header `X-API-Key`. Falta de chave é erro de config.
  const apiKey = process.env.BOLSAI_API_KEY;
  if (!apiKey) throw new BolsaiErroResposta(0, "BOLSAI_API_KEY ausente no servidor");

  const resp = await fetchImpl(url, {
    headers: { Accept: "application/json", "X-API-Key": apiKey },
  });
  const json: unknown = await resp.json().catch(() => null);
  if (!resp.ok) {
    const msg =
      json && typeof json === "object" ? JSON.stringify(json).slice(0, 200) : undefined;
    throw new BolsaiErroResposta(resp.status, msg);
  }
  return json;
}

/** HTTP + validação Zod → tipo de domínio `Fundamentos`, SEM transformar valores. */
async function buscarFundamentos(
  ticker: string,
  fetchImpl: typeof fetch,
): Promise<Fundamentos> {
  const json = await chamarBolsai(ticker, fetchImpl);
  const r = respostaSchema.parse(json);
  return {
    ticker: r.ticker,
    precoLucro: r.pl,
    evEbitda: r.ev_ebitda,
    precoValorPatrimonial: r.pvp,
    margemLiquida: r.net_margin,
    roe: r.roe,
    roic: r.roic,
    roa: r.roa,
    lpa: r.lpa,
    vpa: r.vpa,
    marketCap: r.market_cap,
    lucroLiquido: r.net_income,
    ebitda: r.ebitda,
    dataReferencia: r.reference_date,
    nomeEmpresa: r.corporate_name,
  };
}

// ── API pública ──────────────────────────────────────────────────────────────

/**
 * Fundamentos do ativo-objeto via bolsai, com cache + degradação graciosa (§6.3).
 * Devolve `ResultadoIntegracao<Fundamentos>` (com `origem`/`desatualizado`) — o
 * mesmo contrato das outras integrações; em falha sem cache lança
 * `BolsaiIndisponivelError`.
 */
export function getFundamentos(
  ticker: string,
  opcoes: OpcoesBusca = {},
): Promise<ResultadoIntegracao<Fundamentos>> {
  const fetchImpl = opcoes.fetchImpl ?? globalThis.fetch;
  return cacheGetOrFetch({
    chave: `bolsai:fundamentos:${ticker.toUpperCase()}`,
    ttlSegundos: TTL_SEGUNDOS.fundamentos,
    buscar: () => buscarFundamentos(ticker.toUpperCase(), fetchImpl),
    store: opcoes.store ?? storePadrao(),
    agora: opcoes.agora ?? new Date(),
    forcar: opcoes.forcar ?? false,
  });
}
