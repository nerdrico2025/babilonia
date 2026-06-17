import { describe, it, expect } from "vitest";

import {
  processarLinhas,
  raizDoTicker,
  construirMapaRaizes,
  derivarAtivoObjeto,
} from "./ingestao-cotahist";
import type { NewOpcaoCotahist, NewAcaoCotahist } from "@/db/schema";

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

/**
 * Ação à vista lote-padrão: TPMERC 010 + CODBDI 02. PREEXE/DATVEN ficam ZERADOS
 * (ação não tem strike nem vencimento) → vai para acao_cotahist.
 *  - fechamento R$ 38,50; volume R$ 1.000.000,00; 5000 negócios.
 */
const ACAO_PETR4 = montarRegistro01({
  TIPREG: "01",
  DATAPREGAO: "20260615",
  CODBDI: "02",
  CODNEG: "PETR4",
  TPMERC: "010",
  NOMRES: "PETROBRAS",
  PREULT: reais13(38.5),
  PREOFC: reais13(38.49),
  PREOFV: reais13(38.51),
  TOTNEG: "05000",
  VOLTOT: "000000000100000000", // R$ 1.000.000,00
  FATCOT: "0000001",
  // PREEXE e DATVEN omitidos → zeros (ação não tem strike/vencimento).
});

const HEADER = "00" + " ".repeat(243);
const TRAILER = "99" + " ".repeat(243);
const LIXO_CURTO = "linha curta que não é registro";

/** Opção (070) de 245 bytes, mas PREEXE corrompido com letras → parser lança. */
const CALL_CORROMPIDA =
  CALL_PETR.slice(0, 188) + "ABCDEFGHIJKLM" + CALL_PETR.slice(201);

// ── Fake de upsert em memória (opções + ações) ───────────────────────────────

function upsertFake() {
  const opcoes: NewOpcaoCotahist[] = [];
  const acoes: NewAcaoCotahist[] = [];
  const lotesOpcoes: number[] = [];
  const lotesAcoes: number[] = [];
  return {
    opcoes,
    acoes,
    lotesOpcoes,
    lotesAcoes,
    upsertOpcoes: async (registros: NewOpcaoCotahist[]) => {
      lotesOpcoes.push(registros.length);
      opcoes.push(...registros);
    },
    upsertAcoes: async (registros: NewAcaoCotahist[]) => {
      lotesAcoes.push(registros.length);
      acoes.push(...registros);
    },
  };
}

// ── processarLinhas ──────────────────────────────────────────────────────────

describe("processarLinhas — roteamento opção vs ação num só stream", () => {
  it("roteia opções e ações para upserts distintos e classifica o resto", async () => {
    const mapa = construirMapaRaizes(["PETR4", "VALE3"]);
    const fake = upsertFake();

    const linhas = [
      CALL_PETR, // opção → opcao_cotahist (underlying PETR4)
      ACAO_PETR4, // ação à vista 010+02 → acao_cotahist
      HEADER, // header → pula
      PUT_VALE, // opção → opcao_cotahist (underlying VALE3)
      LIXO_CURTO, // tamanho errado → pula
      CALL_CORROMPIDA, // opção corrompida → erro (loga e segue)
      CALL_ABEV, // opção FORA da watchlist (ABEV) → descarta (§6.4)
      TRAILER, // trailer → pula
    ];

    const rel = await processarLinhas(linhas, {
      resolverObjeto: (s) => derivarAtivoObjeto(s, mapa),
      upsertOpcoes: fake.upsertOpcoes,
      upsertAcoes: fake.upsertAcoes,
      tamanhoLote: 2, // força mais de um lote nas opções
    });

    expect(rel.linhasLidas).toBe(8);
    expect(rel.opcoesIngeridas).toBe(2); // call PETR, put VALE (ABEV é descartada)
    expect(rel.opcoesForaWatchlist).toBe(1); // ABEV não está na watchlist
    expect(rel.acoesIngeridas).toBe(1); // PETR4 à vista
    expect(rel.linhasPuladas).toBe(3); // header, lixo, trailer
    expect(rel.erros).toBe(1); // call corrompida

    // Só as opções DA WATCHLIST foram para o upsert, com os vínculos corretos.
    expect(fake.opcoes).toHaveLength(2);
    const porTicker = new Map(fake.opcoes.map((r) => [r.optionSymbol, r]));
    expect(porTicker.get("PETRF336")?.kind).toBe("call");
    expect(porTicker.get("PETRF336")?.underlying).toBe("PETR4");
    expect(porTicker.get("PETRF336")?.strike).toBe("33.00");
    expect(porTicker.get("VALER450")?.kind).toBe("put");
    expect(porTicker.get("VALER450")?.underlying).toBe("VALE3");
    expect(porTicker.has("ABEVA120")).toBe(false); // descartada, não armazenada
    expect(fake.lotesOpcoes).toEqual([2]); // 2 opções, lote 2 → um flush só

    // Ação foi para o upsert de ações — e SEM strike/vencimento/kind (a row de
    // ação nem tem esses campos).
    expect(fake.acoes).toHaveLength(1);
    const acao = fake.acoes[0]!;
    expect(acao.ticker).toBe("PETR4");
    expect(acao.precoFechamento).toBe("38.50");
    expect(acao.volumeFinanceiro).toBe("1000000.00");
    expect(acao.numeroNegocios).toBe(5000);
    expect("strike" in acao).toBe(false);
    expect("expiresAt" in acao).toBe(false);
    expect("kind" in acao).toBe(false);
  });

  it("uma linha corrompida NÃO aborta o arquivo (as demais ingressam)", async () => {
    const fake = upsertFake();
    const rel = await processarLinhas([CALL_CORROMPIDA, PUT_VALE, ACAO_PETR4], {
      resolverObjeto: () => "VALE3", // dentro da watchlist → ingere
      upsertOpcoes: fake.upsertOpcoes,
      upsertAcoes: fake.upsertAcoes,
    });
    expect(rel.erros).toBe(1);
    expect(rel.opcoesIngeridas).toBe(1);
    expect(rel.acoesIngeridas).toBe(1);
    expect(fake.opcoes.map((r) => r.optionSymbol)).toEqual(["VALER450"]);
    expect(fake.acoes.map((r) => r.ticker)).toEqual(["PETR4"]);
  });

  it("não chama nenhum upsert quando só há header/trailer/lixo", async () => {
    const fake = upsertFake();
    const rel = await processarLinhas([HEADER, TRAILER, LIXO_CURTO], {
      resolverObjeto: () => null,
      upsertOpcoes: fake.upsertOpcoes,
      upsertAcoes: fake.upsertAcoes,
    });
    expect(fake.lotesOpcoes).toEqual([]);
    expect(fake.lotesAcoes).toEqual([]);
    expect(rel.opcoesIngeridas).toBe(0);
    expect(rel.acoesIngeridas).toBe(0);
    expect(rel.linhasPuladas).toBe(3);
  });

  /**
   * REGRESSÃO do bug "Maximum call stack size exceeded" na ingestão real de 2025.
   * Um upsert que falha NÃO pode ser engolido como "linha ruim" nem deixar o lote
   * crescer: antes, a falha era capturada pelo try/catch por-linha e o lote nunca
   * era limpo, então ele crescia 500→501→502… a cada linha (flood de log) até o
   * builder de SQL do Drizzle estourar a pilha com um INSERT gigante. O correto é
   * o erro de upsert PROPAGAR (é sistêmico) — e o lote jamais passar do tamanho.
   */
  it("um upsert de ação que falha PROPAGA — não engole nem faz o lote crescer", async () => {
    const tickers = Array.from({ length: 1200 }, (_, i) =>
      montarRegistro01({
        TIPREG: "01",
        DATAPREGAO: "20250407",
        CODBDI: "02",
        CODNEG: "ACT" + i, // ticker distinto por linha
        TPMERC: "010",
        NOMRES: "X",
        PREULT: reais13(34.56),
        VOLTOT: "000000098765432100",
        QUATOT: "000000123456789012",
        FATCOT: "0000001",
      }),
    );

    const lotesVistos: number[] = [];
    await expect(
      processarLinhas(tickers, {
        resolverObjeto: () => null,
        upsertOpcoes: async () => {},
        upsertAcoes: async (regs) => {
          lotesVistos.push(regs.length);
          throw new Error("boom no banco");
        },
        tamanhoLote: 500,
      }),
    ).rejects.toThrow("boom no banco");

    // O erro propagou no PRIMEIRO flush (500 itens); o lote NUNCA cresceu além do
    // tamanho — sem runaway, sem INSERT gigante, sem estouro de pilha.
    expect(lotesVistos).toEqual([500]);
    expect(Math.max(...lotesVistos)).toBeLessThanOrEqual(500);
  });

  /**
   * REGRESSÃO do log por-linha: as rejeições (parser lançando) são AGREGADAS por
   * motivo com no máximo ~10 amostras — não uma linha de log por rejeição.
   */
  it("agrega rejeições por motivo com ≤ 10 amostras (sem log por-linha)", async () => {
    const fake = upsertFake();
    // 25 opções corrompidas (mesmo motivo: campo PREEXE) + 1 boa.
    const corrompidas = Array.from({ length: 25 }, () => CALL_CORROMPIDA);
    const rel = await processarLinhas([...corrompidas, PUT_VALE], {
      resolverObjeto: () => "VALE3", // a opção boa está na watchlist
      upsertOpcoes: fake.upsertOpcoes,
      upsertAcoes: fake.upsertAcoes,
    });

    expect(rel.erros).toBe(25);
    expect(rel.opcoesIngeridas).toBe(1);
    const agg = rel.rejeicoes.get("campo PREEXE inválido");
    expect(agg).toBeDefined();
    expect(agg?.count).toBe(25); // conta TODAS
    expect(agg?.amostras.length).toBe(10); // mas guarda só ~10 amostras
  });

  /**
   * §6.4 / decisão de storage: só armazenamos opções da WATCHLIST. Opção cujo
   * ativo-objeto não resolve (raiz fora da watchlist) é DESCARTADA — é o que
   * impede ingerir a B3 inteira (~2M linhas) e estourar o tier do Postgres.
   */
  it("descarta opção fora da watchlist (não vai ao upsert) e a conta à parte", async () => {
    const mapa = construirMapaRaizes(["PETR4"]); // só PETR na watchlist
    const fake = upsertFake();
    const rel = await processarLinhas([CALL_PETR, PUT_VALE, CALL_ABEV], {
      resolverObjeto: (s) => derivarAtivoObjeto(s, mapa),
      upsertOpcoes: fake.upsertOpcoes,
      upsertAcoes: fake.upsertAcoes,
    });

    expect(rel.opcoesIngeridas).toBe(1); // só a call de PETR
    expect(rel.opcoesForaWatchlist).toBe(2); // VALE e ABEV fora → descartadas
    expect(rel.erros).toBe(0); // descartar NÃO é erro
    expect(fake.opcoes.map((r) => r.optionSymbol)).toEqual(["PETRF336"]);
  });

  it("watchlist vazia → nenhuma opção ingerida (todas fora), mas ações entram", async () => {
    const mapa = construirMapaRaizes([]); // watchlist vazia
    const fake = upsertFake();
    const rel = await processarLinhas([CALL_PETR, PUT_VALE, ACAO_PETR4], {
      resolverObjeto: (s) => derivarAtivoObjeto(s, mapa),
      upsertOpcoes: fake.upsertOpcoes,
      upsertAcoes: fake.upsertAcoes,
    });

    expect(rel.opcoesIngeridas).toBe(0);
    expect(rel.opcoesForaWatchlist).toBe(2);
    expect(rel.acoesIngeridas).toBe(1); // ações independem da watchlist
    expect(fake.lotesOpcoes).toEqual([]); // nenhum flush de opções
  });
});

// ── registroParaUpsert ───────────────────────────────────────────────────────

describe("registroParaUpsert — mapeamento de campos", () => {
  it("converte numéricos para string e deriva o kind de tipoOpcao", async () => {
    // Reaproveita o parser via processarLinhas para obter um registro real.
    const fake = upsertFake();
    await processarLinhas([CALL_PETR], {
      resolverObjeto: () => "PETR4",
      upsertOpcoes: fake.upsertOpcoes,
      upsertAcoes: fake.upsertAcoes,
    });
    const r = fake.opcoes[0];
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
