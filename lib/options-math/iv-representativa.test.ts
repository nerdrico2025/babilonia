import { describe, it, expect } from "vitest";

import {
  calcularIvRepresentativa,
  DIAS_POR_ANO,
  type OpcaoDoDia,
} from "./iv-representativa";
import { precoBS } from "./black-scholes";
import type { TipoOpcao } from "./index";

/**
 * Testes da IV representativa diária. O truque central é o ROUND-TRIP: geramos o
 * prêmio com o próprio Black-Scholes a partir de uma IV CONHECIDA e confirmamos
 * que o solver recupera a mesma IV — assim o teste valida a escolha da série E a
 * inversão de ponta a ponta, sem depender de números mágicos.
 */

const MS_POR_DIA = 86_400_000;
const TRADE_DATE = new Date(Date.UTC(2025, 5, 2)); // 02/06/2025
const R = Math.log(1 + 0.105); // Selic 10,5% a.a. → contínua

/** Vencimento a `dias` corridos do pregão (casado com a base do módulo). */
function vencEmDias(dias: number): Date {
  return new Date(TRADE_DATE.getTime() + dias * MS_POR_DIA);
}

/** Prêmio teórico (BS) de uma série, para o round-trip IV→prêmio→solver. */
function premioDe(
  tipo: TipoOpcao,
  S: number,
  K: number,
  dias: number,
  sigma: number,
): number {
  return precoBS({ tipo, S, K, T: dias / DIAS_POR_ANO, r: R, sigma });
}

/** Builder de `OpcaoDoDia` com líquidez por padrão (sobrescrevível). */
function opcao(over: Partial<OpcaoDoDia> & Pick<OpcaoDoDia, "optionSymbol" | "tipo" | "strike" | "premio" | "vencimento">): OpcaoDoDia {
  return {
    volumeFinanceiro: 100_000,
    numeroNegocios: 500,
    ...over,
  };
}

describe("calcularIvRepresentativa — escolha da ATM + round-trip", () => {
  it("escolhe a série mais próxima do dinheiro e recupera a IV conhecida", () => {
    const spot = 38;
    const venc = 46; // > 7 dias
    const sigma = 0.35; // IV "verdadeira" injetada via BS

    // Cadeia: strikes 36/38/40, calls e puts, todas geradas com sigma=0.35.
    // A ATM (strike 38) deve vencer; no empate call/put de mesmo strike, a call
    // com mais negócios é escolhida (desempate documentado).
    const cadeia: OpcaoDoDia[] = [
      opcao({ optionSymbol: "C36", tipo: "call", strike: 36, premio: premioDe("call", spot, 36, venc, sigma), vencimento: vencEmDias(venc) }),
      opcao({ optionSymbol: "C38", tipo: "call", strike: 38, premio: premioDe("call", spot, 38, venc, sigma), vencimento: vencEmDias(venc), numeroNegocios: 900 }),
      opcao({ optionSymbol: "P38", tipo: "put", strike: 38, premio: premioDe("put", spot, 38, venc, sigma), vencimento: vencEmDias(venc), numeroNegocios: 400 }),
      opcao({ optionSymbol: "C40", tipo: "call", strike: 40, premio: premioDe("call", spot, 40, venc, sigma), vencimento: vencEmDias(venc) }),
    ];

    const res = calcularIvRepresentativa({ spot, cadeia, r: R, tradeDate: TRADE_DATE });

    expect(res.iv).not.toBeNull();
    if (res.iv === null) return;
    expect(res.iv).toBeCloseTo(0.35, 4); // round-trip
    expect(res.opcaoUsada).toBe("C38"); // strike 38 = ATM; call (mais negócios)
    expect(res.tipoUsado).toBe("call");
    expect(res.spotUsado).toBe(38);
    expect(res.rUsado).toBe(R);
    expect(res.tAnos).toBeCloseTo(46 / 365, 10);
    expect(res.vencimentoUsado.getTime()).toBe(vencEmDias(46).getTime());
  });

  it("salvaguarda dos 7 dias: pula o vencimento ≤ 7 dias e usa o próximo", () => {
    const spot = 38;
    // Vencimento curto (5 dias) com ATM de IV ALTA (0,80) — se fosse usado,
    // a IV sairia ~0,80. O vencimento de 40 dias tem ATM de IV 0,30.
    const cadeia: OpcaoDoDia[] = [
      opcao({ optionSymbol: "C38_5d", tipo: "call", strike: 38, premio: premioDe("call", spot, 38, 5, 0.8), vencimento: vencEmDias(5) }),
      opcao({ optionSymbol: "C38_40d", tipo: "call", strike: 38, premio: premioDe("call", spot, 38, 40, 0.3), vencimento: vencEmDias(40) }),
    ];

    const res = calcularIvRepresentativa({ spot, cadeia, r: R, tradeDate: TRADE_DATE });

    expect(res.iv).not.toBeNull();
    if (res.iv === null) return;
    expect(res.iv).toBeCloseTo(0.3, 4); // usou o de 40 dias, não o de 5
    expect(res.vencimentoUsado.getTime()).toBe(vencEmDias(40).getTime());
    expect(res.opcaoUsada).toBe("C38_40d");
  });

  it("liquidez: ATM ilíquida é descartada em favor da próxima série líquida", () => {
    const spot = 38;
    const venc = 30;
    const sigma = 0.4;
    // ATM exata (strike 38) é ILÍQUIDA (sem volume, sem negócios) → descartada.
    // As de strike 36 e 40 são líquidas; a 36 tem mais negócios (desempate).
    const cadeia: OpcaoDoDia[] = [
      opcao({ optionSymbol: "C38_ILIQ", tipo: "call", strike: 38, premio: premioDe("call", spot, 38, venc, sigma), vencimento: vencEmDias(venc), volumeFinanceiro: 0, numeroNegocios: 0 }),
      opcao({ optionSymbol: "C36", tipo: "call", strike: 36, premio: premioDe("call", spot, 36, venc, sigma), vencimento: vencEmDias(venc), numeroNegocios: 800 }),
      opcao({ optionSymbol: "C40", tipo: "call", strike: 40, premio: premioDe("call", spot, 40, venc, sigma), vencimento: vencEmDias(venc), numeroNegocios: 300 }),
    ];

    const res = calcularIvRepresentativa({ spot, cadeia, r: R, tradeDate: TRADE_DATE });

    expect(res.iv).not.toBeNull();
    if (res.iv === null) return;
    expect(res.opcaoUsada).toBe("C36"); // a ilíquida 38 saiu; 36 e 40 empatam, 36 mais líquida
    expect(res.iv).toBeCloseTo(0.4, 4);
  });

  it("solver null: prêmio inviável na ATM → tenta a próxima série", () => {
    const spot = 38;
    const venc = 30;
    // ATM (38) com prêmio IMPOSSÍVEL (acima do spot p/ call → volImplicita = null).
    // A próxima (36) tem prêmio viável de IV 0,33.
    const cadeia: OpcaoDoDia[] = [
      opcao({ optionSymbol: "C38_RUIM", tipo: "call", strike: 38, premio: spot + 5, vencimento: vencEmDias(venc) }),
      opcao({ optionSymbol: "C36", tipo: "call", strike: 36, premio: premioDe("call", spot, 36, venc, 0.33), vencimento: vencEmDias(venc) }),
    ];

    const res = calcularIvRepresentativa({ spot, cadeia, r: R, tradeDate: TRADE_DATE });

    expect(res.iv).not.toBeNull();
    if (res.iv === null) return;
    expect(res.opcaoUsada).toBe("C36");
    expect(res.iv).toBeCloseTo(0.33, 4);
  });
});

describe("calcularIvRepresentativa — gaps (não inventa)", () => {
  it("sem vencimento > 7 dias → gap, não grava", () => {
    const spot = 38;
    const cadeia: OpcaoDoDia[] = [
      opcao({ optionSymbol: "C38_3d", tipo: "call", strike: 38, premio: premioDe("call", spot, 38, 3, 0.4), vencimento: vencEmDias(3) }),
      opcao({ optionSymbol: "C38_7d", tipo: "call", strike: 38, premio: premioDe("call", spot, 38, 7, 0.4), vencimento: vencEmDias(7) }), // 7 não é > 7
    ];
    const res = calcularIvRepresentativa({ spot, cadeia, r: R, tradeDate: TRADE_DATE });
    expect(res.iv).toBeNull();
    if (res.iv !== null) return;
    expect(res.motivo).toBe("sem-vencimento-valido");
  });

  it("vencimento válido mas todas as séries ilíquidas → gap", () => {
    const spot = 38;
    const cadeia: OpcaoDoDia[] = [
      opcao({ optionSymbol: "C38", tipo: "call", strike: 38, premio: premioDe("call", spot, 38, 30, 0.4), vencimento: vencEmDias(30), volumeFinanceiro: 0, numeroNegocios: 0 }),
      opcao({ optionSymbol: "C40", tipo: "call", strike: 40, premio: premioDe("call", spot, 40, 30, 0.4), vencimento: vencEmDias(30), volumeFinanceiro: 0, numeroNegocios: 0 }),
    ];
    const res = calcularIvRepresentativa({ spot, cadeia, r: R, tradeDate: TRADE_DATE });
    expect(res.iv).toBeNull();
    if (res.iv !== null) return;
    expect(res.motivo).toBe("sem-serie-liquida-com-iv");
  });

  it("spot inválido ou cadeia vazia → gap específico", () => {
    const cadeia: OpcaoDoDia[] = [
      opcao({ optionSymbol: "C38", tipo: "call", strike: 38, premio: 1, vencimento: vencEmDias(30) }),
    ];
    expect(calcularIvRepresentativa({ spot: 0, cadeia, r: R, tradeDate: TRADE_DATE }))
      .toMatchObject({ iv: null, motivo: "spot-invalido" });
    expect(calcularIvRepresentativa({ spot: 38, cadeia: [], r: R, tradeDate: TRADE_DATE }))
      .toMatchObject({ iv: null, motivo: "cadeia-vazia" });
  });
});
