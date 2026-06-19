/**
 * Testes do orquestrador de skew automático (V1).
 *
 * Duas camadas:
 *  1. `selecionarParOtm` (PURA) — seleção do par por distância% do spot, com linhas
 *     sintéticas.
 *  2. `calcularSkewAutomatico` — com `buscarCadeia`/`resolverIv` INJETADOS (sem
 *     banco/rede). A cadeia de fixture é montada pelo MESMO `montarCadeia` da
 *     /api/cadeia (não duplica shape). Consistência: o skew bate com `lerSkew`.
 */

import { describe, expect, it } from "vitest";

import { lerSkew } from "@/lib/analise/volatilidade";

import { montarCadeia, type LinhaOpcaoCadeia } from "./cadeia";
import type { ResultadoCadeiaCotahist } from "./cadeia";
import { calcularSkewAutomatico, selecionarParOtm } from "./skew";

const VENC = new Date("2026-07-17T00:00:00.000Z");

/** Linha sintética de cadeia (bid/ask positivos; irrelevantes p/ a seleção). */
function linha(over: Partial<LinhaOpcaoCadeia> = {}): LinhaOpcaoCadeia {
  return {
    optionSymbol: "X",
    kind: "call",
    strike: 100,
    expiresAt: VENC,
    bid: 1.0,
    ask: 1.2,
    quantidadeTitulos: 100,
    volumeFinanceiro: 10_000,
    numeroNegocios: 10,
    ...over,
  };
}

// ── selecionarParOtm (puro) ───────────────────────────────────────────────────

describe("selecionarParOtm", () => {
  it("escolhe o put e o call OTM mais próximos do alvo (5% do spot)", () => {
    const spot = 100;
    const linhas = [
      // puts abaixo do spot
      linha({ kind: "put", strike: 98, optionSymbol: "P98" }), // 2%
      linha({ kind: "put", strike: 95, optionSymbol: "P95" }), // 5% ← alvo
      linha({ kind: "put", strike: 92, optionSymbol: "P92" }), // 8%
      // calls acima do spot
      linha({ kind: "call", strike: 102, optionSymbol: "C102" }), // 2%
      linha({ kind: "call", strike: 105, optionSymbol: "C105" }), // 5% ← alvo
      linha({ kind: "call", strike: 108, optionSymbol: "C108" }), // 8%
    ];
    const par = selecionarParOtm(linhas, spot, VENC);
    expect(par?.put.optionSymbol).toBe("P95");
    expect(par?.call.optionSymbol).toBe("C105");
  });

  it("sem strike exato, pega o mais próximo do alvo dentro da faixa", () => {
    const spot = 100;
    const linhas = [
      linha({ kind: "put", strike: 96, optionSymbol: "P96" }), // 4% (|4-5|=1)
      linha({ kind: "put", strike: 93, optionSymbol: "P93" }), // 7% (|7-5|=2)
      linha({ kind: "call", strike: 104, optionSymbol: "C104" }), // 4%
      linha({ kind: "call", strike: 107, optionSymbol: "C107" }), // 7%
    ];
    const par = selecionarParOtm(linhas, spot, VENC);
    expect(par?.put.optionSymbol).toBe("P96");
    expect(par?.call.optionSymbol).toBe("C104");
  });

  it("sem put OTM (só calls) → null", () => {
    const linhas = [
      linha({ kind: "call", strike: 105, optionSymbol: "C105" }),
      linha({ kind: "call", strike: 108, optionSymbol: "C108" }),
    ];
    expect(selecionarParOtm(linhas, 100, VENC)).toBeNull();
  });

  it("sem call OTM (só puts) → null", () => {
    const linhas = [
      linha({ kind: "put", strike: 95, optionSymbol: "P95" }),
      linha({ kind: "put", strike: 92, optionSymbol: "P92" }),
    ];
    expect(selecionarParOtm(linhas, 100, VENC)).toBeNull();
  });

  it("strikes fora da faixa comparável (cadeia rala) → null", () => {
    const linhas = [
      linha({ kind: "put", strike: 99, optionSymbol: "P99" }), // 1% (fora de [2,8])
      linha({ kind: "put", strike: 80, optionSymbol: "P80" }), // 20% (fora)
      linha({ kind: "call", strike: 101, optionSymbol: "C101" }), // 1%
      linha({ kind: "call", strike: 120, optionSymbol: "C120" }), // 20%
    ];
    expect(selecionarParOtm(linhas, 100, VENC)).toBeNull();
  });

  it("ignora linhas de outro vencimento", () => {
    const outro = new Date("2026-08-21T00:00:00.000Z");
    const linhas = [
      linha({ kind: "put", strike: 95, optionSymbol: "P95", expiresAt: outro }),
      linha({ kind: "call", strike: 105, optionSymbol: "C105", expiresAt: outro }),
    ];
    // alvo é VENC, mas as linhas são de `outro` → sem candidatos.
    expect(selecionarParOtm(linhas, 100, VENC)).toBeNull();
  });

  it("spot inválido → null", () => {
    const linhas = [
      linha({ kind: "put", strike: 95 }),
      linha({ kind: "call", strike: 105 }),
    ];
    expect(selecionarParOtm(linhas, 0, VENC)).toBeNull();
  });
});

// ── calcularSkewAutomatico (deps injetadas) ───────────────────────────────────

/** Cadeia de fixture montada pelo builder real (spot + um vencimento). */
function cadeiaFake(spot: number | null, linhas: LinhaOpcaoCadeia[]): ResultadoCadeiaCotahist {
  return {
    asOf: VENC,
    cadeia: montarCadeia({ ativo: "PETR4", asOf: VENC, spot, ivAtual: null, linhas }),
  };
}

const LINHAS_OK = [
  linha({ kind: "put", strike: 95, optionSymbol: "PETRS95" }),
  linha({ kind: "call", strike: 105, optionSymbol: "PETRG105" }),
];

describe("calcularSkewAutomatico", () => {
  it("caminho feliz: par encontrado, IVs resolvidas, skew + metadado do par", async () => {
    const ivs: Record<string, number> = { PETRS95: 30, PETRG105: 25 };
    const r = await calcularSkewAutomatico("PETR4", VENC, {
      deps: {
        buscarCadeia: async () => cadeiaFake(100, LINHAS_OK),
        resolverIv: async (s) => ivs[s] ?? null,
      },
    });

    expect(r.disponivel).toBe(true);
    if (!r.disponivel) return;
    // Consistência: bate com lerSkew direto nas MESMAS IVs (não reimplementa).
    const esperado = lerSkew(30, 25);
    expect(r.diferenca).toBe(esperado.diferenca);
    expect(r.leitura).toBe(esperado.leitura);
    // Transparência: qual par embasou o skew.
    expect(r.parUsado.put.symbol).toBe("PETRS95");
    expect(r.parUsado.call.symbol).toBe("PETRG105");
    expect(r.parUsado.put.iv).toBe(30);
    expect(r.parUsado.call.iv).toBe(25);
    expect(r.parUsado.spot).toBe(100);
    expect(r.parUsado.put.distanciaPercentual).toBeCloseTo(5, 6);
    expect(r.parUsado.call.distanciaPercentual).toBeCloseTo(5, 6);
  });

  it("sem par disponível → { disponivel: false, motivo } (não lança)", async () => {
    const r = await calcularSkewAutomatico("PETR4", VENC, {
      deps: {
        // só calls OTM → selecionarParOtm devolve null
        buscarCadeia: async () =>
          cadeiaFake(100, [linha({ kind: "call", strike: 105, optionSymbol: "C105" })]),
        resolverIv: async () => 30,
      },
    });
    expect(r.disponivel).toBe(false);
    if (r.disponivel) return;
    expect(r.motivo).toMatch(/strikes OTM comparáveis/i);
  });

  it("falha ao resolver IV de um lado → graciosa, sem derrubar", async () => {
    const r = await calcularSkewAutomatico("PETR4", VENC, {
      deps: {
        buscarCadeia: async () => cadeiaFake(100, LINHAS_OK),
        resolverIv: async (s) => (s === "PETRS95" ? 30 : null), // call falha
      },
    });
    expect(r.disponivel).toBe(false);
    if (r.disponivel) return;
    expect(r.motivo).toMatch(/volatilidade implícita/i);
  });

  it("sem spot do ativo → { disponivel: false, motivo }", async () => {
    const r = await calcularSkewAutomatico("PETR4", VENC, {
      deps: {
        buscarCadeia: async () => cadeiaFake(null, LINHAS_OK),
        resolverIv: async () => 30,
      },
    });
    expect(r.disponivel).toBe(false);
    if (r.disponivel) return;
    expect(r.motivo).toMatch(/preço do ativo-objeto/i);
  });
});
