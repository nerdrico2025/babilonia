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
  uniqueIndex,
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

// ── opcao_cotahist (cadeia de opções ingerida do COTAHIST) ───────────────────
// Cada linha é uma opção (CALL/PUT) num pregão, parseada do arquivo COTAHIST da
// B3 (registro tipo 01, ver `lib/integrations/b3-cotahist.ts` e
// `docs/apis/b3-cotahist.md`). Dado de FECHAMENTO (EOD), ingerido por job batch
// (`scripts/ingestao-cotahist.ts`), NÃO em request-por-tela (§5.1).
//
// Gregas/IV/IV Rank NÃO ficam aqui — são CALCULADAS depois pelo `options-math`
// a partir destes preços + spot + taxa (§18.1). Esta tabela é a matéria-prima.
//
// Sem open interest na fonte (§6.4): a liquidez sai de volume + nº de negócios +
// spread (bid/ask), todos presentes aqui.
export const opcaoCotahist = pgTable(
  "opcao_cotahist",
  {
    id: serial("id").primaryKey(),
    /** CODNEG — ticker exato da opção (ex.: "PETRF336"). */
    optionSymbol: text("option_symbol").notNull(),
    /**
     * Ativo-objeto derivado por heurística (raiz do ticker + watchlist, §6.4).
     * `null` quando a raiz não casa (ou casa de forma ambígua) com a watchlist —
     * no MVP não tentamos mapear toda a B3, então o vínculo pode faltar.
     */
    underlying: text("underlying"),
    /** Tipo da opção (call/put), derivado do TPMERC 070/080 na ingestão. */
    kind: optionKind("kind").notNull(),
    /** PREEXE — preço de exercício (strike) em BRL. */
    strike: brl("strike").notNull(),
    /** DATAPREGAO — pregão (fechamento) que originou a linha. */
    tradeDate: timestamp("trade_date", { withTimezone: true }).notNull(),
    /** DATVEN — vencimento da opção. */
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),

    // Preços do pregão (BRL). 0,00 = sem negócio/oferta naquele campo.
    /** PREABE — abertura. */
    precoAbertura: brl("preco_abertura").notNull(),
    /** PREMIN — mínimo. */
    precoMinimo: brl("preco_minimo").notNull(),
    /** PREMED — médio. */
    precoMedio: brl("preco_medio").notNull(),
    /** PREMAX — máximo. */
    precoMaximo: brl("preco_maximo").notNull(),
    /** PREULT — último negócio = FECHAMENTO (entrada do Black-Scholes). */
    precoFechamento: brl("preco_fechamento").notNull(),
    /** PREOFC — melhor oferta de compra (bid). 0 = sem oferta. */
    bid: brl("bid").notNull(),
    /** PREOFV — melhor oferta de venda (ask). 0 = sem oferta. */
    ask: brl("ask").notNull(),

    // Liquidez (sem OI — §6.4).
    /** VOLTOT — volume financeiro do pregão (BRL). Até 18 dígitos. */
    volumeFinanceiro: numeric("volume_financeiro", {
      precision: 18,
      scale: 2,
    }).notNull(),
    /** TOTNEG — número de negócios no pregão. */
    numeroNegocios: integer("numero_negocios").notNull(),
    /** QUATOT — quantidade total de títulos negociados. Até 18 dígitos. */
    quantidadeTitulos: numeric("quantidade_titulos", {
      precision: 18,
      scale: 0,
    }).notNull(),
    /** FATCOT — fator de cotação (1, 1000…); afeta o prêmio efetivo se ≠ 1. */
    fatorCotacao: integer("fator_cotacao").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Re-rodar o mesmo pregão não duplica: o upsert casa por (ticker, pregão).
    uniqueIndex("opcao_cotahist_symbol_data_uq").on(t.optionSymbol, t.tradeDate),
  ],
);

// ── acao_cotahist (ações à vista ingeridas do COTAHIST) ──────────────────────
// Preço de fechamento (EOD) do ATIVO-OBJETO por pregão, do mesmo arquivo COTAHIST
// (registro tipo 01, TPMERC=010 + CODBDI=02 — ação à vista lote-padrão, ver
// `lib/integrations/b3-cotahist.ts`). Decisão 2026-06-17: usar o próprio COTAHIST
// como fonte do histórico de spot, pré-requisito do IV Rank (backfill de IV
// histórica precisa do preço do objeto em cada pregão), em vez do tier gratuito
// da brapi (limitado a 252 pregões / poucos ativos).
//
// Espelha `opcao_cotahist`, MENOS o que não se aplica a ação: sem strike, sem
// vencimento (expires_at), sem kind (call/put), sem ativo-objeto derivado (o
// ticker JÁ é o objeto).
export const acaoCotahist = pgTable(
  "acao_cotahist",
  {
    id: serial("id").primaryKey(),
    /** CODNEG — ticker da ação (ex.: "PETR4"). */
    ticker: text("ticker").notNull(),
    /** DATAPREGAO — pregão (fechamento) que originou a linha. */
    tradeDate: timestamp("trade_date", { withTimezone: true }).notNull(),

    // Preços do pregão (BRL). 0,00 = sem negócio/oferta naquele campo.
    /** PREABE — abertura. */
    precoAbertura: brl("preco_abertura").notNull(),
    /** PREMIN — mínimo. */
    precoMinimo: brl("preco_minimo").notNull(),
    /** PREMED — médio. */
    precoMedio: brl("preco_medio").notNull(),
    /** PREMAX — máximo. */
    precoMaximo: brl("preco_maximo").notNull(),
    /** PREULT — último negócio = FECHAMENTO (spot histórico do objeto). */
    precoFechamento: brl("preco_fechamento").notNull(),
    /** PREOFC — melhor oferta de compra (bid). 0 = sem oferta. */
    bid: brl("bid").notNull(),
    /** PREOFV — melhor oferta de venda (ask). 0 = sem oferta. */
    ask: brl("ask").notNull(),

    /** VOLTOT — volume financeiro do pregão (BRL). Até 18 dígitos. */
    volumeFinanceiro: numeric("volume_financeiro", {
      precision: 18,
      scale: 2,
    }).notNull(),
    /** TOTNEG — número de negócios no pregão. */
    numeroNegocios: integer("numero_negocios").notNull(),
    /** QUATOT — quantidade total de títulos negociados. Até 18 dígitos. */
    quantidadeTitulos: numeric("quantidade_titulos", {
      precision: 18,
      scale: 0,
    }).notNull(),
    /** FATCOT — fator de cotação (1, 1000…). */
    fatorCotacao: integer("fator_cotacao").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Re-rodar o mesmo pregão atualiza em vez de duplicar (idempotência).
    uniqueIndex("acao_cotahist_ticker_data_uq").on(t.ticker, t.tradeDate),
  ],
);

// ── iv_history (IV representativa diária por ativo-objeto) ───────────────────
// Uma linha por (ativo, pregão): a VOLATILIDADE IMPLÍCITA representativa do
// ativo-objeto naquele dia (§6.4), CALCULADA por nós (não vem pronta) a partir
// da opção ATM do vencimento mais próximo com liquidez — ver
// `lib/options-math/iv-representativa.ts` e o orquestrador `scripts/calcular-iv.ts`.
//
// É a base do IV Rank/Percentil (vem depois): o Rank precisa da série histórica
// de IV diária. Por isso guardamos também os CAMPOS DE AUDITORIA (qual série,
// vencimento, spot e taxa originaram o número) — todo valor tem de ser conferível.
//
// Dias sem vencimento válido (>7 dias) ou sem série líquida com IV viável NÃO
// geram linha (gap) — nunca gravamos "lixo"/IV inventada (§2.4).
export const ivHistory = pgTable(
  "iv_history",
  {
    id: serial("id").primaryKey(),
    /** Ativo-objeto (symbol da watchlist, ex.: "PETR4"). */
    ativo: text("ativo").notNull(),
    /** Pregão (fechamento) a que esta IV se refere. */
    tradeDate: timestamp("trade_date", { withTimezone: true }).notNull(),
    /** IV anualizada em DECIMAL (0.35 = 35% a.a.). Precisão de gregas/IV (§7). */
    iv: metric("iv").notNull(),

    // ── Auditoria: de onde veio cada número (obrigatório, conferível) ──────────
    /** Vencimento da opção usada (o "mais próximo > 7 dias"). */
    vencimentoUsado: timestamp("vencimento_usado", {
      withTimezone: true,
    }).notNull(),
    /** option_symbol da série ATM escolhida (a que produziu a IV). */
    opcaoUsada: text("opcao_usada").notNull(),
    /** Tipo da série usada (call/put). */
    tipoUsado: optionKind("tipo_usado").notNull(),
    /** Spot do ativo no pregão (preco_fechamento de acao_cotahist), BRL. */
    spotUsado: brl("spot_usado").notNull(),
    /** Prêmio usado no solver = MID (bid+ask)/2 da série escolhida, BRL/ação. */
    premioUsado: brl("premio_usado").notNull(),
    /** Taxa livre de risco CONTÍNUA usada (Selic do pregão; ln(1+Selic)). */
    rUsado: metric("r_usado").notNull(),
    /** Tempo até o vencimento em ANOS usado no Black-Scholes (dias corridos/365). */
    tAnos: metric("t_anos").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Uma IV representativa por ativo por pregão (idempotente ao re-rodar).
    uniqueIndex("iv_history_ativo_data_uq").on(t.ativo, t.tradeDate),
  ],
);

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
export type OpcaoCotahist = typeof opcaoCotahist.$inferSelect;
export type NewOpcaoCotahist = typeof opcaoCotahist.$inferInsert;
export type AcaoCotahist = typeof acaoCotahist.$inferSelect;
export type NewAcaoCotahist = typeof acaoCotahist.$inferInsert;
export type IvHistory = typeof ivHistory.$inferSelect;
export type NewIvHistory = typeof ivHistory.$inferInsert;
export type ApiCache = typeof apiCache.$inferSelect;
export type NewApiCache = typeof apiCache.$inferInsert;
