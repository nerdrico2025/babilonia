/**
 * IV REPRESENTATIVA diária por ativo-objeto (§6.4 do PRD).
 *
 * Parte do núcleo `options-math` (§5.1): PURO e TESTADO. Recebe o spot, a cadeia
 * de opções DAQUELE pregão (já carregada), a taxa `r` e a data — devolve a IV
 * representativa do dia (ou um GAP com o motivo). SEM rede, SEM banco. Quem
 * carrega do Postgres e persiste é o orquestrador `scripts/calcular-iv.ts`.
 *
 * É a matéria-prima do IV Rank/Percentil (que vem depois): o Rank precisa da
 * série histórica de IV diária. Aqui só calculamos a IV de UM dia.
 *
 * ── CRITÉRIO (decisão trancada — não simplificar) ──────────────────────────
 * Para um ativo num pregão, a IV representativa é a IV da opção ATM do
 * vencimento mais próximo COM LIQUIDEZ:
 *  1. Spot do dia = `preco_fechamento` do ativo (vem em `spot`).
 *  2. Vencimento alvo = o vencimento mais próximo a MAIS de `DIAS_MINIMOS_VENCIMENTO`
 *     (7) dias CORRIDOS do pregão. Pula-se a última semana porque a IV explode
 *     perto do vencimento e contaminaria a série. Sem vencimento > 7 dias → GAP.
 *     NÃO rolamos para um vencimento posterior em busca de liquidez: o alvo é
 *     único (o mais curto > 7 dias). Sem IV válida nele no dia → GAP (não inventa).
 *  3. ATM = strike mais próximo do spot, DENTRO do vencimento alvo.
 *  4. Liquidez mínima EXIGIDA: `volumeFinanceiro > 0` OU `numeroNegocios > 0`.
 *     Séries ilíquidas são descartadas ANTES de escolher a ATM — então "subir
 *     para a próxima mais próxima do dinheiro" sai de graça (a lista já só tem
 *     líquidas, ordenada por proximidade).
 *  5. `r` = Selic contínua do pregão (fornecida pelo orquestrador via BCB-SGS).
 *     `T` em ANOS por DIAS CORRIDOS / 365 (ver `DIAS_POR_ANO` para o porquê).
 *  6. Roda o solver de IV do Black-Scholes. Se ele devolver `null` (prêmio
 *     inviável), tenta a PRÓXIMA série mais ATM (ainda líquida) antes de desistir
 *     do dia. A primeira série que produzir IV vence.
 *
 * ── DESEMPATE (documentado) ────────────────────────────────────────────────
 * Quando duas séries estão igualmente perto do dinheiro (ex.: a call e a put de
 * mesmo strike), preferimos a MAIS LÍQUIDA (mais `numeroNegocios`; empate →
 * maior `volumeFinanceiro`); persistindo o empate, preferimos a CALL; e, por
 * fim, ordem do `optionSymbol` (para ser 100% determinístico). Liquidez primeiro
 * porque uma IV "representativa" deve sair da série que o mercado realmente negocia.
 */

import { volImplicita } from "./black-scholes";
import type { TipoOpcao } from "./index";

// ── Constantes ────────────────────────────────────────────────────────────────

/** Vencimentos a ≤ este nº de dias CORRIDOS são pulados (IV explode na última semana). */
export const DIAS_MINIMOS_VENCIMENTO = 7;

const MS_POR_DIA = 86_400_000;

/**
 * Base de anualização de `T`: DIAS CORRIDOS / 365.
 *
 * Escolha (o critério permite 252/úteis OU 365/corridos): usamos **dias
 * corridos/365** porque (a) não exige um calendário de pregões/feriados para
 * contar dias úteis até um vencimento futuro (que pode cair fora dos dados), e
 * (b) é consistente com o `r` contínuo = ln(1 + Selic anual EFETIVA), que também
 * é base anual-calendário. A diferença prática vs. 252 é ~2% em `T` (≈1% na IV),
 * desprezível para a IV representativa.
 */
export const DIAS_POR_ANO = 365;

// ── Tipos ─────────────────────────────────────────────────────────────────────

/** Uma opção da cadeia DAQUELE pregão, já com números por AÇÃO (BRL). */
export interface OpcaoDoDia {
  /** Ticker da série (ex.: "PETRF336") — vai para a auditoria. */
  optionSymbol: string;
  /** call/put. */
  tipo: TipoOpcao;
  /** Strike, BRL/ação. */
  strike: number;
  /** Prêmio = preço de fechamento, BRL/ação. */
  premio: number;
  /** Vencimento da série. */
  vencimento: Date;
  /** VOLTOT — volume financeiro do pregão (BRL). Liquidez. */
  volumeFinanceiro: number;
  /** TOTNEG — nº de negócios no pregão. Liquidez. */
  numeroNegocios: number;
}

/** Entrada de `calcularIvRepresentativa`. */
export interface ParametrosIvRepresentativa {
  /** Spot do ativo no pregão (preço de fechamento da ação), BRL/ação. */
  spot: number;
  /** Cadeia de opções do ativo NAQUELE pregão (calls e puts, vários vencimentos). */
  cadeia: readonly OpcaoDoDia[];
  /** Taxa livre de risco contínua do pregão (ln(1+Selic)). */
  r: number;
  /** Data do pregão (fechamento). */
  tradeDate: Date;
  /** Sobrescreve o mínimo de dias até o vencimento (default `DIAS_MINIMOS_VENCIMENTO`). */
  diasMinimosVencimento?: number;
}

/** Resultado COM IV — inclui os campos de auditoria (de onde veio o número). */
export interface ResultadoIvRepresentativa {
  iv: number;
  /** Vencimento da série usada. */
  vencimentoUsado: Date;
  /** option_symbol da série que produziu a IV. */
  opcaoUsada: string;
  /** call/put da série usada. */
  tipoUsado: TipoOpcao;
  /** Spot usado (= entrada). */
  spotUsado: number;
  /** `r` contínua usada (= entrada). */
  rUsado: number;
  /** `T` em anos usado no Black-Scholes (dias corridos/365). */
  tAnos: number;
}

/** Por que NÃO foi possível calcular a IV do dia (não grava nada — não inventa). */
export type MotivoGapIv =
  | "spot-invalido"
  | "cadeia-vazia"
  | "sem-vencimento-valido"
  | "sem-serie-liquida-com-iv";

/** Resultado SEM IV — o dia vira um gap, com o motivo (auditável). */
export interface GapIv {
  iv: null;
  motivo: MotivoGapIv;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Diferença em dias corridos (pode ser fracionária) entre dois instantes. */
function diasCorridos(de: Date, ate: Date): number {
  return (ate.getTime() - de.getTime()) / MS_POR_DIA;
}

/**
 * Comparador "mais ATM primeiro": ordena por |strike − spot| crescente e desempata
 * por liquidez (negócios, depois volume), depois call antes de put, depois símbolo.
 */
function ordenarPorAtm(
  spot: number,
): (a: OpcaoDoDia, b: OpcaoDoDia) => number {
  return (a, b) => {
    const da = Math.abs(a.strike - spot);
    const db = Math.abs(b.strike - spot);
    if (Math.abs(da - db) > 1e-9) return da - db;
    if (a.numeroNegocios !== b.numeroNegocios) {
      return b.numeroNegocios - a.numeroNegocios;
    }
    if (Math.abs(a.volumeFinanceiro - b.volumeFinanceiro) > 1e-9) {
      return b.volumeFinanceiro - a.volumeFinanceiro;
    }
    if (a.tipo !== b.tipo) return a.tipo === "call" ? -1 : 1;
    return a.optionSymbol < b.optionSymbol ? -1 : 1;
  };
}

// ── API pública ───────────────────────────────────────────────────────────────

/**
 * Calcula a IV representativa de UM ativo num pregão. Ver o critério no cabeçalho.
 *
 * @returns `ResultadoIvRepresentativa` (com IV + auditoria) ou `GapIv` (com o
 *   motivo). NUNCA inventa: prêmio inviável / falta de liquidez / falta de
 *   vencimento viram gap, não um número.
 */
export function calcularIvRepresentativa(
  p: ParametrosIvRepresentativa,
): ResultadoIvRepresentativa | GapIv {
  const diasMin = p.diasMinimosVencimento ?? DIAS_MINIMOS_VENCIMENTO;

  if (!(p.spot > 0)) return { iv: null, motivo: "spot-invalido" };
  if (p.cadeia.length === 0) return { iv: null, motivo: "cadeia-vazia" };

  // 1) Vencimento alvo: o mais próximo a MAIS de `diasMin` dias corridos.
  const vencimentosValidos = [
    ...new Set(
      p.cadeia
        .filter((o) => diasCorridos(p.tradeDate, o.vencimento) > diasMin)
        .map((o) => o.vencimento.getTime()),
    ),
  ].sort((a, b) => a - b);
  if (vencimentosValidos.length === 0) {
    return { iv: null, motivo: "sem-vencimento-valido" };
  }
  const vencimentoAlvo = vencimentosValidos[0]!;
  const tAnos =
    (vencimentoAlvo - p.tradeDate.getTime()) / MS_POR_DIA / DIAS_POR_ANO;

  // 2) Candidatas: do vencimento alvo, COM liquidez, ordenadas por proximidade
  //    do dinheiro (desempate documentado em `ordenarPorAtm`).
  const candidatas = p.cadeia
    .filter((o) => o.vencimento.getTime() === vencimentoAlvo)
    .filter((o) => o.volumeFinanceiro > 0 || o.numeroNegocios > 0)
    .sort(ordenarPorAtm(p.spot));

  // 3) Primeira candidata (mais ATM e líquida) cujo solver devolve IV vence; se
  //    o prêmio for inviável (solver null), tenta a próxima.
  for (const o of candidatas) {
    const iv = volImplicita({
      tipo: o.tipo,
      S: p.spot,
      K: o.strike,
      T: tAnos,
      r: p.r,
      premio: o.premio,
    });
    if (iv !== null) {
      return {
        iv,
        vencimentoUsado: new Date(vencimentoAlvo),
        opcaoUsada: o.optionSymbol,
        tipoUsado: o.tipo,
        spotUsado: p.spot,
        rUsado: p.r,
        tAnos,
      };
    }
  }

  return { iv: null, motivo: "sem-serie-liquida-com-iv" };
}
