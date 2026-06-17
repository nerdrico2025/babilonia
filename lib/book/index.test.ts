/**
 * Testes da agregação do book (§8.1, §10). Confirmam risco total, % de capital,
 * concentração por ativo/vencimento contra os limites do §10 e os alertas de
 * vencimento. Datas em UTC puro para casar com a contagem de dias úteis.
 */
import { describe, expect, it } from "vitest";

import {
  resumirBook,
  avaliarVencimento,
  BOOK_LIMITES,
  type PosicaoAberta,
} from "./index";

function pos(over: Partial<PosicaoAberta>): PosicaoAberta {
  return {
    id: 1,
    underlying: "PETR4",
    structure: "trava_alta",
    expiresAt: new Date(Date.UTC(2026, 6, 17)),
    maxRisk: 1000,
    maxGain: 2000,
    riskDefined: true,
    breakevens: [22],
    ...over,
  };
}

// Quinta-feira 2026-06-18: base estável para contar dias úteis nos testes.
const HOJE = new Date(Date.UTC(2026, 5, 18));

describe("resumirBook", () => {
  it("soma o risco total e mede o % do capital", () => {
    const r = resumirBook(
      [pos({ id: 1, maxRisk: 1000 }), pos({ id: 2, underlying: "VALE3", maxRisk: 1500 })],
      50000,
      { hoje: HOJE },
    );
    expect(r.quantidade).toBe(2);
    expect(r.riscoTotal).toBe(2500);
    expect(r.fracaoCapital).toBeCloseTo(2500 / 50000, 6);
    expect(r.semaforoCapital).toBe("verde");
  });

  it("fica vermelho acima do orçamento de portfólio do capital", () => {
    const acima = BOOK_LIMITES.capitalEmRiscoMaximo * 100000 + 1;
    const r = resumirBook([pos({ maxRisk: acima })], 100000, { hoje: HOJE });
    expect(r.semaforoCapital).toBe("vermelho");
  });

  it("sem capital configurado, alerta (amarelo) em vez de dividir por zero", () => {
    const r = resumirBook([pos({})], 0, { hoje: HOJE });
    expect(r.fracaoCapital).toBeNull();
    expect(r.semaforoCapital).toBe("amarelo");
  });

  it("acha a pior concentração por ativo e classifica contra 20% (§10)", () => {
    // 80% em PETR4, 20% em VALE3 → estoura o limite de concentração por ativo.
    const r = resumirBook(
      [
        pos({ id: 1, underlying: "PETR4", maxRisk: 800 }),
        pos({ id: 2, underlying: "VALE3", maxRisk: 200 }),
      ],
      100000,
      { hoje: HOJE },
    );
    expect(r.concentracaoAtivo?.chave).toBe("PETR4");
    expect(r.concentracaoAtivo?.fracao).toBeCloseTo(0.8, 6);
    expect(r.semaforoConcentracaoAtivo).toBe("vermelho");
  });

  it("mede a concentração por vencimento", () => {
    const venc1 = new Date(Date.UTC(2026, 6, 17));
    const venc2 = new Date(Date.UTC(2026, 7, 21));
    const r = resumirBook(
      [
        pos({ id: 1, underlying: "PETR4", expiresAt: venc1, maxRisk: 500 }),
        pos({ id: 2, underlying: "VALE3", expiresAt: venc1, maxRisk: 500 }),
        pos({ id: 3, underlying: "ITUB4", expiresAt: venc2, maxRisk: 100 }),
      ],
      100000,
      { hoje: HOJE },
    );
    // venc1 concentra 1000/1100 ≈ 0,909 → acima de 30%.
    expect(r.concentracaoVencimento?.fracao).toBeCloseTo(1000 / 1100, 4);
    expect(r.semaforoConcentracaoVencimento).toBe("vermelho");
  });

  it("aponta o vencimento mais próximo e os dias úteis até ele", () => {
    const proximo = new Date(Date.UTC(2026, 5, 22)); // segunda
    const longe = new Date(Date.UTC(2026, 7, 21));
    const r = resumirBook(
      [pos({ id: 1, expiresAt: longe }), pos({ id: 2, expiresAt: proximo })],
      100000,
      { hoje: HOJE },
    );
    expect(r.vencimentoMaisProximo?.getTime()).toBe(proximo.getTime());
    // Qui 18 → seg 22: sex(19) + seg(22) = 2 dias úteis.
    expect(r.diasAteVencimentoMaisProximo).toBe(2);
  });

  it("sinaliza book com risco indefinido", () => {
    const r = resumirBook([pos({ riskDefined: false })], 100000, { hoje: HOJE });
    expect(r.temIndefinido).toBe(true);
  });

  it("book vazio: tudo zerado e verde", () => {
    const r = resumirBook([], 100000, { hoje: HOJE });
    expect(r.quantidade).toBe(0);
    expect(r.riscoTotal).toBe(0);
    expect(r.concentracaoAtivo).toBeNull();
    expect(r.vencimentoMaisProximo).toBeNull();
  });
});

describe("avaliarVencimento", () => {
  it("verde quando falta tempo", () => {
    expect(avaliarVencimento(10).semaforo).toBe("verde");
  });
  it("amarelo dentro dos 5 dias úteis", () => {
    const a = avaliarVencimento(4);
    expect(a.semaforo).toBe("amarelo");
    expect(a.sugestao).toMatch(/encerrar ou rolar/);
  });
  it("vermelho e urgente quando ≤1 dia útil ou vencido", () => {
    expect(avaliarVencimento(1).urgente).toBe(true);
    expect(avaliarVencimento(0).semaforo).toBe("vermelho");
  });
});
