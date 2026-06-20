/**
 * Testes da agregação do book (§8.1, §10). Confirmam risco total, % de capital,
 * concentração por ativo/vencimento contra os limites do §10 e os alertas de
 * vencimento. Datas em UTC puro para casar com a contagem de dias úteis.
 */
import { describe, expect, it } from "vitest";

import {
  resumirBook,
  avaliarVencimento,
  plRealizado,
  BOOK_LIMITES,
  type PernaRealizada,
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

// ── plRealizado (P&L realizado ao fechar) ─────────────────────────────────────

describe("plRealizado", () => {
  // CASO 1 — Trava de ALTA de DÉBITO (bull call spread), fechada com LUCRO.
  // Caso construído à mão (verificável; mesmo rigor dos testes de options-math).
  //   Abertura: compra CALL K40 @ 2,00 ; venda CALL K44 @ 0,80  → débito 1,20/ação.
  //   Fechamento: vende a comprada @ 3,50 ; recompra a vendida @ 1,30.
  //   Perna compra: (3,50 − 2,00)·1·100 = +150
  //   Perna venda : −(1,30 − 0,80)·1·100 = −50
  //   Total = +100,00 (lucro).
  it("trava de débito fechada com lucro → +100,00", () => {
    const pernas: PernaRealizada[] = [
      { side: "compra", quantity: 1, premioAbertura: 2.0, premioFechamento: 3.5 },
      { side: "venda", quantity: 1, premioAbertura: 0.8, premioFechamento: 1.3 },
    ];
    expect(plRealizado(pernas)).toBeCloseTo(100, 6);
  });

  // CASO 2 — Mesma trava de débito, fechada com PREJUÍZO.
  //   Abertura idêntica (débito 1,20/ação).
  //   Fechamento: vende a comprada @ 1,00 ; recompra a vendida @ 0,50.
  //   Perna compra: (1,00 − 2,00)·1·100 = −100
  //   Perna venda : −(0,50 − 0,80)·1·100 = +30
  //   Total = −70,00 (prejuízo).
  it("trava de débito fechada com prejuízo → −70,00", () => {
    const pernas: PernaRealizada[] = [
      { side: "compra", quantity: 1, premioAbertura: 2.0, premioFechamento: 1.0 },
      { side: "venda", quantity: 1, premioAbertura: 0.8, premioFechamento: 0.5 },
    ];
    expect(plRealizado(pernas)).toBeCloseTo(-70, 6);
  });

  // BORDA — lados OPOSTOS com os MESMOS números trocam só o sinal do resultado.
  it("inverter o lado (compra↔venda) inverte o sinal da contribuição", () => {
    const base = { quantity: 1, premioAbertura: 1.0, premioFechamento: 1.5 } as const;
    const comprado = plRealizado([{ side: "compra", ...base }]); // (1,5−1,0)·100 = +50
    const vendido = plRealizado([{ side: "venda", ...base }]); // −(1,5−1,0)·100 = −50
    expect(comprado).toBeCloseTo(50, 6);
    expect(vendido).toBeCloseTo(-50, 6);
    expect(vendido).toBeCloseTo(-comprado, 6);
  });

  it("respeita quantidade (contratos) e tamanho do lote", () => {
    const pernas: PernaRealizada[] = [
      { side: "compra", quantity: 3, premioAbertura: 1.0, premioFechamento: 1.2 },
    ];
    // (1,2−1,0)·3·100 = 60
    expect(plRealizado(pernas)).toBeCloseTo(60, 6);
    // Lote custom (ex.: 1) escala junto: 0,2·3·1 = 0,6
    expect(plRealizado(pernas, 1)).toBeCloseTo(0.6, 6);
  });

  it("sem pernas → 0", () => {
    expect(plRealizado([])).toBe(0);
  });
});
