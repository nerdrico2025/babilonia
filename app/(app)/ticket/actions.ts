"use server";

/**
 * Server Action da tela de TICKET (§8.6, §11): persiste a operação confirmada no
 * banco (Drizzle/Postgres), alimentando o BOOK do dashboard (§7).
 *
 * Grava três tabelas numa sequência: `position` (resumo de risco/retorno) →
 * `leg` (cada perna de opção) → `ticket` (texto pronto + snapshot). Risco antes
 * do ganho também no dado (§2): `maxRisk` e `riskDefined` vêm primeiro.
 *
 * Validação com Zod (§ convenções) porque é uma fronteira que recebe dados do
 * cliente. Degrada graciosamente: se o banco não estiver configurado/indisponível
 * (ex.: `DATABASE_URL` ausente), devolve `{ ok: false, erro }` em vez de quebrar a
 * tela — o usuário ainda consegue copiar o ticket.
 */

import { z } from "zod";

import { getDb } from "@/db";
import { leg, position, ticket } from "@/db/schema";

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

const payloadSchema = z.object({
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

/** Payload aceito pela action (inferido do schema Zod). */
export type TicketPayload = z.infer<typeof payloadSchema>;

/** Resultado da persistência. */
export type ResultadoPersistencia =
  | { ok: true; positionId: number }
  | { ok: false; erro: string };

/**
 * Persiste a `position`, suas `leg`s e o `ticket`. Devolve o id da posição criada
 * (para navegar ao book/histórico) ou um erro legível. NÃO lança — a tela trata
 * o `{ ok: false }`.
 */
export async function persistirTicket(
  entrada: TicketPayload,
): Promise<ResultadoPersistencia> {
  const parsed = payloadSchema.safeParse(entrada);
  if (!parsed.success) {
    return { ok: false, erro: "Dados do ticket inválidos para salvar." };
  }
  const p = parsed.data;
  const vencimento = new Date(p.expiresAtISO);

  try {
    const db = getDb();

    // 1) position — o resumo que alimenta o book (risco antes do ganho, §2).
    const [pos] = await db
      .insert(position)
      .values({
        underlying: p.underlying,
        structure: p.structure,
        expiresAt: vencimento,
        status: "aberta",
        maxRisk: String(p.maxRisk),
        maxGain: p.maxGain == null ? null : String(p.maxGain),
        riskDefined: p.riskDefined,
        breakevens: p.breakevens,
      })
      .returning({ id: position.id });

    const positionId = pos!.id;

    // 2) leg — uma linha por perna de opção. Gregas/IV ficam nulas aqui: são da
    //    OpLab (§7) e não pertencem ao ato de montar/registrar a operação.
    await db.insert(leg).values(
      p.pernas.map((perna) => ({
        positionId,
        optionSymbol: perna.optionSymbol,
        kind: perna.kind,
        side: perna.side,
        strike: String(perna.strike),
        expiresAt: vencimento,
        quantity: perna.quantity,
        premium: String(perna.premium),
      })),
    );

    // 3) ticket — texto pronto (§11) + snapshot estruturado.
    await db.insert(ticket).values({
      positionId,
      content: p.content,
      data: p.data,
    });

    return { ok: true, positionId };
  } catch (e) {
    // Sem banco configurado ou falha de rede: não quebra a tela (§6.3/§2.6).
    const detalhe = e instanceof Error ? e.message : "erro desconhecido";
    return {
      ok: false,
      erro: `Não foi possível salvar no banco agora (${detalhe}). O ticket continua disponível para copiar.`,
    };
  }
}
