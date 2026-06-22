/**
 * Testes da cadeia de opções a partir do COTAHIST.
 *
 * Duas camadas:
 *  1. `montarCadeia` (PURA) — agrupamento/ordenação/mapeamento, com dados
 *     sintéticos, incluindo a integração com `lib/liquidez` (mesma semântica de
 *     campos).
 *  2. `getCadeiaCotahist` — contra o BANCO REAL (Neon), só quando `DATABASE_URL`
 *     está presente (`describe.skipIf`). Valida PETR4 (cadeia plausível, spot e IV
 *     batendo com as tabelas-fonte) e o caso degradado (ativo fora da watchlist).
 */

import { and, desc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { avaliarLiquidez } from "@/lib/liquidez";

import {
  getCadeiaCotahist,
  montarCadeia,
  NOTA_LIQUIDEZ,
  type LinhaOpcaoCadeia,
} from "./cadeia";

// Carrega DATABASE_URL de .env.local para os testes de integração (Node 22).
try {
  process.loadEnvFile(".env.local");
} catch {
  // .env.local ausente — os testes de integração serão pulados.
}

const TEM_DB = Boolean(process.env.DATABASE_URL);

// ── Helpers de fixture ────────────────────────────────────────────────────────

function linha(over: Partial<LinhaOpcaoCadeia> = {}): LinhaOpcaoCadeia {
  return {
    optionSymbol: "PETRX100",
    kind: "call",
    strike: 100,
    expiresAt: new Date("2026-07-17T00:00:00.000Z"),
    bid: 1.0,
    ask: 1.2,
    quantidadeTitulos: 500,
    volumeFinanceiro: 60_000,
    numeroNegocios: 42,
    ...over,
  };
}

// ── montarCadeia (puro) ───────────────────────────────────────────────────────

describe("montarCadeia (puro)", () => {
  it("agrupa por vencimento → strike, separando call e put", () => {
    const c = montarCadeia({
      ativo: "petr4",
      asOf: new Date("2026-06-17T00:00:00.000Z"),
      spot: 38.57,
      ivAtual: 28.16,
      linhas: [
        linha({ optionSymbol: "C100", kind: "call", strike: 100 }),
        linha({ optionSymbol: "P100", kind: "put", strike: 100 }),
        linha({ optionSymbol: "C90", kind: "call", strike: 90 }),
      ],
    });

    expect(c.ativo).toBe("PETR4");
    expect(c.vencimentos).toHaveLength(1);
    const venc = c.vencimentos[0]!;
    // Strikes ordenados ascendente.
    expect(venc.strikes.map((s) => s.strike)).toEqual([90, 100]);
    const s100 = venc.strikes.find((s) => s.strike === 100)!;
    expect(s100.call?.symbol).toBe("C100");
    expect(s100.put?.symbol).toBe("P100");
    const s90 = venc.strikes.find((s) => s.strike === 90)!;
    expect(s90.call?.symbol).toBe("C90");
    expect(s90.put).toBeNull();
  });

  it("ordena vencimentos por data e calcula dias corridos da data-base", () => {
    const c = montarCadeia({
      ativo: "PETR4",
      asOf: new Date("2026-06-17T00:00:00.000Z"),
      spot: 38.57,
      ivAtual: null,
      linhas: [
        linha({ strike: 100, expiresAt: new Date("2026-08-21T00:00:00.000Z") }),
        linha({ strike: 100, expiresAt: new Date("2026-07-17T00:00:00.000Z") }),
      ],
    });
    expect(c.vencimentos.map((v) => v.vencimento)).toEqual([
      "2026-07-17T00:00:00.000Z",
      "2026-08-21T00:00:00.000Z",
    ]);
    // 17/06 → 17/07 = 30 dias corridos.
    expect(c.vencimentos[0]!.diasAteVencimento).toBe(30);
  });

  it("normaliza bid/ask 0 (sem oferta) para null e zera o spread", () => {
    const c = montarCadeia({
      ativo: "PETR4",
      asOf: new Date("2026-06-17T00:00:00.000Z"),
      spot: 38.57,
      ivAtual: null,
      linhas: [linha({ bid: 0, ask: 0 })],
    });
    const op = c.vencimentos[0]!.strikes[0]!.call!;
    expect(op.bid).toBeNull();
    expect(op.ask).toBeNull();
    expect(op.spread).toBeNull();
  });

  it("calcula spread = ask − bid quando ambos existem", () => {
    const c = montarCadeia({
      ativo: "PETR4",
      asOf: new Date("2026-06-17T00:00:00.000Z"),
      spot: 38.57,
      ivAtual: null,
      linhas: [linha({ bid: 1.0, ask: 1.25 })],
    });
    const op = c.vencimentos[0]!.strikes[0]!.call!;
    expect(op.bid).toBe(1.0);
    expect(op.ask).toBe(1.25);
    expect(op.spread).toBeCloseTo(0.25, 10);
  });

  it("mapeia volume (QUATOT), volume financeiro, negócios e marketMaker null", () => {
    const c = montarCadeia({
      ativo: "PETR4",
      asOf: new Date("2026-06-17T00:00:00.000Z"),
      spot: 38.57,
      ivAtual: null,
      linhas: [
        linha({ quantidadeTitulos: 1234, volumeFinanceiro: 99_000, numeroNegocios: 77 }),
      ],
    });
    const op = c.vencimentos[0]!.strikes[0]!.call!;
    expect(op.volume).toBe(1234);
    expect(op.volumeFinanceiro).toBe(99_000);
    expect(op.negocios).toBe(77);
    // COTAHIST não informa market maker (caso conservador).
    expect(op.marketMaker).toBeNull();
    expect(op.tipoExercicio).toBeNull();
    expect(op.tamanhoContrato).toBeNull();
    expect(op.bidVolume).toBeNull();
    expect(op.askVolume).toBeNull();
  });

  it("repassa ivAtual (percentual), spot e fixa as flags/nota da fonte", () => {
    const c = montarCadeia({
      ativo: "PETR4",
      asOf: new Date("2026-06-17T00:00:00.000Z"),
      spot: 38.57,
      ivAtual: 28.16,
      linhas: [linha()],
    });
    expect(c.precoAtivo).toBe(38.57);
    expect(c.ivAtual).toBe(28.16);
    expect(c.openInterestDisponivel).toBe(false);
    expect(c.gregasNaCadeia).toBe(false);
    expect(c.notaLiquidez).toBe(NOTA_LIQUIDEZ);
  });

  it("degrada com cadeia vazia quando não há linhas (sem inventar nada)", () => {
    const c = montarCadeia({
      ativo: "PETR4",
      asOf: null,
      spot: null,
      ivAtual: null,
      linhas: [],
    });
    expect(c.vencimentos).toEqual([]);
    expect(c.precoAtivo).toBeNull();
    expect(c.ivAtual).toBeNull();
  });

  it("produz campos com a semântica que lib/liquidez espera", () => {
    const c = montarCadeia({
      ativo: "PETR4",
      asOf: new Date("2026-06-17T00:00:00.000Z"),
      spot: 38.57,
      ivAtual: null,
      // Volume alto e spread estreito → liquidez "ok".
      linhas: [linha({ bid: 2.0, ask: 2.05, quantidadeTitulos: 5000 })],
    });
    const op = c.vencimentos[0]!.strikes[0]!.call!;
    const av = avaliarLiquidez(op);
    expect(av.nivel).toBe("ok");
    // mid = (2.0 + 2.05) / 2 = 2.025
    expect(av.precoReferencia).toBeCloseTo(2.025, 10);
  });
});

// ── getCadeiaCotahist (banco real) ────────────────────────────────────────────

describe.skipIf(!TEM_DB)("getCadeiaCotahist (banco real)", () => {
  const ATIVO = "PETR4";

  it("monta a cadeia de PETR4 com as-of, spot e IV batendo com as fontes", async () => {
    const { getDb } = await import("@/db");
    const { acaoCotahist, ivHistory, opcaoCotahist } = await import("@/db/schema");
    const db = getDb();

    const { cadeia, asOf } = await getCadeiaCotahist(ATIVO);

    // 1) as-of = trade_date MAIS RECENTE de opcao_cotahist para PETR4.
    const maxOpcao = await db
      .select({ d: opcaoCotahist.tradeDate })
      .from(opcaoCotahist)
      .where(eq(opcaoCotahist.underlying, ATIVO))
      .orderBy(desc(opcaoCotahist.tradeDate))
      .limit(1);
    expect(asOf).not.toBeNull();
    expect(asOf!.getTime()).toBe(maxOpcao[0]!.d.getTime());

    // 2) Cadeia plausível: há vencimentos e strikes; call/put bem separados.
    expect(cadeia.vencimentos.length).toBeGreaterThan(0);
    const totalStrikes = cadeia.vencimentos.reduce((n, v) => n + v.strikes.length, 0);
    expect(totalStrikes).toBeGreaterThan(0);
    for (const v of cadeia.vencimentos) {
      // Strikes ordenados ascendente.
      const strikes = v.strikes.map((s) => s.strike);
      expect([...strikes].sort((a, b) => a - b)).toEqual(strikes);
      for (const s of v.strikes) {
        if (s.call) expect(s.call.tipo).toBe("call");
        if (s.put) expect(s.put.tipo).toBe("put");
        // Vencimento da opção = vencimento da série.
        if (s.call) expect(s.call.vencimento).toBe(v.vencimento);
      }
    }

    // 3) precoAtivo = preco_fechamento de PETR4 em acao_cotahist na data-base.
    const spotRow = await db
      .select({ f: acaoCotahist.precoFechamento })
      .from(acaoCotahist)
      .where(and(eq(acaoCotahist.ticker, ATIVO), eq(acaoCotahist.tradeDate, asOf!)))
      .limit(1);
    if (spotRow[0]) {
      expect(cadeia.precoAtivo).toBeCloseTo(Number(spotRow[0].f), 6);
    }

    // 4) ivAtual = IV representativa mais recente em iv_history × 100 (decimal→%).
    const ivRow = await db
      .select({ iv: ivHistory.iv })
      .from(ivHistory)
      .where(eq(ivHistory.ativo, ATIVO))
      .orderBy(desc(ivHistory.tradeDate))
      .limit(1);
    if (ivRow[0]) {
      expect(cadeia.ivAtual).toBeCloseTo(Number(ivRow[0].iv) * 100, 6);
    }

    // 5) Flags e nota da fonte.
    expect(cadeia.openInterestDisponivel).toBe(false);
    expect(cadeia.gregasNaCadeia).toBe(false);
    expect(cadeia.notaLiquidez).toBe(NOTA_LIQUIDEZ);
  }, 15000);

  it("degrada coerente para um ativo sem dado (fora da watchlist)", async () => {
    const { cadeia, asOf } = await getCadeiaCotahist("ZZZZ999");
    expect(asOf).toBeNull();
    expect(cadeia.vencimentos).toEqual([]);
    expect(cadeia.precoAtivo).toBeNull();
    expect(cadeia.ivAtual).toBeNull();
    expect(cadeia.ativo).toBe("ZZZZ999");
  }, 15000);
});
