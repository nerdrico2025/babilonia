import { describe, it, expect } from "vitest";

import {
  type Leg,
  riscoMaximo,
  ganhoMaximo,
  breakevens,
  resumirEstrutura,
  faixaSugerida,
} from "@/lib/options-math";

/**
 * Testes do motor de análise: risco máximo, ganho máximo (com tratamento de
 * "ilimitado"/"indefinido") e breakeven(s). Validados contra as fórmulas
 * conhecidas do §18 do PRD. NÃO testamos estruturas nomeadas (ainda não
 * implementadas) — apenas alimentamos o motor genérico com listas de pernas.
 */

function leg(
  tipo: Leg["tipo"],
  lado: Leg["lado"],
  strike: number,
  premio: number,
  quantidade = 1,
): Leg {
  return { tipo, lado, strike, premio, quantidade };
}

describe("pernas isoladas", () => {
  it("call COMPRADA: risco = prêmio, ganho ILIMITADO, breakeven = K + prêmio", () => {
    const legs = [leg("call", "compra", 20, 1)];
    expect(riscoMaximo(legs)).toEqual({ valor: 100, indefinido: false });
    expect(ganhoMaximo(legs)).toEqual({ valor: null, ilimitado: true });
    expect(breakevens(legs)).toHaveLength(1);
    expect(breakevens(legs)[0]).toBeCloseTo(21);
  });

  it("call VENDIDA a descoberto: risco INDEFINIDO, ganho = prêmio", () => {
    const legs = [leg("call", "venda", 20, 1)];
    const risco = riscoMaximo(legs);
    expect(risco.indefinido).toBe(true);
    expect(risco.valor).toBe(Infinity);
    expect(ganhoMaximo(legs)).toEqual({ valor: 100, ilimitado: false });
    expect(breakevens(legs)[0]).toBeCloseTo(21);
  });

  it("put COMPRADA: risco = prêmio, ganho limitado (máx. em S=0), breakeven = K − prêmio", () => {
    const legs = [leg("put", "compra", 20, 1)];
    expect(riscoMaximo(legs)).toEqual({ valor: 100, indefinido: false });
    // Ganho máximo no vencimento com o ativo em zero: (20 − 0 − 1) × 100.
    expect(ganhoMaximo(legs)).toEqual({ valor: 1900, ilimitado: false });
    expect(breakevens(legs)[0]).toBeCloseTo(19);
  });

  it("put VENDIDA: risco DEFINIDO (perda máx. em S=0), ganho = prêmio", () => {
    const legs = [leg("put", "venda", 20, 1)];
    expect(riscoMaximo(legs)).toEqual({ valor: 1900, indefinido: false });
    expect(ganhoMaximo(legs)).toEqual({ valor: 100, ilimitado: false });
    expect(breakevens(legs)[0]).toBeCloseTo(19);
  });
});

describe("estruturas de referência do §18 (via pernas)", () => {
  it("trava de ALTA com calls (débito): risco=débito, ganho=(K2−K1)−débito, BE=K1+débito", () => {
    const legs = [
      leg("call", "compra", 20, 2),
      leg("call", "venda", 24, 0.8),
    ];
    // débito = 1,2/ação → 120; ganho = (4 − 1,2) × 100 = 280; BE = 21,2.
    expect(riscoMaximo(legs)).toEqual({ valor: 120, indefinido: false });
    expect(ganhoMaximo(legs)).toEqual({ valor: 280, ilimitado: false });
    const be = breakevens(legs);
    expect(be).toHaveLength(1);
    expect(be[0]).toBeCloseTo(21.2);
  });

  it("trava de BAIXA com puts (débito): risco=débito, ganho=(K2−K1)−débito, BE=K2−débito", () => {
    const legs = [
      leg("put", "compra", 24, 3),
      leg("put", "venda", 20, 1.2),
    ];
    // débito = 1,8/ação → 180; ganho = (4 − 1,8) × 100 = 220; BE = 22,2.
    expect(riscoMaximo(legs)).toEqual({ valor: 180, indefinido: false });
    expect(ganhoMaximo(legs)).toEqual({ valor: 220, ilimitado: false });
    expect(breakevens(legs)[0]).toBeCloseTo(22.2);
  });

  it("borboleta com calls: risco=débito líq., ganho=(K2−K1)−débito, dois breakevens", () => {
    const legs = [
      leg("call", "compra", 18, 3),
      leg("call", "venda", 20, 1.5, 2), // 2× no miolo
      leg("call", "compra", 22, 0.8),
    ];
    // débito líq. = 3 − 2×1,5 + 0,8 = 0,8/ação → 80; ganho = (2 − 0,8)×100 = 120.
    expect(riscoMaximo(legs)).toEqual({ valor: 80, indefinido: false });
    expect(ganhoMaximo(legs)).toEqual({ valor: 120, ilimitado: false });
    const be = breakevens(legs);
    expect(be).toHaveLength(2);
    expect(be[0]).toBeCloseTo(18.8); // K1 + débito
    expect(be[1]).toBeCloseTo(21.2); // K3 − débito
  });

  it("straddle COMPRADO: risco=soma dos prêmios, ganho ILIMITADO, BE = K ± prêmios", () => {
    const legs = [
      leg("call", "compra", 20, 1),
      leg("put", "compra", 20, 1.5),
    ];
    // soma prêmios = 2,5/ação → risco 250; BE = 20 ± 2,5.
    expect(riscoMaximo(legs)).toEqual({ valor: 250, indefinido: false });
    expect(ganhoMaximo(legs)).toEqual({ valor: null, ilimitado: true });
    const be = breakevens(legs);
    expect(be).toHaveLength(2);
    expect(be[0]).toBeCloseTo(17.5);
    expect(be[1]).toBeCloseTo(22.5);
  });

  it("strangle VENDIDO: risco INDEFINIDO (perna de call descoberta)", () => {
    const legs = [
      leg("call", "venda", 24, 0.8),
      leg("put", "venda", 20, 1),
    ];
    expect(riscoMaximo(legs).indefinido).toBe(true);
    expect(ganhoMaximo(legs)).toEqual({ valor: 180, ilimitado: false }); // soma dos prêmios
  });
});

describe("resumirEstrutura — agrega risco antes do ganho (§2)", () => {
  it("monta o resumo completo da trava de alta", () => {
    const legs = [
      leg("call", "compra", 20, 2),
      leg("call", "venda", 24, 0.8),
    ];
    const resumo = resumirEstrutura(legs);
    expect(resumo.riscoMaximo).toBeCloseTo(120);
    expect(resumo.riscoIndefinido).toBe(false);
    expect(resumo.ganhoMaximo).toBeCloseTo(280);
    expect(resumo.ganhoIlimitado).toBe(false);
    expect(resumo.breakevens[0]).toBeCloseTo(21.2);
  });

  it("marca risco indefinido para venda de call a descoberto", () => {
    const resumo = resumirEstrutura([leg("call", "venda", 20, 1)]);
    expect(resumo.riscoIndefinido).toBe(true);
    expect(resumo.riscoMaximo).toBe(Infinity);
    expect(resumo.ganhoIlimitado).toBe(false);
  });
});

describe("faixaSugerida", () => {
  it("abre uma margem em torno dos strikes e nunca devolve min negativo", () => {
    const faixa = faixaSugerida([leg("call", "compra", 20, 1)], 0.3);
    expect(faixa.min).toBeCloseTo(14); // 20 × 0,7
    expect(faixa.max).toBeCloseTo(26); // 20 × 1,3
    expect(faixa.min).toBeGreaterThanOrEqual(0);
  });
});
