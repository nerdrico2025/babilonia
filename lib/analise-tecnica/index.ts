/**
 * analise-tecnica — motor PURO de indicadores técnicos (Fase 2-T1).
 *
 * Recebe arrays de preços/candles JÁ CARREGADOS e devolve números. Sem DB, sem
 * UI, sem efeitos colaterais — mesmo padrão de `lib/options-math` e
 * `lib/analise/fundamentos.ts`. A ponte com `acao_cotahist` vem num passo posterior.
 */

export type {
  Candle,
  SerieIndicador,
  DirecaoCruzamento,
  ResultadoMacd,
  TipoNivel,
  NivelSR,
  SuporteResistenciaProximos,
} from "./tipos";

export { mediaMovelSimples, cruzamentoRecente } from "./medias-moveis";
export { rsi } from "./rsi";
export { macd, emaSerie } from "./macd";
export {
  detectarPivots,
  niveisSuporteResistencia,
  suporteResistenciaProximos,
} from "./suporte-resistencia";
