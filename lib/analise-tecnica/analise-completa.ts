/**
 * analise-tecnica/analise-completa — orquestração T1 + T2 (Fase 2-T3).
 *
 * Junta o motor PURO (medias-moveis, rsi, macd, suporte-resistencia) com o
 * repositório de candles (T2) numa função de alto nível: recebe um ticker, busca o
 * histórico EOD e devolve um `AnaliseTecnica` ESTRUTURADO (só números e
 * sinalizações), pronto para a UI. Espelha o precedente do lado fundamentalista
 * (`lib/analise/fundamentos.ts` = leitura completa para a tela).
 *
 * Fronteira: a computação fica num helper PURO (`montarAnaliseTecnica`), separada
 * do I/O (a busca de candles). NÃO gera texto de "leitura de iniciante" — isso é
 * trabalho de UI/T4; aqui só `cruzamento: 'cima' | 'baixo' | null`, nunca frase.
 *
 * Server-only (a busca toca no Postgres via T2) — por isso fica FORA do barrel
 * puro `index.ts`. Quem chama importa direto deste módulo.
 */

import { cruzamentoRecente, mediaMovelSimples } from "./medias-moveis";
import { macd } from "./macd";
import { obterCandles, LIMITE_PADRAO } from "./repositorio";
import { rsi } from "./rsi";
import {
  niveisSuporteResistencia,
  suporteResistenciaProximos,
} from "./suporte-resistencia";
import type {
  AnaliseTecnica,
  Candle,
  MacdResumo,
  MediasMoveis,
  SerieIndicador,
} from "./tipos";

/**
 * Mínimo de candles para entregar QUALQUER análise: os dois indicadores de menor
 * janela são MM9 (precisa de 9) e RSI14 (precisa de 15 = período + 1). Abaixo de
 * 15 nem o mais leve nasce — é ativo novo na watchlist sem histórico, e devolvemos
 * `null` (não lança). MM21/50/200 e MACD ainda podem vir `null` acima disso, cada
 * um conforme sua própria janela.
 */
export const MINIMO_CANDLES = 15;

/** Função de busca de candles (injetável p/ teste; default = T2). */
type BuscarCandles = (
  ticker: string,
  opts?: { limite?: number },
) => Promise<Candle[]>;

/** Último valor de uma série de indicador (warmup/ausência → `null`). */
function ultimoValor(serie: SerieIndicador): number | null {
  return serie.length > 0 ? (serie[serie.length - 1] ?? null) : null;
}

/**
 * Monta o pacote técnico PURO a partir dos candles já carregados (ordem
 * cronológica ascendente). `null` quando há menos de `MINIMO_CANDLES` — o motivo é
 * sempre "histórico insuficiente" (documentado), nunca uma exceção.
 *
 * É puro/sem I/O: roda os MESMOS indicadores do T1 que a UI rodaria à mão — não
 * reimplementa nenhum cálculo, só orquestra e extrai o ponto mais recente.
 */
export function montarAnaliseTecnica(
  ticker: string,
  candles: Candle[],
): AnaliseTecnica | null {
  const pontos = candles.length;
  if (pontos < MINIMO_CANDLES) return null;

  const closes = candles.map((c) => c.fechamento);
  const ultimo = candles[pontos - 1]!;

  // Médias móveis: séries completas (p/ detectar cruzamento) + último valor.
  const serie9 = mediaMovelSimples(closes, 9);
  const serie21 = mediaMovelSimples(closes, 21);
  const serie50 = mediaMovelSimples(closes, 50);
  const serie200 = mediaMovelSimples(closes, 200);
  const medias: MediasMoveis = {
    mm9: ultimoValor(serie9),
    mm21: ultimoValor(serie21),
    mm50: ultimoValor(serie50),
    mm200: ultimoValor(serie200),
    cruzamento9x21: cruzamentoRecente(serie9, serie21),
    cruzamento50x200: cruzamentoRecente(serie50, serie200),
  };

  // RSI(14).
  const rsi14 = ultimoValor(rsi(closes, 14));

  // MACD(12,26,9): último ponto das três linhas + cruzamento linha × sinal.
  const m = macd(closes);
  const macdResumo: MacdResumo = {
    linha: ultimoValor(m.linha),
    sinal: ultimoValor(m.sinal),
    histograma: ultimoValor(m.histograma),
    cruzamento: cruzamentoRecente(m.linha, m.sinal),
  };

  // Suporte/resistência: pivots da janela (252) → mais próximos do preço atual.
  const precoAtual = ultimo.fechamento;
  const niveis = niveisSuporteResistencia(candles);
  const suporteResistencia = suporteResistenciaProximos(niveis, precoAtual);

  return {
    ticker: ticker.toUpperCase(),
    dataReferencia: ultimo.data,
    pontos,
    precoAtual,
    medias,
    rsi14,
    macd: macdResumo,
    suporteResistencia,
  };
}

/**
 * Análise técnica completa do ativo-objeto: busca os 252 candles mais recentes
 * (T2) e roda todos os indicadores do T1. Devolve `null` (sem lançar) quando não
 * há histórico suficiente — ticker novo/sem ingestão.
 *
 * `opts.buscarCandles` é injetável p/ teste (default: `obterCandles` do T2).
 */
export async function analisarTecnico(
  ticker: string,
  opts: { buscarCandles?: BuscarCandles } = {},
): Promise<AnaliseTecnica | null> {
  const buscar = opts.buscarCandles ?? obterCandles;
  const candles = await buscar(ticker, { limite: LIMITE_PADRAO });
  return montarAnaliseTecnica(ticker, candles);
}
