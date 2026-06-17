/**
 * Schema Drizzle (Postgres / Neon) — camada de dados do Babilônia (§7 do PRD).
 *
 * Convenções de tipos (§7):
 *  - Dinheiro (BRL): `numeric` (decimal) — nunca float, para não perder centavos.
 *  - Quantidades: `integer` em lotes/contratos.
 *  - Datas/horas: `timestamp` COM timezone (`withTimezone`).
 *  - Gregas/IV: guardadas COMO VIERAM da OpLab, com o timestamp da fonte
 *    (`greeks_source_at`) — nunca recalculadas aqui.
 *  - Coleções variáveis (breakevens, preferências, payloads): `jsonb`.
 */
import { relations } from "drizzle-orm";
import {
  pgTable,
  pgEnum,
  serial,
  integer,
  numeric,
  text,
  jsonb,
  timestamp,
  boolean,
} from "drizzle-orm/pg-core";

/** Precisão padrão para valores em BRL (até bilhões, 2 casas). */
const brl = (name: string) => numeric(name, { precision: 16, scale: 2 });
/** Precisão para gregas e IV (valores pequenos com mais casas). */
const metric = (name: string) => numeric(name, { precision: 14, scale: 6 });

// ── Enums ───────────────────────────────────────────────────────────────────

/** Situação de uma operação no book (§7). */
export const positionStatus = pgEnum("position_status", [
  "aberta",
  "encerrada",
  "rolada",
]);

/** Família da estrutura montada (§8.4). Variantes (débito/crédito,
 *  comprado/vendido) ficam implícitas nas pernas. */
export const structureType = pgEnum("structure_type", [
  "trava_alta",
  "trava_baixa",
  "borboleta",
  "condor",
  "straddle",
  "strangle",
  "venda_coberta",
]);

/**
 * Tipo da opção — valores de DOMÍNIO, alinhados a `TipoOpcao` de
 * `lib/options-math`. O formato externo da OpLab (`"CALL"`/`"PUT"`) é convertido
 * na fronteira de integração (`lib/integrations/oplab`), não armazenado cru.
 */
export const optionKind = pgEnum("option_kind", ["call", "put"]);

/** Lado da perna — alinhado a `LadoOperacao` de `lib/options-math`. */
export const legSide = pgEnum("leg_side", ["compra", "venda"]);

// ── settings ─────────────────────────────────────────────────────────────────
// Configurações do usuário (app mono-usuário). Guarda o CAPITAL TOTAL, base de
// todas as regras de risco do §10, e preferências de exibição da UI.
export const settings = pgTable("settings", {
  id: serial("id").primaryKey(),
  /** Capital total do usuário em BRL — base das regras de risco (§10). */
  totalCapital: brl("total_capital").notNull().default("0"),
  /** Preferências de exibição (tema, formato, etc.) — formato livre. */
  displayPreferences: jsonb("display_preferences")
    .$type<Record<string, unknown>>()
    .notNull()
    .default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ── position (o "book") ──────────────────────────────────────────────────────
// Uma operação montada/aberta. Agrega as pernas (`leg`) e guarda o resumo de
// risco/retorno calculado pelo `options-math`. Risco sempre antes do ganho (§2).
export const position = pgTable("position", {
  id: serial("id").primaryKey(),
  /** Ativo-objeto (ex.: "PETR4"). */
  underlying: text("underlying").notNull(),
  /** Família da estrutura (§8.4). */
  structure: structureType("structure").notNull(),
  /** Data em que a operação foi montada. */
  openedAt: timestamp("opened_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  /** Vencimento da operação (menor vencimento das pernas). */
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  status: positionStatus("status").notNull().default("aberta"),
  /** Risco máximo em BRL (apresentado primeiro — §2). */
  maxRisk: brl("max_risk").notNull(),
  /** Ganho máximo em BRL — null quando ilimitado/indefinido. */
  maxGain: brl("max_gain"),
  /** Se o risco é DEFINIDO (true) ou INDEFINIDO (false) — §2. */
  riskDefined: boolean("risk_defined").notNull(),
  /** Ponto(s) de equilíbrio (array de preços). */
  breakevens: jsonb("breakevens").$type<number[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ── leg (perna individual) ───────────────────────────────────────────────────
// Cada perna de opção de uma `position`. Guarda também as gregas/IV COMO VIERAM
// da OpLab, com o timestamp da fonte (§7) — nunca recalculadas aqui.
export const leg = pgTable("leg", {
  id: serial("id").primaryKey(),
  positionId: integer("position_id")
    .notNull()
    .references(() => position.id, { onDelete: "cascade" }),
  /** Ticker exato da opção (ex.: "PETRK221"). */
  optionSymbol: text("option_symbol").notNull(),
  kind: optionKind("kind").notNull(),
  side: legSide("side").notNull(),
  /** Strike em BRL. */
  strike: brl("strike").notNull(),
  /** Vencimento da opção. */
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  /** Quantidade em contratos (lotes). */
  quantity: integer("quantity").notNull(),
  /** Prêmio unitário em BRL. */
  premium: brl("premium").notNull(),

  // Gregas e IV como vieram da OpLab (nullable — podem não estar disponíveis).
  delta: metric("delta"),
  gamma: metric("gamma"),
  theta: metric("theta"),
  vega: metric("vega"),
  rho: metric("rho"),
  /** Volatilidade implícita (IV) da opção. */
  iv: metric("iv"),
  /** Timestamp da fonte (OpLab) para as gregas/IV acima. */
  greeksSourceAt: timestamp("greeks_source_at", { withTimezone: true }),

  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ── ticket (histórico) ───────────────────────────────────────────────────────
// Tickets de operação gerados (§11), vinculados a uma `position`. Guarda o texto
// pronto para copiar e, opcionalmente, um snapshot estruturado.
export const ticket = pgTable("ticket", {
  id: serial("id").primaryKey(),
  positionId: integer("position_id")
    .notNull()
    .references(() => position.id, { onDelete: "cascade" }),
  /** Texto do ticket no formato do §11, pronto para copiar. */
  content: text("content").notNull(),
  /** Snapshot estruturado do ticket (pernas, números) no momento da geração. */
  data: jsonb("data").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ── watchlist ────────────────────────────────────────────────────────────────
// Ativos-objeto acompanhados pelo usuário.
export const watchlist = pgTable("watchlist", {
  id: serial("id").primaryKey(),
  /** Ativo-objeto (ex.: "VALE3") — único. */
  symbol: text("symbol").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ── api_cache ────────────────────────────────────────────────────────────────
// Cache genérico das integrações (brapi/OpLab) com TTL (§6.3). A camada de
// integração grava aqui o payload JSON e a data de expiração.
export const apiCache = pgTable("api_cache", {
  id: serial("id").primaryKey(),
  /** Chave única do cache (ex.: "brapi:quote:PETR4"). */
  key: text("key").notNull().unique(),
  /** Payload da resposta cacheada. */
  payload: jsonb("payload").notNull(),
  /** Instante de expiração (TTL) — registros vencidos são ignorados/limpos. */
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ── Relations ────────────────────────────────────────────────────────────────

export const positionRelations = relations(position, ({ many }) => ({
  legs: many(leg),
  tickets: many(ticket),
}));

export const legRelations = relations(leg, ({ one }) => ({
  position: one(position, {
    fields: [leg.positionId],
    references: [position.id],
  }),
}));

export const ticketRelations = relations(ticket, ({ one }) => ({
  position: one(position, {
    fields: [ticket.positionId],
    references: [position.id],
  }),
}));

// ── Tipos inferidos (para uso no app) ────────────────────────────────────────

export type Settings = typeof settings.$inferSelect;
export type NewSettings = typeof settings.$inferInsert;
export type Position = typeof position.$inferSelect;
export type NewPosition = typeof position.$inferInsert;
export type Leg = typeof leg.$inferSelect;
export type NewLeg = typeof leg.$inferInsert;
export type Ticket = typeof ticket.$inferSelect;
export type NewTicket = typeof ticket.$inferInsert;
export type Watchlist = typeof watchlist.$inferSelect;
export type NewWatchlist = typeof watchlist.$inferInsert;
export type ApiCache = typeof apiCache.$inferSelect;
export type NewApiCache = typeof apiCache.$inferInsert;
