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
 * ── REVISÃO ANTI-OUTLIER (decisão 2026-06-17, sobre dados reais) ────────────
 * A 1ª versão (prêmio = último negócio; vencimento > 7 dias) gerava outliers que
 * contaminariam o IV Rank: IV até 153% (calls ATM curtas com preço de fechamento
 * obsoleto/alto) e ~3–5% (puts ATM curtas com print velho baixo). Diagnóstico
 * empírico (PETR4):
 *  - o "último negócio" (`preco_fechamento`) fica OBSOLETO em série fina — havia
 *    séries com nº de negócios alto (>50) mas SEM oferta (bid=ask=0) e preço de
 *    fechamento 3× o justo. Nenhum piso de liquidez pega isso.
 *  - na faixa relevante (14–45 dias, líquida), 86% das ATM têm bid E ask, com
 *    spread relativo mediano de ~16% → o MID = (bid+ask)/2 é confiável.
 *  - prazos de 8–14 dias têm T pequeno, que amplifica qualquer erro de prêmio.
 * Correções: (1) prêmio = MID exigindo OFERTA DOS DOIS LADOS (bid>0 e ask>0);
 * (2) vencimento alvo ~30 dias com piso RÍGIDO de 14; (3) piso de liquidez real.
 *
 * ── REVISÃO DE SELEÇÃO DE VENCIMENTO (decisão 2026-06-18, sobre cobertura) ───
 * A revisão anti-outlier consertou a QUALIDADE mas derrubou a COBERTURA (~70% dos
 * dias viraram gap). O diagnóstico (`scripts/diagnostico-iv-gaps.ts`) achou a
 * causa: NÃO é o prêmio nem o piso de liquidez — é a regra "vencimento ÚNICO mais
 * próximo de 30d". A B3 tem opções SEMANAIS; a liquidez se concentra nas MENSAIS
 * (3ª sexta). O alvo de 30d caía sistematicamente numa SEMANAL FINA (maxNeg 1–19)
 * no vão entre duas mensais líquidas (maxNeg na casa dos milhares a ~15d e
 * centenas a ~45–50d). Resultado: o vencimento escolhido não tinha série líquida
 * → gap, embora houvesse uma mensal líquida ao lado (259/259 dias-gap de PETR4
 * eram recuperáveis em OUTRO vencimento ≥14d).
 * Correção: a LIQUIDEZ é o GATE; a proximidade de 30d é só o SELETOR entre os
 * vencimentos que passam. Escolhe-se dentro de uma JANELA de tenor [14, 50] dias
 * (`DIAS_MINIMOS/MAXIMOS_VENCIMENTO`) — larga o bastante para SEMPRE conter ao
 * menos uma mensal líquida (mensais ~30d apart; a 50−14=36 a janela contém ≥1).
 *
 * ── CRITÉRIO (atual) ────────────────────────────────────────────────────────
 *  1. Spot do dia = `preco_fechamento` do ativo (vem em `spot`).
 *  2. JANELA de tenor = vencimentos a [`DIAS_MINIMOS_VENCIMENTO` (14),
 *     `DIAS_MAXIMOS_VENCIMENTO` (50)] dias corridos. Sem nenhum na janela → GAP.
 *  3. GATE de LIQUIDEZ por vencimento: mantém só os vencimentos da janela que têm
 *     ≥ 1 série no piso (`numeroNegocios ≥ NEG_MINIMO` (20) E `volumeFinanceiro ≥
 *     VOLUME_MINIMO` (R$ 50k)). Isso DESCARTA a semanal fina e segura a mensal
 *     líquida. Nenhum vencimento passa no gate → GAP.
 *  4. SELETOR entre os que passam: o mais PRÓXIMO de `DIAS_ALVO_VENCIMENTO` (30)
 *     dias; desempate por MAIOR liquidez (maior `numeroNegocios` da série líquida
 *     mais negociada), depois pelo próprio vencimento (determinístico).
 *  5. ATM = strike mais próximo do spot, DENTRO do vencimento escolhido (entre as
 *     séries líquidas). Desempate documentado em `ordenarPorAtm`.
 *  6. Prêmio = MID = (bid+ask)/2, EXIGINDO bid>0 E ask>0 (oferta dos dois lados)
 *     e spread relativo (ask−bid)/mid ≤ `SPREAD_RELATIVO_MAXIMO` (1,0 = 100%).
 *     Série sem oferta de dois lados ou com spread absurdo é DESCARTADA (é onde
 *     mora o print velho); sobe-se para a próxima ATM.
 *  7. `r` = Selic contínua do pregão (fornecida pelo orquestrador via BCB-SGS).
 *     `T` em ANOS por DIAS CORRIDOS / 365 (ver `DIAS_POR_ANO`).
 *  8. Roda o solver de IV do Black-Scholes com o MID. Se devolver `null` (prêmio
 *     inviável), tenta a PRÓXIMA série mais ATM (ainda líquida/com oferta). Se
 *     NENHUMA série do vencimento escolhido produzir IV, cai para o PRÓXIMO
 *     vencimento na ordem de prioridade (degradação graciosa, guardas
 *     INALTERADAS). Esgotados todos → GAP (não inventa, §2.4).
 *
 * ── DESEMPATE (documentado) ────────────────────────────────────────────────
 * Séries igualmente perto do dinheiro: preferimos a MAIS LÍQUIDA (mais
 * `numeroNegocios`; empate → maior `volumeFinanceiro`); persistindo, a CALL; por
 * fim, ordem do `optionSymbol` (determinístico).
 */

import { volImplicita } from "./black-scholes";
import type { TipoOpcao } from "./index";

// ── Constantes (defaults; sobrescrevíveis nos parâmetros) ───────────────────────

/** Vencimento alvo: o mais próximo deste nº de dias corridos. */
export const DIAS_ALVO_VENCIMENTO = 30;

/** Piso RÍGIDO de dias corridos até o vencimento (nunca usar < isto). */
export const DIAS_MINIMOS_VENCIMENTO = 14;

/**
 * Teto da JANELA de tenor (dias corridos). Junto com o piso de 14, define a faixa
 * [14, 50] de onde se escolhe o vencimento. 50 é largo o bastante para SEMPRE
 * conter ao menos uma MENSAL líquida (no diagnóstico, mensais a ~15d e ~45–50d):
 * com mensais ~30d apart e janela de 36 dias úteis de largura, há sempre ≥ 1.
 */
export const DIAS_MAXIMOS_VENCIMENTO = 50;

/** Piso de liquidez: nº mínimo de negócios na série escolhida. */
export const NEG_MINIMO = 20;

/** Piso de liquidez: volume financeiro mínimo (BRL) na série escolhida. */
export const VOLUME_MINIMO = 50_000;

/**
 * Spread relativo máximo aceito na série: (ask−bid)/mid. Acima disso a oferta é
 * larga demais para um MID confiável → descarta. 1,0 = o spread iguala o mid (a
 * oferta de venda é o dobro da de compra) — claramente intratável.
 */
export const SPREAD_RELATIVO_MAXIMO = 1.0;

const MS_POR_DIA = 86_400_000;

/**
 * Base de anualização de `T`: DIAS CORRIDOS / 365.
 *
 * Escolha (o critério permite 252/úteis OU 365/corridos): usamos **dias
 * corridos/365** porque (a) não exige um calendário de pregões/feriados para
 * contar dias úteis até um vencimento futuro (que pode cair fora dos dados), e
 * (b) é consistente com o `r` contínuo = ln(1 + Selic anual EFETIVA), que também
 * é base anual-calendário. A diferença prática vs. 252 é ~2% em `T` (≈1% na IV).
 */
export const DIAS_POR_ANO = 365;

// ── Tipos ─────────────────────────────────────────────────────────────────────

/** Uma opção da cadeia DAQUELE pregão, com bid/ask por AÇÃO (BRL). */
export interface OpcaoDoDia {
  /** Ticker da série (ex.: "PETRF336") — vai para a auditoria. */
  optionSymbol: string;
  /** call/put. */
  tipo: TipoOpcao;
  /** Strike, BRL/ação. */
  strike: number;
  /** PREOFC — melhor oferta de COMPRA (bid), BRL/ação. 0 = sem oferta. */
  bid: number;
  /** PREOFV — melhor oferta de VENDA (ask), BRL/ação. 0 = sem oferta. */
  ask: number;
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
  /** Vencimento alvo em dias corridos (default `DIAS_ALVO_VENCIMENTO`). */
  diasAlvo?: number;
  /** Piso rígido de dias até o vencimento (default `DIAS_MINIMOS_VENCIMENTO`). */
  diasMinimos?: number;
  /** Teto da janela de tenor em dias corridos (default `DIAS_MAXIMOS_VENCIMENTO`). */
  diasMaximos?: number;
  /** Piso de nº de negócios (default `NEG_MINIMO`). */
  negMinimo?: number;
  /** Piso de volume financeiro BRL (default `VOLUME_MINIMO`). */
  volumeMinimo?: number;
  /** Spread relativo máximo (default `SPREAD_RELATIVO_MAXIMO`). */
  spreadMaximo?: number;
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
  /** Prêmio MID usado no solver (BRL/ação) — input auditável da IV. */
  premioUsado: number;
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

/**
 * Prêmio MID de uma série, ou `null` se a oferta não é confiável: precisa de
 * bid>0 E ask>0 (oferta dos dois lados) e spread relativo ≤ `spreadMaximo`.
 */
function midConfiavel(o: OpcaoDoDia, spreadMaximo: number): number | null {
  if (!(o.bid > 0) || !(o.ask > 0)) return null;
  const mid = (o.bid + o.ask) / 2;
  const spreadRel = (o.ask - o.bid) / mid;
  if (spreadRel > spreadMaximo) return null;
  return mid;
}

// ── API pública ───────────────────────────────────────────────────────────────

/**
 * Calcula a IV representativa de UM ativo num pregão. Ver o critério no cabeçalho.
 *
 * @returns `ResultadoIvRepresentativa` (com IV + auditoria) ou `GapIv` (com o
 *   motivo). NUNCA inventa: prêmio inviável / falta de liquidez/oferta / falta
 *   de vencimento viram gap, não um número.
 */
export function calcularIvRepresentativa(
  p: ParametrosIvRepresentativa,
): ResultadoIvRepresentativa | GapIv {
  const diasAlvo = p.diasAlvo ?? DIAS_ALVO_VENCIMENTO;
  const diasMinimos = p.diasMinimos ?? DIAS_MINIMOS_VENCIMENTO;
  const diasMaximos = p.diasMaximos ?? DIAS_MAXIMOS_VENCIMENTO;
  const negMinimo = p.negMinimo ?? NEG_MINIMO;
  const volumeMinimo = p.volumeMinimo ?? VOLUME_MINIMO;
  const spreadMaximo = p.spreadMaximo ?? SPREAD_RELATIVO_MAXIMO;

  if (!(p.spot > 0)) return { iv: null, motivo: "spot-invalido" };
  if (p.cadeia.length === 0) return { iv: null, motivo: "cadeia-vazia" };

  // 1) JANELA de tenor: vencimentos a [diasMinimos, diasMaximos] dias corridos.
  const vencimentosNaJanela = [
    ...new Set(
      p.cadeia
        .filter((o) => {
          const d = diasCorridos(p.tradeDate, o.vencimento);
          return d >= diasMinimos && d <= diasMaximos;
        })
        .map((o) => o.vencimento.getTime()),
    ),
  ];
  if (vencimentosNaJanela.length === 0) {
    return { iv: null, motivo: "sem-vencimento-valido" };
  }

  // 2) GATE de LIQUIDEZ por vencimento: mantém os vencimentos da janela que têm
  //    ≥ 1 série no piso de liquidez (descarta a semanal fina; segura a mensal).
  //    Guarda as candidatas líquidas ordenadas por ATM e a liquidez do vencimento
  //    (maior nº de negócios) para o desempate do seletor.
  const vencsComLiquidez: {
    venc: number;
    candidatas: OpcaoDoDia[];
    liquidez: number;
  }[] = [];
  for (const venc of vencimentosNaJanela) {
    const candidatas = p.cadeia
      .filter((o) => o.vencimento.getTime() === venc)
      .filter(
        (o) =>
          o.numeroNegocios >= negMinimo && o.volumeFinanceiro >= volumeMinimo,
      )
      .sort(ordenarPorAtm(p.spot));
    if (candidatas.length === 0) continue;
    const liquidez = candidatas.reduce(
      (m, o) => Math.max(m, o.numeroNegocios),
      0,
    );
    vencsComLiquidez.push({ venc, candidatas, liquidez });
  }
  if (vencsComLiquidez.length === 0) {
    return { iv: null, motivo: "sem-serie-liquida-com-iv" };
  }

  // 3) SELETOR: ordena os vencimentos que passaram no gate pelo mais próximo de
  //    `diasAlvo`; desempate por maior liquidez, depois pelo próprio vencimento.
  vencsComLiquidez.sort((a, b) => {
    const da = Math.abs(diasCorridos(p.tradeDate, new Date(a.venc)) - diasAlvo);
    const db = Math.abs(diasCorridos(p.tradeDate, new Date(b.venc)) - diasAlvo);
    if (Math.abs(da - db) > 1e-9) return da - db;
    if (a.liquidez !== b.liquidez) return b.liquidez - a.liquidez;
    return a.venc - b.venc;
  });

  // 4) Percorre os vencimentos na ordem de prioridade; dentro de cada um, a 1ª
  //    candidata ATM com MID confiável (dois lados + spread são) cujo solver
  //    devolve IV vence. Esgotado o vencimento, cai para o próximo (degradação
  //    graciosa); esgotados todos → GAP. Guardas de qualidade INALTERADAS.
  for (const { venc, candidatas } of vencsComLiquidez) {
    const tAnos = (venc - p.tradeDate.getTime()) / MS_POR_DIA / DIAS_POR_ANO;
    for (const o of candidatas) {
      const mid = midConfiavel(o, spreadMaximo);
      if (mid === null) continue; // sem oferta de dois lados / spread absurdo
      const iv = volImplicita({
        tipo: o.tipo,
        S: p.spot,
        K: o.strike,
        T: tAnos,
        r: p.r,
        premio: mid,
      });
      if (iv !== null) {
        return {
          iv,
          vencimentoUsado: new Date(venc),
          opcaoUsada: o.optionSymbol,
          tipoUsado: o.tipo,
          spotUsado: p.spot,
          premioUsado: mid,
          rUsado: p.r,
          tAnos,
        };
      }
    }
  }

  return { iv: null, motivo: "sem-serie-liquida-com-iv" };
}
