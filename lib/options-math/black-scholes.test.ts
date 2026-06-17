import { describe, it, expect } from "vitest";
import {
  normalCDF,
  normalPDF,
  precoBS,
  gregas,
  volImplicita,
  type ParametrosBS,
} from "./black-scholes";

/**
 * Testes do motor Black-Scholes (§18.1). Numéricos, com âncoras calculáveis à
 * mão ou de tabela conhecida. O núcleo não pode ter bug.
 */

describe("normalCDF / normalPDF", () => {
  it("N(0) = 0,5", () => {
    expect(normalCDF(0)).toBeCloseTo(0.5, 7);
  });

  it("N(1,96) ≈ 0,975 e N(−1,96) ≈ 0,025", () => {
    expect(normalCDF(1.96)).toBeCloseTo(0.975, 4);
    expect(normalCDF(-1.96)).toBeCloseTo(0.025, 4);
  });

  it("é simétrica: N(x) + N(−x) = 1", () => {
    for (const x of [0.1, 0.5, 1, 2, 3]) {
      expect(normalCDF(x) + normalCDF(-x)).toBeCloseTo(1, 10);
    }
  });

  it("caudas: N(−∞)→0, N(+∞)→1", () => {
    expect(normalCDF(-8)).toBeCloseTo(0, 6);
    expect(normalCDF(8)).toBeCloseTo(1, 6);
  });

  it("PDF padrão: φ(0) = 1/√(2π)", () => {
    expect(normalPDF(0)).toBeCloseTo(0.3989422804, 9);
  });
});

describe("precoBS — paridade put-call (C − P = S − K·e^(−rT))", () => {
  const casos: ParametrosBS[] = [
    { tipo: "call", S: 100, K: 100, T: 1, r: 0.1, sigma: 0.25 },
    { tipo: "call", S: 87.5, K: 95, T: 0.5, r: 0.06, sigma: 0.4 },
  ];
  it.each(casos)("vale para S=$S K=$K T=$T r=$r sigma=$sigma", (p) => {
    const call = precoBS({ ...p, tipo: "call" });
    const put = precoBS({ ...p, tipo: "put" });
    const esperado = p.S - p.K * Math.exp(-p.r * p.T);
    expect(call - put).toBeCloseTo(esperado, 9);
  });
});

describe("precoBS — caso âncora ATM (S=100, K=100, T=1, r=0, sigma=0,20)", () => {
  const ancora: ParametrosBS = {
    tipo: "call",
    S: 100,
    K: 100,
    T: 1,
    r: 0,
    sigma: 0.2,
  };

  it("call ATM ≈ 7,97 (ordem de grandeza)", () => {
    const call = precoBS(ancora);
    // Valor analítico = 100·(2·N(0,1) − 1) ≈ 7,9656.
    expect(call).toBeCloseTo(7.97, 1);
    expect(call).toBeCloseTo(7.9656, 2);
  });

  it("com r=0 a call e a put ATM têm o mesmo preço (paridade)", () => {
    expect(precoBS({ ...ancora, tipo: "call" })).toBeCloseTo(
      precoBS({ ...ancora, tipo: "put" }),
      9,
    );
  });
});

describe("precoBS — bordas", () => {
  it("T=0 → valor intrínseco não descontado", () => {
    expect(precoBS({ tipo: "call", S: 110, K: 100, T: 0, r: 0.1, sigma: 0.3 })).toBe(10);
    expect(precoBS({ tipo: "put", S: 110, K: 100, T: 0, r: 0.1, sigma: 0.3 })).toBe(0);
  });

  it("sigma=0 → valor intrínseco descontado ao forward", () => {
    const c = precoBS({ tipo: "call", S: 100, K: 100, T: 1, r: 0.1, sigma: 0 });
    expect(c).toBeCloseTo(100 - 100 * Math.exp(-0.1), 9); // ≈ 9,516
  });

  it("rejeita S ou K não positivos", () => {
    expect(() => precoBS({ tipo: "call", S: 0, K: 100, T: 1, r: 0, sigma: 0.2 })).toThrow();
    expect(() => precoBS({ tipo: "call", S: 100, K: -1, T: 1, r: 0, sigma: 0.2 })).toThrow();
  });
});

describe("gregas — delta", () => {
  it("delta de call ATM ≈ 0,5 (caso âncora dá ~0,54)", () => {
    const { delta } = gregas({ tipo: "call", S: 100, K: 100, T: 1, r: 0, sigma: 0.2 });
    expect(delta).toBeGreaterThan(0.45);
    expect(delta).toBeLessThan(0.6);
  });

  it("call muito ITM → delta perto de 1; muito OTM → perto de 0", () => {
    const itm = gregas({ tipo: "call", S: 200, K: 100, T: 0.5, r: 0.05, sigma: 0.3 });
    const otm = gregas({ tipo: "call", S: 50, K: 100, T: 0.5, r: 0.05, sigma: 0.3 });
    expect(itm.delta).toBeGreaterThan(0.97);
    expect(otm.delta).toBeLessThan(0.03);
  });

  it("delta de call ∈ [0,1] e de put ∈ [−1,0]", () => {
    const base = { S: 100, K: 105, T: 0.7, r: 0.08, sigma: 0.35 } as const;
    const c = gregas({ ...base, tipo: "call" });
    const p = gregas({ ...base, tipo: "put" });
    expect(c.delta).toBeGreaterThanOrEqual(0);
    expect(c.delta).toBeLessThanOrEqual(1);
    expect(p.delta).toBeGreaterThanOrEqual(-1);
    expect(p.delta).toBeLessThanOrEqual(0);
    // Relação delta_call − delta_put = 1 (sem dividendos).
    expect(c.delta - p.delta).toBeCloseTo(1, 9);
  });
});

describe("gregas — sinais e convenções", () => {
  const p: ParametrosBS = { tipo: "call", S: 100, K: 100, T: 1, r: 0, sigma: 0.2 };

  it("vega > 0 e gama > 0", () => {
    const g = gregas(p);
    expect(g.vega).toBeGreaterThan(0);
    expect(g.gama).toBeGreaterThan(0);
  });

  it("theta ≤ 0 para call comprada ATM (decaimento)", () => {
    expect(gregas(p).theta).toBeLessThan(0);
  });

  it("conversões: vegaPorPonto = vega/100 e thetaPorPregao = theta/252", () => {
    const g = gregas(p);
    expect(g.vegaPorPonto).toBeCloseTo(g.vega / 100, 12);
    expect(g.thetaPorPregao).toBeCloseTo(g.theta / 252, 12);
  });

  it("vega bate com diferença finita do preço (por +1 ponto de vol)", () => {
    const h = 1e-4; // em vol decimal
    const cMais = precoBS({ ...p, sigma: p.sigma + h });
    const cMenos = precoBS({ ...p, sigma: p.sigma - h });
    const vegaNumerica = (cMais - cMenos) / (2 * h); // por +1,00 de vol
    expect(gregas(p).vega).toBeCloseTo(vegaNumerica, 4);
  });

  it("delta bate com diferença finita do preço", () => {
    const h = 1e-3;
    const cMais = precoBS({ ...p, S: p.S + h });
    const cMenos = precoBS({ ...p, S: p.S - h });
    const deltaNumerico = (cMais - cMenos) / (2 * h);
    expect(gregas(p).delta).toBeCloseTo(deltaNumerico, 5);
  });

  it("gama e vega são iguais para call e put (mesmos parâmetros)", () => {
    const base = { S: 100, K: 110, T: 0.8, r: 0.07, sigma: 0.3 } as const;
    const c = gregas({ ...base, tipo: "call" });
    const pu = gregas({ ...base, tipo: "put" });
    expect(c.gama).toBeCloseTo(pu.gama, 12);
    expect(c.vega).toBeCloseTo(pu.vega, 12);
  });
});

describe("volImplicita — round-trip e bordas", () => {
  // Casos BEM-CONDICIONADOS (vega não-desprezível): a IV recupera-se nítida.
  const conjuntos: Array<Omit<ParametrosBS, "sigma">> = [
    { tipo: "call", S: 100, K: 100, T: 1, r: 0.05 },
    { tipo: "put", S: 100, K: 95, T: 0.5, r: 0.1 },
    { tipo: "call", S: 100, K: 120, T: 0.5, r: 0.08 }, // OTM moderado
    { tipo: "put", S: 100, K: 120, T: 0.5, r: 0.08 }, // ITM moderado
  ];

  it.each(conjuntos)("recupera o sigma usado para precificar ($tipo K=$K)", (base) => {
    for (const sigma of [0.1, 0.2, 0.35, 0.8]) {
      const premio = precoBS({ ...base, sigma });
      const resolvido = volImplicita({ ...base, premio });
      expect(resolvido).not.toBeNull();
      expect(resolvido as number).toBeCloseTo(sigma, 6);
    }
  });

  it("deep OTM + vol baixa é mal-condicionado: preço bate, sigma só aproximado", () => {
    // Vega minúscula → muitos sigmas dão quase o mesmo prêmio. O solver tem de
    // reproduzir o PREÇO com precisão; o sigma fica determinado de forma frouxa.
    const base = { tipo: "call", S: 100, K: 130, T: 0.25, r: 0.08 } as const;
    const sigma = 0.1;
    const premio = precoBS({ ...base, sigma });
    const resolvido = volImplicita({ ...base, premio });
    expect(resolvido).not.toBeNull();
    expect(precoBS({ ...base, sigma: resolvido as number })).toBeCloseTo(premio, 9);
    expect(resolvido as number).toBeCloseTo(sigma, 3);
  });

  it("retorna null para prêmio abaixo do valor intrínseco", () => {
    // Call ITM: intrínseco descontado ≈ 10; prêmio de 5 é inviável.
    const r = volImplicita({ tipo: "call", S: 100, K: 90, T: 1, r: 0, premio: 5 });
    expect(r).toBeNull();
  });

  it("retorna null para série sem negócio (prêmio = 0)", () => {
    const r = volImplicita({ tipo: "call", S: 100, K: 100, T: 1, r: 0.05, premio: 0 });
    expect(r).toBeNull();
  });

  it("retorna null para prêmio no/acima do limite superior", () => {
    // Call não pode valer ≥ S.
    const r = volImplicita({ tipo: "call", S: 100, K: 100, T: 1, r: 0.05, premio: 100 });
    expect(r).toBeNull();
  });

  it("retorna null para prazo inválido (T ≤ 0)", () => {
    const r = volImplicita({ tipo: "call", S: 100, K: 100, T: 0, r: 0.05, premio: 5 });
    expect(r).toBeNull();
  });

  it("resolve mesmo em caso quase-degenerado que força a bisseção (deep OTM)", () => {
    const base = { tipo: "call", S: 100, K: 200, T: 0.1, r: 0.05 } as const;
    const sigma = 0.6;
    const premio = precoBS({ ...base, sigma });
    const resolvido = volImplicita({ ...base, premio });
    expect(resolvido).not.toBeNull();
    expect(resolvido as number).toBeCloseTo(sigma, 5);
  });
});
