/**
 * GET /api/ativo/{ticker} — cotação + fundamentos do ativo-objeto (brapi, §6.1).
 *
 * Proxy do §5.1: a tela NUNCA chama o brapi direto — passa por aqui, que esconde
 * o `BRAPI_TOKEN` (server-only) e usa a camada `lib/integrations` (com cache).
 * Cada bloco vem com seu metadado de frescor (§6.3).
 *
 * Fundamentos exigem plano Startup do brapi; no plano Free os campos voltam
 * `null` (a integração não quebra). Se o brapi cair sem cache, a cotação (dado
 * essencial) derruba a rota com 503; os fundamentos degradam para `null`.
 */
import { getCotacao, getFundamentos } from "@/lib/integrations/brapi";

import {
  erroIntegracao,
  exigirSessao,
  frescorDe,
  lerForcar,
  tickerSchema,
  erroParametro,
} from "../../_lib/http";

export async function GET(
  request: Request,
  ctx: { params: Promise<{ ticker: string }> },
) {
  // 1) Sessão (§13) — 401 JSON se não autenticado.
  const negado = await exigirSessao();
  if (negado) return negado;

  // 2) Valida o parâmetro de entrada (Zod) antes de gastar chamada externa.
  const { ticker: bruto } = await ctx.params;
  const parsed = tickerSchema.safeParse(bruto);
  if (!parsed.success) {
    return erroParametro("ticker inválido", parsed.error.issues);
  }
  const ticker = parsed.data;
  const forcar = lerForcar(request.url);

  // 3) Camada de integração (com cache). Cotação é essencial; fundamentos são
  //    "best-effort" (plano/cobertura variam) — não derrubam a rota.
  try {
    const cotacao = await getCotacao(ticker, { forcar });

    let fundamentos = null;
    let frescorFundamentos = null;
    try {
      const r = await getFundamentos(ticker, { forcar });
      fundamentos = r.dado;
      frescorFundamentos = frescorDe(r);
    } catch {
      // Fundamentos indisponíveis (sem plano/sem cache) não quebram a tela.
      fundamentos = null;
      frescorFundamentos = null;
    }

    return Response.json({
      ticker,
      cotacao: cotacao.dado,
      fundamentos,
      frescor: {
        cotacao: frescorDe(cotacao),
        fundamentos: frescorFundamentos,
      },
    });
  } catch (e) {
    // Cotação sem cache disponível: o dado essencial faltou (§6.3).
    return erroIntegracao(e);
  }
}
