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

import { getDb } from "@/db";
import { leg, position, ticket } from "@/db/schema";

import {
  payloadSchema,
  valoresLegs,
  valoresPosition,
  valoresTicket,
  type TicketPayload,
} from "./operacao";

// Schema/mappers da criação vivem em `./operacao` (módulo puro): um arquivo
// `"use server"` só pode exportar funções async. Reexportamos o TIPO (apagado em
// runtime) para os consumidores que já importavam daqui.
export type { TicketPayload };

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

  try {
    const db = getDb();

    // 1) position — o resumo que alimenta o book (risco antes do ganho, §2).
    const [pos] = await db
      .insert(position)
      .values(valoresPosition(p))
      .returning({ id: position.id });

    const positionId = pos!.id;

    // 2) leg — uma linha por perna de opção. Gregas/IV ficam nulas aqui: são
    //    calculadas on-demand (§7) e não pertencem ao ato de registrar a operação.
    await db.insert(leg).values(valoresLegs(positionId, p));

    // 3) ticket — texto pronto (§11) + snapshot estruturado.
    await db.insert(ticket).values(valoresTicket(positionId, p));

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
