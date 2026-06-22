/**
 * Testes da ponte acao_cotahist → Candle[] (T2).
 *
 * Duas camadas, espelhando a convenção de `lib/dados-opcoes/cadeia.test.ts`:
 *  1. `acaoCotahistParaCandle` (PURA) + `obterCandles`/`obterDataUltimoCandle` com
 *     um `db` FAKE injetado — determinístico, sem Postgres nem rede.
 *  2. Integração contra o Neon REAL (`describe.skipIf`), só quando há DATABASE_URL:
 *     confirma ordem, frescor e o caso "limite > disponível" (≈363 pregões reais).
 */

import { describe, expect, it } from "vitest";

import type { AcaoCotahist } from "@/db/schema";

import {
  acaoCotahistParaCandle,
  obterCandles,
  obterDataUltimoCandle,
  type Db,
} from "./repositorio";

// Carrega DATABASE_URL de .env.local para os testes de integração (Node 22).
try {
  process.loadEnvFile(".env.local");
} catch {
  // .env.local ausente — os testes de integração serão pulados.
}
const TEM_DB = Boolean(process.env.DATABASE_URL);

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** Linha de `acao_cotahist` ($inferSelect): numeric vem como STRING. */
function linhaAcao(over: Partial<AcaoCotahist> = {}): AcaoCotahist {
  return {
    id: 1,
    ticker: "PETR4",
    tradeDate: new Date("2026-06-17T00:00:00.000Z"),
    precoAbertura: "38.10",
    precoMinimo: "37.90",
    precoMedio: "38.30",
    precoMaximo: "38.70",
    precoFechamento: "38.57",
    bid: "38.55",
    ask: "38.58",
    volumeFinanceiro: "1000000.00",
    numeroNegocios: 1200,
    quantidadeTitulos: "50000",
    fatorCotacao: 1,
    createdAt: new Date("2026-06-17T22:00:00.000Z"),
    updatedAt: new Date("2026-06-17T22:00:00.000Z"),
    ...over,
  };
}

/**
 * `db` falso: simula `select().from().where().orderBy(desc).limit(n)` do Drizzle
 * devolvendo as linhas em ordem DESC por `tradeDate`, recortadas em `n` — como o
 * Neon faria. O `where` por ticker é ignorado: cada fake já recebe o dataset do
 * ticker em teste (a correção do filtro é coberta na integração real).
 */
function fakeDb(linhas: AcaoCotahist[]): Db {
  const desc = [...linhas].sort(
    (a, b) => b.tradeDate.getTime() - a.tradeDate.getTime(),
  );
  const builder = {
    select: () => builder,
    from: () => builder,
    where: () => builder,
    orderBy: () => builder,
    limit: async (n: number) => desc.slice(0, n),
  };
  return builder as unknown as Db;
}

// ── acaoCotahistParaCandle (puro) ─────────────────────────────────────────────

describe("acaoCotahistParaCandle", () => {
  it("mapeia uma linha válida para o Candle correto (numeric string → number)", () => {
    const candle = acaoCotahistParaCandle(linhaAcao());
    expect(candle).toEqual({
      data: "2026-06-17T00:00:00.000Z",
      abertura: 38.1,
      maxima: 38.7,
      minima: 37.9,
      fechamento: 38.57,
      volume: 50000, // quantidadeTitulos (QUATOT)
    });
  });

  it("campo numeric malformado → erro EXPLÍCITO (não NaN silencioso)", () => {
    expect(() =>
      acaoCotahistParaCandle(linhaAcao({ precoFechamento: "não-é-número" })),
    ).toThrow(/precoFechamento/);
    // o erro também identifica ticker/pregão
    expect(() =>
      acaoCotahistParaCandle(linhaAcao({ ticker: "VALE3", precoMaximo: "abc" })),
    ).toThrow(/VALE3/);
  });
});

// ── obterCandles / obterDataUltimoCandle (db injetado) ────────────────────────

describe("obterCandles (db fake)", () => {
  const datas = [
    "2026-06-10",
    "2026-06-15",
    "2026-06-11",
    "2026-06-17",
    "2026-06-12",
  ];
  const dataset = datas.map((d, i) =>
    linhaAcao({ id: i + 1, tradeDate: new Date(`${d}T00:00:00.000Z`) }),
  );

  it("devolve os candles em ordem CRONOLÓGICA ASCENDENTE", async () => {
    const candles = await obterCandles("PETR4", { db: fakeDb(dataset) });
    const ordenadas = candles.map((c) => c.data);
    expect(ordenadas).toEqual([...ordenadas].sort());
    expect(candles).toHaveLength(5);
    expect(candles.at(-1)!.data).toBe("2026-06-17T00:00:00.000Z");
  });

  it("respeita o limite, mantendo os pregões MAIS RECENTES (em ascendente)", async () => {
    const candles = await obterCandles("PETR4", { db: fakeDb(dataset), limite: 3 });
    expect(candles.map((c) => c.data)).toEqual([
      "2026-06-12T00:00:00.000Z",
      "2026-06-15T00:00:00.000Z",
      "2026-06-17T00:00:00.000Z",
    ]);
  });

  it("limite MAIOR que o disponível → devolve o que existe (não trunca/erra)", async () => {
    const candles = await obterCandles("PETR4", { db: fakeDb(dataset), limite: 1000 });
    expect(candles).toHaveLength(5);
  });

  it("ticker sem nenhuma linha → [] (não lança)", async () => {
    const candles = await obterCandles("ZZZZ99", { db: fakeDb([]) });
    expect(candles).toEqual([]);
  });
});

describe("obterDataUltimoCandle (db fake)", () => {
  it("expõe a data do candle mais recente", async () => {
    const dataset = [
      linhaAcao({ id: 1, tradeDate: new Date("2026-06-10T00:00:00.000Z") }),
      linhaAcao({ id: 2, tradeDate: new Date("2026-06-17T00:00:00.000Z") }),
      linhaAcao({ id: 3, tradeDate: new Date("2026-06-12T00:00:00.000Z") }),
    ];
    const data = await obterDataUltimoCandle("PETR4", fakeDb(dataset));
    expect(data?.toISOString()).toBe("2026-06-17T00:00:00.000Z");
  });

  it("ticker sem histórico → null", async () => {
    expect(await obterDataUltimoCandle("ZZZZ99", fakeDb([]))).toBeNull();
  });
});

// ── Integração com o Neon real (só com DATABASE_URL) ──────────────────────────

describe.skipIf(!TEM_DB)("obterCandles (Neon real)", () => {
  it("PETR4: candles ascendentes e frescor batendo com o último pregão", async () => {
    const candles = await obterCandles("PETR4");
    expect(candles.length).toBeGreaterThan(0);
    expect(candles.length).toBeLessThanOrEqual(252);
    // ascendente
    const datas = candles.map((c) => c.data);
    expect(datas).toEqual([...datas].sort());
    // frescor: a data do último candle == obterDataUltimoCandle
    const ultima = await obterDataUltimoCandle("PETR4");
    expect(candles.at(-1)!.data).toBe(ultima!.toISOString());
  }, 15000);

  it("limite > disponível devolve todo o histórico sem erro (≈363 pregões)", async () => {
    const candles = await obterCandles("PETR4", { limite: 5000 });
    expect(candles.length).toBeGreaterThan(0);
    // não estoura nem trunca em 5000 — devolve o que existe.
    expect(candles.length).toBeLessThan(5000);
  }, 15000);

  it("ticker fora da watchlist → [] (sem lançar)", async () => {
    expect(await obterCandles("ZZZZ99")).toEqual([]);
  }, 15000);
});
