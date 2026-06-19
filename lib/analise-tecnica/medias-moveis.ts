/**
 * analise-tecnica/medias-moveis — médias móveis simples (SMA) e detecção de
 * cruzamento entre duas médias. Módulo PURO.
 *
 * As funções tratam dado insuficiente com `null`/`null` no retorno (nunca lançam
 * por falta de candles); só lançam para entrada malformada (não-array) ou período
 * inválido — erro de programação, não de dado.
 */

import type { DirecaoCruzamento, SerieIndicador } from "./tipos";

/** Valida que `periodo` é inteiro positivo (uso correto da API). */
function validarPeriodo(periodo: number): void {
  if (!Number.isInteger(periodo) || periodo <= 0) {
    throw new RangeError(`periodo deve ser inteiro positivo, recebi ${periodo}`);
  }
}

/**
 * Média móvel simples de `periodo` pontos, alinhada ao array de entrada.
 *
 * Retorna `null` nos primeiros `periodo - 1` pontos (sem dado suficiente) e a
 * média dos últimos `periodo` fechamentos a partir daí. Genérica: usar com 9, 21,
 * 50, 200 etc. Implementação por janela deslizante (O(n)).
 */
export function mediaMovelSimples(precos: number[], periodo: number): SerieIndicador {
  if (!Array.isArray(precos)) {
    throw new TypeError("precos deve ser um array de números");
  }
  validarPeriodo(periodo);

  const saida: SerieIndicador = [];
  let soma = 0;
  for (let i = 0; i < precos.length; i++) {
    soma += precos[i]!;
    if (i >= periodo) soma -= precos[i - periodo]!;
    saida.push(i >= periodo - 1 ? soma / periodo : null);
  }
  return saida;
}

/**
 * Detecta o cruzamento entre duas médias (rápida × lenta) NO PONTO MAIS RECENTE
 * das séries. Recebe as duas séries já calculadas (ex.: SMA9 e SMA21), alinhadas.
 *
 * Compara os DOIS últimos pontos em que ambas têm valor:
 * - rápida sai de ≤ lenta para > lenta → "cima";
 * - rápida sai de ≥ lenta para < lenta → "baixo";
 * - caso contrário (sem troca de lado, ou dado insuficiente) → `null`.
 *
 * Usa os últimos índices das séries; assume que `rapida` e `lenta` estão alinhadas
 * ao MESMO array de preços (mesmo comprimento). Empate (diferença zero) nos dois
 * pontos não é cruzamento.
 */
export function cruzamentoRecente(
  rapida: SerieIndicador,
  lenta: SerieIndicador,
): DirecaoCruzamento | null {
  if (!Array.isArray(rapida) || !Array.isArray(lenta)) {
    throw new TypeError("rapida e lenta devem ser arrays");
  }
  const n = Math.min(rapida.length, lenta.length);
  if (n < 2) return null;

  const rAtual = rapida[n - 1];
  const rAnterior = rapida[n - 2];
  const lAtual = lenta[n - 1];
  const lAnterior = lenta[n - 2];
  if (rAtual == null || rAnterior == null || lAtual == null || lAnterior == null) {
    return null;
  }

  const difAnterior = rAnterior - lAnterior;
  const difAtual = rAtual - lAtual;
  if (difAnterior <= 0 && difAtual > 0) return "cima";
  if (difAnterior >= 0 && difAtual < 0) return "baixo";
  return null;
}
