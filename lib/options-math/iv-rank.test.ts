import { describe, it, expect } from "vitest";

import {
  calcularIvRank,
  percentilType7,
  LOOKBACK,
  type PontoIv,
} from "./iv-rank";

/**
 * Testes do IV Rank / IV Percentil. Os casos são NUMÉRICOS e conferíveis na mão:
 * usamos séries sintéticas com p5/p95 conhecidos pelo método type-7 (numpy/
 * `PERCENTILE.INC`) para que cada asserção possa ser refeita a lápis. Ver o
 * cabeçalho de `iv-rank.ts` para as definições.
 */

const MS_POR_DIA = 86_400_000;
const BASE = new Date(Date.UTC(2025, 0, 2)); // 02/01/2025

/** Constrói a série a partir de uma lista de IVs, datando 1 pregão/dia. */
function serieDeIvs(ivs: readonly number[]): PontoIv[] {
  return ivs.map((iv, i) => ({
    tradeDate: new Date(BASE.getTime() + i * MS_POR_DIA),
    iv,
  }));
}

/** IVs igualmente espaçadas de `de` a `ate` (inclusive), com `n` pontos. */
function rampa(de: number, ate: number, n: number): number[] {
  return Array.from({ length: n }, (_, i) => de + ((ate - de) * i) / (n - 1));
}

describe("percentilType7", () => {
  it("bate com numpy/Excel no caso clássico 0..100 (n=101)", () => {
    // x = [0,1,...,100]; h = (101−1)·p. p5 → h=5 → x[5]=5; p95 → h=95 → x[95]=95.
    const x = Array.from({ length: 101 }, (_, i) => i);
    expect(percentilType7(x, 0.05)).toBeCloseTo(5, 10);
    expect(percentilType7(x, 0.95)).toBeCloseTo(95, 10);
    expect(percentilType7(x, 0.5)).toBeCloseTo(50, 10);
  });

  it("interpola entre vizinhos quando h é fracionário", () => {
    // x=[10,20,30,40]; n=4. p=0.5 → h=1.5 → 20 + 0.5·(30−20)=25.
    expect(percentilType7([10, 20, 30, 40], 0.5)).toBeCloseTo(25, 10);
  });

  it("array de 1 ponto devolve o próprio ponto", () => {
    expect(percentilType7([0.42], 0.05)).toBe(0.42);
    expect(percentilType7([0.42], 0.95)).toBe(0.42);
  });
});

describe("calcularIvRank — caso conhecido (p5/p95 na mão)", () => {
  // Série i/120, i=0..120 (121 pontos ⇒ estado 'parcial', acima do piso de 120).
  // type-7: p5 → h=(121−1)·0.05=6 → x[6]=6/120=0.05; p95 → h=114 → x[114]=0.95.
  const ivs = Array.from({ length: 121 }, (_, i) => i / 120);
  const serie = serieDeIvs(ivs);

  it("IV Rank no centro = 50", () => {
    // (0.50 − 0.05) / (0.95 − 0.05) × 100 = 45/90×100 = 50.
    const r = calcularIvRank(serie, 0.5);
    expect(r.ivRank).toBeCloseTo(50, 6);
  });

  it("IV Percentil no centro = 61/121 (o alvo conta a si mesmo)", () => {
    // dias com iv ≤ 0.50: 0/120..60/120 = 61 de 121 = 50.4132%.
    const r = calcularIvRank(serie, 0.5);
    expect(r.ivPercentil).toBeCloseTo((61 / 121) * 100, 6);
  });

  it("IV Rank intermediário coerente com a régua [0.05, 0.95]", () => {
    // alvo 0.32 → (0.32 − 0.05)/0.90×100 = 30.
    const r = calcularIvRank(serie, 0.32);
    expect(r.ivRank).toBeCloseTo(30, 6);
  });
});

describe("calcularIvRank — clamp em [0, 100]", () => {
  const ivs = Array.from({ length: 121 }, (_, i) => i / 120); // p5=0.05, p95=0.95
  const serie = serieDeIvs(ivs);

  it("IV_hoje acima do p95 → Rank = 100", () => {
    const r = calcularIvRank(serie, 0.99); // > 0.95
    expect(r.ivRank).toBe(100);
  });

  it("IV_hoje abaixo do p5 → Rank = 0", () => {
    const r = calcularIvRank(serie, 0.01); // < 0.05
    expect(r.ivRank).toBe(0);
  });

  it("IV_hoje MUITO acima (outlier do próprio dia) ainda satura em 100", () => {
    const r = calcularIvRank(serie, 5.0);
    expect(r.ivRank).toBe(100);
  });
});

describe("calcularIvRank — robustez a outlier (p5/p95 vs min/max cru)", () => {
  it("UM ponto extremo move o MÁX cru em cheio, mas quase não move o p95", () => {
    // Base: 130 pregões "normais" de 0.20 a 0.40 (faixa típica de um ano).
    const base = rampa(0.2, 0.4, 130);
    // Injeta UM outlier extremo (estilo MGLU3 128%): vol real, porém excepcional.
    const comOutlier = [...base, 1.28];

    const ordBase = [...base].sort((a, b) => a - b);
    const ordOut = [...comOutlier].sort((a, b) => a - b);

    // min/max CRU: o máximo salta de 0.40 para 1.28 (+0.88) — a régua quebra.
    const maxBase = ordBase[ordBase.length - 1]!;
    const maxOut = ordOut[ordOut.length - 1]!;
    expect(maxBase).toBeCloseTo(0.4, 6);
    expect(maxOut).toBeCloseTo(1.28, 6);
    expect(maxOut - maxBase).toBeGreaterThan(0.8);

    // p95 ROBUSTO: praticamente não se move com o único ponto extremo.
    const p95Base = percentilType7(ordBase, 0.95);
    const p95Out = percentilType7(ordOut, 0.95);
    expect(Math.abs(p95Out - p95Base)).toBeLessThan(0.02);

    // Consequência prática: o Rank de um dia TÍPICO (0.30) quase não muda com o
    // outlier presente — a régua continua representando a faixa do ano.
    const serieBase = serieDeIvs(base);
    const serieOut = serieDeIvs(comOutlier);
    const rankBase = calcularIvRank(serieBase, 0.3).ivRank!;
    const rankOut = calcularIvRank(serieOut, 0.3).ivRank!;
    expect(Math.abs(rankOut - rankBase)).toBeLessThan(2); // < 2 pontos de Rank

    // Para contraste: se a régua fosse min/max CRU, o mesmo dia despencaria.
    const rankMinMaxBase =
      ((0.3 - ordBase[0]!) / (maxBase - ordBase[0]!)) * 100;
    const rankMinMaxOut = ((0.3 - ordOut[0]!) / (maxOut - ordOut[0]!)) * 100;
    expect(rankMinMaxBase).toBeCloseTo(50, 0); // ~50 sem outlier
    expect(rankMinMaxOut).toBeLessThan(15); // esmagado para ~9 com outlier
  });
});

describe("calcularIvRank — três estados de confiabilidade", () => {
  it("252 pregões → 'completo' (janela cheia)", () => {
    const r = calcularIvRank(serieDeIvs(rampa(0.2, 0.5, 252)), 0.35);
    expect(r.estado).toBe("completo");
    expect(r.diasNaJanela).toBe(252);
    expect(r.ivRank).not.toBeNull();
  });

  it("acima de 252 → janela CAPADA em 252, ainda 'completo'", () => {
    const r = calcularIvRank(serieDeIvs(rampa(0.2, 0.5, 300)), 0.35);
    expect(r.estado).toBe("completo");
    expect(r.diasNaJanela).toBe(LOOKBACK); // 252, não 300
  });

  it("130 pregões → 'parcial' (calcula, mas marca)", () => {
    const r = calcularIvRank(serieDeIvs(rampa(0.2, 0.5, 130)), 0.35);
    expect(r.estado).toBe("parcial");
    expect(r.diasNaJanela).toBe(130);
    expect(r.ivRank).not.toBeNull();
    expect(r.ivPercentil).not.toBeNull();
  });

  it("50 pregões → 'insuficiente' (sem Rank nem Percentil)", () => {
    const r = calcularIvRank(serieDeIvs(rampa(0.2, 0.5, 50)), 0.35);
    expect(r.estado).toBe("insuficiente");
    expect(r.diasNaJanela).toBe(50);
    expect(r.ivRank).toBeNull();
    expect(r.ivPercentil).toBeNull();
  });

  it("fronteiras exatas: 120 → 'parcial', 119 → 'insuficiente'", () => {
    expect(calcularIvRank(serieDeIvs(rampa(0.2, 0.5, 120)), 0.3).estado).toBe(
      "parcial",
    );
    expect(calcularIvRank(serieDeIvs(rampa(0.2, 0.5, 119)), 0.3).estado).toBe(
      "insuficiente",
    );
  });
});

describe("calcularIvRank — IV Percentil monotônico e extremos", () => {
  const serie = serieDeIvs(rampa(0.2, 0.5, 200));

  it("monotônico: IV_hoje maior ⇒ percentil maior-ou-igual", () => {
    const alvos = [0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5];
    const pcts = alvos.map((a) => calcularIvRank(serie, a).ivPercentil!);
    for (let i = 1; i < pcts.length; i++) {
      expect(pcts[i]!).toBeGreaterThanOrEqual(pcts[i - 1]!);
    }
  });

  it("extremos: alvo acima de tudo → 100%; abaixo de tudo → 0%", () => {
    expect(calcularIvRank(serie, 0.99).ivPercentil).toBe(100); // ≥ todos
    expect(calcularIvRank(serie, 0.01).ivPercentil).toBe(0); // < todos
  });

  it("alvo igual ao máximo da janela → 100% (todos ≤ ele)", () => {
    expect(calcularIvRank(serie, 0.5).ivPercentil).toBeCloseTo(100, 6);
  });
});

describe("calcularIvRank — robustez de entrada", () => {
  it("ordena a série por data (entrada fora de ordem não muda o resultado)", () => {
    const ivs = rampa(0.2, 0.5, 150);
    const emOrdem = serieDeIvs(ivs);
    const embaralhada = [...emOrdem].reverse();
    const a = calcularIvRank(emOrdem, 0.35);
    const b = calcularIvRank(embaralhada, 0.35);
    expect(b.ivRank).toBeCloseTo(a.ivRank!, 10);
    expect(b.ivPercentil).toBeCloseTo(a.ivPercentil!, 10);
    expect(b.diasNaJanela).toBe(a.diasNaJanela);
  });

  it("régua degenerada (série constante) → Rank neutro 50", () => {
    const r = calcularIvRank(serieDeIvs(Array(150).fill(0.3)), 0.3);
    expect(r.ivRank).toBe(50);
    expect(r.ivPercentil).toBe(100); // todos iguais ≤ alvo
  });
});
