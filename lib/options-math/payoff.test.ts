import { describe, it, expect } from "vitest";

import {
  type Leg,
  TAMANHO_LOTE_PADRAO,
  valorIntrinseco,
  payoffPerna,
  payoffEstrutura,
  curvaPayoff,
} from "@/lib/options-math";

/**
 * Testes do payoff de UMA perna e do motor de varredura (§8.4 item 4).
 * Pontos conhecidos para call/put, comprada/vendida; casos de borda no strike,
 * abaixo e acima; e monotonicidade da curva onde esperado.
 */

// Helper enxuto para montar pernas nos testes.
function leg(
  tipo: Leg["tipo"],
  lado: Leg["lado"],
  strike: number,
  premio: number,
  quantidade = 1,
): Leg {
  return { tipo, lado, strike, premio, quantidade };
}

describe("valorIntrinseco", () => {
  it("call: max(preço − strike, 0) — no strike, abaixo e acima", () => {
    expect(valorIntrinseco("call", 20, 20)).toBe(0); // no strike
    expect(valorIntrinseco("call", 20, 15)).toBe(0); // abaixo (OTM)
    expect(valorIntrinseco("call", 20, 26)).toBe(6); // acima (ITM)
  });

  it("put: max(strike − preço, 0) — no strike, abaixo e acima", () => {
    expect(valorIntrinseco("put", 20, 20)).toBe(0); // no strike
    expect(valorIntrinseco("put", 20, 14)).toBe(6); // abaixo (ITM)
    expect(valorIntrinseco("put", 20, 25)).toBe(0); // acima (OTM)
  });
});

describe("payoffPerna — pontos conhecidos (lote padrão = 100)", () => {
  it("usa o lote padrão da B3 igual a 100", () => {
    expect(TAMANHO_LOTE_PADRAO).toBe(100);
  });

  it("call COMPRADA (K=20, prêmio=1): perde o prêmio abaixo, lucra acima", () => {
    const l = leg("call", "compra", 20, 1);
    expect(payoffPerna(l, 18)).toBeCloseTo(-100); // abaixo: perde prêmio
    expect(payoffPerna(l, 20)).toBeCloseTo(-100); // no strike: perde prêmio
    expect(payoffPerna(l, 21)).toBeCloseTo(0); // breakeven = K + prêmio
    expect(payoffPerna(l, 25)).toBeCloseTo(400); // (5 − 1) × 100
  });

  it("call VENDIDA (K=20, prêmio=1): recebe o prêmio abaixo, perde acima", () => {
    const l = leg("call", "venda", 20, 1);
    expect(payoffPerna(l, 18)).toBeCloseTo(100); // mantém o prêmio
    expect(payoffPerna(l, 20)).toBeCloseTo(100); // no strike: mantém prêmio
    expect(payoffPerna(l, 21)).toBeCloseTo(0); // breakeven
    expect(payoffPerna(l, 25)).toBeCloseTo(-400); // espelho da comprada
  });

  it("put COMPRADA (K=20, prêmio=1): lucra abaixo, perde o prêmio acima", () => {
    const l = leg("put", "compra", 20, 1);
    expect(payoffPerna(l, 15)).toBeCloseTo(400); // (5 − 1) × 100
    expect(payoffPerna(l, 19)).toBeCloseTo(0); // breakeven = K − prêmio
    expect(payoffPerna(l, 20)).toBeCloseTo(-100); // no strike: perde prêmio
    expect(payoffPerna(l, 25)).toBeCloseTo(-100); // acima: perde prêmio
  });

  it("put VENDIDA (K=20, prêmio=1): recebe o prêmio acima, perde abaixo", () => {
    const l = leg("put", "venda", 20, 1);
    expect(payoffPerna(l, 15)).toBeCloseTo(-400); // espelho da comprada
    expect(payoffPerna(l, 19)).toBeCloseTo(0); // breakeven
    expect(payoffPerna(l, 20)).toBeCloseTo(100); // no strike: mantém prêmio
    expect(payoffPerna(l, 25)).toBeCloseTo(100); // acima: mantém prêmio
  });

  it("escala com a quantidade de contratos", () => {
    const l = leg("call", "compra", 20, 1, 3);
    expect(payoffPerna(l, 25)).toBeCloseTo(1200); // 3 × 400
  });

  it("tamanho do lote é parametrizável (lote = 1 → valor por ação × qtd)", () => {
    const l = leg("call", "compra", 20, 1);
    expect(payoffPerna(l, 25, 1)).toBeCloseTo(4); // (5 − 1) × 1
  });
});

describe("payoffEstrutura — soma das pernas", () => {
  it("soma o resultado de cada perna no mesmo preço", () => {
    const legs = [leg("call", "compra", 20, 2), leg("call", "venda", 24, 0.8)];
    // Em S=25: comprada (5−2)×100=300; vendida −(1−0.8)×100=−20... confere abaixo.
    // comprada call24? não — vendida K=24: intr(25)=1 → −(1−0.8)×100 = −20.
    expect(payoffEstrutura(legs, 25)).toBeCloseTo(300 - 20);
    // Em S=20: ambas OTM/no strike → −(débito) = −(2−0.8)×100 = −120.
    expect(payoffEstrutura(legs, 20)).toBeCloseTo(-120);
  });

  it("estrutura vazia tem payoff zero", () => {
    expect(payoffEstrutura([], 42)).toBe(0);
  });
});

describe("curvaPayoff — motor de varredura (§8.4)", () => {
  const longCall = [leg("call", "compra", 20, 1)];

  it("devolve pontos ordenados, cobrindo de min a max", () => {
    const curva = curvaPayoff(longCall, { min: 10, max: 30, passos: 20 });
    expect(curva[0]!.preco).toBeCloseTo(10);
    expect(curva[curva.length - 1]!.preco).toBeCloseTo(30);
    for (let i = 1; i < curva.length; i++) {
      expect(curva[i]!.preco).toBeGreaterThan(curva[i - 1]!.preco);
    }
  });

  it("call COMPRADA: curva é monotônica NÃO-decrescente", () => {
    const curva = curvaPayoff(longCall, { min: 5, max: 40, passos: 70 });
    for (let i = 1; i < curva.length; i++) {
      expect(curva[i]!.resultado).toBeGreaterThanOrEqual(
        curva[i - 1]!.resultado - 1e-9,
      );
    }
  });

  it("call VENDIDA: curva é monotônica NÃO-crescente", () => {
    const curva = curvaPayoff([leg("call", "venda", 20, 1)], {
      min: 5,
      max: 40,
      passos: 70,
    });
    for (let i = 1; i < curva.length; i++) {
      expect(curva[i]!.resultado).toBeLessThanOrEqual(
        curva[i - 1]!.resultado + 1e-9,
      );
    }
  });

  it("put COMPRADA: curva é monotônica NÃO-crescente", () => {
    const curva = curvaPayoff([leg("put", "compra", 20, 1)], {
      min: 5,
      max: 40,
      passos: 70,
    });
    for (let i = 1; i < curva.length; i++) {
      expect(curva[i]!.resultado).toBeLessThanOrEqual(
        curva[i - 1]!.resultado + 1e-9,
      );
    }
  });

  it("inclui os vértices (strike e breakeven) dentro da faixa", () => {
    const curva = curvaPayoff(longCall, { min: 10, max: 30, passos: 4 });
    const precos = curva.map((p) => p.preco);
    // passos=4 em [10,30] → grade {10,15,20,25,30}; strike 20 já cai na grade,
    // mas o breakeven 21 (= K + prêmio) NÃO está na grade e deve ser incluído.
    expect(precos.some((p) => Math.abs(p - 21) < 1e-9)).toBe(true);
    const pBreakeven = curva.find((p) => Math.abs(p.preco - 21) < 1e-9)!;
    expect(pBreakeven.resultado).toBeCloseTo(0);
  });

  it("rejeita faixa inválida (max ≤ min)", () => {
    expect(() => curvaPayoff(longCall, { min: 30, max: 10 })).toThrow();
  });
});
