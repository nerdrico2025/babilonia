/**
 * Parser posicional de UMA linha do arquivo COTAHIST (B3) — registro tipo 01.
 *
 * Contrato confirmado em `docs/apis/b3-cotahist.md` (layout de 245 bytes/registro,
 * posições 1-based inclusivas, conferidas contra o PDF oficial da B3). Decisão de
 * fonte em §6.2 do PRD e em `AGENTS.md` (a cadeia de opções vem do COTAHIST EOD).
 *
 * ⚠️ ESTE MÓDULO NÃO BAIXA NADA NEM TOCA O BANCO. É parsing PURO de uma linha em
 * um objeto tipado — o pipeline de ingestão (download → stream → gravação) vem
 * depois e USA este parser. Mantê-lo puro/testável é crítico: um deslocamento de
 * 1 byte corromperia TODOS os strikes e vencimentos silenciosamente, e esse dado
 * alimenta o `options-math` (§5.1). Por isso nada aqui "chuta" número: campo
 * numérico ilegível em registro 01 **lança erro** (ver "Política de erros").
 *
 * Política de erros (decisão consciente — §2.4 "nunca inventar"):
 *  - Linha que NÃO é um registro tipo 01 que processamos (tamanho ≠ 245, ou
 *    TIPREG ≠ "01" — header `00`, trailer `99`, linha em branco/parcial) →
 *    `parseLinhaCotahist` retorna `null`. Isso é uma decisão de ROTEAMENTO, não
 *    um erro: a ingestão itera o arquivo inteiro e simplesmente PULA o que não é
 *    cotação (`if (!reg) continue`).
 *  - Campo numérico/data ILEGÍVEL dentro de uma linha 245-bytes TIPREG=01 (ex.:
 *    letras onde deviam vir dígitos — sintoma clássico de byte-shift) → LANÇA
 *    `CotahistCampoInvalidoError`. É corrupção real de dado: a ingestão deve
 *    falhar alto / quarentenar a linha, JAMAIS persistir um strike-lixo.
 */

// ── Constantes de layout e domínio ───────────────────────────────────────────

/** Tamanho fixo do registro, em bytes/caracteres (sem o CRLF). */
export const TAMANHO_REGISTRO = 245;

/** TIPREG do registro de cotação (o único que parseamos). */
export const TIPREG_COTACAO = "01";

/** TPMERC — opções de COMPRA (CALL). */
export const TPMERC_CALL = "070";
/** TPMERC — opções de VENDA (PUT). */
export const TPMERC_PUT = "080";
/**
 * TPMERC — mercado À VISTA (`010` = "VISTA" na tabela TPMERC do PDF, pág. 10/10,
 * Revisão 02). Usado para capturar o preço do ATIVO-OBJETO (necessário para o
 * IV Rank — decisão 2026-06-17 de usar o próprio COTAHIST como histórico de spot).
 */
export const TPMERC_VISTA = "010";
/**
 * CODBDI — LOTE PADRÃO (`02` = "LOTE PADRAO" na tabela CODBDI do PDF, pág. 7/10,
 * Revisão 02). Combinado com `TPMERC=010`, identifica a ação à vista no lote
 * redondo — excluindo fracionário (CODBDI 96 / TPMERC 020), direitos/recibos
 * (CODBDI 10), etc., que NÃO são o ativo-objeto que queremos.
 */
export const CODBDI_LOTE_PADRAO = "02";

/**
 * Tamanho do contrato de opção de ação na B3 = **100 ações por contrato**. NÃO
 * vem no arquivo (é convenção de mercado); registrado aqui como constante para o
 * cálculo de prêmio/risco por contrato (ver nota de `FATCOT` no doc).
 */
export const ACOES_POR_CONTRATO = 100;

// ── Tipos ────────────────────────────────────────────────────────────────────

/** CALL para TPMERC 070, PUT para 080; `null` para qualquer outro mercado. */
export type TipoOpcao = "CALL" | "PUT";

/**
 * Registro tipo 01 do COTAHIST já parseado e com decimais corrigidos.
 *
 * Convenções:
 *  - Preços (`pre*`) e `volTot` em **BRL** já dividido pelo decimal implícito.
 *  - `totNeg`, `quaTot`, `fatCot` são inteiros (contagens/fator).
 *  - Datas em `Date` (UTC, à meia-noite) — ver `parseDataAaaammdd`.
 *  - `datVen` é `null` quando vem zerado (papel sem vencimento, ex.: à vista).
 *  - `tipoOpcao` derivado de `tpMerc` (conveniência); `null` se não for 070/080.
 */
export interface RegistroCotahist {
  /** TIPREG — sempre `"01"` aqui (filtrado na entrada). */
  readonly tipreg: typeof TIPREG_COTACAO;
  /** DATAPREGAO — data do pregão (fechamento que originou o dado). */
  readonly dataPregao: Date;
  /** CODBDI — segmento do papel (informativo; o filtro confiável é TPMERC). */
  readonly codBdi: string;
  /** CODNEG — código de negociação (ticker), com `trim`. */
  readonly codNeg: string;
  /** TPMERC — tipo de mercado (`"070"` call, `"080"` put, `"010"` à vista…). */
  readonly tpMerc: string;
  /** NOMRES — nome resumido do emissor (ajuda a ligar a opção ao objeto), `trim`. */
  readonly nomRes: string;
  /** PREABE — preço de abertura (BRL). */
  readonly preAbe: number;
  /** PREMAX — preço máximo (BRL). */
  readonly preMax: number;
  /** PREMIN — preço mínimo (BRL). */
  readonly preMin: number;
  /** PREMED — preço médio (BRL). */
  readonly preMed: number;
  /** PREULT — preço do último negócio = **fechamento** (BRL). */
  readonly preUlt: number;
  /** PREOFC — melhor oferta de compra (bid, BRL). */
  readonly preOfc: number;
  /** PREOFV — melhor oferta de venda (ask, BRL). */
  readonly preOfv: number;
  /** TOTNEG — número de negócios no pregão (liquidez). */
  readonly totNeg: number;
  /** QUATOT — quantidade total de títulos negociados (liquidez). */
  readonly quaTot: number;
  /** VOLTOT — volume financeiro total do pregão (BRL, liquidez). */
  readonly volTot: number;
  /** PREEXE — preço de exercício (strike, BRL). Zerado em papel sem strike. */
  readonly preExe: number;
  /** DATVEN — data de vencimento; `null` quando zerada (sem vencimento). */
  readonly datVen: Date | null;
  /** FATCOT — fator de cotação (1, 1000…). Conferir/ajustar prêmio quando ≠ 1. */
  readonly fatCot: number;
  /** Tipo de opção derivado de TPMERC (`CALL`/`PUT`), ou `null`. */
  readonly tipoOpcao: TipoOpcao | null;
}

/**
 * Registro tipo 01 de uma AÇÃO À VISTA (lote-padrão) já parseado. É um subconjunto
 * do `RegistroCotahist`: ação NÃO tem strike, vencimento nem tipo call/put, então
 * esses campos simplesmente NÃO EXISTEM aqui (em vez de virem zerados/espúrios).
 * As posições de byte dos campos são as MESMAS do registro de opção — é o mesmo
 * layout de 245 bytes; muda só o conjunto de campos preenchidos (PDF Rev. 02).
 */
export interface RegistroAcaoCotahist {
  /** TIPREG — sempre `"01"`. */
  readonly tipreg: typeof TIPREG_COTACAO;
  /** DATAPREGAO — data do pregão (fechamento). */
  readonly dataPregao: Date;
  /** CODBDI — segmento; aqui sempre `"02"` (lote padrão). */
  readonly codBdi: string;
  /** CODNEG — ticker da ação (ex.: `"PETR4"`), com `trim`. */
  readonly codNeg: string;
  /** TPMERC — tipo de mercado; aqui sempre `"010"` (à vista). */
  readonly tpMerc: string;
  /** NOMRES — nome resumido do emissor, `trim`. */
  readonly nomRes: string;
  /** PREABE — preço de abertura (BRL). */
  readonly preAbe: number;
  /** PREMAX — preço máximo (BRL). */
  readonly preMax: number;
  /** PREMIN — preço mínimo (BRL). */
  readonly preMin: number;
  /** PREMED — preço médio (BRL). */
  readonly preMed: number;
  /** PREULT — preço do último negócio = **fechamento** (BRL, spot do objeto). */
  readonly preUlt: number;
  /** PREOFC — melhor oferta de compra (bid, BRL). */
  readonly preOfc: number;
  /** PREOFV — melhor oferta de venda (ask, BRL). */
  readonly preOfv: number;
  /** TOTNEG — número de negócios no pregão. */
  readonly totNeg: number;
  /** QUATOT — quantidade total de títulos negociados. */
  readonly quaTot: number;
  /** VOLTOT — volume financeiro total do pregão (BRL). */
  readonly volTot: number;
  /** FATCOT — fator de cotação (1, 1000…). */
  readonly fatCot: number;
}

// ── Erro ─────────────────────────────────────────────────────────────────────

/**
 * Um campo numérico/data de um registro 01 válido (245 bytes, TIPREG=01) está
 * ilegível. Sinaliza corrupção/desalinhamento — NUNCA é engolido como 0 ou NaN.
 */
export class CotahistCampoInvalidoError extends Error {
  constructor(
    /** Nome do campo do layout (ex.: `"PREEXE"`). */
    public readonly campo: string,
    /** Conteúdo bruto fatiado (entre aspas, para depurar o byte-shift). */
    public readonly bruto: string,
  ) {
    super(`COTAHIST: campo ${campo} inválido: "${bruto}"`);
    this.name = "CotahistCampoInvalidoError";
  }
}

// ── Helpers de fatiamento e conversão ────────────────────────────────────────

/**
 * Fatia um campo por posição **1-based inclusiva** (como no PDF da B3). O doc dá
 * `Pos.Ini`/`Pos.Fin` 1-based; `slice` é 0-based e exclusivo no fim → o ajuste
 * fica encapsulado aqui, num único lugar.
 */
function campo(linha: string, posIni: number, posFin: number): string {
  return linha.slice(posIni - 1, posFin);
}

/**
 * Inteiro de um campo numérico zero-preenchido (`/^\d+$/`). Qualquer caractere
 * não-dígito (incl. espaço/letra que vazou de um campo texto por desalinhamento)
 * → `CotahistCampoInvalidoError`. NÃO retorna NaN nem 0 silencioso.
 */
function parseInteiro(bruto: string, nomeCampo: string): number {
  if (!/^\d+$/.test(bruto)) {
    throw new CotahistCampoInvalidoError(nomeCampo, bruto);
  }
  return Number(bruto);
}

/**
 * Número decimal com casas IMPLÍCITAS (coluna `Dec` do layout): o inteiro é
 * dividido por `10^casas`. Ex.: PREULT/PREEXE têm `Dec=2`, então
 * `"0000000003300"` → 3300 → **R$ 33,00**. VOLTOT idem (`Dec=2`).
 */
function parseDecimal(bruto: string, nomeCampo: string, casas: number): number {
  const inteiro = parseInteiro(bruto, nomeCampo);
  return inteiro / 10 ** casas;
}

/**
 * Data `AAAAMMDD` → `Date` em **UTC à meia-noite** (UTC evita que o fuso empurre
 * o dia para 31/12 ou 17/01). Campo todo-zeros (`"00000000"`) → `null` (papel
 * sem essa data). Mês/dia fora de faixa → `CotahistCampoInvalidoError`.
 */
function parseDataAaaammdd(bruto: string, nomeCampo: string): Date | null {
  if (!/^\d{8}$/.test(bruto)) {
    throw new CotahistCampoInvalidoError(nomeCampo, bruto);
  }
  if (bruto === "00000000") return null;

  const ano = Number(bruto.slice(0, 4));
  const mes = Number(bruto.slice(4, 6));
  const dia = Number(bruto.slice(6, 8));

  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) {
    throw new CotahistCampoInvalidoError(nomeCampo, bruto);
  }
  return new Date(Date.UTC(ano, mes - 1, dia));
}

/** Remove apenas o terminador de linha (CR/LF) — o registro em si é largura-fixa. */
function removerQuebraLinha(linha: string): string {
  return linha.replace(/[\r\n]+$/, "");
}

/** Lê TIPREG (posições 1–2) sem validar o resto — usado nos guard-checks. */
function lerTipreg(linha: string): string {
  return campo(linha, 1, 2);
}

// ── API pública ──────────────────────────────────────────────────────────────

/**
 * Diz se a linha é uma OPÇÃO que nos interessa: registro tipo 01 (245 bytes) E
 * TPMERC ∈ {070 CALL, 080 PUT}. Função barata e que NUNCA lança — serve de filtro
 * rápido na ingestão antes de chamar o parser completo. Linha de tamanho errado
 * ou de outro tipo simplesmente retorna `false`.
 */
export function isOpcaoDeInteresse(linha: string): boolean {
  const l = removerQuebraLinha(linha);
  if (l.length !== TAMANHO_REGISTRO) return false;
  if (lerTipreg(l) !== TIPREG_COTACAO) return false;
  const tpMerc = campo(l, 25, 27);
  return tpMerc === TPMERC_CALL || tpMerc === TPMERC_PUT;
}

/**
 * Faz o parse de UMA linha do COTAHIST.
 *
 * @returns `RegistroCotahist` se a linha for um registro tipo 01 de 245 bytes;
 *   `null` se NÃO for (tamanho ≠ 245, ou TIPREG ≠ "01" — header/trailer/branco).
 * @throws {CotahistCampoInvalidoError} se a linha É um registro 01 de 245 bytes
 *   mas tem um campo numérico/data ilegível (corrupção/byte-shift).
 *
 * Ver "Política de erros" no topo do arquivo para o porquê do `null` vs. `throw`.
 */
export function parseLinhaCotahist(linha: string): RegistroCotahist | null {
  const l = removerQuebraLinha(linha);

  // Guard de roteamento: não é o registro que processamos → pula (null).
  if (l.length !== TAMANHO_REGISTRO) return null;
  if (lerTipreg(l) !== TIPREG_COTACAO) return null;

  // ⚠️ O discriminador CALL/PUT é o TPMERC (070/080), NÃO o CODBDI. O CODBDI
  // tem códigos 78/82 que TAMBÉM significam "opção de compra/venda", mas por
  // outro critério (boletim diário) — não usar para isso. Conferido contra o
  // PDF oficial (Revisão 02, 05/10/2020), tabela TPMERC.
  const tpMerc = campo(l, 25, 27);
  const tipoOpcao: TipoOpcao | null =
    tpMerc === TPMERC_CALL ? "CALL" : tpMerc === TPMERC_PUT ? "PUT" : null;

  // A partir daqui é um registro 01 íntegro: campo ruim = corrupção → throw.
  return {
    tipreg: TIPREG_COTACAO,
    dataPregao: parseDataObrigatoria(campo(l, 3, 10), "DATAPREGAO"),
    codBdi: campo(l, 11, 12).trim(),
    codNeg: campo(l, 13, 24).trim(),
    tpMerc,
    nomRes: campo(l, 28, 39).trim(),
    preAbe: parseDecimal(campo(l, 57, 69), "PREABE", 2),
    preMax: parseDecimal(campo(l, 70, 82), "PREMAX", 2),
    preMin: parseDecimal(campo(l, 83, 95), "PREMIN", 2),
    preMed: parseDecimal(campo(l, 96, 108), "PREMED", 2),
    preUlt: parseDecimal(campo(l, 109, 121), "PREULT", 2),
    preOfc: parseDecimal(campo(l, 122, 134), "PREOFC", 2),
    preOfv: parseDecimal(campo(l, 135, 147), "PREOFV", 2),
    totNeg: parseInteiro(campo(l, 148, 152), "TOTNEG"),
    quaTot: parseInteiro(campo(l, 153, 170), "QUATOT"),
    volTot: parseDecimal(campo(l, 171, 188), "VOLTOT", 2),
    // ⚠️ Strike = PREEXE (189–201), em BRL, Dec=2. NÃO confundir com PTOEXE
    // (218–230, Dec=6): aquele é o strike em PONTOS, só para opções
    // referenciadas em dólar — não usamos. Se alguém achar que "o strike está
    // na posição errada", é porque olhou o PTOEXE; o nosso é o PREEXE.
    preExe: parseDecimal(campo(l, 189, 201), "PREEXE", 2),
    datVen: parseDataAaaammdd(campo(l, 203, 210), "DATVEN"),
    fatCot: parseInteiro(campo(l, 211, 217), "FATCOT"),
    tipoOpcao,
  };
}

/** Como `parseDataAaaammdd`, mas exige data preenchida (DATAPREGAO nunca é zero). */
function parseDataObrigatoria(bruto: string, nomeCampo: string): Date {
  const data = parseDataAaaammdd(bruto, nomeCampo);
  if (data === null) throw new CotahistCampoInvalidoError(nomeCampo, bruto);
  return data;
}

// ── Ações à vista (lote-padrão) ──────────────────────────────────────────────

/**
 * Diz se a linha é uma AÇÃO À VISTA no lote-padrão que nos interessa: registro
 * tipo 01 (245 bytes), `TPMERC=010` (vista) E `CODBDI=02` (lote padrão). Como o
 * `isOpcaoDeInteresse`, é barata, NUNCA lança e serve de filtro na ingestão.
 *
 * É MUTUAMENTE EXCLUSIVA com `isOpcaoDeInteresse`: opção tem TPMERC 070/080
 * (nunca 010), então nenhuma linha cai nos dois filtros.
 */
export function isAcaoVistaLotePadrao(linha: string): boolean {
  const l = removerQuebraLinha(linha);
  if (l.length !== TAMANHO_REGISTRO) return false;
  if (lerTipreg(l) !== TIPREG_COTACAO) return false;
  return campo(l, 25, 27) === TPMERC_VISTA && campo(l, 11, 12) === CODBDI_LOTE_PADRAO;
}

/**
 * Faz o parse de UMA linha do COTAHIST como AÇÃO À VISTA.
 *
 * Diferente do `parseLinhaCotahist`, NÃO lê PREEXE (189–201) nem DATVEN
 * (203–210): em ação esses campos vêm zerados e não representam dado — logo a
 * struct de ação não os contém e não há strike/vencimento espúrios.
 *
 * @returns `RegistroAcaoCotahist` se for um registro tipo 01 de 245 bytes; `null`
 *   se NÃO for (tamanho ≠ 245, ou TIPREG ≠ "01"). NÃO valida TPMERC/CODBDI — a
 *   classificação ação-vs-opção é feita pelos discriminadores `is*` na ingestão.
 * @throws {CotahistCampoInvalidoError} campo numérico ilegível (corrupção).
 */
export function parseRegistroAcao(linha: string): RegistroAcaoCotahist | null {
  const l = removerQuebraLinha(linha);

  if (l.length !== TAMANHO_REGISTRO) return null;
  if (lerTipreg(l) !== TIPREG_COTACAO) return null;

  return {
    tipreg: TIPREG_COTACAO,
    dataPregao: parseDataObrigatoria(campo(l, 3, 10), "DATAPREGAO"),
    codBdi: campo(l, 11, 12).trim(),
    codNeg: campo(l, 13, 24).trim(),
    tpMerc: campo(l, 25, 27),
    nomRes: campo(l, 28, 39).trim(),
    preAbe: parseDecimal(campo(l, 57, 69), "PREABE", 2),
    preMax: parseDecimal(campo(l, 70, 82), "PREMAX", 2),
    preMin: parseDecimal(campo(l, 83, 95), "PREMIN", 2),
    preMed: parseDecimal(campo(l, 96, 108), "PREMED", 2),
    preUlt: parseDecimal(campo(l, 109, 121), "PREULT", 2),
    preOfc: parseDecimal(campo(l, 122, 134), "PREOFC", 2),
    preOfv: parseDecimal(campo(l, 135, 147), "PREOFV", 2),
    totNeg: parseInteiro(campo(l, 148, 152), "TOTNEG"),
    quaTot: parseInteiro(campo(l, 153, 170), "QUATOT"),
    volTot: parseDecimal(campo(l, 171, 188), "VOLTOT", 2),
    fatCot: parseInteiro(campo(l, 211, 217), "FATCOT"),
    // PREEXE (189–201) e DATVEN (203–210) NÃO são lidos: em ação vêm zerados.
  };
}
