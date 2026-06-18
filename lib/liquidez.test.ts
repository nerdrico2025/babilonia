/**
 * Testes da heurística de liquidez (§9). Confirmam que volume baixo e spread
 * largo geram alerta `baixa`, que o market maker afrouxa o piso de volume e que
 * a falta total de dados também alerta — tudo sem usar open interest (§6.4).
 */
import { describe, expect, it } from "vitest";

import { avaliarLiquidez, precoReferencia, LIQUIDEZ_LIMITES } from "./liquidez";
import type { OpcaoCadeia } from "@/lib/opcoes/tipos";

// Cria uma opção da cadeia com os campos relevantes (resto neutro).
function op(over: Partial<OpcaoCadeia>): OpcaoCadeia {
  return {
    symbol: "PETRK221",
    tipo: "call",
    strike: 22,
    vencimento: "2026-07-17",
    tipoExercicio: null,
    tamanhoContrato: 100,
    bid: null,
    ask: null,
    spread: null,
    volume: null,
    volumeFinanceiro: null,
    bidVolume: null,
    askVolume: null,
    negocios: null,
    marketMaker: null,
    ...over,
  };
}

describe("avaliarLiquidez", () => {
  it("considera líquida com bom volume e spread estreito", () => {
    const r = avaliarLiquidez(op({ bid: 1.0, ask: 1.05, spread: 0.05, volume: 500 }));
    expect(r.nivel).toBe("ok");
    expect(r.spreadRelativo).toBeCloseTo(0.05 / 1.025, 4);
  });

  it("alerta (baixa) com volume baixo", () => {
    const r = avaliarLiquidez(op({ bid: 1.0, ask: 1.02, spread: 0.02, volume: 10 }));
    expect(r.nivel).toBe("baixa");
    expect(r.motivos.join(" ")).toMatch(/Volume baixo/);
  });

  it("alerta (baixa) com spread largo mesmo com volume alto", () => {
    const r = avaliarLiquidez(op({ bid: 1.0, ask: 1.4, spread: 0.4, volume: 1000 }));
    expect(r.nivel).toBe("baixa");
    expect(r.motivos.join(" ")).toMatch(/Spread largo/);
  });

  it("market maker afrouxa o piso de volume", () => {
    const baixo = op({ bid: 1.0, ask: 1.03, spread: 0.03, volume: 30 });
    expect(avaliarLiquidez(baixo).nivel).toBe("baixa");
    expect(avaliarLiquidez({ ...baixo, marketMaker: true }).nivel).toBe("ok");
  });

  it("sem volume e sem spread, alerta por falta de dados", () => {
    const r = avaliarLiquidez(op({}));
    expect(r.nivel).toBe("baixa");
    expect(r.motivos.join(" ")).toMatch(/Sem dados/);
  });

  it("não ultrapassa o limite de volume padrão", () => {
    const limite = LIQUIDEZ_LIMITES.volumeMinimo;
    const noLimite = avaliarLiquidez(op({ bid: 1, ask: 1.02, spread: 0.02, volume: limite }));
    expect(noLimite.nivel).toBe("ok");
  });
});

describe("precoReferencia", () => {
  it("usa o meio entre bid e ask quando ambos existem", () => {
    expect(precoReferencia(op({ bid: 1.0, ask: 1.2 }))).toBeCloseTo(1.1, 6);
  });
  it("usa o lado disponível quando falta um", () => {
    expect(precoReferencia(op({ bid: null, ask: 0.8 }))).toBe(0.8);
    expect(precoReferencia(op({ bid: 0.5, ask: 0 }))).toBe(0.5);
  });
  it("devolve null sem bid nem ask válidos", () => {
    expect(precoReferencia(op({ bid: 0, ask: 0 }))).toBeNull();
  });
});
