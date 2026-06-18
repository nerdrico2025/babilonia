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
 *
 * Critério atual: prêmio = MID = (bid+ask)/2 exigindo oferta dos DOIS lados;
 * piso de liquidez (negócios + volume) como GATE; SELEÇÃO DE VENCIMENTO numa
 * janela de tenor [14,50] dias — a LIQUIDEZ é o gate (descarta a semanal fina) e
 * a proximidade de ~30d é o seletor entre os que passam (revisão 2026-06-18).
 * Ver cabeçalho de `iv-representativa.ts`.
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

/**
 * Builder de `OpcaoDoDia` com liquidez por padrão (sobrescrevível). A conveniência
 * `premio` representa o MID desejado: gera bid/ask = MID ∓ 1% (spread relativo ~2%,
 * bem dentro do limite), preservando o round-trip. Para testar oferta de um lado só
 * ou spread absurdo, passe `bid`/`ask` explícitos (que sobrescrevem o default).
 */
function opcao(
  over: Pick<OpcaoDoDia, "optionSymbol" | "tipo" | "strike" | "vencimento"> &
    Partial<OpcaoDoDia> & { premio?: number },
): OpcaoDoDia {
  const { premio, ...rest } = over;
  const bid = premio !== undefined ? premio * 0.99 : 0;
  const ask = premio !== undefined ? premio * 1.01 : 0;
  return {
    volumeFinanceiro: 100_000,
    numeroNegocios: 500,
    bid,
    ask,
    ...rest,
  };
}

describe("calcularIvRepresentativa — escolha da ATM + round-trip", () => {
  it("escolhe a série mais próxima do dinheiro e recupera a IV conhecida", () => {
    const spot = 38;
    const venc = 30; // alvo
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
    expect(res.premioUsado).toBeCloseTo(premioDe("call", spot, 38, venc, sigma), 6); // MID auditável
    expect(res.rUsado).toBe(R);
    expect(res.tAnos).toBeCloseTo(30 / 365, 10);
    expect(res.vencimentoUsado.getTime()).toBe(vencEmDias(venc).getTime());
  });

  it("vencimento alvo: escolhe o mais próximo de ~30 dias entre os ≥ 14 dias", () => {
    const spot = 38;
    // Três vencimentos válidos (≥14). Cada um com ATM de IV distinta. O alvo é o
    // mais próximo de 30 dias corridos (=30d, IV 0,30) — não o mais curto.
    const cadeia: OpcaoDoDia[] = [
      opcao({ optionSymbol: "C38_16d", tipo: "call", strike: 38, premio: premioDe("call", spot, 38, 16, 0.5), vencimento: vencEmDias(16) }),
      opcao({ optionSymbol: "C38_30d", tipo: "call", strike: 38, premio: premioDe("call", spot, 38, 30, 0.3), vencimento: vencEmDias(30) }),
      opcao({ optionSymbol: "C38_50d", tipo: "call", strike: 38, premio: premioDe("call", spot, 38, 50, 0.45), vencimento: vencEmDias(50) }),
    ];

    const res = calcularIvRepresentativa({ spot, cadeia, r: R, tradeDate: TRADE_DATE });

    expect(res.iv).not.toBeNull();
    if (res.iv === null) return;
    expect(res.iv).toBeCloseTo(0.3, 4); // usou o de 30 dias
    expect(res.vencimentoUsado.getTime()).toBe(vencEmDias(30).getTime());
    expect(res.opcaoUsada).toBe("C38_30d");
  });

  it("GATE de liquidez: ignora a SEMANAL fina perto de 30d e usa a MENSAL líquida", () => {
    const spot = 38;
    // Reproduz o cenário do diagnóstico: uma semanal a 31d (a MAIS próxima de 30d)
    // mas ILÍQUIDA (5 negócios, sem volume) entre duas mensais líquidas (17d e 45d).
    // A liquidez é o GATE: a semanal é descartada e, entre as que passam, a 17d
    // (mais próxima de 30d) vence. A IV 0,9 da semanal NÃO pode aparecer.
    const cadeia: OpcaoDoDia[] = [
      opcao({ optionSymbol: "C38_31d_SEM", tipo: "call", strike: 38, premio: premioDe("call", spot, 38, 31, 0.9), vencimento: vencEmDias(31), numeroNegocios: 5, volumeFinanceiro: 0 }),
      opcao({ optionSymbol: "C38_17d", tipo: "call", strike: 38, premio: premioDe("call", spot, 38, 17, 0.3), vencimento: vencEmDias(17) }),
      opcao({ optionSymbol: "C38_45d", tipo: "call", strike: 38, premio: premioDe("call", spot, 38, 45, 0.5), vencimento: vencEmDias(45) }),
    ];

    const res = calcularIvRepresentativa({ spot, cadeia, r: R, tradeDate: TRADE_DATE });

    expect(res.iv).not.toBeNull();
    if (res.iv === null) return;
    expect(res.opcaoUsada).toBe("C38_17d"); // mensal líquida mais próxima de 30d
    expect(res.iv).toBeCloseTo(0.3, 4);
    expect(res.vencimentoUsado.getTime()).toBe(vencEmDias(17).getTime());
  });

  it("desempate do seletor: vencimentos equidistantes de 30d → o mais LÍQUIDO vence", () => {
    const spot = 38;
    // 25d e 35d são equidistantes de 30 (|±5|). Ambos líquidos; o de 35d é MAIS
    // líquido (900 vs 300 negócios) → vence pelo desempate documentado.
    const cadeia: OpcaoDoDia[] = [
      opcao({ optionSymbol: "C38_25d", tipo: "call", strike: 38, premio: premioDe("call", spot, 38, 25, 0.6), vencimento: vencEmDias(25), numeroNegocios: 300 }),
      opcao({ optionSymbol: "C38_35d", tipo: "call", strike: 38, premio: premioDe("call", spot, 38, 35, 0.4), vencimento: vencEmDias(35), numeroNegocios: 900 }),
    ];

    const res = calcularIvRepresentativa({ spot, cadeia, r: R, tradeDate: TRADE_DATE });

    expect(res.iv).not.toBeNull();
    if (res.iv === null) return;
    expect(res.opcaoUsada).toBe("C38_35d");
    expect(res.iv).toBeCloseTo(0.4, 4);
    expect(res.vencimentoUsado.getTime()).toBe(vencEmDias(35).getTime());
  });

  it("degradação graciosa: vencimento prioritário sem MID válido → cai p/ o próximo", () => {
    const spot = 38;
    // 28d é o mais próximo de 30d e líquido, mas sua ÚNICA série tem oferta de um
    // lado só (ask=0) → sem MID confiável. Cai para o 45d (líquido, dois lados).
    const cadeia: OpcaoDoDia[] = [
      opcao({ optionSymbol: "C38_28d_1LADO", tipo: "call", strike: 38, bid: 1.5, ask: 0, vencimento: vencEmDias(28) }),
      opcao({ optionSymbol: "C38_45d", tipo: "call", strike: 38, premio: premioDe("call", spot, 38, 45, 0.42), vencimento: vencEmDias(45) }),
    ];

    const res = calcularIvRepresentativa({ spot, cadeia, r: R, tradeDate: TRADE_DATE });

    expect(res.iv).not.toBeNull();
    if (res.iv === null) return;
    expect(res.opcaoUsada).toBe("C38_45d");
    expect(res.iv).toBeCloseTo(0.42, 4);
  });

  it("piso de 14 dias: ignora o vencimento < 14 dias mesmo sendo o mais curto", () => {
    const spot = 38;
    // Vencimento curto (10 dias) com ATM de IV ALTA (0,80) — abaixo do piso de 14,
    // deve ser ignorado. O vencimento de 30 dias (IV 0,30) é o alvo.
    const cadeia: OpcaoDoDia[] = [
      opcao({ optionSymbol: "C38_10d", tipo: "call", strike: 38, premio: premioDe("call", spot, 38, 10, 0.8), vencimento: vencEmDias(10) }),
      opcao({ optionSymbol: "C38_30d", tipo: "call", strike: 38, premio: premioDe("call", spot, 38, 30, 0.3), vencimento: vencEmDias(30) }),
    ];

    const res = calcularIvRepresentativa({ spot, cadeia, r: R, tradeDate: TRADE_DATE });

    expect(res.iv).not.toBeNull();
    if (res.iv === null) return;
    expect(res.iv).toBeCloseTo(0.3, 4); // usou o de 30 dias, não o de 10
    expect(res.vencimentoUsado.getTime()).toBe(vencEmDias(30).getTime());
    expect(res.opcaoUsada).toBe("C38_30d");
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

  it("oferta de um lado só (ask=0): série líquida sem MID confiável é pulada", () => {
    const spot = 38;
    const venc = 30;
    // ATM (38) líquida MAS sem oferta de venda (ask=0) — é o print velho que a
    // revisão anti-outlier descarta. Sobe para a 36, com oferta dos dois lados.
    const cadeia: OpcaoDoDia[] = [
      opcao({ optionSymbol: "C38_1LADO", tipo: "call", strike: 38, bid: 1.5, ask: 0, vencimento: vencEmDias(venc) }),
      opcao({ optionSymbol: "C36", tipo: "call", strike: 36, premio: premioDe("call", spot, 36, venc, 0.4), vencimento: vencEmDias(venc) }),
    ];

    const res = calcularIvRepresentativa({ spot, cadeia, r: R, tradeDate: TRADE_DATE });

    expect(res.iv).not.toBeNull();
    if (res.iv === null) return;
    expect(res.opcaoUsada).toBe("C36");
    expect(res.iv).toBeCloseTo(0.4, 4);
  });

  it("spread absurdo (> limite): série é pulada por MID não confiável", () => {
    const spot = 38;
    const venc = 30;
    // ATM (38) líquida com dois lados, mas spread relativo = 1,5/1,25 = 1,2 > 0,7.
    // Descarta e sobe para a 36, com spread são.
    const cadeia: OpcaoDoDia[] = [
      opcao({ optionSymbol: "C38_SPREAD", tipo: "call", strike: 38, bid: 0.5, ask: 2.0, vencimento: vencEmDias(venc) }),
      opcao({ optionSymbol: "C36", tipo: "call", strike: 36, premio: premioDe("call", spot, 36, venc, 0.4), vencimento: vencEmDias(venc) }),
    ];

    const res = calcularIvRepresentativa({ spot, cadeia, r: R, tradeDate: TRADE_DATE });

    expect(res.iv).not.toBeNull();
    if (res.iv === null) return;
    expect(res.opcaoUsada).toBe("C36");
    expect(res.iv).toBeCloseTo(0.4, 4);
  });

  it("spread no limite mais rígido (0,7): quote largo que ANTES passava agora é pulado", () => {
    const spot = 38;
    const venc = 30;
    // ATM (38): bid 1,0 / ask 2,2 → mid 1,6, spread relativo 1,2/1,6 = 0,75 > 0,7.
    // Antes (limite 1,0) passaria; agora é descartada e sobe para a 36.
    const cadeia: OpcaoDoDia[] = [
      opcao({ optionSymbol: "C38_075", tipo: "call", strike: 38, bid: 1.0, ask: 2.2, vencimento: vencEmDias(venc) }),
      opcao({ optionSymbol: "C36", tipo: "call", strike: 36, premio: premioDe("call", spot, 36, venc, 0.4), vencimento: vencEmDias(venc) }),
    ];

    const res = calcularIvRepresentativa({ spot, cadeia, r: R, tradeDate: TRADE_DATE });

    expect(res.iv).not.toBeNull();
    if (res.iv === null) return;
    expect(res.opcaoUsada).toBe("C36");
    expect(res.iv).toBeCloseTo(0.4, 4);
  });

  it("trava de moneyness: série JUSTO dentro da trava (≤15%) é aceita", () => {
    const spot = 38;
    const venc = 30;
    // Única líquida é a strike 33 (moneyness 33/38−1 = −13,2%, dentro de 15%).
    // É aceita (a trava não pode rejeitar séries quase no dinheiro).
    const cadeia: OpcaoDoDia[] = [
      opcao({ optionSymbol: "C33", tipo: "call", strike: 33, premio: premioDe("call", spot, 33, venc, 0.4), vencimento: vencEmDias(venc) }),
    ];

    const res = calcularIvRepresentativa({ spot, cadeia, r: R, tradeDate: TRADE_DATE });

    expect(res.iv).not.toBeNull();
    if (res.iv === null) return;
    expect(res.opcaoUsada).toBe("C33");
    expect(res.iv).toBeCloseTo(0.4, 4);
  });

  it("solver null: prêmio (MID) inviável na ATM → tenta a próxima série", () => {
    const spot = 38;
    const venc = 30;
    // ATM (38) com MID IMPOSSÍVEL (acima do spot p/ call → volImplicita = null).
    // A próxima (36) tem MID viável de IV 0,33.
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
  it("teto da janela (50d): vencimento líquido além de 50d é ignorado → gap", () => {
    const spot = 38;
    // Única série líquida está a 60d (fora da janela [14,50]); a de 20d é ilíquida.
    // Nenhum vencimento da janela passa no gate → gap (não usa o 60d).
    const cadeia: OpcaoDoDia[] = [
      opcao({ optionSymbol: "C38_20d_ILIQ", tipo: "call", strike: 38, premio: premioDe("call", spot, 38, 20, 0.4), vencimento: vencEmDias(20), numeroNegocios: 0, volumeFinanceiro: 0 }),
      opcao({ optionSymbol: "C38_60d", tipo: "call", strike: 38, premio: premioDe("call", spot, 38, 60, 0.4), vencimento: vencEmDias(60) }),
    ];
    const res = calcularIvRepresentativa({ spot, cadeia, r: R, tradeDate: TRADE_DATE });
    expect(res.iv).toBeNull();
    if (res.iv !== null) return;
    expect(res.motivo).toBe("sem-serie-liquida-com-iv");
  });

  it("sem vencimento na janela [14,50] → gap, não grava", () => {
    const spot = 38;
    const cadeia: OpcaoDoDia[] = [
      opcao({ optionSymbol: "C38_7d", tipo: "call", strike: 38, premio: premioDe("call", spot, 38, 7, 0.4), vencimento: vencEmDias(7) }),
      opcao({ optionSymbol: "C38_13d", tipo: "call", strike: 38, premio: premioDe("call", spot, 38, 13, 0.4), vencimento: vencEmDias(13) }), // 13 < 14 (piso)
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

  it("trava de moneyness: única série líquida é deep-ITM (>15%) → gap (não cai no strike distante)", () => {
    const spot = 38;
    // Reproduz o caso ITSA4: a ATM/perto-do-dinheiro é ilíquida e só sobra uma
    // série DEEP-ITM (strike 30 = −21% do spot), líquida e com dois lados. A trava
    // de moneyness a rejeita → gap, em vez de gerar a IV inflada do strike distante.
    const cadeia: OpcaoDoDia[] = [
      opcao({ optionSymbol: "C38_ILIQ", tipo: "call", strike: 38, premio: premioDe("call", spot, 38, 30, 0.4), vencimento: vencEmDias(30), volumeFinanceiro: 0, numeroNegocios: 0 }),
      opcao({ optionSymbol: "C30_ITM", tipo: "call", strike: 30, premio: premioDe("call", spot, 30, 30, 0.4), vencimento: vencEmDias(30) }),
    ];
    const res = calcularIvRepresentativa({ spot, cadeia, r: R, tradeDate: TRADE_DATE });
    expect(res.iv).toBeNull();
    if (res.iv !== null) return;
    expect(res.motivo).toBe("sem-serie-liquida-com-iv");
  });

  it("séries líquidas mas nenhuma com oferta dos dois lados → gap", () => {
    const spot = 38;
    // Ambas líquidas, mas sem ask (print velho) → MID não confiável em nenhuma.
    const cadeia: OpcaoDoDia[] = [
      opcao({ optionSymbol: "C38", tipo: "call", strike: 38, bid: 1.5, ask: 0, vencimento: vencEmDias(30) }),
      opcao({ optionSymbol: "C40", tipo: "call", strike: 40, bid: 0.9, ask: 0, vencimento: vencEmDias(30) }),
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
