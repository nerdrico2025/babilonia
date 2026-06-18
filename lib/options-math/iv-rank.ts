/**
 * IV RANK e IV PERCENTIL por ativo-objeto (§8.2 / §9 do PRD).
 *
 * Parte do núcleo `options-math` (§5.1): PURO e TESTADO. Recebe a SÉRIE histórica
 * de IV diária (a `iv_history`, já carregada) + a IV do dia alvo, e devolve
 * { ivRank, ivPercentil, diasNaJanela, estado }. SEM rede, SEM banco. Quem lê do
 * Postgres e chama isto é o orquestrador `scripts/iv-rank.ts`.
 *
 * É a métrica de "opção CARA vs. BARATA" do app: situa a IV de HOJE dentro da
 * sua própria faixa histórica. IV Rank alto ⇒ vol implícita perto do topo do
 * ano ⇒ opções "caras" (favorece estruturas VENDEDORAS de prêmio); IV Rank baixo
 * ⇒ "baratas" (favorece COMPRA). O app só MOSTRA o número — não recomenda (§2.3).
 *
 * ── DEFINIÇÕES (trancadas) ──────────────────────────────────────────────────
 *  • Janela de lookback = os últimos `LOOKBACK` (252) pregões DISPONÍVEIS na série
 *    do ativo. NÃO se exige calendário contínuo: contam-se os pregões que existem
 *    em `iv_history` (dias de gap simplesmente não estão na série). A janela
 *    INCLUI o pregão alvo (ele faz parte do próprio lookback).
 *
 *  • IV Rank = (IV_hoje − IV_min) / (IV_max − IV_min) × 100, onde IV_min e IV_max
 *    são as BORDAS POR PERCENTIL da janela: o **percentil 5** (piso) e o
 *    **percentil 95** (teto) — NÃO o mínimo/máximo CRU. O resultado é CLAMPADO em
 *    [0, 100]: um dia acima do p95 vira 100; abaixo do p5, vira 0.
 *
 *    POR QUE p5/p95 em vez de min/max cru? Robustez a OUTLIER. Um único pregão
 *    com IV extrema (vol real porém excepcional — ex.: MGLU3 ~128%) move o MÁXIMO
 *    cru em cheio e ESMAGA o Rank de todos os outros dias contra a base (todo dia
 *    "normal" pareceria barato para sempre). O p95 quase não se move com UM ponto
 *    extremo (ver teste de robustez), então a régua continua representando a faixa
 *    TÍPICA do ano. O clamp garante que o dia-outlier ainda leia 100 (está, de
 *    fato, no topo), sem distorcer a régua dos demais.
 *
 *  • IV Percentil = % de dias da janela com IV ≤ IV_hoje. Como a janela inclui o
 *    pregão alvo, ele conta a si mesmo (o percentil nunca é exatamente 0 quando o
 *    alvo está na série) — interpretação documentada e consistente.
 *
 * ── TRÊS ESTADOS DE CONFIABILIDADE (regra trancada — não fabricar Rank) ──────
 *  Sobre pouquíssimos pontos um Rank é ruído; por isso o estado é EXPLÍCITO:
 *   • diasNaJanela ≥ 252  → 'completo'     — Rank/Percentil exibidos normalmente.
 *   • 120 ≤ dias < 252    → 'parcial'      — Rank/Percentil calculados, MAS a UI
 *                                            deve avisar "histórico parcial (N dias)".
 *   • dias < 120          → 'insuficiente' — NÃO se calcula Rank nem Percentil
 *                                            (ambos `null`); a UI mostra
 *                                            "histórico insuficiente". Nunca se
 *                                            fabrica métrica sobre base curta.
 *  (Como a janela é capada em 252, `diasNaJanela` = min(252, pregões disponíveis);
 *   logo o estado equivale a olhar quantos pregões o ativo tem em `iv_history`.)
 *
 * O método de percentil é o LINEAR type-7 (mesmo do numpy/`PERCENTILE.INC` do
 * Excel): interpolação entre as posições vizinhas — ver `percentilType7`.
 */

// ── Constantes ──────────────────────────────────────────────────────────────

/** Janela de lookback do IV Rank/Percentil, em pregões (§9). */
export const LOOKBACK = 252;

/** Piso de pregões para 'completo' (= `LOOKBACK`: janela cheia). */
export const DIAS_COMPLETO = 252;

/** Piso de pregões para 'parcial' (abaixo disto é 'insuficiente'). */
export const DIAS_MINIMOS_PARCIAL = 120;

/** Borda inferior da régua do Rank: percentil 5 (robusto a outlier). */
export const PERCENTIL_PISO = 0.05;

/** Borda superior da régua do Rank: percentil 95 (robusto a outlier). */
export const PERCENTIL_TETO = 0.95;

// ── Tipos ───────────────────────────────────────────────────────────────────

/** Um pregão da série histórica de IV (uma linha de `iv_history`). */
export interface PontoIv {
  /** Pregão (fechamento) a que a IV se refere. */
  tradeDate: Date;
  /** IV anualizada em DECIMAL (0.35 = 35% a.a.). */
  iv: number;
}

/** Confiabilidade do Rank conforme o tamanho do histórico disponível. */
export type EstadoIvRank = "completo" | "parcial" | "insuficiente";

/** Resultado do IV Rank/Percentil de um ativo num pregão alvo. */
export interface ResultadoIvRank {
  /**
   * IV Rank em [0, 100], ou `null` quando o estado é 'insuficiente' (base curta
   * demais — não se fabrica número).
   */
  ivRank: number | null;
  /** IV Percentil em [0, 100], ou `null` quando 'insuficiente'. */
  ivPercentil: number | null;
  /** Nº de pregões EFETIVAMENTE na janela (= min(LOOKBACK, disponíveis)). */
  diasNaJanela: number;
  /** Confiabilidade da métrica (define o que a UI exibe/avisa). */
  estado: EstadoIvRank;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Percentil LINEAR type-7 (numpy/`PERCENTILE.INC`) de um array JÁ ORDENADO
 * ascendentemente. `p` em [0, 1]. Interpola entre as posições vizinhas:
 * posição contínua h = (n−1)·p; valor = x[⌊h⌋] + (h−⌊h⌋)·(x[⌊h⌋+1] − x[⌊h⌋]).
 *
 * Pré-condição: `ordenado.length ≥ 1`.
 */
export function percentilType7(ordenado: readonly number[], p: number): number {
  const n = ordenado.length;
  // Guardas defensivas (o chamador já garante n ≥ 1; satisfaz o strict).
  const primeiro = ordenado[0] ?? 0;
  if (n === 1) return primeiro;

  const h = (n - 1) * p;
  const lo = Math.floor(h);
  const hi = Math.min(lo + 1, n - 1);
  const vLo = ordenado[lo] ?? primeiro;
  const vHi = ordenado[hi] ?? vLo;
  return vLo + (h - lo) * (vHi - vLo);
}

/** Estado de confiabilidade a partir do nº de pregões na janela. */
function estadoPorDias(dias: number): EstadoIvRank {
  if (dias >= DIAS_COMPLETO) return "completo";
  if (dias >= DIAS_MINIMOS_PARCIAL) return "parcial";
  return "insuficiente";
}

/** Limita `x` ao intervalo [min, max]. */
function clamp(x: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, x));
}

// ── API pública ─────────────────────────────────────────────────────────────

/**
 * Calcula IV Rank e IV Percentil de um ativo no pregão alvo. Ver o critério no
 * cabeçalho do módulo.
 *
 * @param serie  Série histórica de IV do ativo (uma entrada por pregão). Não
 *   precisa estar ordenada — a função ordena por `tradeDate` ascendente e usa as
 *   últimas `LOOKBACK` (252) entradas como janela. Espera-se que INCLUA o pregão
 *   alvo (a janela termina nele).
 * @param ivAlvo IV do dia alvo (em decimal) — o ponto que se quer situar.
 * @returns `ResultadoIvRank`. Em 'insuficiente' (janela < 120), `ivRank` e
 *   `ivPercentil` vêm `null` (não se fabrica métrica sobre base curta).
 */
export function calcularIvRank(
  serie: readonly PontoIv[],
  ivAlvo: number,
): ResultadoIvRank {
  // Janela = últimos LOOKBACK pregões disponíveis (ordem cronológica asc).
  const ordenadaPorData = [...serie].sort(
    (a, b) => a.tradeDate.getTime() - b.tradeDate.getTime(),
  );
  const janela = ordenadaPorData.slice(-LOOKBACK);
  const diasNaJanela = janela.length;
  const estado = estadoPorDias(diasNaJanela);

  // 'insuficiente': base curta demais — não se calcula Rank nem Percentil (§2.4).
  if (estado === "insuficiente") {
    return { ivRank: null, ivPercentil: null, diasNaJanela, estado };
  }

  // IV Percentil = % de dias da janela com IV ≤ IV_hoje (inclui o alvo).
  const ivsOrdenadas = janela.map((p) => p.iv).sort((a, b) => a - b);
  const naFaixa = ivsOrdenadas.filter((iv) => iv <= ivAlvo).length;
  const ivPercentil = (naFaixa / diasNaJanela) * 100;

  // IV Rank: régua = [p5, p95] da janela (bordas robustas a outlier).
  const piso = percentilType7(ivsOrdenadas, PERCENTIL_PISO);
  const teto = percentilType7(ivsOrdenadas, PERCENTIL_TETO);
  const amplitude = teto - piso;

  let ivRank: number;
  if (amplitude <= 1e-12) {
    // Régua degenerada (p5 ≈ p95): a IV não tem dispersão na janela. Sem faixa
    // para "caro vs. barato", devolve-se o ponto NEUTRO (50) em vez de dividir
    // por zero. Caso de borda raríssimo (série quase constante).
    ivRank = 50;
  } else {
    ivRank = clamp(((ivAlvo - piso) / amplitude) * 100, 0, 100);
  }

  return { ivRank, ivPercentil, diasNaJanela, estado };
}
