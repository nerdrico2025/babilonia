/**
 * historico/dominio — tipos + lógica PURA do ciclo de vida da position.
 *
 * Módulo SEM `"use server"`: um arquivo de Server Actions só pode exportar funções
 * async. Os tipos, o schema de encerramento e o planejamento puro do P&L
 * (`planejarEncerramento`) vivem aqui, e são consumidos por `./actions` (Server
 * Actions) e pelos testes.
 */

import { z } from "zod";

import { plRealizado, type PernaRealizada } from "@/lib/book";

// ── Erros tipados ─────────────────────────────────────────────────────────────

export type CodigoErroHistorico =
  | "validacao"
  | "nao_encontrada"
  | "nao_aberta"
  | "fechamento_incompleto"
  | "persistencia";

export interface ErroHistorico {
  codigo: CodigoErroHistorico;
  mensagem: string;
}

export function erro(
  codigo: CodigoErroHistorico,
  mensagem: string,
): { ok: false; erro: ErroHistorico } {
  return { ok: false, erro: { codigo, mensagem } };
}

// ── Contrato da camada de dados (injetável p/ teste) ──────────────────────────

/** Status persistido de uma position (espelha o enum `positionStatus`). */
export type StatusPosition = "aberta" | "encerrada" | "rolada";

/** Position + suas legs, no mínimo que os actions precisam. */
export interface PositionComLegs {
  position: { id: number; status: StatusPosition };
  legs: { id: number; side: "compra" | "venda"; quantity: number; premium: number }[];
}

// ── Encerramento ──────────────────────────────────────────────────────────────

export const encerrarSchema = z.object({
  /** Débito/crédito líquido de fechamento (por ação) — base da apuração. */
  exitPrice: z.number().finite(),
  /** Prêmio de fechamento por perna (por ação), referenciado pelo id da leg. */
  pernasFechamento: z
    .array(z.object({ legId: z.number().int().positive(), premioFechamento: z.number().finite() }))
    .min(1),
});

export type EncerrarInput = z.infer<typeof encerrarSchema>;

/**
 * Plano de encerramento PURO: casa cada leg ao seu prêmio de fechamento e apura o
 * P&L com `plRealizado` (H1). Falha tipada se faltar o fechamento de alguma perna.
 */
export function planejarEncerramento(
  legs: PositionComLegs["legs"],
  dados: EncerrarInput,
): { ok: true; realizedPnl: number } | { ok: false; erro: ErroHistorico } {
  const porLeg = new Map(dados.pernasFechamento.map((p) => [p.legId, p.premioFechamento]));
  const pernas: PernaRealizada[] = [];
  for (const l of legs) {
    const premioFechamento = porLeg.get(l.id);
    if (premioFechamento == null) {
      return erro(
        "fechamento_incompleto",
        `Faltou o prêmio de fechamento da perna ${l.id}. Informe o fechamento de todas as pernas.`,
      );
    }
    pernas.push({
      side: l.side,
      quantity: l.quantity,
      premioAbertura: l.premium,
      premioFechamento,
    });
  }
  return { ok: true, realizedPnl: plRealizado(pernas) };
}
