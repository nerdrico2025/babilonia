import { describe, it, expect } from "vitest";

import type { ResultadoEstrutura } from "@/lib/options-math";
import {
  avaliarRisco,
  diasUteisEntre,
  type AvaliacaoRisco,
  type OperacaoCandidata,
  type PosicaoBook,
  type RegraRisco,
} from "@/lib/risk-rules";

/**
 * Testes das regras do §10. Casos NO LIMITE e FORA do limite para cada regra
 * (5% / 10% / 20% / 30% / 5 dias úteis), além do guard "sempre alertar" do
 * risco indefinido. Datas em UTC; 2026-06-15 é uma segunda-feira (usada como
 * "hoje" nos testes de vencimento).
 */

// Fábrica enxuta de um resultado de estrutura (só o que as regras leem).
function estrutura(
  rotulo: "DEFINIDO" | "INDEFINIDO",
  riscoMaximo: number,
): ResultadoEstrutura {
  return {
    nome: "teste",
    risco_maximo: riscoMaximo,
    rotulo_risco: rotulo,
    ganho_maximo: 0,
    breakevens: [],
    curva: [],
    legs: [],
    avisos: [],
  };
}

const VENC_PADRAO = new Date(Date.UTC(2026, 6, 17)); // 17/07/2026

function op(
  rotulo: "DEFINIDO" | "INDEFINIDO",
  riscoMaximo: number,
  extra: Partial<OperacaoCandidata> = {},
): OperacaoCandidata {
  return {
    estrutura: estrutura(rotulo, riscoMaximo),
    ativoObjeto: "PETR4",
    vencimento: VENC_PADRAO,
    ...extra,
  };
}

function regra(avals: AvaliacaoRisco[], r: RegraRisco): AvaliacaoRisco {
  return avals.find((a) => a.regra === r)!;
}

const CAPITAL = 10_000;

describe("Risco DEFINIDO — limite de 5% do capital", () => {
  it("no limite (5%): amarelo", () => {
    const a = regra(avaliarRisco(op("DEFINIDO", 500), CAPITAL), "risco_capital");
    expect(a.semaforo).toBe("amarelo");
    expect(a.texto).toContain("5%");
  });

  it("fora do limite (7%): vermelho, com texto claro", () => {
    const a = regra(avaliarRisco(op("DEFINIDO", 700), CAPITAL), "risco_capital");
    expect(a.semaforo).toBe("vermelho");
    expect(a.texto).toContain("7%");
    expect(a.texto).toContain("acima do");
    expect(a.texto).toContain("risco definido");
  });

  it("bem abaixo (2%): verde", () => {
    const a = regra(avaliarRisco(op("DEFINIDO", 200), CAPITAL), "risco_capital");
    expect(a.semaforo).toBe("verde");
  });
});

describe("Risco INDEFINIDO — limite de 10% de margem + sempre alertar", () => {
  it("no limite (10%): amarelo e alerta de risco real", () => {
    const a = regra(
      avaliarRisco(op("INDEFINIDO", Infinity, { margemRequerida: 1000 }), CAPITAL),
      "risco_capital",
    );
    expect(a.semaforo).toBe("amarelo");
    expect(a.texto).toContain("10%");
    expect(a.texto).toContain("superar o prêmio");
  });

  it("fora do limite (15%): vermelho e alerta", () => {
    const a = regra(
      avaliarRisco(op("INDEFINIDO", Infinity, { margemRequerida: 1500 }), CAPITAL),
      "risco_capital",
    );
    expect(a.semaforo).toBe("vermelho");
    expect(a.texto).toContain("superar o prêmio");
  });

  it("abaixo do limite (5%): NUNCA verde — fica amarelo e sempre alerta", () => {
    const a = regra(
      avaliarRisco(op("INDEFINIDO", Infinity, { margemRequerida: 500 }), CAPITAL),
      "risco_capital",
    );
    expect(a.semaforo).toBe("amarelo");
    expect(a.semaforo).not.toBe("verde");
    expect(a.texto).toContain("INDEFINIDO");
    expect(a.texto).toContain("superar o prêmio");
  });

  it("sem margem informada: amarelo, pede a margem e ainda alerta", () => {
    const a = regra(
      avaliarRisco(op("INDEFINIDO", Infinity), CAPITAL),
      "risco_capital",
    );
    expect(a.semaforo).toBe("amarelo");
    expect(a.texto).toContain("margem requerida");
    expect(a.texto).toContain("superar o prêmio");
  });

  it("capital não configurado: amarelo pedindo para configurar", () => {
    const a = regra(avaliarRisco(op("DEFINIDO", 500), 0), "risco_capital");
    expect(a.semaforo).toBe("amarelo");
    expect(a.texto).toContain("capital total");
  });
});

describe("Concentração por ativo-objeto — limite de 20% do book", () => {
  const book = (...ps: PosicaoBook[]) => ps;

  it("no limite (20%): amarelo", () => {
    // candidato PETR4 expõe 500; book com 2000 de outro ativo → 500/2500 = 20%.
    const a = regra(
      avaliarRisco(op("DEFINIDO", 500), CAPITAL, book({
        ativoObjeto: "VALE3", vencimento: VENC_PADRAO, exposicao: 2000,
      })),
      "concentracao_ativo",
    );
    expect(a.semaforo).toBe("amarelo");
    expect(a.texto).toContain("20%");
  });

  it("fora do limite (50%): vermelho", () => {
    const a = regra(
      avaliarRisco(op("DEFINIDO", 500), CAPITAL, book({
        ativoObjeto: "VALE3", vencimento: VENC_PADRAO, exposicao: 500,
      })),
      "concentracao_ativo",
    );
    expect(a.semaforo).toBe("vermelho");
    expect(a.texto).toContain("PETR4");
  });

  it("bem abaixo (~9%): verde", () => {
    const a = regra(
      avaliarRisco(op("DEFINIDO", 500), CAPITAL, book({
        ativoObjeto: "VALE3", vencimento: VENC_PADRAO, exposicao: 5000,
      })),
      "concentracao_ativo",
    );
    expect(a.semaforo).toBe("verde");
  });

  it("soma posições do mesmo ativo já no book", () => {
    // PETR4 já tem 1500; candidato +500 = 2000; total 8000 → 25% → vermelho.
    const a = regra(
      avaliarRisco(op("DEFINIDO", 500), CAPITAL, book(
        { ativoObjeto: "PETR4", vencimento: VENC_PADRAO, exposicao: 1500 },
        { ativoObjeto: "VALE3", vencimento: VENC_PADRAO, exposicao: 6000 },
      )),
      "concentracao_ativo",
    );
    expect(a.semaforo).toBe("vermelho");
    expect(a.texto).toContain("25%");
  });
});

describe("Concentração por vencimento — limite de 30% do book", () => {
  const OUTRO_VENC = new Date(Date.UTC(2026, 7, 21)); // 21/08/2026

  it("no limite (30%): amarelo", () => {
    // candidato expõe 300 no VENC_PADRAO; 700 em outro vencimento → 300/1000 = 30%.
    const a = regra(
      avaliarRisco(op("DEFINIDO", 300), CAPITAL, [
        { ativoObjeto: "VALE3", vencimento: OUTRO_VENC, exposicao: 700 },
      ]),
      "concentracao_vencimento",
    );
    expect(a.semaforo).toBe("amarelo");
    expect(a.texto).toContain("30%");
  });

  it("fora do limite (60%): vermelho", () => {
    const a = regra(
      avaliarRisco(op("DEFINIDO", 300), CAPITAL, [
        { ativoObjeto: "VALE3", vencimento: OUTRO_VENC, exposicao: 200 },
      ]),
      "concentracao_vencimento",
    );
    expect(a.semaforo).toBe("vermelho");
  });

  it("bem abaixo (~5,7%): verde", () => {
    const a = regra(
      avaliarRisco(op("DEFINIDO", 300), CAPITAL, [
        { ativoObjeto: "VALE3", vencimento: OUTRO_VENC, exposicao: 5000 },
      ]),
      "concentracao_vencimento",
    );
    expect(a.semaforo).toBe("verde");
  });

  it("agrupa MÚLTIPLAS posições que vencem no mesmo dia (mesmo dia ≠ mesma hora)", () => {
    // Candidata 300 + duas posições no MESMO dia da candidata (uma com hora
    // diferente, p/ provar a normalização por dia) = 300 + 200 + 300 = 800.
    // Outro vencimento contribui 200 → total 1000 → 80% → vermelho.
    const mesmoDiaComHora = new Date(Date.UTC(2026, 6, 17, 18, 30)); // 17/07 18:30
    const a = regra(
      avaliarRisco(op("DEFINIDO", 300), CAPITAL, [
        { ativoObjeto: "PETR4", vencimento: VENC_PADRAO, exposicao: 200 },
        { ativoObjeto: "VALE3", vencimento: mesmoDiaComHora, exposicao: 300 },
        { ativoObjeto: "ITUB4", vencimento: OUTRO_VENC, exposicao: 200 },
      ]),
      "concentracao_vencimento",
    );
    expect(a.semaforo).toBe("vermelho");
    expect(a.texto).toContain("80%");
  });

  it("usa a MARGEM (não o risco infinito) como peso quando a candidata é INDEFINIDA", () => {
    // Mesmo critério da regra por ativo: peso da candidata = margem requerida.
    // 300 (margem) no venc da candidata + 700 em outro → 300/1000 = 30% → amarelo.
    const a = regra(
      avaliarRisco(
        op("INDEFINIDO", Infinity, { margemRequerida: 300 }),
        CAPITAL,
        [{ ativoObjeto: "VALE3", vencimento: OUTRO_VENC, exposicao: 700 }],
      ),
      "concentracao_vencimento",
    );
    expect(a.semaforo).toBe("amarelo");
    expect(a.texto).toContain("30%");
  });
});

describe("Proximidade de vencimento — alerta nos ~5 dias úteis", () => {
  const SEG = new Date(Date.UTC(2026, 5, 15)); // segunda 15/06/2026

  function prox(venc: Date, feriados: Date[] = []) {
    return regra(
      avaliarRisco(op("DEFINIDO", 100, { vencimento: venc }), CAPITAL, [], {
        hoje: SEG,
        feriados,
      }),
      "proximidade_vencimento",
    );
  }

  it("no limite (5 dias úteis): amarelo, sugere encerrar/rolar", () => {
    const a = prox(new Date(Date.UTC(2026, 5, 22))); // segunda seguinte = 5 d.u.
    expect(a.semaforo).toBe("amarelo");
    expect(a.texto).toMatch(/encerrar ou rolar/);
  });

  it("fora do limite (6 dias úteis): verde", () => {
    const a = prox(new Date(Date.UTC(2026, 5, 23))); // terça seguinte = 6 d.u.
    expect(a.semaforo).toBe("verde");
  });

  it("véspera (1 dia útil): vermelho", () => {
    const a = prox(new Date(Date.UTC(2026, 5, 16))); // terça = 1 d.u.
    expect(a.semaforo).toBe("vermelho");
  });

  it("vence hoje ou já passou: vermelho", () => {
    expect(prox(SEG).semaforo).toBe("vermelho");
    expect(prox(new Date(Date.UTC(2026, 5, 10))).semaforo).toBe("vermelho");
  });

  it("feriado no meio reduz a contagem de dias úteis", () => {
    // Mesma janela de 5 d.u., mas com feriado na quarta 17/06 → vira 4 d.u.
    const a = prox(new Date(Date.UTC(2026, 5, 22)), [new Date(Date.UTC(2026, 5, 17))]);
    expect(a.semaforo).toBe("amarelo");
    expect(a.texto).toContain("4 dias úteis");
  });
});

describe("diasUteisEntre — contagem (de, ate], pula fins de semana e feriados", () => {
  const SEG = new Date(Date.UTC(2026, 5, 15)); // segunda
  const SEX = new Date(Date.UTC(2026, 5, 19)); // sexta
  const SEG2 = new Date(Date.UTC(2026, 5, 22)); // segunda seguinte

  it("segunda → sexta = 4 dias úteis", () => {
    expect(diasUteisEntre(SEG, SEX)).toBe(4);
  });

  it("segunda → segunda seguinte = 5 dias úteis (pula o fim de semana)", () => {
    expect(diasUteisEntre(SEG, SEG2)).toBe(5);
  });

  it("sexta → segunda = 1 dia útil (sábado e domingo não contam)", () => {
    expect(diasUteisEntre(SEX, SEG2)).toBe(1);
  });

  it("feriado no intervalo desconta um dia útil", () => {
    expect(diasUteisEntre(SEG, SEG2, [new Date(Date.UTC(2026, 5, 17))])).toBe(4);
  });

  it("data final no passado retorna 0", () => {
    expect(diasUteisEntre(SEG2, SEG)).toBe(0);
  });
});

describe("comportamento geral", () => {
  it("avalia as 4 regras e nunca 'bloqueia' (só verde/amarelo/vermelho)", () => {
    const avals = avaliarRisco(op("DEFINIDO", 500), CAPITAL);
    expect(avals).toHaveLength(4);
    for (const a of avals) {
      expect(["verde", "amarelo", "vermelho"]).toContain(a.semaforo);
    }
  });
});
