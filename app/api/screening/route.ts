/**
 * POST /api/screening — TRIAGEM de estruturas via microserviço de quant (§4.1/§15).
 *
 * Proxy fino (§5.1): valida a entrada (Zod), exige sessão (§13) e repassa ao
 * microserviço Python (`lib/integrations/quant-service`), que varre a cadeia e
 * ranqueia estruturas de risco DEFINIDO. NÃO recalcula nada — os números vêm 100%
 * do serviço (mesmas fórmulas do §18). O metadado de FRESCOR (data-base por ativo)
 * é repassado tal como veio.
 *
 * Degradação graciosa (§6.3): serviço fora/hibernando → 503 com mensagem clara
 * ("ferramenta de triagem indisponível"); contrato divergente → 502.
 */
import { z } from "zod";

import {
  QuantServiceIndisponivelError,
  TIPOS_ESTRUTURA,
  screenarCadeia,
  type ScreeningParams,
} from "@/lib/integrations/quant-service";

import { erroParametro, exigirSessao, tickerSchema } from "../_lib/http";

/** Corpo aceito pela rota (camelCase). Espelha `ScreeningParams`, com limites. */
const inputSchema = z
  .object({
    tickers: z.array(tickerSchema).min(1).max(20).optional(),
    tipos: z.array(z.enum(TIPOS_ESTRUTURA)).min(1).optional(),
    topN: z.number().int().min(1).max(100).optional(),
    capitalTotal: z.number().positive().optional(),
    riscoMaxPct: z.number().positive().max(1).optional(),
    vencimentoMinDias: z.number().int().min(0).optional(),
    vencimentoMaxDias: z.number().int().min(0).optional(),
    maxVencimentos: z.number().int().min(1).max(12).optional(),
    maxStrikesPorLado: z.number().int().min(1).max(50).optional(),
    tamanhoLote: z.number().int().min(1).optional(),
  })
  .strict();

export async function POST(request: Request) {
  const negado = await exigirSessao();
  if (negado) return negado;

  const corpo: unknown = await request.json().catch(() => null);
  const parsed = inputSchema.safeParse(corpo ?? {});
  if (!parsed.success) {
    return erroParametro("parâmetros da triagem inválidos", parsed.error.issues);
  }

  // `parsed.data` já tem o shape de `ScreeningParams` (mesmos nomes camelCase).
  const params: ScreeningParams = parsed.data;

  try {
    const resultado = await screenarCadeia(params);
    // Repasse direto: aviso de triagem + frescor + ranking, sem recalcular.
    return Response.json(resultado);
  } catch (e) {
    if (e instanceof QuantServiceIndisponivelError) {
      return Response.json(
        {
          erro: "triagem indisponível",
          mensagem:
            "A ferramenta de triagem está indisponível no momento. O serviço pode " +
            "estar iniciando — tente de novo em alguns segundos.",
        },
        { status: 503 },
      );
    }
    // Resposta fora do contrato esperado (ZodError) ou erro inesperado.
    return Response.json(
      {
        erro: "resposta inesperada da triagem",
        mensagem: "O serviço de triagem respondeu em um formato inesperado.",
      },
      { status: 502 },
    );
  }
}
