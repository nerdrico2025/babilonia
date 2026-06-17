import { describe, it, expect } from "vitest";

import {
  parseLinhaCotahist,
  isOpcaoDeInteresse,
  parseRegistroAcao,
  isAcaoVistaLotePadrao,
  CotahistCampoInvalidoError,
  TAMANHO_REGISTRO,
} from "@/lib/integrations/b3-cotahist";

/**
 * Testes do parser posicional do COTAHIST (registro tipo 01, 245 bytes).
 *
 * As linhas de exemplo são montadas À MÃO pelo helper `montarRegistro01`, que
 * concatena os 26 campos do layout NA ORDEM e com a LARGURA exata do doc
 * (`docs/apis/b3-cotahist.md`). Concatenar na ordem garante, por construção, que
 * cada campo cai na posição 1-based certa — e a soma das larguras é 245 (há um
 * teste explícito para isso). Numéricos vão zero-preenchidos à esquerda; textos,
 * espaço-preenchidos à direita (como no arquivo real).
 */

// ── Builder de registro tipo 01 ──────────────────────────────────────────────

/**
 * Largura de cada campo do registro 01, NA ORDEM do layout (doc §"Registro tipo
 * 01"). A soma é 245. Os comentários repetem Pos.Ini–Pos.Fin para conferência.
 */
const CAMPOS = [
  { nome: "TIPREG", tam: 2, num: true }, //   1–2
  { nome: "DATAPREGAO", tam: 8, num: true }, //   3–10
  { nome: "CODBDI", tam: 2, num: false }, //  11–12
  { nome: "CODNEG", tam: 12, num: false }, //  13–24
  { nome: "TPMERC", tam: 3, num: true }, //  25–27
  { nome: "NOMRES", tam: 12, num: false }, //  28–39
  { nome: "ESPECI", tam: 10, num: false }, //  40–49
  { nome: "PRAZOT", tam: 3, num: false }, //  50–52
  { nome: "MODREF", tam: 4, num: false }, //  53–56
  { nome: "PREABE", tam: 13, num: true }, //  57–69
  { nome: "PREMAX", tam: 13, num: true }, //  70–82
  { nome: "PREMIN", tam: 13, num: true }, //  83–95
  { nome: "PREMED", tam: 13, num: true }, //  96–108
  { nome: "PREULT", tam: 13, num: true }, // 109–121
  { nome: "PREOFC", tam: 13, num: true }, // 122–134
  { nome: "PREOFV", tam: 13, num: true }, // 135–147
  { nome: "TOTNEG", tam: 5, num: true }, // 148–152
  { nome: "QUATOT", tam: 18, num: true }, // 153–170
  { nome: "VOLTOT", tam: 18, num: true }, // 171–188
  { nome: "PREEXE", tam: 13, num: true }, // 189–201
  { nome: "INDOPC", tam: 1, num: true }, // 202–202
  { nome: "DATVEN", tam: 8, num: true }, // 203–210
  { nome: "FATCOT", tam: 7, num: true }, // 211–217
  { nome: "PTOEXE", tam: 13, num: true }, // 218–230
  { nome: "CODISI", tam: 12, num: false }, // 231–242
  { nome: "DISMES", tam: 3, num: true }, // 243–245
] as const;

type NomeCampo = (typeof CAMPOS)[number]["nome"];

/**
 * Monta um registro 01 de 245 chars a partir de um mapa parcial de campos. Onde
 * não informado: numérico → zeros; texto → espaços. Cada valor é
 * truncado/preenchido para a largura do campo.
 */
function montarRegistro01(valores: Partial<Record<NomeCampo, string>>): string {
  return CAMPOS.map(({ nome, tam, num }) => {
    const v = valores[nome] ?? "";
    if (v.length > tam) {
      throw new Error(`Campo ${nome} excede ${tam} chars: "${v}"`);
    }
    return num ? v.padStart(tam, "0") : v.padEnd(tam, " ");
  }).join("");
}

// ── Sanidade do próprio builder ──────────────────────────────────────────────

describe("layout do COTAHIST (sanidade do builder)", () => {
  it("a soma das larguras dos 26 campos é 245", () => {
    const soma = CAMPOS.reduce((acc, c) => acc + c.tam, 0);
    expect(soma).toBe(TAMANHO_REGISTRO);
  });

  it("um registro montado tem exatamente 245 chars e os campos nas posições do doc", () => {
    const linha = montarRegistro01({
      TIPREG: "01",
      CODNEG: "PETRF336",
      TPMERC: "070",
      PREEXE: "0000000003300",
      DATVEN: "20260116",
    });
    expect(linha).toHaveLength(245);
    // Conferência direta das posições 1-based → slice 0-based:
    expect(linha.slice(0, 2)).toBe("01"); // TIPREG 1–2
    expect(linha.slice(12, 24)).toBe("PETRF336    "); // CODNEG 13–24
    expect(linha.slice(24, 27)).toBe("070"); // TPMERC 25–27
    expect(linha.slice(188, 201)).toBe("0000000003300"); // PREEXE 189–201
    expect(linha.slice(202, 210)).toBe("20260116"); // DATVEN 203–210
  });
});

// ── Linhas de exemplo conhecidas ─────────────────────────────────────────────

/**
 * Exemplo CALL — PETRF336 (call de PETR4), pregão 15/06/2026.
 *  - fechamento (PREULT) = R$ 1,23 → inteiro 123, Dec=2
 *  - bid/ask = R$ 1,20 / R$ 1,25 → 120 / 125
 *  - strike (PREEXE) = R$ 33,00 → 3300, Dec=2
 *  - vencimento (DATVEN) = 16/01/2026
 *  - VOLTOT = R$ 3.085.000,00 → inteiro 308500000, Dec=2
 *  - TOTNEG = 1500 negócios; QUATOT = 250000 títulos; FATCOT = 1
 */
const LINHA_CALL = montarRegistro01({
  TIPREG: "01",
  DATAPREGAO: "20260615",
  CODBDI: "78",
  CODNEG: "PETRF336",
  TPMERC: "070",
  NOMRES: "PETROBRAS",
  PREMAX: "0000000000130", // R$ 1,30
  PREULT: "0000000000123", // R$ 1,23 (fechamento)
  PREOFC: "0000000000120", // bid R$ 1,20
  PREOFV: "0000000000125", // ask R$ 1,25
  TOTNEG: "01500",
  QUATOT: "000000000000250000",
  VOLTOT: "000000000308500000", // R$ 3.085.000,00
  PREEXE: "0000000003300", // strike R$ 33,00
  INDOPC: "0",
  DATVEN: "20260116",
  FATCOT: "0000001",
});

/**
 * Exemplo PUT — VALER450 (put de VALE3), mesmo pregão.
 *  - fechamento = R$ 2,50 → 250
 *  - strike = R$ 45,00 → 4500
 *  - vencimento = 16/01/2026
 *  - TPMERC = 080 (put)
 */
const LINHA_PUT = montarRegistro01({
  TIPREG: "01",
  DATAPREGAO: "20260615",
  CODBDI: "82",
  CODNEG: "VALER450",
  TPMERC: "080",
  NOMRES: "VALE",
  PREULT: "0000000000250", // R$ 2,50
  PREOFC: "0000000000245",
  PREOFV: "0000000000255",
  TOTNEG: "00300",
  QUATOT: "000000000000050000",
  VOLTOT: "000000000012500000", // R$ 125.000,00
  PREEXE: "0000000004500", // strike R$ 45,00
  INDOPC: "0",
  DATVEN: "20260116",
  FATCOT: "0000001",
});

describe("parseLinhaCotahist — extração de valores conhecidos", () => {
  it("extrai a CALL exatamente como montada", () => {
    const reg = parseLinhaCotahist(LINHA_CALL);
    expect(reg).not.toBeNull();
    if (!reg) return; // estreita o tipo p/ o TS

    expect(reg.tipreg).toBe("01");
    expect(reg.codNeg).toBe("PETRF336"); // texto com trim
    expect(reg.tpMerc).toBe("070");
    expect(reg.tipoOpcao).toBe("CALL");
    expect(reg.nomRes).toBe("PETROBRAS");
    expect(reg.preUlt).toBe(1.23); // fechamento, Dec=2
    expect(reg.preMax).toBe(1.3);
    expect(reg.preOfc).toBe(1.2); // bid
    expect(reg.preOfv).toBe(1.25); // ask
    expect(reg.totNeg).toBe(1500);
    expect(reg.quaTot).toBe(250000);
    expect(reg.volTot).toBe(3_085_000); // Dec=2 → 308500000 / 100
    expect(reg.preExe).toBe(33); // strike R$ 33,00
    expect(reg.fatCot).toBe(1);

    // DATAPREGAO 15/06/2026 e DATVEN 16/01/2026, ambos em UTC.
    expect(reg.dataPregao.getUTCFullYear()).toBe(2026);
    expect(reg.dataPregao.getUTCMonth()).toBe(5); // junho (0-based)
    expect(reg.dataPregao.getUTCDate()).toBe(15);
  });

  it("extrai a PUT exatamente como montada", () => {
    const reg = parseLinhaCotahist(LINHA_PUT);
    expect(reg).not.toBeNull();
    if (!reg) return;

    expect(reg.tpMerc).toBe("080");
    expect(reg.tipoOpcao).toBe("PUT");
    expect(reg.codNeg).toBe("VALER450");
    expect(reg.preUlt).toBe(2.5);
    expect(reg.preExe).toBe(45); // strike R$ 45,00
    expect(reg.volTot).toBe(125_000);
  });
});

describe("parseLinhaCotahist — regras de parsing pontuais", () => {
  it("decimal implícito: PREEXE com Dec=2 divide o inteiro por 100", () => {
    // "0000000003300" (13 dígitos) representa 3300 centavos → R$ 33,00.
    const reg = parseLinhaCotahist(LINHA_CALL);
    expect(reg?.preExe).toBe(33.0);

    // Outra magnitude, para deixar o /100 explícito: 1234 → R$ 12,34.
    const linha = montarRegistro01({
      TIPREG: "01",
      DATAPREGAO: "20260615",
      CODNEG: "TESTE",
      TPMERC: "070",
      PREEXE: "0000000001234",
      DATVEN: "20260116",
      FATCOT: "0000001",
    });
    expect(parseLinhaCotahist(linha)?.preExe).toBe(12.34);
  });

  it('data: DATVEN "20260116" vira 16/01/2026 (UTC)', () => {
    const reg = parseLinhaCotahist(LINHA_CALL);
    const dv = reg?.datVen;
    expect(dv).toBeInstanceOf(Date);
    expect(dv?.getUTCFullYear()).toBe(2026);
    expect(dv?.getUTCMonth()).toBe(0); // janeiro (0-based)
    expect(dv?.getUTCDate()).toBe(16);
  });

  it("DATVEN zerado (papel sem vencimento) vira null, sem lançar", () => {
    const linha = montarRegistro01({
      TIPREG: "01",
      DATAPREGAO: "20260615",
      CODNEG: "PETR4",
      TPMERC: "010", // à vista
      DATVEN: "00000000",
      FATCOT: "0000001",
    });
    const reg = parseLinhaCotahist(linha);
    expect(reg?.datVen).toBeNull();
    expect(reg?.tipoOpcao).toBeNull(); // 010 não é call/put
  });
});

describe("isOpcaoDeInteresse — filtro de ingestão", () => {
  it("é true para call (070) e put (080)", () => {
    expect(isOpcaoDeInteresse(LINHA_CALL)).toBe(true);
    expect(isOpcaoDeInteresse(LINHA_PUT)).toBe(true);
  });

  it("é false para mercado à vista (010) e para linha de tamanho errado", () => {
    const aVista = montarRegistro01({
      TIPREG: "01",
      CODNEG: "PETR4",
      TPMERC: "010",
    });
    expect(isOpcaoDeInteresse(aVista)).toBe(false);
    expect(isOpcaoDeInteresse("linha curta")).toBe(false);
  });
});

describe("parseLinhaCotahist — política de erros", () => {
  it("linha de tamanho errado → null (roteamento, não erro)", () => {
    expect(parseLinhaCotahist("")).toBeNull();
    expect(parseLinhaCotahist("01 linha muito curta")).toBeNull();
    expect(parseLinhaCotahist(LINHA_CALL + "X")).toBeNull(); // 246 chars
  });

  it("TIPREG ≠ 01 (header 00 / trailer 99) → null", () => {
    const header = "00" + " ".repeat(TAMANHO_REGISTRO - 2);
    const trailer = "99" + " ".repeat(TAMANHO_REGISTRO - 2);
    expect(parseLinhaCotahist(header)).toBeNull();
    expect(parseLinhaCotahist(trailer)).toBeNull();
  });

  it("ignora o terminador CRLF (registro continua válido)", () => {
    const reg = parseLinhaCotahist(LINHA_CALL + "\r\n");
    expect(reg?.codNeg).toBe("PETRF336");
  });

  it("campo numérico ilegível em registro 01 → lança CotahistCampoInvalidoError", () => {
    // Injeta letras onde PREEXE (189–201) espera dígitos — sintoma de byte-shift.
    const corrompida =
      LINHA_CALL.slice(0, 188) + "ABCDEFGHIJKLM" + LINHA_CALL.slice(201);
    expect(corrompida).toHaveLength(245);
    expect(() => parseLinhaCotahist(corrompida)).toThrow(
      CotahistCampoInvalidoError,
    );
    try {
      parseLinhaCotahist(corrompida);
    } catch (e) {
      expect((e as CotahistCampoInvalidoError).campo).toBe("PREEXE");
    }
  });

  it("data inválida (mês 13) em registro 01 → lança", () => {
    const linha = montarRegistro01({
      TIPREG: "01",
      DATAPREGAO: "20260615",
      CODNEG: "TESTE",
      TPMERC: "070",
      PREEXE: "0000000003300",
      DATVEN: "20261316", // mês 13 → impossível
      FATCOT: "0000001",
    });
    expect(() => parseLinhaCotahist(linha)).toThrow(CotahistCampoInvalidoError);
  });
});

// ── Ações à vista ────────────────────────────────────────────────────────────

/**
 * Exemplo AÇÃO À VISTA — PETR4, lote-padrão (CODBDI 02 + TPMERC 010), pregão
 * 15/06/2026. PREEXE e DATVEN ZERADOS (ação não tem strike nem vencimento).
 *  - fechamento (PREULT) = R$ 38,50 → 3850
 *  - volume (VOLTOT) = R$ 12.000.000,00 → 1200000000
 *  - 8000 negócios; 1.500.000 títulos.
 */
const LINHA_ACAO = montarRegistro01({
  TIPREG: "01",
  DATAPREGAO: "20260615",
  CODBDI: "02", // LOTE PADRAO (tabela CODBDI, pág. 7/10)
  CODNEG: "PETR4",
  TPMERC: "010", // VISTA (tabela TPMERC, pág. 10/10)
  NOMRES: "PETROBRAS",
  PREULT: "0000000003850", // R$ 38,50
  PREOFC: "0000000003849",
  PREOFV: "0000000003851",
  TOTNEG: "08000",
  QUATOT: "000000000001500000",
  VOLTOT: "000000001200000000", // R$ 12.000.000,00
  FATCOT: "0000001",
  // PREEXE e DATVEN omitidos → "000…0" (zeros).
});

describe("parseRegistroAcao — extração de ação à vista", () => {
  it("extrai ticker, fechamento e volume corretos", () => {
    const reg = parseRegistroAcao(LINHA_ACAO);
    expect(reg).not.toBeNull();
    if (!reg) return;

    expect(reg.codNeg).toBe("PETR4");
    expect(reg.tpMerc).toBe("010");
    expect(reg.codBdi).toBe("02");
    expect(reg.preUlt).toBe(38.5); // fechamento
    expect(reg.preOfc).toBe(38.49); // bid
    expect(reg.preOfv).toBe(38.51); // ask
    expect(reg.totNeg).toBe(8000);
    expect(reg.quaTot).toBe(1_500_000);
    expect(reg.volTot).toBe(12_000_000); // Dec=2
    expect(reg.dataPregao.getUTCFullYear()).toBe(2026);
    expect(reg.dataPregao.getUTCDate()).toBe(15);
  });

  it("NÃO produz strike nem vencimento espúrios (a struct nem os tem)", () => {
    const reg = parseRegistroAcao(LINHA_ACAO);
    expect(reg).not.toBeNull();
    if (!reg) return;
    // PREEXE/DATVEN vinham zerados; a row de ação não os carrega.
    expect("preExe" in reg).toBe(false);
    expect("datVen" in reg).toBe(false);
    expect("tipoOpcao" in reg).toBe(false);
  });

  it("retorna null para tamanho errado / TIPREG ≠ 01", () => {
    expect(parseRegistroAcao("curta")).toBeNull();
    expect(parseRegistroAcao("00" + " ".repeat(243))).toBeNull();
  });

  /**
   * REGRESSÃO da ingestão real de 2025: ação à vista de PAPEL LÍQUIDO tem QUATOT
   * (qtd. de títulos) e VOLTOT (volume) GIGANTES — centenas de milhões / bilhões,
   * preenchendo quase todos os 18 dígitos do campo. Os exemplos sintéticos usavam
   * valores pequenos; este usa magnitudes REAIS (BPAC11) para garantir que o
   * parser NÃO estoura (nem com `Number`/`toFixed`) e extrai ticker e fechamento.
   */
  it("parseia ação real de alto volume (BPAC11) sem lançar e extrai ticker/fechamento", () => {
    const linha = montarRegistro01({
      TIPREG: "01",
      DATAPREGAO: "20250407",
      CODBDI: "02",
      CODNEG: "BPAC11",
      TPMERC: "010",
      NOMRES: "BTG PACTUAL",
      PREULT: "0000000003456", // R$ 34,56 (fechamento)
      PREOFC: "0000000003455",
      PREOFV: "0000000003457",
      TOTNEG: "45678",
      QUATOT: "000000123456789012", // ~1,23e11 títulos (campo quase cheio)
      VOLTOT: "000000098765432100", // R$ 987.654.321,00 de volume
      FATCOT: "0000001",
    });

    expect(() => parseRegistroAcao(linha)).not.toThrow();

    const reg = parseRegistroAcao(linha);
    expect(reg).not.toBeNull();
    if (!reg) return;
    expect(reg.codNeg).toBe("BPAC11");
    expect(reg.preUlt).toBe(34.56); // fechamento
    expect(reg.quaTot).toBe(123456789012);
    expect(reg.volTot).toBe(987654321); // 98765432100 / 100 (Dec=2)
  });
});

describe("discriminadores opção vs ação — mutuamente exclusivos", () => {
  it("uma ação NÃO é vista como opção, e vice-versa", () => {
    // Ação à vista: é ação, não é opção.
    expect(isAcaoVistaLotePadrao(LINHA_ACAO)).toBe(true);
    expect(isOpcaoDeInteresse(LINHA_ACAO)).toBe(false);

    // Opção (CALL/PUT): é opção, não é ação à vista.
    expect(isOpcaoDeInteresse(LINHA_CALL)).toBe(true);
    expect(isAcaoVistaLotePadrao(LINHA_CALL)).toBe(false);
    expect(isAcaoVistaLotePadrao(LINHA_PUT)).toBe(false);
  });

  it("à vista FRACIONÁRIO (TPMERC 020) ou CODBDI ≠ 02 não conta como ação-objeto", () => {
    const fracionario = montarRegistro01({
      TIPREG: "01",
      DATAPREGAO: "20260615",
      CODBDI: "96", // fracionário
      CODNEG: "PETR4F",
      TPMERC: "020",
    });
    expect(isAcaoVistaLotePadrao(fracionario)).toBe(false);

    // Vista (010) mas CODBDI fora de 02 (ex.: 10 = direitos/recibos) → fora.
    const direitos = montarRegistro01({
      TIPREG: "01",
      DATAPREGAO: "20260615",
      CODBDI: "10",
      CODNEG: "PETR1",
      TPMERC: "010",
    });
    expect(isAcaoVistaLotePadrao(direitos)).toBe(false);
  });
});
