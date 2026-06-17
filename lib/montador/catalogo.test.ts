/**
 * Testes do catálogo do montador. Não reimplementam a matemática (isso é do
 * `options-math`, já testado): garantem que cada variante MONTA, delega ao núcleo
 * e expõe o rótulo de risco e os metadados que a UI espera.
 */
import { describe, expect, it } from "vitest";

import { CATALOGO, GRUPOS, type EstruturaId } from "./catalogo";

// Valores plausíveis para cada campo, por variante (strikes crescentes).
const ENTRADAS: Record<EstruturaId, Record<string, number>> = {
  trava_alta_debito: { k1: 20, k2: 22, premioK1: 1.2, premioK2: 0.5 },
  trava_alta_credito: { k1: 18, k2: 20, premioK1: 0.4, premioK2: 1.1 },
  trava_baixa_debito: { k1: 18, k2: 20, premioK1: 0.4, premioK2: 1.2 },
  trava_baixa_credito: { k1: 20, k2: 22, premioK1: 1.1, premioK2: 0.4 },
  borboleta: { k1: 18, k2: 20, k3: 22, premioK1: 2.5, premioK2: 1.2, premioK3: 0.5 },
  condor: {
    k1: 18, k2: 20, k3: 22, k4: 24,
    premioK1: 2.6, premioK2: 1.4, premioK3: 0.7, premioK4: 0.3,
  },
  straddle_comprado: { k: 20, premioCall: 1.1, premioPut: 1.0 },
  straddle_vendido: { k: 20, premioCall: 1.1, premioPut: 1.0 },
  strangle_comprado: { k1: 18, k2: 22, premioPut: 0.6, premioCall: 0.5 },
  strangle_vendido: { k1: 18, k2: 22, premioPut: 0.6, premioCall: 0.5 },
  venda_coberta: { k: 22, premio: 0.9 },
};

const IDS = Object.keys(CATALOGO) as EstruturaId[];

describe("catálogo do montador", () => {
  it.each(IDS)("monta a estrutura %s a partir do núcleo", (id) => {
    const def = CATALOGO[id];
    const resultado = def.montar({ valores: ENTRADAS[id], quantidade: 1 });

    // Os campos vêm 100% do options-math; aqui só checamos a forma.
    expect(resultado.legs.length).toBeGreaterThan(0);
    expect(resultado.curva.length).toBeGreaterThan(1);
    expect(["DEFINIDO", "INDEFINIDO"]).toContain(resultado.rotulo_risco);
    expect(Number.isFinite(resultado.risco_maximo) || resultado.risco_maximo === Infinity).toBe(true);
  });

  it("rotula como INDEFINIDO as versões vendidas a descoberto", () => {
    expect(CATALOGO.straddle_vendido.montar({ valores: ENTRADAS.straddle_vendido, quantidade: 1 }).rotulo_risco).toBe("INDEFINIDO");
    expect(CATALOGO.strangle_vendido.montar({ valores: ENTRADAS.strangle_vendido, quantidade: 1 }).rotulo_risco).toBe("INDEFINIDO");
  });

  it("rotula travas e venda coberta como DEFINIDO", () => {
    expect(CATALOGO.trava_alta_debito.montar({ valores: ENTRADAS.trava_alta_debito, quantidade: 1 }).rotulo_risco).toBe("DEFINIDO");
    expect(CATALOGO.venda_coberta.montar({ valores: ENTRADAS.venda_coberta, quantidade: 1 }).rotulo_risco).toBe("DEFINIDO");
  });

  it("aponta o campo que falta em vez de inventar (§2.4)", () => {
    expect(() =>
      CATALOGO.trava_alta_debito.montar({ valores: { k1: 20 }, quantidade: 1 }),
    ).toThrow(/Falta preencher/);
  });

  it("a quantidade multiplica o risco (delegado ao núcleo)", () => {
    const um = CATALOGO.trava_alta_debito.montar({ valores: ENTRADAS.trava_alta_debito, quantidade: 1 });
    const dois = CATALOGO.trava_alta_debito.montar({ valores: ENTRADAS.trava_alta_debito, quantidade: 2 });
    expect(dois.risco_maximo).toBeCloseTo(um.risco_maximo * 2, 6);
  });

  it("todos os ids dos grupos existem no catálogo e nenhum fica de fora", () => {
    const idsGrupos = GRUPOS.flatMap((g) => g.ids).sort();
    expect(idsGrupos).toEqual(IDS.sort());
  });
});
