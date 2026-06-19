import { describe, expect, it } from "vitest";

import { rsi } from "./rsi";

describe("rsi (Wilder)", () => {
  it("reproduz o exemplo clássico de RSI(14) (~70,5)", () => {
    // Série de fechamentos do exemplo canônico de RSI de Wilder difundido pela
    // StockChars (artigo "Relative Strength Index"). Com os preços a 2 casas, o
    // primeiro RSI (índice 14, após 14 variações) sai ~70,46 — conferido à mão:
    //   ganhos médios = 3,34/14 = 0,238571 · perdas médias = 1,40/14 = 0,10
    //   RS = 2,38571 → RSI = 100 − 100/(1+RS) = 70,46.
    const closes = [
      44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89,
      46.03, 45.61, 46.28, 46.28, 46.0, 46.03, 46.41, 46.22, 45.64,
    ];
    const r = rsi(closes, 14);
    // Warmup: os 14 primeiros pontos são null.
    expect(r.slice(0, 14).every((v) => v === null)).toBe(true);
    expect(r[14]).not.toBeNull();
    expect(r[14]!).toBeCloseTo(70.46, 1);
  });

  it("série só de alta → RSI 100 (sem perdas, sem divisão por zero)", () => {
    const subindo = Array.from({ length: 21 }, (_, i) => 10 + i); // 10,11,...,30
    const r = rsi(subindo, 14);
    expect(r[14]).toBe(100);
    expect(r[20]).toBe(100);
  });

  it("todos os preços iguais → RSI 50 (neutro), sem NaN nem divisão por zero", () => {
    const iguais = new Array(20).fill(50);
    const r = rsi(iguais, 14);
    expect(r[15]).toBe(50);
    expect(r.every((v) => v === null || Number.isFinite(v))).toBe(true);
  });

  it("array vazio → []", () => {
    expect(rsi([], 14)).toEqual([]);
  });

  it("série menor que período+1 → tudo null", () => {
    expect(rsi([1, 2, 3], 14)).toEqual([null, null, null]);
  });

  it("lança em entrada malformada ou período inválido", () => {
    // @ts-expect-error — entrada inválida proposital
    expect(() => rsi(null, 14)).toThrow(TypeError);
    expect(() => rsi([1, 2, 3], 0)).toThrow(RangeError);
  });
});
