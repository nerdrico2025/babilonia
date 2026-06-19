import { describe, expect, it } from "vitest";

import {
  detectarPivots,
  niveisSuporteResistencia,
  suporteResistenciaProximos,
} from "./suporte-resistencia";
import type { Candle } from "./tipos";

/** Helper: candle só com o que importa aqui (máxima/mínima); resto preenchido. */
function c(maxima: number, minima: number, data: string): Candle {
  return { data, abertura: minima, maxima, minima, fechamento: maxima, volume: 1000 };
}

describe("detectarPivots", () => {
  it("identifica o pivô de alta e o de baixa óbvios (N=2)", () => {
    // maxima: pico estrito no idx3 (20). minima: vale estrito no idx7 (2).
    const maxima = [10, 11, 12, 20, 12, 11, 10, 9, 8, 9, 10];
    const minima = [20, 19, 18, 17, 16, 15, 14, 2, 14, 15, 16];
    const candles = maxima.map((mx, i) => c(mx, minima[i]!, `d${i}`));

    const niveis = detectarPivots(candles, 2);

    const resistencias = niveis.filter((n) => n.tipo === "resistencia");
    const suportes = niveis.filter((n) => n.tipo === "suporte");
    expect(resistencias).toEqual([{ preco: 20, data: "d3", tipo: "resistencia" }]);
    expect(suportes).toEqual([{ preco: 2, data: "d7", tipo: "suporte" }]);
  });

  it("empate dentro da janela desqualifica o candidato (não é 'quase pivô')", () => {
    // Platô de duas máximas iguais (5,5): nenhuma é máximo ESTRITO → sem pivô.
    const maxima = [1, 2, 5, 5, 2, 1];
    const candles = maxima.map((mx, i) => c(mx, mx - 10, `d${i}`));
    const resistencias = detectarPivots(candles, 2).filter(
      (n) => n.tipo === "resistencia",
    );
    expect(resistencias).toEqual([]);
  });

  it("série curta demais para a janela → [] (sem lançar)", () => {
    const candles = [c(2, 1, "a"), c(3, 1, "b"), c(2, 1, "c")];
    expect(detectarPivots(candles, 2)).toEqual([]);
  });

  it("array vazio → []", () => {
    expect(detectarPivots([], 5)).toEqual([]);
  });

  it("lança em entrada malformada ou N inválido", () => {
    // @ts-expect-error — entrada inválida proposital
    expect(() => detectarPivots("x", 5)).toThrow(TypeError);
    expect(() => detectarPivots([], 0)).toThrow(RangeError);
  });
});

describe("niveisSuporteResistencia", () => {
  it("usa só os últimos `janela` candles", () => {
    // 11 candles; com janela=5 sobram os 5 últimos (idx6..10) e o pivô de alta do
    // idx3 (máxima 20) fica FORA do recorte — só o vale local do idx8 sobra.
    const maxima = [10, 11, 12, 20, 12, 11, 10, 9, 8, 9, 10];
    const candles = maxima.map((mx, i) => c(mx, mx - 10, `d${i}`));
    const recorte = niveisSuporteResistencia(candles, { n: 2, janela: 5 });
    expect(recorte.some((nv) => nv.preco === 20)).toBe(false);
    expect(recorte).toEqual([{ preco: -2, data: "d8", tipo: "suporte" }]);
    // Sem recorte, o pivô de alta do idx3 reaparece.
    const semRecorte = niveisSuporteResistencia(candles, { n: 2, janela: 252 });
    expect(semRecorte.some((nv) => nv.preco === 20)).toBe(true);
  });
});

describe("suporteResistenciaProximos", () => {
  const niveis = [
    { preco: 20, data: "d3", tipo: "resistencia" as const },
    { preco: 2, data: "d7", tipo: "suporte" as const },
    { preco: 8, data: "d9", tipo: "suporte" as const },
    { preco: 15, data: "d2", tipo: "resistencia" as const },
  ];

  it("acha o suporte mais próximo abaixo e a resistência mais próxima acima", () => {
    const { suporte, resistencia } = suporteResistenciaProximos(niveis, 10);
    // Abaixo de 10: {2, 8} → mais próximo é 8. Acima de 10: {20, 15} → 15.
    expect(suporte?.preco).toBe(8);
    expect(resistencia?.preco).toBe(15);
  });

  it("retorna null no lado sem nível", () => {
    const { suporte, resistencia } = suporteResistenciaProximos(niveis, 100);
    expect(suporte?.preco).toBe(20); // tudo está abaixo de 100
    expect(resistencia).toBeNull();
  });

  it("ignora nível exatamente no preço atual", () => {
    const { suporte, resistencia } = suporteResistenciaProximos(
      [{ preco: 10, data: "x", tipo: "suporte" }],
      10,
    );
    expect(suporte).toBeNull();
    expect(resistencia).toBeNull();
  });
});
