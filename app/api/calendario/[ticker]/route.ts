/**
 * GET /api/calendario/{ticker} — calendário de eventos do ativo (DESLIGADO, 5.6).
 *
 * A busca automática de proventos/resultados foi DESLIGADA: proventos e resultados
 * são e seguem MANUAIS (o campo de data manual do montador de ticket cobre o caso
 * principal). A rota NÃO virou um CRUD; ela apenas SINALIZA indisponibilidade de
 * forma explícita e tipada (mesmo formato `{ disponivel: false, motivo,
 * fonteAlternativa }` já usado para resultados, §6.4) — nunca inventa dado (§2.4)
 * nem devolve uma lista vazia que pareça "não há evento previsto".
 *
 * Não toca mais em `lib/integrations/brapi` (que sai no 5.7).
 */
import {
  exigirSessao,
  tickerSchema,
  erroParametro,
} from "../../_lib/http";

/** Proventos não são obtidos automaticamente — input manual (§2.4). */
const PROVENTOS_INDISPONIVEL = {
  disponivel: false as const,
  motivo: "O calendário de proventos não é obtido automaticamente.",
  fonteAlternativa:
    "Confira na sua corretora ou use o campo de data manual ao montar o ticket.",
};

/** Calendário de resultados (balanços) também é manual (§6.4). */
const RESULTADOS_INDISPONIVEL = {
  disponivel: false as const,
  motivo: "O calendário de divulgação de resultados não é obtido automaticamente (§6.4).",
  fonteAlternativa:
    "Informe a data manualmente (RI da empresa, B3, Status Invest) ao montar o ticket.",
};

export async function GET(
  _request: Request,
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

  // Sem rede: a resposta é determinística e honesta (§2.4). Sem `frescor` (não há
  // dado com data de origem).
  return Response.json({
    ticker,
    proventos: PROVENTOS_INDISPONIVEL,
    resultados: RESULTADOS_INDISPONIVEL,
  });
}
