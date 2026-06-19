import { describe, expect, it } from "vitest";

import { emaSerie, macd } from "./macd";

describe("emaSerie", () => {
  it("EMA(3) de [1,2,3,4,5] conferível à mão", () => {
    // k = 2/(3+1) = 0,5 · semente idx2 = (1+2+3)/3 = 2
    //   idx3 = 4·0,5 + 2·0,5 = 3 · idx4 = 5·0,5 + 3·0,5 = 4
    const e = emaSerie([1, 2, 3, 4, 5], 3);
    expect(e[0]).toBeNull();
    expect(e[1]).toBeNull();
    expect(e[2]!).toBeCloseTo(2, 10);
    expect(e[3]!).toBeCloseTo(3, 10);
    expect(e[4]!).toBeCloseTo(4, 10);
  });

  it("série menor que o período → tudo null", () => {
    expect(emaSerie([1, 2], 3)).toEqual([null, null]);
  });
});

describe("macd", () => {
  it("MACD(2,3,2) de [1..6] conferível à mão (EMAs calculadas a dedo)", () => {
    // EMA2: [null, 1.5, 2.5, 3.5, 4.5, 5.5]
    // EMA3: [null, null, 2,   3,   4,   5  ]
    // linha = EMA2 − EMA3 (onde ambas existem): 0,5 constante de idx2 em diante.
    // sinal = EMA2 da linha [0.5,0.5,0.5,0.5] = [null, 0.5, 0.5, 0.5] → idx3..5.
    // histograma = linha − sinal = 0 onde ambos existem.
    const { linha, sinal, histograma } = macd([1, 2, 3, 4, 5, 6], 2, 3, 2);

    expect(linha[0]).toBeNull();
    expect(linha[1]).toBeNull();
    for (let i = 2; i <= 5; i++) expect(linha[i]!).toBeCloseTo(0.5, 10);

    expect(sinal[0]).toBeNull();
    expect(sinal[1]).toBeNull();
    expect(sinal[2]).toBeNull();
    for (let i = 3; i <= 5; i++) expect(sinal[i]!).toBeCloseTo(0.5, 10);

    expect(histograma[2]).toBeNull();
    for (let i = 3; i <= 5; i++) expect(histograma[i]!).toBeCloseTo(0, 10);
  });

  it("histograma = linha − sinal ponto a ponto onde ambos existem", () => {
    const precos = Array.from({ length: 40 }, (_, i) => 100 + Math.sin(i / 3) * 5);
    const { linha, sinal, histograma } = macd(precos);
    for (let i = 0; i < precos.length; i++) {
      if (linha[i] != null && sinal[i] != null) {
        expect(histograma[i]!).toBeCloseTo(linha[i]! - sinal[i]!, 10);
      } else {
        expect(histograma[i]).toBeNull();
      }
    }
  });

  it("primeiro sinal do MACD(12,26,9) nasce no índice 33", () => {
    const precos = Array.from({ length: 60 }, (_, i) => 50 + i);
    const { sinal } = macd(precos);
    expect(sinal[32]).toBeNull();
    expect(sinal[33]).not.toBeNull();
  });

  it("array vazio / curto → séries vazias ou todas null, sem lançar", () => {
    expect(macd([])).toEqual({ linha: [], sinal: [], histograma: [] });
    const curto = macd([1, 2, 3]);
    expect(curto.linha).toEqual([null, null, null]);
    expect(curto.sinal).toEqual([null, null, null]);
    expect(curto.histograma).toEqual([null, null, null]);
  });

  it("lança em entrada malformada", () => {
    // @ts-expect-error — entrada inválida proposital
    expect(() => macd(42)).toThrow(TypeError);
  });
});
