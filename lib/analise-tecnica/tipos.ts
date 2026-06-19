/**
 * analise-tecnica/tipos — tipos base do motor de indicadores técnicos (Fase 2-T1).
 *
 * Módulo PURO: estes tipos descrevem só dados de entrada (candles / preços) e de
 * saída (séries de indicadores e níveis). Sem DB, sem UI.
 *
 * NB: NÃO reaproveitamos o tipo `AcaoCotahist` do Drizzle (`db/schema.ts`) de
 * propósito — ele carrega campos de persistência (id, timestamps, bid/ask,
 * volumeFinanceiro…) e numéricos como string. Este `Candle` é o contrato mínimo,
 * puramente numérico, que o motor precisa. A ponte acao_cotahist → Candle é
 * responsabilidade de um passo posterior (camada de dados), não deste módulo.
 */

/** Candle OHLCV de um pregão. `data` em ISO (ex.: "2026-06-18"). */
export interface Candle {
  data: string;
  abertura: number;
  maxima: number;
  minima: number;
  fechamento: number;
  volume: number;
}

/**
 * Série de um indicador alinhada 1:1 ao array de entrada. `null` nos pontos de
 * "warmup" em que ainda não há dado suficiente para o cálculo.
 */
export type SerieIndicador = (number | null)[];

/**
 * Direção de um cruzamento de médias do ponto de vista da média RÁPIDA:
 * - "cima": a rápida cruzou PARA CIMA da lenta (viés comprador / golden-cross).
 * - "baixo": a rápida cruzou PARA BAIXO da lenta (viés vendedor / death-cross).
 */
export type DirecaoCruzamento = "cima" | "baixo";

/** Resultado do MACD: as três séries alinhadas ao array de entrada. */
export interface ResultadoMacd {
  /** Linha MACD = EMA(rápida) − EMA(lenta). */
  linha: SerieIndicador;
  /** Linha de sinal = EMA da linha MACD. */
  sinal: SerieIndicador;
  /** Histograma = linha − sinal. */
  histograma: SerieIndicador;
}

/** Tipo de um nível identificado por pivots. */
export type TipoNivel = "suporte" | "resistencia";

/** Nível de suporte/resistência identificado num candle pivô. */
export interface NivelSR {
  /** Preço do nível (máxima do pivô para resistência, mínima para suporte). */
  preco: number;
  /** Data (ISO) do candle pivô que originou o nível. */
  data: string;
  tipo: TipoNivel;
}

/** Suporte mais próximo abaixo e resistência mais próxima acima de um preço. */
export interface SuporteResistenciaProximos {
  suporte: NivelSR | null;
  resistencia: NivelSR | null;
}

// ── Análise técnica completa (T3 — orquestração) ──────────────────────────────
// Resumo ESTRUTURADO (só números e sinalizações), sem texto de "leitura de
// iniciante" — isso é trabalho de UI/T4. Cada indicador é nulável individualmente:
// com poucos candles, MM200/MACD ainda nascem `null` enquanto MM9/RSI já têm valor.

/** Médias móveis (últimos valores) + cruzamentos recentes entre elas. */
export interface MediasMoveis {
  mm9: number | null;
  mm21: number | null;
  mm50: number | null;
  mm200: number | null;
  /** Cruzamento recente MM9 × MM21 (curto prazo). */
  cruzamento9x21: DirecaoCruzamento | null;
  /** Cruzamento recente MM50 × MM200 (golden/death cross). */
  cruzamento50x200: DirecaoCruzamento | null;
}

/** MACD no ponto mais recente + se a linha cruzou o sinal recentemente. */
export interface MacdResumo {
  linha: number | null;
  sinal: number | null;
  histograma: number | null;
  /** Cruzamento recente da linha MACD × linha de sinal. */
  cruzamento: DirecaoCruzamento | null;
}

/** Pacote técnico completo do ativo, pronto para a UI consumir (sem texto). */
export interface AnaliseTecnica {
  ticker: string;
  /** Data (ISO) do candle mais recente — frescor para a UI carimbar. */
  dataReferencia: string;
  /** Nº de candles usados no cálculo. */
  pontos: number;
  /** Preço atual = fechamento do candle mais recente (mesma fonte do Bloco Técnico). */
  precoAtual: number;
  medias: MediasMoveis;
  rsi14: number | null;
  macd: MacdResumo;
  suporteResistencia: SuporteResistenciaProximos;
}
