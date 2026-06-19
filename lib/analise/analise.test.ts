/**
 * Testes das leituras fundamentalista e de volatilidade (§8.2, §9). Foco: a
 * regra do IV Rank (alto→vendidas / baixo→compradas), a tendência de lucros e a
 * ausência ABSOLUTA de "compre/venda" nas leituras (§2.3).
 */
import { describe, expect, it } from "vitest";

import { lerFundamentos, tendenciaLucros, type FundamentosEntrada } from "./fundamentos";
import { lerVolatilidade, lerSkew } from "./volatilidade";

const VAZIO: FundamentosEntrada = {
  precoLucro: null,
  evEbitda: null,
  precoValorPatrimonial: null,
  margemBruta: null,
  margemOperacional: null,
  margemLiquida: null,
  lucrosPorTrimestre: [],
};

describe("fundamentos", () => {
  it("sem nenhum dado, pede para colar", () => {
    const r = lerFundamentos(VAZIO);
    expect(r.tendenciaLucros).toBeNull();
    expect(r.leitura.join(" ")).toMatch(/Cole os dados/);
  });

  it("descreve P/L e margem líquida (em pontos) sem recomendar", () => {
    const r = lerFundamentos({ ...VAZIO, precoLucro: 8, margemLiquida: 21.69 });
    const t = r.leitura.join(" ");
    expect(t).toMatch(/P\/L de 8/);
    expect(t).toMatch(/21,7%/); // pontos percentuais, sem dupla conversão
    expect(t).not.toMatch(/compre|venda /i);
  });

  it("detecta tendência de alta nos lucros", () => {
    expect(
      tendenciaLucros([
        { fim: "2025-03-31", lucroLiquido: 100 },
        { fim: "2025-06-30", lucroLiquido: 120 },
        { fim: "2025-09-30", lucroLiquido: 140 },
      ]),
    ).toBe("alta");
  });

  it("tendência null com menos de 2 trimestres", () => {
    expect(tendenciaLucros([{ fim: "2025-03-31", lucroLiquido: 100 }])).toBeNull();
  });
});

describe("volatilidade", () => {
  it("IV Rank alto favorece vendidas (com alerta de resultados)", () => {
    const r = lerVolatilidade({ ivAtual: 54, ivRank: 85, ivPercentil: 80 });
    expect(r.vies).toBe("vendidas");
    const t = r.leitura.join(" ");
    expect(t).toMatch(/VENDIDAS/);
    expect(t).toMatch(/resultados próximos/);
    expect(t).not.toMatch(/compre|venda /i);
  });

  it("IV Rank baixo favorece compradas", () => {
    expect(lerVolatilidade({ ivAtual: 20, ivRank: 15, ivPercentil: 12 }).vies).toBe("compradas");
  });

  it("IV Rank intermediário é neutro", () => {
    expect(lerVolatilidade({ ivAtual: 30, ivRank: 50, ivPercentil: 45 }).vies).toBe("neutro");
  });

  it("sem IV Rank, não conclui viés", () => {
    expect(lerVolatilidade({ ivAtual: 30, ivRank: null, ivPercentil: null }).vies).toBeNull();
  });

  it("skew: put mais cara = proteção valorizada", () => {
    expect(lerSkew(40, 35).leitura).toMatch(/proteção contra quedas/);
    expect(lerSkew(35, 40).leitura).toMatch(/exposição à alta/);
  });
});
