import { describe, it, expect } from "vitest";

import {
  processarLinhas,
  raizDoTicker,
  construirMapaRaizes,
  derivarAtivoObjeto,
} from "./ingestao-cotahist";
import type { NewOpcaoCotahist } from "@/db/schema";

/**
 * Testes do PIPELINE de ingestão — foco no núcleo PURO `processarLinhas`
 * (filtro + parse + roteamento para upsert) e na heurística opção→objeto. Nada
 * aqui toca rede, disco ou banco: o `upsert` é um fake em memória e as "linhas"
 * são um array de registros montados à mão.
 *
 * As linhas seguem o mesmo builder posicional do teste do parser
 * (`lib/integrations/b3-cotahist.test.ts`): concatenação dos 26 campos do
 * registro 01 na ordem/largura do layout (soma = 245). Numéricos zero-à-esquerda,
 * texto espaço-à-direita.
 */

// ── Builder de registro tipo 01 (espelha o do teste do parser) ───────────────

const CAMPOS = [
  { nome: "TIPREG", tam: 2, num: true },
  { nome: "DATAPREGAO", tam: 8, num: true },
  { nome: "CODBDI", tam: 2, num: false },
  { nome: "CODNEG", tam: 12, num: false },
  { nome: "TPMERC", tam: 3, num: true },
  { nome: "NOMRES", tam: 12, num: false },
  { nome: "ESPECI", tam: 10, num: false },
  { nome: "PRAZOT", tam: 3, num: false },
  { nome: "MODREF", tam: 4, num: false },
  { nome: "PREABE", tam: 13, num: true },
  { nome: "PREMAX", tam: 13, num: true },
  { nome: "PREMIN", tam: 13, num: true },
  { nome: "PREMED", tam: 13, num: true },
  { nome: "PREULT", tam: 13, num: true },
  { nome: "PREOFC", tam: 13, num: true },
  { nome: "PREOFV", tam: 13, num: true },
  { nome: "TOTNEG", tam: 5, num: true },
  { nome: "QUATOT", tam: 18, num: true },
  { nome: "VOLTOT", tam: 18, num: true },
  { nome: "PREEXE", tam: 13, num: true },
  { nome: "INDOPC", tam: 1, num: true },
  { nome: "DATVEN", tam: 8, num: true },
  { nome: "FATCOT", tam: 7, num: true },
  { nome: "PTOEXE", tam: 13, num: true },
  { nome: "CODISI", tam: 12, num: false },
  { nome: "DISMES", tam: 3, num: true },
] as const;

type NomeCampo = (typeof CAMPOS)[number]["nome"];

function montarRegistro01(valores: Partial<Record<NomeCampo, string>>): string {
  const linha = CAMPOS.map(({ nome, tam, num }) => {
    const v = valores[nome] ?? "";
    if (v.length > tam) throw new Error(`Campo ${nome} excede ${tam}: "${v}"`);
    return num ? v.padStart(tam, "0") : v.padEnd(tam, " ");
  }).join("");
  if (linha.length !== 245) throw new Error(`Registro com ${linha.length} ≠ 245`);
  return linha;
}

/** Centavos de um valor em reais, como string de 13 dígitos (Dec=2). */
function reais13(reais: number): string {
  return Math.round(reais * 100)
    .toString()
    .padStart(13, "0");
}

// ── Linhas de exemplo ────────────────────────────────────────────────────────

const CALL_PETR = montarRegistro01({
  TIPREG: "01",
  DATAPREGAO: "20260615",
  CODBDI: "78",
  CODNEG: "PETRF336",
  TPMERC: "070",
  NOMRES: "PETROBRAS",
  PREULT: reais13(1.23),
  PREOFC: reais13(1.2),
  PREOFV: reais13(1.25),
  TOTNEG: "01500",
  PREEXE: reais13(33),
  DATVEN: "20260116",
  FATCOT: "0000001",
});

const PUT_VALE = montarRegistro01({
  TIPREG: "01",
  DATAPREGAO: "20260615",
  CODBDI: "82",
  CODNEG: "VALER450",
  TPMERC: "080",
  NOMRES: "VALE",
  PREULT: reais13(2.5),
  PREEXE: reais13(45),
  DATVEN: "20260116",
  FATCOT: "0000001",
});

/** Opção cuja raiz (ABEV) NÃO está na watchlist → underlying deve ser null. */
const CALL_ABEV = montarRegistro01({
  TIPREG: "01",
  DATAPREGAO: "20260615",
  CODNEG: "ABEVA120",
  TPMERC: "070",
  PREEXE: reais13(12),
  DATVEN: "20260116",
  FATCOT: "0000001",
});

/** Ação à vista (TPMERC 010) — não é opção, deve ser pulada. */
const ACAO_PETR4 = montarRegistro01({
  TIPREG: "01",
  DATAPREGAO: "20260615",
  CODNEG: "PETR4",
  TPMERC: "010",
});

const HEADER = "00" + " ".repeat(243);
const TRAILER = "99" + " ".repeat(243);
const LIXO_CURTO = "linha curta que não é registro";

/** Opção (070) de 245 bytes, mas PREEXE corrompido com letras → parser lança. */
const CALL_CORROMPIDA =
  CALL_PETR.slice(0, 188) + "ABCDEFGHIJKLM" + CALL_PETR.slice(201);

// ── Fake de upsert em memória ────────────────────────────────────────────────

function upsertFake() {
  const recebidos: NewOpcaoCotahist[] = [];
  const lotes: number[] = [];
  return {
    recebidos,
    lotes,
    upsert: async (registros: NewOpcaoCotahist[]) => {
      lotes.push(registros.length);
      recebidos.push(...registros);
    },
  };
}

const loggerMudo = { warn: () => {} };

// ── processarLinhas ──────────────────────────────────────────────────────────

describe("processarLinhas — filtro + parse + roteamento", () => {
  it("ingere só as opções e classifica o resto (pulos/erros) corretamente", async () => {
    const mapa = construirMapaRaizes(["PETR4", "VALE3"]);
    const fake = upsertFake();

    const linhas = [
      CALL_PETR, // opção → ingere (underlying PETR4)
      ACAO_PETR4, // ação → pula
      HEADER, // header → pula
      PUT_VALE, // opção → ingere (underlying VALE3)
      LIXO_CURTO, // tamanho errado → pula
      CALL_CORROMPIDA, // opção corrompida → erro (loga e segue)
      CALL_ABEV, // opção sem match na watchlist → ingere (underlying null)
      TRAILER, // trailer → pula
    ];

    const rel = await processarLinhas(linhas, {
      resolverObjeto: (s) => derivarAtivoObjeto(s, mapa),
      upsert: fake.upsert,
      tamanhoLote: 2, // força mais de um lote
      logger: loggerMudo,
    });

    expect(rel.linhasLidas).toBe(8);
    expect(rel.opcoesIngeridas).toBe(3); // call PETR, put VALE, call ABEV
    expect(rel.linhasPuladas).toBe(4); // ação, header, lixo, trailer
    expect(rel.erros).toBe(1); // call corrompida

    // 3 registros chegaram ao upsert, com os vínculos corretos.
    expect(fake.recebidos).toHaveLength(3);
    const porTicker = new Map(fake.recebidos.map((r) => [r.optionSymbol, r]));

    expect(porTicker.get("PETRF336")?.kind).toBe("call");
    expect(porTicker.get("PETRF336")?.underlying).toBe("PETR4");
    expect(porTicker.get("PETRF336")?.strike).toBe("33.00");
    expect(porTicker.get("PETRF336")?.precoFechamento).toBe("1.23");

    expect(porTicker.get("VALER450")?.kind).toBe("put");
    expect(porTicker.get("VALER450")?.underlying).toBe("VALE3");

    // Raiz fora da watchlist → vínculo null, mas a opção é ingerida mesmo assim.
    expect(porTicker.get("ABEVA120")?.underlying).toBeNull();

    // tamanhoLote=2 com 3 registros → lotes [2, 1].
    expect(fake.lotes).toEqual([2, 1]);
  });

  it("uma linha corrompida NÃO aborta o arquivo (as demais opções ingressam)", async () => {
    const fake = upsertFake();
    const rel = await processarLinhas([CALL_CORROMPIDA, PUT_VALE], {
      resolverObjeto: () => null,
      upsert: fake.upsert,
      logger: loggerMudo,
    });
    expect(rel.erros).toBe(1);
    expect(rel.opcoesIngeridas).toBe(1);
    expect(fake.recebidos.map((r) => r.optionSymbol)).toEqual(["VALER450"]);
  });

  it("não chama upsert quando não há nenhuma opção", async () => {
    let chamou = false;
    const rel = await processarLinhas([HEADER, ACAO_PETR4, TRAILER], {
      resolverObjeto: () => null,
      upsert: async () => {
        chamou = true;
      },
      logger: loggerMudo,
    });
    expect(chamou).toBe(false);
    expect(rel.opcoesIngeridas).toBe(0);
    expect(rel.linhasPuladas).toBe(3);
  });
});

// ── registroParaUpsert ───────────────────────────────────────────────────────

describe("registroParaUpsert — mapeamento de campos", () => {
  it("converte numéricos para string e deriva o kind de tipoOpcao", async () => {
    // Reaproveita o parser via processarLinhas para obter um registro real.
    const fake = upsertFake();
    await processarLinhas([CALL_PETR], {
      resolverObjeto: () => "PETR4",
      upsert: fake.upsert,
      logger: loggerMudo,
    });
    const r = fake.recebidos[0];
    expect(r).toBeDefined();
    if (!r) return;
    expect(r.numeroNegocios).toBe(1500);
    expect(r.fatorCotacao).toBe(1);
    expect(r.bid).toBe("1.20");
    expect(r.ask).toBe("1.25");
    expect(r.expiresAt).toBeInstanceOf(Date);
    expect((r.expiresAt as Date).getUTCFullYear()).toBe(2026);
  });
});

// ── Heurística opção → ativo-objeto ──────────────────────────────────────────

describe("heurística raiz + watchlist (§6.4)", () => {
  it("raizDoTicker pega as 4 primeiras letras (e null se não houver 4)", () => {
    expect(raizDoTicker("PETRF336")).toBe("PETR");
    expect(raizDoTicker("VALER450")).toBe("VALE");
    expect(raizDoTicker("PETR4")).toBe("PETR"); // símbolo do objeto também
    expect(raizDoTicker("AB1")).toBeNull(); // < 4 letras
  });

  it("mapeia raiz única → objeto; raiz ambígua fica de fora (preferir null)", () => {
    const mapa = construirMapaRaizes(["PETR4", "VALE3"]);
    expect(mapa.get("PETR")).toBe("PETR4");
    expect(mapa.get("VALE")).toBe("VALE3");

    // PETR3 e PETR4 colidem na raiz PETR → ambígua → não entra no mapa.
    const ambiguo = construirMapaRaizes(["PETR3", "PETR4"]);
    expect(ambiguo.has("PETR")).toBe(false);
  });

  it("derivarAtivoObjeto resolve pela raiz, ou null fora da watchlist", () => {
    const mapa = construirMapaRaizes(["PETR4", "VALE3"]);
    expect(derivarAtivoObjeto("PETRF336", mapa)).toBe("PETR4");
    expect(derivarAtivoObjeto("VALER450", mapa)).toBe("VALE3");
    expect(derivarAtivoObjeto("ABEVA120", mapa)).toBeNull(); // não na watchlist
  });
});
