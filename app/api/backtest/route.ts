/**
 * POST /api/backtest — SIMULAÇÃO HISTÓRICA de uma estrutura via microserviço de
 * quant (§4.1/§15 Fase 3).
 *
 * Proxy fino (§5.1): valida a entrada (Zod), exige sessão (§13) e repassa ao
 * microserviço Python (`lib/integrations/quant-service`), que carrega o histórico
 * de fechamentos e simula a evolução da estrutura. NÃO recalcula nada — série,
 * resumo (risco/ganho/pl_final) e os ajustes por provento vêm 100% do serviço. O
 * metadado de frescor (data de entrada/saída/vencimento) é repassado tal como veio.
 *
 * Erros, propositalmente separados:
 *  - serviço fora/hibernando → 503 (mensagem clara, mesmo padrão do screening);
 *  - dado insuficiente (422) / estrutura inválida (400) → repassa o status e a
 *    mensagem do serviço, para o usuário corrigir a data/estrutura (§2.4);
 *  - contrato divergente (ZodError) → 502.
 */
import { z } from "zod";

import {
  BacktestEntradaError,
  QuantServiceIndisponivelError,
  backtestEstrutura,
  type BacktestParams,
} from "@/lib/integrations/quant-service";

import { erroParametro, exigirSessao } from "../_lib/http";

/** Ticker EXATO de uma opção da B3 (raiz 4 letras + letra da série + strike). */
const optionSymbolSchema = z
  .string()
  .trim()
  .transform((s) => s.toUpperCase())
  .pipe(
    z
      .string()
      .regex(/^[A-Z]{4,6}\d{1,5}$/, "ticker de opção inválido (ex.: PETRE450)"),
  );

/** Data no formato yyyy-mm-dd (como vem de um <input type="date">). */
const dataSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "data inválida (use AAAA-MM-DD)");

/** Corpo aceito pela rota (camelCase). Espelha `BacktestParams`, com limites. */
const inputSchema = z
  .object({
    pernas: z
      .array(
        z.object({
          optionSymbol: optionSymbolSchema,
          lado: z.enum(["compra", "venda"]),
          quantidade: z.number().int().min(1).max(100_000),
        }),
      )
      .min(1)
      .max(8),
    dataEntrada: dataSchema,
    dataSaida: dataSchema.optional(),
    tamanhoLote: z.number().int().min(1).optional(),
  })
  .strict();

export async function POST(request: Request) {
  const negado = await exigirSessao();
  if (negado) return negado;

  const corpo: unknown = await request.json().catch(() => null);
  const parsed = inputSchema.safeParse(corpo ?? {});
  if (!parsed.success) {
    return erroParametro("parâmetros da simulação inválidos", parsed.error.issues);
  }

  // `parsed.data` já tem o shape de `BacktestParams` (mesmos nomes camelCase).
  const params: BacktestParams = parsed.data;

  try {
    const resultado = await backtestEstrutura(params);
    // Repasse direto: disclaimer + datas + série + resumo, sem recalcular.
    return Response.json(resultado);
  } catch (e) {
    if (e instanceof BacktestEntradaError) {
      // Resposta de NEGÓCIO do serviço (dado insuficiente / estrutura inválida):
      // repassa o status (422/400) e a mensagem para o usuário corrigir.
      return Response.json(
        {
          erro:
            e.status === 422
              ? "dados insuficientes para a simulação"
              : "estrutura inválida para a simulação",
          mensagem: e.message,
          ...(e.faltam ? { faltam: e.faltam } : {}),
        },
        { status: e.status },
      );
    }
    if (e instanceof QuantServiceIndisponivelError) {
      return Response.json(
        {
          erro: "simulação indisponível",
          mensagem:
            "A ferramenta de simulação histórica está indisponível no momento. O " +
            "serviço pode estar iniciando — tente de novo em alguns segundos.",
        },
        { status: 503 },
      );
    }
    // Resposta fora do contrato esperado (ZodError) ou erro inesperado.
    return Response.json(
      {
        erro: "resposta inesperada da simulação",
        mensagem: "O serviço de simulação respondeu em um formato inesperado.",
      },
      { status: 502 },
    );
  }
}
