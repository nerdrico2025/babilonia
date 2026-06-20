"use server";

/**
 * Server Actions do ciclo de vida da position (§12, §18): ENCERRAR e ROLAR.
 *
 * Primeiro `db.update(position)` do app — move o status `aberta → encerrada/rolada`,
 * apura o P&L realizado (encerramento) e registra o vínculo da rolagem. Não
 * recalcula matemática: reaproveita `plRealizado` (lib/book, H1) e os mappers de
 * criação de operação de `ticket/actions` (não duplica o insert).
 *
 * ATOMICIDADE: tudo roda dentro de UMA transação interativa (`comTransacao` →
 * Pool/WebSocket; o `neon-http` não suporta). Erro tipado de negócio (não
 * encontrada / não aberta / fechamento incompleto) retorna `{ ok:false }` SEM
 * escrever; erro de escrita LANÇA e a transação faz ROLLBACK (nada persiste pela
 * metade — ex.: na rolagem, a antiga nunca fica "rolada" apontando p/ uma nova que
 * falhou). A camada de dados é injetável (`executarTx`) para teste sem banco.
 */

import { z } from "zod";

import { comTransacao, type TxNeon } from "@/db";
import { leg, position, ticket } from "@/db/schema";
import { eq } from "drizzle-orm";

import {
  payloadSchema,
  valoresLegs,
  valoresPosition,
  valoresTicket,
  type TicketPayload,
} from "../ticket/operacao";
import {
  encerrarSchema,
  erro,
  planejarEncerramento,
  type EncerrarInput,
  type ErroHistorico,
  type PositionComLegs,
} from "./dominio";

// Reexporta os tipos do domínio para quem importava daqui (apagados em runtime).
export type {
  CodigoErroHistorico,
  ErroHistorico,
  StatusPosition,
  PositionComLegs,
  EncerrarInput,
} from "./dominio";

// ── Contrato da camada de dados (injetável p/ teste) ──────────────────────────

/** Operações da transação (a impl. de produção usa Drizzle/tx; o teste, memória). */
export interface CtxTx {
  buscarPositionComLegs(id: number): Promise<PositionComLegs | null>;
  encerrar(
    id: number,
    dados: { exitPrice: number; realizedPnl: number; closedAt: Date },
  ): Promise<void>;
  criarOperacao(payload: TicketPayload): Promise<number>;
  marcarRolada(id: number, novaPositionId: number, closedAt: Date): Promise<void>;
}

/** Runner transacional: roda `fn` com rollback automático em erro. */
export type ExecutarTx = <T>(fn: (ctx: CtxTx) => Promise<T>) => Promise<T>;

/** Ctx de PRODUÇÃO sobre uma transação Drizzle (Pool/WebSocket). */
function ctxDrizzle(tx: TxNeon): CtxTx {
  return {
    async buscarPositionComLegs(id) {
      const [pos] = await tx
        .select({ id: position.id, status: position.status })
        .from(position)
        .where(eq(position.id, id))
        .limit(1);
      if (!pos) return null;
      const legs = await tx
        .select({
          id: leg.id,
          side: leg.side,
          quantity: leg.quantity,
          premium: leg.premium,
        })
        .from(leg)
        .where(eq(leg.positionId, id));
      return {
        position: { id: pos.id, status: pos.status },
        legs: legs.map((l) => ({
          id: l.id,
          side: l.side,
          quantity: l.quantity,
          premium: Number(l.premium),
        })),
      };
    },
    async encerrar(id, dados) {
      await tx
        .update(position)
        .set({
          status: "encerrada",
          closedAt: dados.closedAt,
          exitPrice: String(dados.exitPrice),
          realizedPnl: String(dados.realizedPnl),
        })
        .where(eq(position.id, id));
    },
    async criarOperacao(payload) {
      // MESMA lógica de `persistirTicket` (mappers compartilhados), agora dentro da tx.
      const [pos] = await tx
        .insert(position)
        .values(valoresPosition(payload))
        .returning({ id: position.id });
      const novaId = pos!.id;
      await tx.insert(leg).values(valoresLegs(novaId, payload));
      await tx.insert(ticket).values(valoresTicket(novaId, payload));
      return novaId;
    },
    async marcarRolada(id, novaPositionId, closedAt) {
      // Rolagem NÃO apura P&L da antiga: o payload é a operação NOVA e não traz os
      // prêmios de fechamento das pernas antigas — `exitPrice`/`realizedPnl` ficam
      // null (não inventar dado, §2.4). Para apurar o resultado da rolagem, encerre
      // explicitamente com os prêmios (futuro). Aqui só o vínculo + a transição.
      await tx
        .update(position)
        .set({ status: "rolada", closedAt, rolledIntoPositionId: novaPositionId })
        .where(eq(position.id, id));
    },
  };
}

/** Runner de produção: transação interativa real (rollback automático). */
const executarTxPadrao: ExecutarTx = (fn) => comTransacao((tx) => fn(ctxDrizzle(tx)));

// ── Encerrar ──────────────────────────────────────────────────────────────────

export type ResultadoEncerrar =
  | { ok: true; realizedPnl: number }
  | { ok: false; erro: ErroHistorico };

/**
 * Encerra uma position aberta: apura o P&L realizado e grava status/closedAt/
 * exitPrice/realizedPnl. Não move posições já encerradas/roladas.
 */
export async function encerrarPosition(
  positionId: number,
  dados: EncerrarInput,
  opcoes: { executarTx?: ExecutarTx } = {},
): Promise<ResultadoEncerrar> {
  const idOk = z.number().int().positive().safeParse(positionId);
  const parsed = encerrarSchema.safeParse(dados);
  if (!idOk.success || !parsed.success) {
    return erro("validacao", "Dados de encerramento inválidos para salvar.");
  }
  const executarTx = opcoes.executarTx ?? executarTxPadrao;

  try {
    return await executarTx(async (ctx) => {
      const reg = await ctx.buscarPositionComLegs(positionId);
      if (!reg) return erro("nao_encontrada", `Posição ${positionId} não encontrada.`);
      if (reg.position.status !== "aberta") {
        return erro(
          "nao_aberta",
          `Posição ${positionId} não está aberta (status atual: ${reg.position.status}).`,
        );
      }
      const plano = planejarEncerramento(reg.legs, parsed.data);
      if (!plano.ok) return plano;

      await ctx.encerrar(positionId, {
        exitPrice: parsed.data.exitPrice,
        realizedPnl: plano.realizedPnl,
        closedAt: new Date(),
      });
      return { ok: true, realizedPnl: plano.realizedPnl };
    });
  } catch (e) {
    return erro(
      "persistencia",
      `Não foi possível encerrar agora (${e instanceof Error ? e.message : "erro desconhecido"}).`,
    );
  }
}

// ── Rolar ─────────────────────────────────────────────────────────────────────

export type ResultadoRolar =
  | { ok: true; novaPositionId: number }
  | { ok: false; erro: ErroHistorico };

/**
 * Rola uma position aberta: cria a NOVA operação (mesma lógica de `persistirTicket`)
 * e marca a antiga como "rolada" apontando para a nova — tudo na MESMA transação
 * (atômico). Se a criação da nova falhar, a antiga não fica "rolada" órfã.
 */
export async function rolarPosition(
  positionId: number,
  novaOperacao: TicketPayload,
  opcoes: { executarTx?: ExecutarTx } = {},
): Promise<ResultadoRolar> {
  const idOk = z.number().int().positive().safeParse(positionId);
  const parsed = payloadSchema.safeParse(novaOperacao);
  if (!idOk.success || !parsed.success) {
    return erro("validacao", "Dados da rolagem inválidos para salvar.");
  }
  const executarTx = opcoes.executarTx ?? executarTxPadrao;

  try {
    return await executarTx(async (ctx) => {
      const reg = await ctx.buscarPositionComLegs(positionId);
      if (!reg) return erro("nao_encontrada", `Posição ${positionId} não encontrada.`);
      if (reg.position.status !== "aberta") {
        return erro(
          "nao_aberta",
          `Posição ${positionId} não está aberta (status atual: ${reg.position.status}).`,
        );
      }
      // Cria a nova ANTES de marcar a antiga; ambas na mesma tx → rollback junto.
      const novaPositionId = await ctx.criarOperacao(parsed.data);
      await ctx.marcarRolada(positionId, novaPositionId, new Date());
      return { ok: true, novaPositionId };
    });
  } catch (e) {
    return erro(
      "persistencia",
      `Não foi possível rolar agora (${e instanceof Error ? e.message : "erro desconhecido"}).`,
    );
  }
}
