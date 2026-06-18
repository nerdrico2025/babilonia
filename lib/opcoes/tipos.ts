/**
 * Tipos de domínio das OPÇÕES — módulo NEUTRO (§5.1).
 *
 * SÓ TIPOS: sem imports de DB, UI, integrações ou qualquer runtime. É a fonte de
 * verdade do FORMATO da cadeia/gregas/volatilidade, desacoplada da FONTE de dados
 * (hoje OpLab; depois COTAHIST/B3 + Black-Scholes próprio). Por não ter efeitos
 * nem dependências, pode ser importado pelo núcleo puro `options-math` sem violar
 * a pureza, pela UI e pelas integrações — todos falam o mesmo vocabulário.
 *
 * Tipos EXCLUSIVOS de uma fonte específica (ex.: `TaxaJuros`,
 * `OpenInterestIndisponivel` da OpLab) NÃO moram aqui — ficam no módulo da fonte.
 */

// ── Tipo base ────────────────────────────────────────────────────────────────

/**
 * Tipo da opção normalizado para o domínio (CALL/PUT → call/put). Fonte de
 * verdade ÚNICA — reexportada por `lib/options-math` e por `lib/integrations`.
 */
export type TipoOpcao = "call" | "put";

// ── Cadeia de opções ─────────────────────────────────────────────────────────

/**
 * Uma opção da cadeia. SEM gregas/IV (vêm da calculadora BS) e SEM open
 * interest (não existe na fonte — §6.4). Expõe os proxies de liquidez.
 */
export interface OpcaoCadeia {
  /** Ticker exato da opção (ex.: "PETRK221"). */
  symbol: string;
  tipo: TipoOpcao;
  strike: number;
  /** Vencimento (data ISO), como veio da fonte. */
  vencimento: string;
  /** AMERICAN/EUROPEAN, ou null. */
  tipoExercicio: string | null;
  tamanhoContrato: number | null;
  bid: number | null;
  ask: number | null;
  /** Spread ask − bid (≥ 0), proxy de liquidez (§8.3); null se faltar bid/ask. */
  spread: number | null;
  volume: number | null;
  volumeFinanceiro: number | null;
  bidVolume: number | null;
  askVolume: number | null;
  negocios: number | null;
  marketMaker: boolean | null;
}

/** Um vencimento da cadeia, com a grade de strikes (call/put lado a lado). */
export interface SerieVencimento {
  vencimento: string;
  diasAteVencimento: number | null;
  strikes: { strike: number; call: OpcaoCadeia | null; put: OpcaoCadeia | null }[];
}

/** Cadeia de opções estruturada de um ativo-objeto (§6.2). */
export interface CadeiaOpcoes {
  ativo: string;
  /** Preço do ativo-objeto (close/spot), ou null. */
  precoAtivo: number | null;
  /** IV atual do ATIVO (iv_current). IV por opção não vem aqui (§6.4 #3). */
  ivAtual: number | null;
  vencimentos: SerieVencimento[];
  /** Sempre `false`: a fonte não fornece open interest (§6.4 #1). */
  openInterestDisponivel: false;
  /** Sempre `false`: gregas não vêm na cadeia; use a calculadora BS (§6.4 #2). */
  gregasNaCadeia: false;
  /** Explicação da liquidez sem OI (volume + spread + market maker). */
  notaLiquidez: string;
}

// ── Volatilidade do ativo-objeto ──────────────────────────────────────────────

/** Volatilidade do ATIVO-OBJETO — é onde mora o IV Rank (§6.4 #3). */
export interface VolatilidadeAtivo {
  ativo: string;
  ivAtual: number | null;
  ivRank1a: number | null;
  ivPercentil1a: number | null;
  ivRank6m: number | null;
  ivPercentil6m: number | null;
  ewmaAtual: number | null;
  /** Sempre `false`: IV Rank existe só no ativo, nunca por contrato (§6.4 #3). */
  ivRankPorContratoDisponivel: false;
  /**
   * Confiabilidade do IV Rank de 1 ANO (a UI usa para o aviso "histórico
   * parcial/insuficiente", §9). OPCIONAL: a fonte OpLab não preenche (e não precisa
   * mudar). `estado`: 'completo' (≥252 pregões) / 'parcial' (120–251) /
   * 'insuficiente' (<120 → ranks `null`). `diasJanela`: pregões efetivamente na
   * janela. (O 6m não tem badge próprio — herda este aviso.)
   */
  confiabilidade?: {
    estado: "completo" | "parcial" | "insuficiente";
    diasJanela: number;
  };
}

// ── Gregas por opção ──────────────────────────────────────────────────────────

/** Gregas + IV por opção, vindas da calculadora Black-Scholes. */
export interface GregasOpcao {
  symbol: string;
  moneyness: string | null;
  /** Preço teórico Black-Scholes. */
  precoTeorico: number | null;
  delta: number | null;
  gamma: number | null;
  vega: number | null;
  theta: number | null;
  rho: number | null;
  /** Volatilidade implícita da opção (campo `volatility`). */
  iv: number | null;
  /** Probabilidade de exercício (%). */
  probExercicio: number | null;
  spotPrice: number | null;
  strike: number | null;
  margem: number | null;
}

/** Parâmetros da calculadora BS (§6.4 #2). `irate` é a SELIC. */
export interface ParamsGregas {
  /** Ticker exato da opção. */
  symbol: string;
  /** Taxa de juros (%) — SELIC. */
  irate: number;
  /** Volatilidade (%) usada no cálculo. */
  vol?: number;
  spotprice?: number;
  strike?: number;
  premium?: number;
  /** Dias para o vencimento. */
  dtm?: number;
  tipo?: TipoOpcao;
}
