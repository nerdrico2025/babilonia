/**
 * Testes das preferências e validações de Configurações. Garantem leitura
 * tolerante (dado antigo/ inválido vira o padrão) e validação do ticker/capital.
 */
import { describe, expect, it } from "vitest";

import {
  capitalSchema,
  lerPreferencias,
  PREFERENCIAS_PADRAO,
  tickerAtivoSchema,
} from "./settings";

describe("lerPreferencias", () => {
  it("usa o padrão quando não há nada salvo", () => {
    expect(lerPreferencias(undefined)).toEqual(PREFERENCIAS_PADRAO);
    expect(lerPreferencias({})).toEqual({ tema: "claro" });
  });
  it("lê o tema salvo e ignora campos desconhecidos", () => {
    expect(lerPreferencias({ tema: "escuro", outro: 1 })).toEqual({ tema: "escuro" });
  });
  it("cai no padrão diante de tema inválido (não lança)", () => {
    expect(lerPreferencias({ tema: "neon" })).toEqual({ tema: "claro" });
  });
});

describe("tickerAtivoSchema", () => {
  it("aceita e normaliza tickers válidos", () => {
    expect(tickerAtivoSchema.parse("petr4")).toBe("PETR4");
    expect(tickerAtivoSchema.parse(" taee11 ")).toBe("TAEE11");
  });
  it("rejeita lixo", () => {
    expect(tickerAtivoSchema.safeParse("ABC").success).toBe(false);
    expect(tickerAtivoSchema.safeParse("PETR4!").success).toBe(false);
  });
});

describe("capitalSchema", () => {
  it("aceita zero e positivos", () => {
    expect(capitalSchema.parse(0)).toBe(0);
    expect(capitalSchema.parse(50000)).toBe(50000);
  });
  it("rejeita negativos e não-números", () => {
    expect(capitalSchema.safeParse(-1).success).toBe(false);
    expect(capitalSchema.safeParse(Number.NaN).success).toBe(false);
  });
});
