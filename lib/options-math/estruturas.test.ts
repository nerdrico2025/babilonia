import { describe, it, expect } from "vitest";

import {
  travaAltaCallDebito,
  travaAltaPutCredito,
  travaBaixaPutDebito,
  travaBaixaCallCredito,
  borboletaCalls,
  condorCalls,
  straddleComprado,
  straddleVendido,
  strangleComprado,
  strangleVendido,
  vendaCoberta,
} from "@/lib/options-math";

/**
 * Testes das ESTRUTURAS NOMEADAS (§8.4, §18). Números fechados, um caso
 * conhecido por estrutura, validação do rótulo DEFINIDO/INDEFINIDO e o guard
 * das vendidas a descoberto (risco INDEFINIDO, nunca um número enganoso).
 *
 * Os casos usam `tamanhoLote: 1` para conferir os valores POR AÇÃO direto das
 * fórmulas do §18; um teste à parte cobre o lote padrão (100).
 */

describe("Travas verticais", () => {
  it("Trava de ALTA débito (K1=20, K2=22, débito=0,80): risco 0,80; ganho 1,20; BE 20,80", () => {
    const r = travaAltaCallDebito({
      k1: 20, k2: 22, premioK1: 1.0, premioK2: 0.2, tamanhoLote: 1,
    });
    expect(r.risco_maximo).toBeCloseTo(0.8);
    expect(r.rotulo_risco).toBe("DEFINIDO");
    expect(r.ganho_maximo).toBeCloseTo(1.2);
    expect(r.breakevens).toHaveLength(1);
    expect(r.breakevens[0]).toBeCloseTo(20.8);
  });

  it("Trava de ALTA crédito (bull put, crédito=0,80): risco 1,20; ganho=crédito 0,80; BE 21,20", () => {
    const r = travaAltaPutCredito({
      k1: 20, k2: 22, premioK1: 0.2, premioK2: 1.0, tamanhoLote: 1,
    });
    expect(r.risco_maximo).toBeCloseTo(1.2); // (K2−K1) − crédito
    expect(r.rotulo_risco).toBe("DEFINIDO");
    expect(r.ganho_maximo).toBeCloseTo(0.8); // = crédito
    expect(r.breakevens[0]).toBeCloseTo(21.2); // K2 − crédito
  });

  it("Trava de BAIXA débito (puts; débito=0,80): risco 0,80; ganho 1,20; BE K2−débito=21,20", () => {
    const r = travaBaixaPutDebito({
      k1: 20, k2: 22, premioK1: 0.2, premioK2: 1.0, tamanhoLote: 1,
    });
    expect(r.risco_maximo).toBeCloseTo(0.8);
    expect(r.rotulo_risco).toBe("DEFINIDO");
    expect(r.ganho_maximo).toBeCloseTo(1.2);
    expect(r.breakevens[0]).toBeCloseTo(21.2);
  });

  it("Trava de BAIXA crédito (bear call, crédito=0,80): risco 1,20; ganho 0,80; BE K1+crédito=20,80", () => {
    const r = travaBaixaCallCredito({
      k1: 20, k2: 22, premioK1: 1.0, premioK2: 0.2, tamanhoLote: 1,
    });
    expect(r.risco_maximo).toBeCloseTo(1.2);
    expect(r.rotulo_risco).toBe("DEFINIDO");
    expect(r.ganho_maximo).toBeCloseTo(0.8);
    expect(r.breakevens[0]).toBeCloseTo(20.8);
  });

  it("escala com o tamanho do lote padrão (100): risco 80, ganho 120", () => {
    const r = travaAltaCallDebito({ k1: 20, k2: 22, premioK1: 1.0, premioK2: 0.2 });
    expect(r.risco_maximo).toBeCloseTo(80);
    expect(r.ganho_maximo).toBeCloseTo(120);
    expect(r.breakevens[0]).toBeCloseTo(20.8); // breakeven é preço — independe do lote
  });
});

describe("Borboleta e condor", () => {
  it("Borboleta (18/20/22; débito=0,30): risco 0,30; ganho 1,70; BEs 18,30 e 21,70; DEFINIDO", () => {
    const r = borboletaCalls({
      k1: 18, k2: 20, k3: 22,
      premioK1: 1.2, premioK2: 0.6, premioK3: 0.3,
      tamanhoLote: 1,
    });
    expect(r.risco_maximo).toBeCloseTo(0.3); // 1,2 − 2×0,6 + 0,3
    expect(r.rotulo_risco).toBe("DEFINIDO");
    expect(r.ganho_maximo).toBeCloseTo(1.7); // (K2−K1) − débito
    expect(r.breakevens).toHaveLength(2);
    expect(r.breakevens[0]).toBeCloseTo(18.3); // K1 + débito
    expect(r.breakevens[1]).toBeCloseTo(21.7); // K3 − débito
  });

  it("Condor (18/20/22/24; débito=1,10): risco 1,10; ganho 0,90; BEs 19,10 e 22,90; platô interno", () => {
    const r = condorCalls({
      k1: 18, k2: 20, k3: 22, k4: 24,
      premioK1: 3.0, premioK2: 1.5, premioK3: 0.7, premioK4: 0.3,
      tamanhoLote: 1,
    });
    expect(r.risco_maximo).toBeCloseTo(1.1); // 3,0 − 1,5 − 0,7 + 0,3
    expect(r.rotulo_risco).toBe("DEFINIDO");
    expect(r.ganho_maximo).toBeCloseTo(0.9); // (K2−K1) − débito
    expect(r.breakevens[0]).toBeCloseTo(19.1); // K1 + débito
    expect(r.breakevens[1]).toBeCloseTo(22.9); // K4 − débito
    // Platô de ganho entre os strikes internos: resultado igual em K2 e K3.
    const emK2 = r.curva.find((p) => Math.abs(p.preco - 20) < 1e-9)!;
    const emK3 = r.curva.find((p) => Math.abs(p.preco - 22) < 1e-9)!;
    expect(emK2.resultado).toBeCloseTo(0.9);
    expect(emK3.resultado).toBeCloseTo(emK2.resultado);
  });
});

describe("Straddle e strangle", () => {
  it("Straddle COMPRADO (K=20; prêmios 1,0+1,2): risco 2,20; ganho ilimitado; BEs 17,8 e 22,2", () => {
    const r = straddleComprado({ k: 20, premioCall: 1.0, premioPut: 1.2, tamanhoLote: 1 });
    expect(r.risco_maximo).toBeCloseTo(2.2);
    expect(r.rotulo_risco).toBe("DEFINIDO");
    expect(r.ganho_maximo).toBe("ilimitado");
    expect(r.breakevens).toHaveLength(2);
    expect(r.breakevens[0]).toBeCloseTo(17.8);
    expect(r.breakevens[1]).toBeCloseTo(22.2);
  });

  it("Strangle COMPRADO (put 18 / call 22; prêmios 0,5+0,6): risco 1,10; ilimitado; BEs 16,9 e 23,1", () => {
    const r = strangleComprado({
      k1: 18, k2: 22, premioPut: 0.5, premioCall: 0.6, tamanhoLote: 1,
    });
    expect(r.risco_maximo).toBeCloseTo(1.1);
    expect(r.rotulo_risco).toBe("DEFINIDO");
    expect(r.ganho_maximo).toBe("ilimitado");
    expect(r.breakevens[0]).toBeCloseTo(16.9);
    expect(r.breakevens[1]).toBeCloseTo(23.1);
  });

  it("Straddle VENDIDO: risco INDEFINIDO (Infinity), NUNCA um número bonito; ganho = prêmios", () => {
    const r = straddleVendido({ k: 20, premioCall: 1.0, premioPut: 1.2, tamanhoLote: 1 });
    expect(r.rotulo_risco).toBe("INDEFINIDO");
    expect(r.risco_maximo).toBe(Infinity);
    expect(Number.isFinite(r.risco_maximo)).toBe(false); // não pode ser finito/enganoso
    expect(r.ganho_maximo).toBeCloseTo(2.2); // soma dos prêmios (recebida)
    expect(r.avisos.length).toBeGreaterThan(0);
  });

  it("Strangle VENDIDO: risco INDEFINIDO (Infinity); ganho = prêmios", () => {
    const r = strangleVendido({
      k1: 18, k2: 22, premioPut: 0.5, premioCall: 0.6, tamanhoLote: 1,
    });
    expect(r.rotulo_risco).toBe("INDEFINIDO");
    expect(r.risco_maximo).toBe(Infinity);
    expect(r.ganho_maximo).toBeCloseTo(1.1);
    expect(r.avisos.length).toBeGreaterThan(0);
  });
});

describe("Venda coberta (só a perna de opção, §3.2)", () => {
  it("DEFINIDO, risco de caixa 0 na perna; ganho = prêmio; BE = K + prêmio; avisos presentes", () => {
    const r = vendaCoberta({ k: 20, premio: 1.0, tamanhoLote: 1 });
    expect(r.rotulo_risco).toBe("DEFINIDO");
    expect(r.risco_maximo).toBe(0);
    expect(r.ganho_maximo).toBeCloseTo(1.0); // prêmio recebido
    expect(r.breakevens).toEqual([21.0]); // K + prêmio
    expect(r.avisos.length).toBe(2); // perder o ativo + escopo §3.2
    expect(r.avisos.join(" ")).toMatch(/ativo/i);
  });

  it("ganho escala com lote e quantidade", () => {
    const r = vendaCoberta({ k: 20, premio: 1.0, quantidade: 3 }); // lote 100
    expect(r.ganho_maximo).toBeCloseTo(300); // 1,0 × 3 × 100
  });
});

describe("Validações de entrada", () => {
  it("rejeita strikes fora de ordem na trava de alta", () => {
    expect(() =>
      travaAltaCallDebito({ k1: 22, k2: 20, premioK1: 1, premioK2: 0.2 }),
    ).toThrow();
  });

  it("rejeita borboleta com strikes não equidistantes", () => {
    expect(() =>
      borboletaCalls({
        k1: 18, k2: 20, k3: 23,
        premioK1: 1.2, premioK2: 0.6, premioK3: 0.3,
      }),
    ).toThrow(/equidistantes/);
  });

  it("rejeita condor com strikes fora de ordem", () => {
    expect(() =>
      condorCalls({
        k1: 18, k2: 20, k3: 19, k4: 24,
        premioK1: 3, premioK2: 1.5, premioK3: 0.7, premioK4: 0.3,
      }),
    ).toThrow();
  });
});
