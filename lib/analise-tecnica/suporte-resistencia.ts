/**
 * analise-tecnica/suporte-resistencia — níveis por PIVOTS. Módulo PURO.
 *
 * Pivô de alta (resistência): candle cuja `maxima` é estritamente a MAIOR dentro
 * de uma janela de N candles antes e N depois. Pivô de baixa (suporte): `minima`
 * estritamente a MENOR na mesma janela. A comparação é ESTRITA — um empate dentro
 * da janela desqualifica o candidato (evita "quase pivots" em platôs).
 */

import type {
  Candle,
  NivelSR,
  SuporteResistenciaProximos,
} from "./tipos";

/** Janela default (N candles de cada lado) para confirmar um pivô. */
const N_PADRAO = 5;
/** Janela default de lookback (≈ 1 ano de pregões). */
const LOOKBACK_PADRAO = 252;

/**
 * Detecta os pivots de uma série de candles. Para cada candle com N vizinhos de
 * cada lado, verifica se é máximo/mínimo local estrito. Devolve a lista de níveis
 * na ordem cronológica em que aparecem.
 *
 * Série menor que `2 * n + 1` → devolve `[]` (sem pivô possível), nunca lança por
 * falta de dado. Lança só para entrada não-array ou `n` inválido.
 */
export function detectarPivots(candles: Candle[], n = N_PADRAO): NivelSR[] {
  if (!Array.isArray(candles)) {
    throw new TypeError("candles deve ser um array");
  }
  if (!Number.isInteger(n) || n <= 0) {
    throw new RangeError(`n deve ser inteiro positivo, recebi ${n}`);
  }

  const niveis: NivelSR[] = [];
  for (let i = n; i < candles.length - n; i++) {
    const centro = candles[i]!;
    let ehMaximo = true;
    let ehMinimo = true;
    for (let j = i - n; j <= i + n; j++) {
      if (j === i) continue;
      const vizinho = candles[j]!;
      if (vizinho.maxima >= centro.maxima) ehMaximo = false;
      if (vizinho.minima <= centro.minima) ehMinimo = false;
      if (!ehMaximo && !ehMinimo) break;
    }
    if (ehMaximo) {
      niveis.push({ preco: centro.maxima, data: centro.data, tipo: "resistencia" });
    }
    if (ehMinimo) {
      niveis.push({ preco: centro.minima, data: centro.data, tipo: "suporte" });
    }
  }
  return niveis;
}

/**
 * Níveis de suporte/resistência considerando os últimos `janela` candles (default
 * 252, ou todos se houver menos). Apenas recorta a janela e delega a
 * `detectarPivots`.
 */
export function niveisSuporteResistencia(
  candles: Candle[],
  opcoes: { n?: number; janela?: number } = {},
): NivelSR[] {
  if (!Array.isArray(candles)) {
    throw new TypeError("candles deve ser um array");
  }
  const n = opcoes.n ?? N_PADRAO;
  const janela = opcoes.janela ?? LOOKBACK_PADRAO;
  const recentes = candles.slice(Math.max(0, candles.length - janela));
  return detectarPivots(recentes, n);
}

/**
 * Dado um `precoAtual` e a lista de níveis, identifica o SUPORTE mais próximo
 * abaixo (maior preço entre os níveis < preço atual) e a RESISTÊNCIA mais próxima
 * acima (menor preço entre os níveis > preço atual). Níveis exatamente no preço
 * atual são ignorados. Retorna `null` quando não há nível do lado correspondente.
 */
export function suporteResistenciaProximos(
  niveis: NivelSR[],
  precoAtual: number,
): SuporteResistenciaProximos {
  if (!Array.isArray(niveis)) {
    throw new TypeError("niveis deve ser um array");
  }

  let suporte: NivelSR | null = null;
  let resistencia: NivelSR | null = null;
  for (const nivel of niveis) {
    if (nivel.preco < precoAtual) {
      if (suporte == null || nivel.preco > suporte.preco) suporte = nivel;
    } else if (nivel.preco > precoAtual) {
      if (resistencia == null || nivel.preco < resistencia.preco) resistencia = nivel;
    }
  }
  return { suporte, resistencia };
}
