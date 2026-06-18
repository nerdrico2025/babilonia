/**
 * Testes das gregas on-demand a partir do COTAHIST.
 *
 * 1. `montarGregas` (PURA) — Black-Scholes, unidades expostas, degradação sem
 *    inventar. Dados sintéticos.
 * 2. `getGregasCotahist` — contra o BANCO REAL (Neon), só com `DATABASE_URL`
 *    (`describe.skipIf`): um symbol real de PETR4, auto-SELIC (fetch stub) e override.
 */

import { and, desc, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { montarGregas, getGregasCotahist, type ParametrosMontarGregas } from "./gregas";

try {
  process.loadEnvFile(".env.local");
} catch {
  // .env.local ausente — integração pulada.
}
const TEM_DB = Boolean(process.env.DATABASE_URL);

// Stub de fetch para o BCB-SGS (série 432): devolve uma Selic fixa de 15% a.a.,
// para a auto-SELIC ser determinística e OFFLINE.
const fetchSelicStub: typeof fetch = async () =>
  new Response(JSON.stringify([{ data: "01/01/2025", valor: "15.0" }]), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

function params(over: Partial<ParametrosMontarGregas> = {}): ParametrosMontarGregas {
  return {
    symbol: "PETRX380",
    tipo: "call",
    spot: 38.57,
    strike: 38,
    premio: 1.8,
    T: 0.1,
    r: 0.1,
    ...over,
  };
}

// ── montarGregas (puro) ───────────────────────────────────────────────────────

describe("montarGregas (puro)", () => {
  it("call ATM-ITM com prêmio: gregas e IV plausíveis, unidades da UI", () => {
    const g = montarGregas(params());
    expect(g.symbol).toBe("PETRX380");
    expect(g.moneyness).toBe("ITM"); // call, spot > strike
    expect(g.spotPrice).toBe(38.57);
    expect(g.strike).toBe(38);
    // delta de call ∈ (0,1); ligeiramente ITM → > 0.5.
    expect(g.delta!).toBeGreaterThan(0.5);
    expect(g.delta!).toBeLessThan(1);
    expect(g.gamma!).toBeGreaterThan(0);
    expect(g.vega!).toBeGreaterThan(0);
    expect(g.theta!).toBeLessThan(0); // decaimento (comprado)
    expect(g.iv!).toBeGreaterThan(0); // em PERCENTUAL
    expect(g.precoTeorico!).toBeGreaterThan(0);
    expect(g.probExercicio!).toBeGreaterThan(0);
    expect(g.probExercicio!).toBeLessThan(100);
    // margem não é calculada por esta stack.
    expect(g.margem).toBeNull();
  });

  it("a IV resolvida reprecifica o prêmio observado (round-trip)", () => {
    const p = params();
    const g = montarGregas(p);
    // precoTeorico ≈ prêmio usado quando sigma = IV implícita.
    expect(g.precoTeorico!).toBeCloseTo(p.premio!, 4);
  });

  it("override de vol fixa a IV (= vol) e dispensa o prêmio", () => {
    const g = montarGregas(params({ premio: null, vol: 30 }));
    expect(g.iv).toBeCloseTo(30, 9); // percentual, igual ao override
    expect(g.delta).not.toBeNull();
    expect(g.gamma).not.toBeNull();
  });

  it("put: delta negativo e moneyness invertido", () => {
    const g = montarGregas(params({ tipo: "put", premio: null, vol: 30 }));
    expect(g.moneyness).toBe("OTM"); // put, spot > strike
    expect(g.delta!).toBeLessThan(0);
    expect(g.delta!).toBeGreaterThan(-1);
  });

  it("ATM rotula 'ATM' dentro da tolerância", () => {
    const g = montarGregas(params({ strike: 38.57, vol: 30, premio: null }));
    expect(g.moneyness).toBe("ATM");
  });

  it("sem spot/r/T válido → campos do BS null, sem inventar", () => {
    const semSpot = montarGregas(params({ spot: null }));
    expect(semSpot.delta).toBeNull();
    expect(semSpot.iv).toBeNull();
    expect(semSpot.precoTeorico).toBeNull();
    expect(semSpot.moneyness).toBeNull(); // sem spot não há moneyness
    expect(semSpot.strike).toBe(38); // o que se sabe permanece

    expect(montarGregas(params({ r: null })).delta).toBeNull();
    expect(montarGregas(params({ T: 0 })).delta).toBeNull();
  });

  it("prêmio inviável e sem vol → IV/gregas null (não inventa)", () => {
    // prêmio 0.5 < valor intrínseco descontado (~0.95) de um call ITM → sem IV.
    const g = montarGregas(params({ premio: 0.5 }));
    expect(g.iv).toBeNull();
    expect(g.delta).toBeNull();
    expect(g.spotPrice).toBe(38.57); // dados conhecidos seguem
    expect(g.strike).toBe(38);
  });
});

// ── getGregasCotahist (banco real) ────────────────────────────────────────────

describe.skipIf(!TEM_DB)("getGregasCotahist (banco real)", () => {
  /** Escolhe um call de PETR4 líquido (bid&ask>0) com vencimento ~20–70 dias. */
  async function escolherCallPetr4(): Promise<{ symbol: string; dataBase: Date }> {
    const { getDb } = await import("@/db");
    const { opcaoCotahist } = await import("@/db/schema");
    const db = getDb();
    const max = await db
      .select({ d: opcaoCotahist.tradeDate })
      .from(opcaoCotahist)
      .where(eq(opcaoCotahist.underlying, "PETR4"))
      .orderBy(desc(opcaoCotahist.tradeDate))
      .limit(1);
    const dataBase = max[0]!.d;
    const cands = await db
      .select({
        symbol: opcaoCotahist.optionSymbol,
        venc: opcaoCotahist.expiresAt,
        neg: opcaoCotahist.numeroNegocios,
      })
      .from(opcaoCotahist)
      .where(
        and(
          eq(opcaoCotahist.underlying, "PETR4"),
          eq(opcaoCotahist.tradeDate, dataBase),
          eq(opcaoCotahist.kind, "call"),
          sql`${opcaoCotahist.bid} > 0 and ${opcaoCotahist.ask} > 0`,
        ),
      )
      .orderBy(desc(opcaoCotahist.numeroNegocios));
    const dia = 86_400_000;
    const escolhido = cands.find((c) => {
      const d = (c.venc.getTime() - dataBase.getTime()) / dia;
      return d >= 20 && d <= 70;
    });
    expect(escolhido).toBeDefined();
    return { symbol: escolhido!.symbol, dataBase };
  }

  it("symbol real de PETR4: gregas/IV plausíveis com auto-SELIC", async () => {
    const { symbol, dataBase } = await escolherCallPetr4();
    const { gregas: g, asOf } = await getGregasCotahist(symbol, { fetchImpl: fetchSelicStub });

    expect(asOf.getTime()).toBe(dataBase.getTime()); // as-of = trade_date da série
    expect(g.symbol).toBe(symbol);
    expect(g.spotPrice).toBeCloseTo(38.57, 2); // spot PETR4 na data-base
    expect(g.delta!).toBeGreaterThan(0);
    expect(g.delta!).toBeLessThan(1);
    expect(g.gamma!).toBeGreaterThan(0);
    expect(g.vega!).toBeGreaterThan(0);
    expect(g.iv!).toBeGreaterThan(0); // percentual
    expect(g.iv!).toBeLessThan(500);
    expect(g.probExercicio!).toBeGreaterThanOrEqual(0);
    expect(g.probExercicio!).toBeLessThanOrEqual(100);
    expect(["ITM", "ATM", "OTM"]).toContain(g.moneyness);
    expect(g.margem).toBeNull();
  });

  it("override de vol/r é respeitado (iv = vol; sem rede)", async () => {
    const { symbol } = await escolherCallPetr4();
    // vol override fixa a IV; r override evita a busca de SELIC (sem fetch).
    const { gregas: g } = await getGregasCotahist(symbol, { vol: 30, r: 0.1 });
    expect(g.iv).toBeCloseTo(30, 6);
    expect(g.delta).not.toBeNull();
  });
});
