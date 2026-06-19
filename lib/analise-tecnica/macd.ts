/**
 * analise-tecnica/macd — MACD (Moving Average Convergence Divergence). Módulo PURO.
 *
 * Definição padrão: linha = EMA(rápida) − EMA(lenta); sinal = EMA(linha);
 * histograma = linha − sinal. Tudo com EMA (não SMA), conforme a definição
 * clássica de Appel. Cada EMA é semeada com a SMA dos primeiros `periodo` pontos.
 *
 * As três séries saem alinhadas ao array de entrada, com `null` no warmup.
 */

import type { ResultadoMacd, SerieIndicador } from "./tipos";

/**
 * EMA alinhada ao array de entrada. Semente = SMA dos primeiros `periodo` valores
 * (colocada no índice `periodo - 1`); daí em diante a recursão exponencial padrão
 * com fator k = 2 / (periodo + 1). `null` no warmup. Exportada para teste/reuso.
 */
export function emaSerie(valores: number[], periodo: number): SerieIndicador {
  if (!Array.isArray(valores)) {
    throw new TypeError("valores deve ser um array de números");
  }
  if (!Number.isInteger(periodo) || periodo <= 0) {
    throw new RangeError(`periodo deve ser inteiro positivo, recebi ${periodo}`);
  }

  const n = valores.length;
  const saida: SerieIndicador = new Array(n).fill(null);
  if (n < periodo) return saida;

  const k = 2 / (periodo + 1);
  let ema = 0;
  for (let i = 0; i < periodo; i++) ema += valores[i]!;
  ema /= periodo;
  saida[periodo - 1] = ema;
  for (let i = periodo; i < n; i++) {
    ema = valores[i]! * k + ema * (1 - k);
    saida[i] = ema;
  }
  return saida;
}

/**
 * MACD(rapida=12, lenta=26, sinal=9). Devolve `{ linha, sinal, histograma }`,
 * cada um alinhado ao array de entrada.
 *
 * Dado insuficiente vira `null` nas posições afetadas (séries todas em `null` se
 * nem a EMA lenta nasce). Só lança para entrada não-array ou período inválido.
 */
export function macd(
  precos: number[],
  rapida = 12,
  lenta = 26,
  sinal = 9,
): ResultadoMacd {
  if (!Array.isArray(precos)) {
    throw new TypeError("precos deve ser um array de números");
  }

  const n = precos.length;
  const emaRapida = emaSerie(precos, rapida);
  const emaLenta = emaSerie(precos, lenta);

  // Linha MACD: definida só onde AMBAS as EMAs existem (a partir de lenta-1,
  // já que lenta ≥ rápida → a EMA lenta nasce por último).
  const linha: SerieIndicador = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    const r = emaRapida[i];
    const l = emaLenta[i];
    if (r != null && l != null) linha[i] = r - l;
  }

  // Sinal = EMA da linha MACD. A EMA precisa rodar sobre a parte CONTÍGUA não-nula
  // da linha (do índice lenta-1 em diante), depois remapeamos para os índices reais.
  const inicioLinha = Math.max(0, lenta - 1);
  const linhaValida: number[] = [];
  for (let i = inicioLinha; i < n; i++) {
    if (linha[i] != null) linhaValida.push(linha[i]!);
  }
  const sinalValida = emaSerie(linhaValida, sinal);

  const sinalSerie: SerieIndicador = new Array(n).fill(null);
  for (let i = 0; i < sinalValida.length; i++) {
    sinalSerie[inicioLinha + i] = sinalValida[i]!;
  }

  const histograma: SerieIndicador = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    const m = linha[i];
    const s = sinalSerie[i];
    if (m != null && s != null) histograma[i] = m - s;
  }

  return { linha, sinal: sinalSerie, histograma };
}
