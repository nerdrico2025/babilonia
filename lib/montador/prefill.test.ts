/**
 * Testes do pré-preenchimento cadeia → montador. Garantem o casamento correto de
 * calls/puts por strike para cada família e o aviso quando a seleção não basta.
 */
import { describe, expect, it } from "vitest";

import { prefillDaCadeia } from "./prefill";
import type { SerieSelecionada } from "./selecao-cadeia";

function serie(over: Partial<SerieSelecionada>): SerieSelecionada {
  return {
    symbol: "X",
    tipo: "call",
    strike: 20,
    vencimento: "2026-07-17",
    premioRef: 1,
    bid: 0.95,
    ask: 1.05,
    ...over,
  };
}

describe("prefillDaCadeia", () => {
  it("preenche trava de alta (débito) com 2 calls em ordem de strike", () => {
    const r = prefillDaCadeia("trava_alta_debito", [
      serie({ tipo: "call", strike: 22, premioRef: 0.5 }),
      serie({ tipo: "call", strike: 20, premioRef: 1.2 }),
    ]);
    expect(r.completo).toBe(true);
    expect(r.valores).toMatchObject({ k1: "20", k2: "22", premioK1: "1,2", premioK2: "0,5" });
  });

  it("preenche straddle com 1 call e 1 put de mesmo strike", () => {
    const r = prefillDaCadeia("straddle_comprado", [
      serie({ tipo: "call", strike: 20, premioRef: 1.1 }),
      serie({ tipo: "put", strike: 20, premioRef: 0.9 }),
    ]);
    expect(r.completo).toBe(true);
    expect(r.valores).toMatchObject({ k: "20", premioCall: "1,1", premioPut: "0,9" });
  });

  it("avisa quando call e put do straddle têm strikes diferentes", () => {
    const r = prefillDaCadeia("straddle_comprado", [
      serie({ tipo: "call", strike: 21, premioRef: 1.1 }),
      serie({ tipo: "put", strike: 20, premioRef: 0.9 }),
    ]);
    expect(r.aviso).toMatch(/strikes diferentes/);
  });

  it("preenche strangle com put (menor) e call (maior)", () => {
    const r = prefillDaCadeia("strangle_comprado", [
      serie({ tipo: "call", strike: 24, premioRef: 0.4 }),
      serie({ tipo: "put", strike: 18, premioRef: 0.5 }),
    ]);
    expect(r.valores).toMatchObject({ k1: "18", k2: "24", premioPut: "0,5", premioCall: "0,4" });
  });

  it("falha com aviso quando faltam séries do tipo certo", () => {
    const r = prefillDaCadeia("condor", [serie({ tipo: "call", strike: 20 })]);
    expect(r.completo).toBe(false);
    expect(r.aviso).toMatch(/4 calls/);
  });

  it("fica incompleto (sem inventar) quando falta o prêmio", () => {
    const r = prefillDaCadeia("venda_coberta", [
      serie({ tipo: "call", strike: 22, premioRef: null }),
    ]);
    expect(r.valores.k).toBe("22");
    expect(r.valores.premio).toBe("");
    expect(r.completo).toBe(false);
  });
});
