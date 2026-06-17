import { describe, it, expect } from "vitest";
import { RISK_LIMITS } from "@/lib/risk-rules";

/**
 * Teste de fumaça da Fase 0 — garante que o setup do Vitest funciona
 * (runner, globals, alias `@/` e resolução de módulos). Os testes reais do
 * núcleo `options-math` chegam na Fase 1.
 */
describe("setup de testes (smoke)", () => {
  it("o runner do Vitest está funcionando", () => {
    expect(1 + 1).toBe(2);
  });

  it("resolve imports via alias '@/' e lê constantes do projeto", () => {
    // Limites do §10 do PRD: risco definido até 5% do capital.
    expect(RISK_LIMITS.definedRiskMaxFraction).toBe(0.05);
  });
});
