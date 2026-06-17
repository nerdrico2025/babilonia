/**
 * black-scholes — motor de PRICING, VOLATILIDADE IMPLÍCITA e GREGAS.
 *
 * Parte do núcleo `options-math` (§5.1 do PRD): PURO e TESTADO. Recebe números,
 * devolve números. SEM efeitos colaterais, SEM UI, SEM banco, SEM rede. Quem
 * busca COTAHIST/SGS é `lib/integrations`; aqui chegam só os parâmetros.
 * Desenho de referência: `docs/design/options-math-black-scholes.md` (§18.1).
 *
 * MODELO: Black-Scholes EUROPEU, SEM dividendos (q = 0) — simplificação CONSCIENTE
 * do MVP. As opções de ações da B3 são AMERICANAS; a revisão (modelo
 * binomial/americano + dividendos) fica para a Fase 3, sem tocar na UI.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * UNIDADES (fixas — não misturar, é a maior fonte de bug):
 *  - `S`     preço do ativo-objeto (spot), BRL, por ação.            (> 0)
 *  - `K`     strike, BRL, por ação.                                  (> 0)
 *  - `T`     tempo até o vencimento, em ANOS, base 252 (= du / 252). (≥ 0)
 *  - `r`     taxa livre de risco CONTÍNUA, ao ano (ex.: ln(1+Selic)).
 *  - `sigma` volatilidade anual, DECIMAL (0.20 = 20%).               (≥ 0)
 *  - `premio` prêmio observado (fechamento), BRL, por ação.
 *
 * Tudo é POR AÇÃO. Tamanho de contrato (100) e FATCOT são tratados fora daqui,
 * na camada de prêmio/ticket — o BS opera por unidade do ativo.
 * ──────────────────────────────────────────────────────────────────────────
 */

import type { TipoOpcao } from "./index";

// Tolerância de preço (BRL) para convergência do solver de IV.
const TOL_PRECO = 1e-10;
// Limites sãos de busca de volatilidade (0,01% a 500% a.a.).
const VOL_MIN = 1e-4;
const VOL_MAX = 5;

/** Parâmetros completos do Black-Scholes (com `sigma` conhecido). */
export interface ParametrosBS {
  tipo: TipoOpcao;
  /** Spot, BRL/ação. */
  S: number;
  /** Strike, BRL/ação. */
  K: number;
  /** Tempo até o vencimento, anos (base 252). */
  T: number;
  /** Taxa livre de risco contínua, a.a. */
  r: number;
  /** Volatilidade anual, decimal. */
  sigma: number;
}

/**
 * Gregas da opção. Convenções (explícitas):
 *  - `delta` — variação do prêmio por +R$ 1,00 no spot. Adimensional;
 *    call ∈ [0, 1], put ∈ [−1, 0].
 *  - `gama` — variação do delta por +R$ 1,00 no spot. Sempre ≥ 0.
 *  - `vega` — variação do prêmio por +1,00 (= +100 p.p.) de volatilidade.
 *    Sempre ≥ 0. Para "por 1 ponto percentual" use `vegaPorPonto` (= vega/100).
 *  - `theta` — variação do prêmio por +1 ANO de passagem de tempo (decaimento;
 *    normalmente ≤ 0 para posição comprada). Para "por pregão" use
 *    `thetaPorPregao` (= theta/252, base 252 — convenção do mercado BR).
 *  - `rho` — variação do prêmio por +1,00 (= +100 p.p.) na taxa de juros.
 */
export interface Gregas {
  delta: number;
  gama: number;
  vega: number;
  theta: number;
  rho: number;
  /** `vega` reexpressa por +1 ponto percentual de vol (= vega / 100). */
  vegaPorPonto: number;
  /** `theta` reexpressa por pregão (= theta / 252, base 252). */
  thetaPorPregao: number;
}

// ── CDF / PDF da normal padrão ────────────────────────────────────────────────

/**
 * PDF da normal padrão: φ(x) = e^(−x²/2) / √(2π).
 */
export function normalPDF(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.SQRT2 / Math.sqrt(Math.PI);
}

/**
 * CDF da normal padrão N(x) = P(Z ≤ x), Z ~ Normal(0,1).
 *
 * Algoritmo de Hart (via G. West, "Better Approximations to Cumulative Normal
 * Functions"): aproximação racional com erro ~1·10⁻¹⁵ — precisão de ponto
 * flutuante. Escolhido (em vez de Abramowitz-Stegun ~7,5e-8) porque o erro da
 * CDF é o limitante da recuperação de `sigma` no solver de IV; com precisão
 * dupla o round-trip de IV fica nítido onde o problema é bem-condicionado.
 */
export function normalCDF(x: number): number {
  const z = Math.abs(x);
  if (z > 37) return x > 0 ? 1 : 0;

  const e = Math.exp(-(z * z) / 2);
  let c: number;
  if (z < 7.07106781186547) {
    let num = 3.52624965998911e-2 * z + 0.700383064443688;
    num = num * z + 6.37396220353165;
    num = num * z + 33.912866078383;
    num = num * z + 112.079291497871;
    num = num * z + 221.213596169931;
    num = num * z + 220.206867912376;
    let den = 8.83883476483184e-2 * z + 1.75566716318264;
    den = den * z + 16.064177579207;
    den = den * z + 86.7807322029461;
    den = den * z + 296.564248779674;
    den = den * z + 637.333633378831;
    den = den * z + 793.826512519948;
    den = den * z + 440.413735824752;
    c = (e * num) / den;
  } else {
    let f = z + 0.65;
    f = z + 4 / f;
    f = z + 3 / f;
    f = z + 2 / f;
    f = z + 1 / f;
    c = e / (f * 2.506628274631);
  }
  // `c` é a cauda superior P(Z ≥ z); ajusta pelo sinal de x.
  return x <= 0 ? c : 1 - c;
}

// ── Helpers internos ──────────────────────────────────────────────────────────

function validar(S: number, K: number, T: number): void {
  if (!(S > 0)) throw new Error("black-scholes: S (spot) deve ser > 0.");
  if (!(K > 0)) throw new Error("black-scholes: K (strike) deve ser > 0.");
  if (T < 0) throw new Error("black-scholes: T (prazo) não pode ser < 0.");
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(Math.max(x, lo), hi);
}

/** Calcula d1 e d2 (exige T > 0 e sigma > 0). */
function d1d2(p: ParametrosBS): { d1: number; d2: number } {
  const vsqrtT = p.sigma * Math.sqrt(p.T);
  const d1 = (Math.log(p.S / p.K) + (p.r + (p.sigma * p.sigma) / 2) * p.T) / vsqrtT;
  return { d1, d2: d1 - vsqrtT };
}

// ── Pricing ───────────────────────────────────────────────────────────────────

/**
 * Preço teórico Black-Scholes (call ou put), europeu, sem dividendos.
 *
 * Bordas:
 *  - `T = 0` (vencido) → valor intrínseco não descontado: max(S−K,0) / max(K−S,0).
 *  - `sigma = 0` (sem vol) → valor intrínseco DESCONTADO ao forward:
 *    max(S − K·e^(−rT), 0) para call; max(K·e^(−rT) − S, 0) para put.
 */
export function precoBS(p: ParametrosBS): number {
  validar(p.S, p.K, p.T);
  const { tipo, S, K, T, r, sigma } = p;

  if (T === 0) {
    return tipo === "call" ? Math.max(S - K, 0) : Math.max(K - S, 0);
  }
  if (sigma <= 0) {
    const fwdK = K * Math.exp(-r * T);
    return tipo === "call" ? Math.max(S - fwdK, 0) : Math.max(fwdK - S, 0);
  }

  const { d1, d2 } = d1d2(p);
  const disc = Math.exp(-r * T);
  return tipo === "call"
    ? S * normalCDF(d1) - K * disc * normalCDF(d2)
    : K * disc * normalCDF(-d2) - S * normalCDF(-d1);
}

// ── Gregas ────────────────────────────────────────────────────────────────────

/**
 * Gregas a partir de `sigma` (ver convenções em {@link Gregas}).
 *
 * Em bordas degeneradas (`T = 0` ou `sigma ≤ 0`) não há valor extrínseco:
 * gama/vega/theta/rho = 0 e o delta vira indicador de moneyness (0/±1).
 */
export function gregas(p: ParametrosBS): Gregas {
  validar(p.S, p.K, p.T);
  const { tipo, S, K, T, r, sigma } = p;

  if (T === 0 || sigma <= 0) {
    // Forward para decidir ITM quando sigma=0 e T>0; spot puro quando T=0.
    const ref = T === 0 ? S - K : S - K * Math.exp(-r * T);
    const itm = tipo === "call" ? ref > 0 : ref < 0;
    const delta = itm ? (tipo === "call" ? 1 : -1) : 0;
    return {
      delta,
      gama: 0,
      vega: 0,
      theta: 0,
      rho: 0,
      vegaPorPonto: 0,
      thetaPorPregao: 0,
    };
  }

  const { d1, d2 } = d1d2(p);
  const sqrtT = Math.sqrt(T);
  const pdf = normalPDF(d1);
  const disc = Math.exp(-r * T);

  const delta = tipo === "call" ? normalCDF(d1) : normalCDF(d1) - 1;
  const gama = pdf / (S * sigma * sqrtT);
  const vega = S * pdf * sqrtT;
  const theta =
    tipo === "call"
      ? -(S * pdf * sigma) / (2 * sqrtT) - r * K * disc * normalCDF(d2)
      : -(S * pdf * sigma) / (2 * sqrtT) + r * K * disc * normalCDF(-d2);
  const rho =
    tipo === "call"
      ? K * T * disc * normalCDF(d2)
      : -K * T * disc * normalCDF(-d2);

  return {
    delta,
    gama,
    vega,
    theta,
    rho,
    vegaPorPonto: vega / 100,
    thetaPorPregao: theta / 252,
  };
}

// ── Volatilidade implícita ────────────────────────────────────────────────────

/** Parâmetros do solver de IV: como o BS, mas com `premio` no lugar de `sigma`. */
export interface ParametrosVolImplicita {
  tipo: TipoOpcao;
  S: number;
  K: number;
  T: number;
  r: number;
  /** Prêmio observado (fechamento), BRL/ação. */
  premio: number;
}

/**
 * Resolve a volatilidade implícita a partir do prêmio observado.
 *
 * Método: Newton-Raphson (usando vega) com FALLBACK para bisseção quando vega→0
 * ou o passo sai dos limites/não converge. Chute inicial de
 * Brenner-Subrahmanyam.
 *
 * NÃO INVENTA (§2.4 do PRD): devolve `null` quando não há IV válida —
 *  - prazo/spot/strike inválidos (≤ 0);
 *  - série SEM negócio (`premio ≤ 0`);
 *  - prêmio ABAIXO do valor intrínseco descontado (no-arbitrage violado);
 *  - prêmio no/acima do limite superior (≥ S para call, ≥ K·e^(−rT) para put) →
 *    vol explodiria;
 *  - prêmio essencialmente igual ao intrínseco (sem valor extrínseco a inverter).
 */
export function volImplicita(p: ParametrosVolImplicita): number | null {
  const { tipo, S, K, T, r, premio } = p;
  if (!(S > 0) || !(K > 0) || !(T > 0)) return null;
  if (!(premio > 0)) return null; // sem negócio / prêmio inválido

  const disc = Math.exp(-r * T);
  const limInf = tipo === "call" ? Math.max(S - K * disc, 0) : Math.max(K * disc - S, 0);
  const limSup = tipo === "call" ? S : K * disc;

  // Fora da faixa sem arbitragem, ou sem valor extrínseco → não há IV.
  if (premio < limInf - 1e-10) return null;
  if (premio <= limInf + 1e-8) return null;
  if (premio >= limSup - 1e-10) return null;

  const preco = (sigma: number): number => precoBS({ tipo, S, K, T, r, sigma });
  const vegaDe = (sigma: number): number => {
    const { d1 } = d1d2({ tipo, S, K, T, r, sigma });
    return S * normalPDF(d1) * Math.sqrt(T);
  };

  // Chute inicial de Brenner-Subrahmanyam (bom para ATM), limitado à faixa sã.
  let sigma = Math.sqrt((2 * Math.PI) / T) * (premio / S);
  if (!Number.isFinite(sigma) || sigma <= 0) sigma = 0.2;
  sigma = clamp(sigma, VOL_MIN, VOL_MAX);

  // 1) Newton-Raphson.
  for (let i = 0; i < 100; i++) {
    const diff = preco(sigma) - premio;
    if (Math.abs(diff) < TOL_PRECO) return sigma;
    const v = vegaDe(sigma);
    if (!Number.isFinite(v) || v < 1e-8) break; // vega ~0 → bisseção
    const proximo = sigma - diff / v;
    if (!Number.isFinite(proximo) || proximo <= VOL_MIN || proximo >= VOL_MAX) {
      break; // saiu da faixa → bisseção
    }
    if (Math.abs(proximo - sigma) < 1e-12) return proximo;
    sigma = proximo;
  }
  if (Math.abs(preco(sigma) - premio) < TOL_PRECO) return sigma;

  // 2) Fallback: bisseção em [VOL_MIN, VOL_MAX]. preço é monotônico em sigma.
  let lo = VOL_MIN;
  let hi = VOL_MAX;
  let pLo = preco(lo) - premio;
  const pHi = preco(hi) - premio;
  if (pLo * pHi > 0) return null; // não há raiz na faixa
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const pMid = preco(mid) - premio;
    if (Math.abs(pMid) < TOL_PRECO) return mid;
    if (pLo * pMid <= 0) {
      hi = mid;
    } else {
      lo = mid;
      pLo = pMid;
    }
  }
  return (lo + hi) / 2;
}
