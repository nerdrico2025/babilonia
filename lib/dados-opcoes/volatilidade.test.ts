/**
 * Testes da volatilidade (IV Rank/Percentil) a partir de iv_history.
 *
 * 1. `montarVolatilidade` (PURA) — janelas 1a/6m, estados de confiabilidade,
 *    unidade percentual, degradação. Dados sintéticos.
 * 2. `getVolatilidadeCotahist` — contra o BANCO REAL (Neon), só com `DATABASE_URL`
 *    (`describe.skipIf`): PETR4 (completo, 6m preenchido, batendo com calcularIvRank)
 *    e ECOR3 (insuficiente, ranks null).
 */

import { asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { calcularIvRank, type PontoIv } from "@/lib/options-math";

import { getVolatilidadeCotahist, montarVolatilidade } from "./volatilidade";

try {
  process.loadEnvFile(".env.local");
} catch {
  // .env.local ausente — integração pulada.
}
const TEM_DB = Boolean(process.env.DATABASE_URL);

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** Série de `n` pregões consecutivos; IV (decimal) dada por `ivDe(i)`. */
function serie(n: number, ivDe: (i: number) => number): PontoIv[] {
  const base = Date.UTC(2025, 0, 1);
  return Array.from({ length: n }, (_, i) => ({
    tradeDate: new Date(base + i * 86_400_000),
    iv: ivDe(i),
  }));
}

/** Rampa linear de `a` a `b` em `n` pontos (mesma ideia do teste do iv-rank). */
function rampa(a: number, b: number, n: number): (i: number) => number {
  return (i) => a + ((b - a) * i) / (n - 1);
}

// ── montarVolatilidade (puro) ─────────────────────────────────────────────────

describe("montarVolatilidade (puro)", () => {
  it("degrada coerente com série vazia (tudo null, asOf null)", () => {
    const { volatilidade, asOf } = montarVolatilidade("petr4", []);
    expect(asOf).toBeNull();
    expect(volatilidade.ativo).toBe("PETR4");
    expect(volatilidade.ivAtual).toBeNull();
    expect(volatilidade.ivRank1a).toBeNull();
    expect(volatilidade.ivPercentil1a).toBeNull();
    expect(volatilidade.ivRank6m).toBeNull();
    expect(volatilidade.ivPercentil6m).toBeNull();
    expect(volatilidade.ewmaAtual).toBeNull();
    expect(volatilidade.ivRankPorContratoDisponivel).toBe(false);
    expect(volatilidade.confiabilidade).toBeUndefined();
  });

  it("série completa (≥252): estado 'completo', ranks em [0,100], 6m preenchido", () => {
    const s = serie(252, rampa(0.2, 0.5, 252));
    const { volatilidade, asOf } = montarVolatilidade("PETR4", s);

    // ivAtual = última IV (decimal) × 100.
    expect(volatilidade.ivAtual).toBeCloseTo(50, 6);
    // asOf = último pregão.
    expect(asOf!.getTime()).toBe(s[s.length - 1]!.tradeDate.getTime());

    expect(volatilidade.confiabilidade).toEqual({ estado: "completo", diasJanela: 252 });
    expect(volatilidade.ivRank1a).not.toBeNull();
    expect(volatilidade.ivRank1a!).toBeGreaterThanOrEqual(0);
    expect(volatilidade.ivRank1a!).toBeLessThanOrEqual(100);
    // 6m preenchido (≥60 pregões).
    expect(volatilidade.ivRank6m).not.toBeNull();
    expect(volatilidade.ivPercentil6m).not.toBeNull();
  });

  it("bate com calcularIvRank (1a janela 252 e 6m janela 126)", () => {
    const s = serie(252, rampa(0.2, 0.5, 252));
    const alvo = s[s.length - 1]!.iv;
    const r1a = calcularIvRank(s, alvo);
    const r6m = calcularIvRank(s, alvo, {
      lookback: 126,
      diasCompletos: 126,
      diasMinimos: 60,
    });
    const { volatilidade } = montarVolatilidade("PETR4", s);
    expect(volatilidade.ivRank1a).toBe(r1a.ivRank);
    expect(volatilidade.ivPercentil1a).toBe(r1a.ivPercentil);
    expect(volatilidade.ivRank6m).toBe(r6m.ivRank);
    expect(volatilidade.ivPercentil6m).toBe(r6m.ivPercentil);
  });

  it("100 pregões: 1a 'insuficiente' (null), mas 6m preenchido (≥60)", () => {
    const s = serie(100, rampa(0.2, 0.5, 100));
    const { volatilidade } = montarVolatilidade("PETR4", s);
    expect(volatilidade.confiabilidade).toEqual({
      estado: "insuficiente",
      diasJanela: 100,
    });
    expect(volatilidade.ivRank1a).toBeNull();
    expect(volatilidade.ivPercentil1a).toBeNull();
    expect(volatilidade.ivRank6m).not.toBeNull();
    expect(volatilidade.ivPercentil6m).not.toBeNull();
  });

  it("50 pregões: 1a e 6m insuficientes (ambos null)", () => {
    const s = serie(50, rampa(0.2, 0.5, 50));
    const { volatilidade } = montarVolatilidade("PETR4", s);
    expect(volatilidade.confiabilidade!.estado).toBe("insuficiente");
    expect(volatilidade.ivRank1a).toBeNull();
    expect(volatilidade.ivRank6m).toBeNull();
    expect(volatilidade.ivPercentil6m).toBeNull();
  });
});

// ── getVolatilidadeCotahist (banco real) ──────────────────────────────────────

describe.skipIf(!TEM_DB)("getVolatilidadeCotahist (banco real)", () => {
  it("PETR4: completo, 6m preenchido e batendo com calcularIvRank", async () => {
    const { getDb } = await import("@/db");
    const { ivHistory } = await import("@/db/schema");
    const db = getDb();

    const linhas = await db
      .select({ tradeDate: ivHistory.tradeDate, iv: ivHistory.iv })
      .from(ivHistory)
      .where(eq(ivHistory.ativo, "PETR4"))
      .orderBy(asc(ivHistory.tradeDate));
    const s: PontoIv[] = linhas.map((l) => ({ tradeDate: l.tradeDate, iv: Number(l.iv) }));
    expect(s.length).toBeGreaterThanOrEqual(252);

    const alvo = s[s.length - 1]!;
    const esperado1a = calcularIvRank(s, alvo.iv);

    const { volatilidade, asOf } = await getVolatilidadeCotahist("PETR4");

    expect(asOf!.getTime()).toBe(alvo.tradeDate.getTime());
    expect(volatilidade.ivAtual).toBeCloseTo(alvo.iv * 100, 6);
    expect(volatilidade.confiabilidade!.estado).toBe("completo");
    expect(volatilidade.ivRank1a).toBeCloseTo(esperado1a.ivRank!, 6);
    expect(volatilidade.ivPercentil1a).toBeCloseTo(esperado1a.ivPercentil!, 6);
    // 6m preenchido.
    expect(volatilidade.ivRank6m).not.toBeNull();
    expect(volatilidade.ivPercentil6m).not.toBeNull();
  });

  it("ECOR3: histórico insuficiente → estado 'insuficiente' e ranks null", async () => {
    const { volatilidade } = await getVolatilidadeCotahist("ECOR3");
    expect(volatilidade.confiabilidade!.estado).toBe("insuficiente");
    expect(volatilidade.ivRank1a).toBeNull();
    expect(volatilidade.ivPercentil1a).toBeNull();
    // ECOR3 tem poucos pregões (< 60) → 6m também null.
    expect(volatilidade.ivRank6m).toBeNull();
    // ivAtual ainda é exibível (última IV diária), em percentual.
    expect(volatilidade.ivAtual).not.toBeNull();
  });
});
