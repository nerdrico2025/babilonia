/**
 * GET /api/cadeia/{ativo} — cadeia de opções + IV/IV Rank do ativo (OpLab, §6.2).
 *
 * Proxy do §5.1: esconde o `OPLAB_ACCESS_TOKEN` (server-only) e usa a camada
 * `lib/integrations/oplab` (com cache). Devolve dois blocos com frescor próprio:
 *  - `cadeia`: grade call/put por strike e vencimento (a chamada mais pesada);
 *  - `volatilidade`: IV atual + IV Rank/percentil do ATIVO-OBJETO (§6.4 #3 — IV
 *    Rank só existe no ativo, nunca por contrato).
 *
 * ⚠️ Lacunas §6.4 sinalizadas pela própria camada e repassadas honestamente:
 *  - gregas/IV por opção NÃO vêm na cadeia → ver `GET /api/gregas`;
 *  - open interest NÃO existe na OpLab → liquidez por volume + spread + MM.
 */
import {
  getCadeiaOpcoes,
  getVolatilidadeAtivo,
} from "@/lib/integrations/oplab";

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
  const forcar = lerForcar(request.url);

  try {
    // A cadeia é o dado essencial da tela; se faltar (sem cache) a rota cai 503.
    const cadeia = await getCadeiaOpcoes(ativo, { forcar });

    // Volatilidade (IV Rank) é complementar — não derruba a cadeia se faltar.
    let volatilidade = null;
    let frescorVolatilidade = null;
    try {
      const r = await getVolatilidadeAtivo(ativo, { forcar });
      volatilidade = r.dado;
      frescorVolatilidade = frescorDe(r);
    } catch {
      volatilidade = null;
      frescorVolatilidade = null;
    }

    return Response.json({
      ativo,
      cadeia: cadeia.dado,
      volatilidade,
      frescor: {
        cadeia: frescorDe(cadeia),
        volatilidade: frescorVolatilidade,
      },
    });
  } catch (e) {
    return erroIntegracao(e);
  }
}
