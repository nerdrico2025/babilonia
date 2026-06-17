/**
 * GET /api/calendario/{ticker} — calendário de eventos do ativo (brapi, §6.1).
 *
 * Proxy do §5.1 (esconde o `BRAPI_TOKEN`, usa cache de `lib/integrations`).
 * Reúne os eventos que o app acompanha:
 *  - `proventos`: dividendos/JCP anunciados (brapi Startup) — com frescor;
 *  - `resultados`: datas de divulgação de balanços. O brapi NÃO fornece isso em
 *    plano nenhum (§6.4) — devolvemos a sinalização honesta (NUNCA inventamos,
 *    §2.4), com a fonte alternativa (input manual).
 */
import {
  getCalendarioProventos,
  getCalendarioResultados,
} from "@/lib/integrations/brapi";

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
  const negado = await exigirSessao();
  if (negado) return negado;

  const { ticker: bruto } = await ctx.params;
  const parsed = tickerSchema.safeParse(bruto);
  if (!parsed.success) {
    return erroParametro("ticker inválido", parsed.error.issues);
  }
  const ticker = parsed.data;
  const forcar = lerForcar(request.url);

  // Resultados não dependem de rede: é uma indisponibilidade por design (§6.4).
  const resultados = getCalendarioResultados(ticker);

  try {
    const proventos = await getCalendarioProventos(ticker, { forcar });
    return Response.json({
      ticker,
      proventos: proventos.dado,
      resultados, // { disponivel: false, motivo, fonteAlternativa }
      frescor: {
        proventos: frescorDe(proventos),
      },
    });
  } catch (e) {
    return erroIntegracao(e);
  }
}
