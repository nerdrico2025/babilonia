/**
 * GET /api/cadeia/{ativo} — cadeia de opções + IV/IV Rank do ativo (COTAHIST, §6.2).
 *
 * A rota consome a camada de dados própria (`lib/dados-opcoes`, COTAHIST +
 * Black-Scholes/`iv_history`). O FRESCOR é a DATA-BASE de fechamento (EOD), pois o
 * dado é ingerido por job (§5.1) e não tem cache de request. Devolve dois blocos:
 *  - `cadeia`: grade call/put por strike e vencimento (essencial — sem ela, 503);
 *  - `volatilidade`: IV atual + IV Rank/percentil do ATIVO-OBJETO (§6.4 #3 — IV
 *    Rank só existe no ativo, nunca por contrato; complementar — degrada para null).
 *
 * O frescor de cada bloco carimba o `asOf` (pregão de fechamento mais recente) do
 * respectivo módulo — o último pregão válido varia por ativo.
 *
 * ⚠️ Lacunas §6.4 repassadas honestamente pela camada de dados:
 *  - gregas/IV por opção NÃO vêm na cadeia → ver `GET /api/gregas` (on-demand);
 *  - open interest NÃO existe no COTAHIST → liquidez por volume + spread.
 */
import { getCadeiaCotahist } from "@/lib/dados-opcoes/cadeia";
import { getVolatilidadeCotahist } from "@/lib/dados-opcoes/volatilidade";

import {
  erroIntegracao,
  exigirSessao,
  frescorEod,
  tickerSchema,
  erroParametro,
  type Frescor,
} from "../../_lib/http";

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ ativo: string }> },
) {
  const negado = await exigirSessao();
  if (negado) return negado;

  const { ativo: bruto } = await ctx.params;
  const parsed = tickerSchema.safeParse(bruto);
  if (!parsed.success) {
    return erroParametro("ativo inválido", parsed.error.issues);
  }
  const ativo = parsed.data;

  try {
    // A cadeia é o dado essencial da tela. Sem data-base (ativo fora da watchlist
    // ou ainda sem COTAHIST ingerido) → 503, como hoje.
    const { cadeia, asOf } = await getCadeiaCotahist(ativo);
    if (asOf === null) {
      return Response.json(
        {
          erro: "sem dados de opções para este ativo",
          mensagem:
            "Ainda não há cadeia de opções (COTAHIST) ingerida para este ativo. " +
            "Ele pode estar fora da watchlist ou sem dados de fechamento.",
        },
        { status: 503 },
      );
    }

    // Volatilidade (IV Rank) é complementar — não derruba a cadeia se faltar. Sem
    // IV diária em `iv_history` (asOf null) ela degrada para null, como hoje.
    let volatilidade = null;
    let frescorVolatilidade: Frescor | null = null;
    try {
      const r = await getVolatilidadeCotahist(ativo);
      if (r.asOf !== null) {
        volatilidade = r.volatilidade;
        frescorVolatilidade = frescorEod(r.asOf);
      }
    } catch {
      volatilidade = null;
      frescorVolatilidade = null;
    }

    return Response.json({
      ativo,
      cadeia,
      volatilidade,
      frescor: {
        cadeia: frescorEod(asOf),
        volatilidade: frescorVolatilidade,
      },
    });
  } catch (e) {
    return erroIntegracao(e);
  }
}
