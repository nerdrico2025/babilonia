/**
 * ticket/operacao — schema + mappers PUROS da criação de uma operação (§11).
 *
 * Módulo SEM `"use server"` (não é Server Action): um arquivo `"use server"` só
 * pode exportar funções async, então o schema Zod e os mappers síncronos (valores
 * de insert) vivem AQUI. É a FONTE ÚNICA do shape de criação, reutilizada por:
 *  - `persistirTicket` (ticket/actions) — cria a operação a partir da tela;
 *  - `rolarPosition` (historico/actions) — cria a NOVA operação na rolagem, com a
 *    MESMA lógica (sem duplicar o insert).
 */

import { z } from "zod";

// Famílias do enum `structureType` (§7) — espelha `FamiliaEstrutura` do catálogo.
const FAMILIAS = [
  "trava_alta",
  "trava_baixa",
  "borboleta",
  "condor",
  "straddle",
  "strangle",
  "venda_coberta",
] as const;

const pernaSchema = z.object({
  /** Ticker EXATO da opção na B3 (ex.: "PETRK221"). */
  optionSymbol: z.string().trim().min(1),
  kind: z.enum(["call", "put"]),
  side: z.enum(["compra", "venda"]),
  strike: z.number().finite(),
  quantity: z.number().int().positive(),
  premium: z.number().finite(),
});

export const payloadSchema = z.object({
  underlying: z.string().trim().min(1),
  structure: z.enum(FAMILIAS),
  /** Vencimento em ISO (menor vencimento das pernas). */
  expiresAtISO: z.string().min(1),
  /**
   * Risco máximo em BRL, sempre FINITO: no risco definido é o risco da estrutura;
   * no indefinido é a margem requerida (proxy de capital comprometido), pois não
   * há valor finito de perda máxima — `riskDefined` registra a natureza real.
   */
  maxRisk: z.number().finite().nonnegative(),
  /** Ganho máximo em BRL, ou `null` quando ilimitado. */
  maxGain: z.number().finite().nullable(),
  riskDefined: z.boolean(),
  breakevens: z.array(z.number().finite()),
  pernas: z.array(pernaSchema).min(1),
  /** Texto do ticket no formato do §11, pronto para copiar. */
  content: z.string().min(1),
  /** Snapshot estruturado (para auditoria/histórico). */
  data: z.record(z.string(), z.unknown()),
});

/** Payload aceito na criação de uma operação (inferido do schema Zod). */
export type TicketPayload = z.infer<typeof payloadSchema>;

// ── Mappers payload → linhas do banco (FONTE ÚNICA da criação) ─────────────────

/** Linha de `position` a partir do payload (nasce sempre "aberta"). */
export function valoresPosition(p: TicketPayload) {
  return {
    underlying: p.underlying,
    structure: p.structure,
    expiresAt: new Date(p.expiresAtISO),
    status: "aberta" as const,
    maxRisk: String(p.maxRisk),
    maxGain: p.maxGain == null ? null : String(p.maxGain),
    riskDefined: p.riskDefined,
    breakevens: p.breakevens,
  };
}

/** Linhas de `leg` (uma por perna) a partir do payload. */
export function valoresLegs(positionId: number, p: TicketPayload) {
  const vencimento = new Date(p.expiresAtISO);
  return p.pernas.map((perna) => ({
    positionId,
    optionSymbol: perna.optionSymbol,
    kind: perna.kind,
    side: perna.side,
    strike: String(perna.strike),
    expiresAt: vencimento,
    quantity: perna.quantity,
    premium: String(perna.premium),
  }));
}

/** Linha de `ticket` (texto §11 + snapshot) a partir do payload. */
export function valoresTicket(positionId: number, p: TicketPayload) {
  return { positionId, content: p.content, data: p.data };
}
