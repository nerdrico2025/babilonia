/**
 * analise-tecnica/rsi — Índice de Força Relativa (RSI) pelo método de Wilder.
 * Módulo PURO.
 *
 * Suavização de Wilder (não SMA simples): a primeira média de ganhos/perdas é a
 * média aritmética dos primeiros `periodo` deltas; daí em diante cada média é
 * `(media_anterior * (periodo - 1) + valor_atual) / periodo`.
 *
 * Retorna série alinhada ao array de entrada, com `null` durante o warmup (os
 * primeiros `periodo` pontos — precisa de `periodo` variações = `periodo + 1`
 * preços para o primeiro valor).
 */

import type { SerieIndicador } from "./tipos";

/** RSI a partir das médias de ganho/perda já suavizadas. */
function calcularRsi(mediaGanho: number, mediaPerda: number): number {
  // Sem perdas no período. Se também não houve ganho (mercado parado), o RSI é
  // indefinido na teoria — devolvemos 50 (neutro) por convenção, evitando a
  // divisão por zero. Havendo só ganhos, é 100.
  if (mediaPerda === 0) return mediaGanho === 0 ? 50 : 100;
  const rs = mediaGanho / mediaPerda;
  return 100 - 100 / (1 + rs);
}

/**
 * RSI de Wilder com `periodo` configurável (default 14).
 *
 * Trata dado insuficiente devolvendo a série toda em `null`; só lança se `precos`
 * não for array ou `periodo` for inválido.
 */
export function rsi(precos: number[], periodo = 14): SerieIndicador {
  if (!Array.isArray(precos)) {
    throw new TypeError("precos deve ser um array de números");
  }
  if (!Number.isInteger(periodo) || periodo <= 0) {
    throw new RangeError(`periodo deve ser inteiro positivo, recebi ${periodo}`);
  }

  const n = precos.length;
  const saida: SerieIndicador = new Array(n).fill(null);
  if (n < periodo + 1) return saida;

  // Primeira média = média aritmética dos `periodo` primeiros deltas.
  let ganhos = 0;
  let perdas = 0;
  for (let i = 1; i <= periodo; i++) {
    const delta = precos[i]! - precos[i - 1]!;
    if (delta > 0) ganhos += delta;
    else perdas -= delta;
  }
  let mediaGanho = ganhos / periodo;
  let mediaPerda = perdas / periodo;
  saida[periodo] = calcularRsi(mediaGanho, mediaPerda);

  // Suavização de Wilder para os pontos seguintes.
  for (let i = periodo + 1; i < n; i++) {
    const delta = precos[i]! - precos[i - 1]!;
    const ganho = delta > 0 ? delta : 0;
    const perda = delta < 0 ? -delta : 0;
    mediaGanho = (mediaGanho * (periodo - 1) + ganho) / periodo;
    mediaPerda = (mediaPerda * (periodo - 1) + perda) / periodo;
    saida[i] = calcularRsi(mediaGanho, mediaPerda);
  }
  return saida;
}
