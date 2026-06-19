import { describe, expect, it } from "vitest";

import { cruzamentoRecente, mediaMovelSimples } from "./medias-moveis";

describe("mediaMovelSimples", () => {
  it("calcula MM3 de uma série conhecida (conferível à mão)", () => {
    // [1,2,3,4,5], período 3:
    //   (1+2+3)/3 = 2 · (2+3+4)/3 = 3 · (3+4+5)/3 = 4
    expect(mediaMovelSimples([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  });

  it("é genérica para qualquer período (ex.: período 2)", () => {
    expect(mediaMovelSimples([10, 20, 30, 40], 2)).toEqual([null, 15, 25, 35]);
  });

  it("array vazio → []", () => {
    expect(mediaMovelSimples([], 9)).toEqual([]);
  });

  it("período maior que a série → tudo null", () => {
    expect(mediaMovelSimples([1, 2, 3], 5)).toEqual([null, null, null]);
  });

  it("período igual ao tamanho → só o último ponto tem valor", () => {
    expect(mediaMovelSimples([2, 4, 6], 3)).toEqual([null, null, 4]);
  });

  it("lança em entrada malformada (não-array) ou período inválido", () => {
    // @ts-expect-error — entrada inválida proposital
    expect(() => mediaMovelSimples("abc", 3)).toThrow(TypeError);
    expect(() => mediaMovelSimples([1, 2, 3], 0)).toThrow(RangeError);
    expect(() => mediaMovelSimples([1, 2, 3], 1.5)).toThrow(RangeError);
  });
});

describe("cruzamentoRecente", () => {
  it("detecta cruzamento para CIMA (rápida sobe acima da lenta) no último ponto", () => {
    const rapida = [8, 9, 11];
    const lenta = [10, 10, 10];
    // anterior: 9 < 10 · atual: 11 > 10 → "cima"
    expect(cruzamentoRecente(rapida, lenta)).toBe("cima");
  });

  it("detecta cruzamento para BAIXO no último ponto", () => {
    const rapida = [12, 11, 9];
    const lenta = [10, 10, 10];
    // anterior: 11 > 10 · atual: 9 < 10 → "baixo"
    expect(cruzamentoRecente(rapida, lenta)).toBe("baixo");
  });

  it("sem troca de lado → null (rápida segue acima nos dois pontos)", () => {
    expect(cruzamentoRecente([11, 12], [10, 10])).toBeNull();
  });

  it("empate (diferença zero) não é cruzamento", () => {
    expect(cruzamentoRecente([10, 10], [10, 10])).toBeNull();
  });

  it("dado insuficiente (warmup/null no fim) → null", () => {
    expect(cruzamentoRecente([null, 11], [null, 10])).toBeNull();
    expect(cruzamentoRecente([11], [10])).toBeNull();
  });
});
