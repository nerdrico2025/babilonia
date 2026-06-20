/**
 * queries — leituras do banco para o Dashboard / Book (tela 2, §8.1).
 *
 * Camada fina sobre o Drizzle (server-only). Converte os tipos do banco (numeric
 * vem como string) para números do domínio e agrupa as pernas por posição.
 *
 * Degradação graciosa (§2.6, §6.3): se o banco não estiver configurado
 * (`DATABASE_URL` ausente) ou cair, `carregarBook` devolve `{ ok: false, erro }`
 * em vez de derrubar a tela — o dashboard mostra um aviso e segue.
 */

import { asc, desc, eq, inArray } from "drizzle-orm";

import { lerPreferencias, type Preferencias } from "@/lib/settings";

import { getDb } from "./index";
import { leg, position, settings, ticket, watchlist } from "./schema";

/** Perna de opção de uma posição (números já convertidos). */
export interface PernaBook {
  /** Id da `leg` no banco — referência para o fechamento por perna (encerrar). */
  legId: number;
  optionSymbol: string;
  kind: "call" | "put";
  side: "compra" | "venda";
  strike: number;
  quantity: number;
  premium: number;
}

/** Posição aberta do book, com suas pernas. */
export interface PosicaoBookDB {
  id: number;
  underlying: string;
  structure: string;
  expiresAt: Date;
  maxRisk: number;
  maxGain: number | null;
  riskDefined: boolean;
  breakevens: number[];
  pernas: PernaBook[];
}

/** Resultado da leitura do book (com capital), ou falha legível. */
export type ResultadoBook =
  | { ok: true; capitalTotal: number; posicoes: PosicaoBookDB[] }
  | { ok: false; erro: string };

/** Capital total de `settings` (base das regras de risco, §10). 0 se não houver. */
async function lerCapitalTotal(): Promise<number> {
  const db = getDb();
  const linhas = await db.select().from(settings).limit(1);
  return linhas[0] ? Number(linhas[0].totalCapital) : 0;
}

/**
 * Lê o book ABERTO (posições + pernas) e o capital total. Posições ordenadas por
 * vencimento crescente (as mais próximas primeiro — combinam com os alertas).
 */
export async function carregarBook(): Promise<ResultadoBook> {
  try {
    const db = getDb();

    const posicoes = await db
      .select()
      .from(position)
      .where(eq(position.status, "aberta"))
      .orderBy(asc(position.expiresAt));

    const ids = posicoes.map((p) => p.id);
    const pernas = ids.length
      ? await db.select().from(leg).where(inArray(leg.positionId, ids))
      : [];

    // Agrupa as pernas por posição.
    const pernasPorPosicao = new Map<number, PernaBook[]>();
    for (const l of pernas) {
      const lista = pernasPorPosicao.get(l.positionId) ?? [];
      lista.push({
        legId: l.id,
        optionSymbol: l.optionSymbol,
        kind: l.kind,
        side: l.side,
        strike: Number(l.strike),
        quantity: l.quantity,
        premium: Number(l.premium),
      });
      pernasPorPosicao.set(l.positionId, lista);
    }

    const capitalTotal = await lerCapitalTotal();

    return {
      ok: true,
      capitalTotal,
      posicoes: posicoes.map((p) => ({
        id: p.id,
        underlying: p.underlying,
        structure: p.structure,
        expiresAt: p.expiresAt,
        maxRisk: Number(p.maxRisk),
        maxGain: p.maxGain == null ? null : Number(p.maxGain),
        riskDefined: p.riskDefined,
        breakevens: p.breakevens,
        pernas: pernasPorPosicao.get(p.id) ?? [],
      })),
    };
  } catch (e) {
    const detalhe = e instanceof Error ? e.message : "erro desconhecido";
    return { ok: false, erro: detalhe };
  }
}

// ── Configurações (tela 3, §7, §14) ───────────────────────────────────────────

/** Item da watchlist (ativo-objeto acompanhado). */
export interface AtivoWatchlist {
  id: number;
  symbol: string;
}

/** Configurações do usuário: capital, preferências e watchlist. */
export interface ConfiguracoesDB {
  capitalTotal: number;
  preferencias: Preferencias;
  watchlist: AtivoWatchlist[];
}

/** Resultado da leitura das configurações, ou falha legível (DB indisponível). */
export type ResultadoConfiguracoes =
  | ({ ok: true } & ConfiguracoesDB)
  | { ok: false; erro: string };

/**
 * Lê as configurações (linha única de `settings`, app mono-usuário) e a
 * watchlist ordenada por símbolo. Degrada com erro legível se o banco cair.
 */
export async function carregarConfiguracoes(): Promise<ResultadoConfiguracoes> {
  try {
    const db = getDb();

    const linhas = await db.select().from(settings).limit(1);
    const linha = linhas[0];
    const ativos = await db.select().from(watchlist).orderBy(asc(watchlist.symbol));

    return {
      ok: true,
      capitalTotal: linha ? Number(linha.totalCapital) : 0,
      preferencias: lerPreferencias(linha?.displayPreferences),
      watchlist: ativos.map((a) => ({ id: a.id, symbol: a.symbol })),
    };
  } catch (e) {
    const detalhe = e instanceof Error ? e.message : "erro desconhecido";
    return { ok: false, erro: detalhe };
  }
}

// ── Histórico / Diário (tela 8, §3.1, §8) ─────────────────────────────────────

/** Situação de uma operação no book (§7). */
export type StatusPosicao = "aberta" | "encerrada" | "rolada";

/** Uma operação no histórico, com pernas e o último ticket gerado. */
export interface PosicaoHistorico {
  id: number;
  underlying: string;
  structure: string;
  status: StatusPosicao;
  openedAt: Date;
  expiresAt: Date;
  createdAt: Date;
  maxRisk: number;
  maxGain: number | null;
  riskDefined: boolean;
  breakevens: number[];
  pernas: PernaBook[];
  /** Texto do ticket mais recente (§11), ou null se não houver. */
  ticketContent: string | null;
  /** P&L realizado ao encerrar (BRL), ou null enquanto aberta/rolada. */
  realizedPnl: number | null;
  /** Position nova que substituiu esta (rolagem), ou null. */
  rolledIntoPositionId: number | null;
}

/** Resultado da leitura do histórico (com capital, p/ reconstruir tickets). */
export type ResultadoHistorico =
  | { ok: true; capitalTotal: number; posicoes: PosicaoHistorico[] }
  | { ok: false; erro: string };

/**
 * Lê TODAS as operações (qualquer status), mais recentes primeiro, com pernas e
 * o texto do ticket mais recente de cada uma. Inclui o capital (para o fluxo de
 * "ticket de ajuste", §12). Degrada com erro legível se o banco cair.
 */
export async function carregarHistorico(): Promise<ResultadoHistorico> {
  try {
    const db = getDb();

    const posicoes = await db
      .select()
      .from(position)
      .orderBy(desc(position.createdAt));

    const ids = posicoes.map((p) => p.id);
    const pernas = ids.length
      ? await db.select().from(leg).where(inArray(leg.positionId, ids))
      : [];
    // Tickets ordenados do mais recente ao mais antigo: o primeiro de cada
    // posição é o "atual".
    const tickets = ids.length
      ? await db
          .select()
          .from(ticket)
          .where(inArray(ticket.positionId, ids))
          .orderBy(desc(ticket.createdAt))
      : [];

    const pernasPorPosicao = new Map<number, PernaBook[]>();
    for (const l of pernas) {
      const lista = pernasPorPosicao.get(l.positionId) ?? [];
      lista.push({
        legId: l.id,
        optionSymbol: l.optionSymbol,
        kind: l.kind,
        side: l.side,
        strike: Number(l.strike),
        quantity: l.quantity,
        premium: Number(l.premium),
      });
      pernasPorPosicao.set(l.positionId, lista);
    }

    const ticketPorPosicao = new Map<number, string>();
    for (const t of tickets) {
      if (!ticketPorPosicao.has(t.positionId)) ticketPorPosicao.set(t.positionId, t.content);
    }

    const linhas = await db.select().from(settings).limit(1);
    const capitalTotal = linhas[0] ? Number(linhas[0].totalCapital) : 0;

    return {
      ok: true,
      capitalTotal,
      posicoes: posicoes.map((p) => ({
        id: p.id,
        underlying: p.underlying,
        structure: p.structure,
        status: p.status,
        openedAt: p.openedAt,
        expiresAt: p.expiresAt,
        createdAt: p.createdAt,
        maxRisk: Number(p.maxRisk),
        maxGain: p.maxGain == null ? null : Number(p.maxGain),
        riskDefined: p.riskDefined,
        breakevens: p.breakevens,
        pernas: pernasPorPosicao.get(p.id) ?? [],
        ticketContent: ticketPorPosicao.get(p.id) ?? null,
        realizedPnl: p.realizedPnl == null ? null : Number(p.realizedPnl),
        rolledIntoPositionId: p.rolledIntoPositionId ?? null,
      })),
    };
  } catch (e) {
    const detalhe = e instanceof Error ? e.message : "erro desconhecido";
    return { ok: false, erro: detalhe };
  }
}
