/**
 * options-math — NÚCLEO do Babilônia.
 *
 * Módulo PURO e TESTADO (§5.1 do PRD): recebe parâmetros (strikes, prêmios,
 * quantidades, tipo) e devolve números. SEM efeitos colaterais, SEM dependência
 * de UI, banco ou rede. É o coração do app — não pode ter bug.
 *
 * Fórmulas de referência das estruturas em §18 do PRD. As ESTRUTURAS NOMEADAS
 * (travas, borboletas, condores…) NÃO são implementadas aqui ainda — este
 * arquivo entrega só o MOTOR GENÉRICO que opera sobre uma lista de pernas.
 *
 * Convenções de unidade (§7, §18):
 *  - `strike` e `premio` são valores POR AÇÃO, em BRL (como cotados na B3).
 *  - `quantidade` é o número de CONTRATOS (lotes).
 *  - Todo resultado financeiro é total em BRL = (valor por ação) ×
 *    quantidade × TAMANHO DO LOTE.
 *
 * Suposição documentada — TAMANHO DO LOTE:
 *  Na B3, as opções sobre ações são negociadas em lote padrão de **100** ações,
 *  e prêmio/strike são cotados por ação. Por isso `TAMANHO_LOTE_PADRAO = 100`.
 *  O valor é PARAMETRIZÁVEL em todas as funções (último argumento `tamanhoLote`)
 *  para cobrir exceções (ex.: opções sobre índice/ETF com multiplicador
 *  diferente) sem alterar o núcleo.
 *
 * As ESTRUTURAS NOMEADAS (travas, borboleta, condor, straddle/strangle, venda
 * coberta) ficam em `./estruturas` e são reexportadas no fim deste arquivo.
 */

// ── Tipos base ───────────────────────────────────────────────────────────────

/** Tipo da opção. */
export type TipoOpcao = "call" | "put";

/** Lado da operação na perna. */
export type LadoOperacao = "compra" | "venda";

/** Perna individual de uma estrutura (§7, §18 do PRD). */
export interface Leg {
  tipo: TipoOpcao;
  lado: LadoOperacao;
  /** Strike em BRL, por ação. */
  strike: number;
  /** Prêmio unitário em BRL, por ação. */
  premio: number;
  /** Quantidade em contratos (lotes). */
  quantidade: number;
}

/** Ponto da curva de payoff (preço do ativo no vencimento → resultado em BRL). */
export interface PontoPayoff {
  /** Preço do ativo-objeto no vencimento (BRL). */
  preco: number;
  /** Resultado financeiro TOTAL da estrutura nesse preço (BRL). */
  resultado: number;
}

/** Faixa de preços a varrer para montar a curva de payoff (§8.4 item 4). */
export interface FaixaPrecos {
  /** Preço mínimo do ativo no vencimento (BRL). */
  min: number;
  /** Preço máximo do ativo no vencimento (BRL). */
  max: number;
  /** Nº de intervalos uniformes da varredura (pontos = passos + 1). Default 50. */
  passos?: number;
  /**
   * Se `true` (default), inclui os "joelhos" da curva (strikes e breakevens
   * dentro da faixa) além da grade uniforme, para a curva passar EXATAMENTE
   * pelos vértices. Use `false` para uma grade estritamente uniforme.
   */
  incluirVertices?: boolean;
}

/**
 * Resumo de risco/retorno de uma estrutura. Risco SEMPRE antes do ganho (§2).
 */
export interface ResumoEstrutura {
  /** Risco máximo em BRL, como número POSITIVO. `Infinity` se indefinido. */
  riscoMaximo: number;
  /** `true` = risco INDEFINIDO/ilimitado; `false` = DEFINIDO (§2, item 2). */
  riscoIndefinido: boolean;
  /** Ganho máximo em BRL. `null` quando ilimitado. */
  ganhoMaximo: number | null;
  /** `true` quando o ganho é ilimitado para cima. */
  ganhoIlimitado: boolean;
  /** Ponto(s) de equilíbrio (preços do ativo), em ordem crescente. */
  breakevens: number[];
}

/** Tamanho do lote padrão da B3 para opções sobre ações (ver cabeçalho). */
export const TAMANHO_LOTE_PADRAO = 100;

// Tolerância para comparações de ponto flutuante (preços/BRL têm centavos).
const EPS = 1e-9;

// ── Payoff ───────────────────────────────────────────────────────────────────

/**
 * Valor intrínseco de UMA opção no vencimento, por ação (sempre ≥ 0):
 *  - call: max(preço − strike, 0)
 *  - put:  max(strike − preço, 0)
 */
export function valorIntrinseco(
  tipo: TipoOpcao,
  strike: number,
  preco: number,
): number {
  return tipo === "call"
    ? Math.max(preco - strike, 0)
    : Math.max(strike - preco, 0);
}

/**
 * Resultado financeiro TOTAL de UMA perna a um preço do ativo no vencimento.
 *
 * Por ação: comprador ganha (intrínseco − prêmio); vendedor ganha o oposto
 * (prêmio − intrínseco). Multiplica-se por quantidade × tamanho do lote.
 */
export function payoffPerna(
  leg: Leg,
  preco: number,
  tamanhoLote: number = TAMANHO_LOTE_PADRAO,
): number {
  const intrinseco = valorIntrinseco(leg.tipo, leg.strike, preco);
  const sinal = leg.lado === "compra" ? 1 : -1;
  return sinal * (intrinseco - leg.premio) * leg.quantidade * tamanhoLote;
}

/**
 * Resultado financeiro TOTAL da estrutura (soma das pernas) a um dado preço.
 * É a base do motor: o payoff de qualquer combinação é a soma das pernas.
 */
export function payoffEstrutura(
  legs: Leg[],
  preco: number,
  tamanhoLote: number = TAMANHO_LOTE_PADRAO,
): number {
  return legs.reduce((acc, leg) => acc + payoffPerna(leg, preco, tamanhoLote), 0);
}

/**
 * Motor genérico: varre uma faixa de preços do ativo no vencimento e devolve a
 * CURVA DE PAYOFF — base do gráfico (§8.4 item 4). Os pontos saem ordenados por
 * preço crescente.
 */
export function curvaPayoff(
  legs: Leg[],
  faixa: FaixaPrecos,
  tamanhoLote: number = TAMANHO_LOTE_PADRAO,
): PontoPayoff[] {
  const { min, max } = faixa;
  if (!(max > min)) {
    throw new Error("curvaPayoff: faixa inválida (max deve ser > min).");
  }
  const passos = faixa.passos ?? 50;
  if (!Number.isInteger(passos) || passos < 1) {
    throw new Error("curvaPayoff: 'passos' deve ser inteiro ≥ 1.");
  }

  // Conjunto de preços a avaliar (dedup por proximidade abaixo).
  const precos: number[] = [];
  for (let i = 0; i <= passos; i++) {
    precos.push(min + ((max - min) * i) / passos);
  }

  // Inclui os "joelhos" da curva (strikes e breakevens) dentro da faixa, para
  // que a poligonal passe exatamente pelos vértices — gráfico fiel aos números.
  if (faixa.incluirVertices !== false) {
    for (const leg of legs) {
      if (leg.strike >= min && leg.strike <= max) precos.push(leg.strike);
    }
    for (const be of breakevens(legs, tamanhoLote)) {
      if (be >= min && be <= max) precos.push(be);
    }
  }

  precos.sort((a, b) => a - b);

  const curva: PontoPayoff[] = [];
  for (const preco of precos) {
    // Dedup: evita pontos repetidos (grade + vértice coincidentes).
    const ultimo = curva[curva.length - 1];
    if (ultimo && Math.abs(ultimo.preco - preco) < EPS) continue;
    curva.push({ preco, resultado: payoffEstrutura(legs, preco, tamanhoLote) });
  }
  return curva;
}

// ── Análise (risco / ganho / breakeven) ──────────────────────────────────────
//
// O payoff de uma soma de opções é uma função CONTÍNUA e LINEAR POR PARTES do
// preço, com "joelhos" (mudanças de inclinação) apenas nos strikes. Logo:
//  - Os extremos finitos só podem ocorrer em S = 0, nos strikes, ou nas caudas.
//  - A cauda S → +∞ tem inclinação constante (só as calls seguem variando):
//    se > 0 → ganho ilimitado; se < 0 → perda ilimitada (risco INDEFINIDO).
//  - O lado S → 0 é limitado (preço não fica negativo).
// Por isso calculamos tudo de forma EXATA a partir desses pontos críticos, em
// vez de inferir de uma amostragem (que poderia "pular" um vértice).

/** Preços críticos a avaliar: 0 e cada strike distinto, em ordem crescente. */
function precosCriticos(legs: Leg[]): number[] {
  const strikes = Array.from(new Set(legs.map((l) => l.strike))).sort(
    (a, b) => a - b,
  );
  return [0, ...strikes];
}

/**
 * Inclinação do payoff TOTAL (BRL por unidade de preço) quando S → +∞.
 * Só as calls continuam "no dinheiro" no infinito; cada call comprada soma
 * +qtd×lote e cada call vendida soma −qtd×lote. Puts não contribuem.
 */
function inclinacaoNoInfinito(legs: Leg[], tamanhoLote: number): number {
  return legs.reduce((acc, leg) => {
    if (leg.tipo !== "call") return acc;
    const sinal = leg.lado === "compra" ? 1 : -1;
    return acc + sinal * leg.quantidade * tamanhoLote;
  }, 0);
}

/**
 * Risco máximo da estrutura (perda máxima), como número POSITIVO em BRL.
 * `indefinido = true` (e `valor = Infinity`) quando a perda cresce sem limite
 * (cauda S → +∞ negativa, ex.: venda de call a descoberto) — §2.
 */
export function riscoMaximo(
  legs: Leg[],
  tamanhoLote: number = TAMANHO_LOTE_PADRAO,
): { valor: number; indefinido: boolean } {
  if (legs.length === 0) return { valor: 0, indefinido: false };
  if (inclinacaoNoInfinito(legs, tamanhoLote) < -EPS) {
    return { valor: Infinity, indefinido: true };
  }
  const piorResultado = Math.min(
    ...precosCriticos(legs).map((s) => payoffEstrutura(legs, s, tamanhoLote)),
  );
  // Perda é o oposto do pior resultado; se nunca há perda, risco = 0.
  return { valor: Math.max(0, -piorResultado), indefinido: false };
}

/**
 * Ganho máximo da estrutura em BRL. `ilimitado = true` (e `valor = null`)
 * quando o ganho cresce sem limite (cauda S → +∞ positiva, ex.: compra de call).
 */
export function ganhoMaximo(
  legs: Leg[],
  tamanhoLote: number = TAMANHO_LOTE_PADRAO,
): { valor: number | null; ilimitado: boolean } {
  if (legs.length === 0) return { valor: 0, ilimitado: false };
  if (inclinacaoNoInfinito(legs, tamanhoLote) > EPS) {
    return { valor: null, ilimitado: true };
  }
  const melhorResultado = Math.max(
    ...precosCriticos(legs).map((s) => payoffEstrutura(legs, s, tamanhoLote)),
  );
  return { valor: melhorResultado, ilimitado: false };
}

/**
 * Ponto(s) de equilíbrio (breakeven): preços do ativo no vencimento onde o
 * resultado total é zero. Devolve em ordem crescente.
 *
 * Estratégia exata: como o payoff é linear por partes (joelhos nos strikes),
 * procura-se zero (a) exatamente sobre um vértice, (b) por troca de sinal entre
 * vértices consecutivos (interpolação linear), e (c) na cauda além do maior
 * strike (usando a inclinação no infinito).
 */
export function breakevens(
  legs: Leg[],
  tamanhoLote: number = TAMANHO_LOTE_PADRAO,
): number[] {
  if (legs.length === 0) return [];

  const vertices = precosCriticos(legs);
  const P = (s: number) => payoffEstrutura(legs, s, tamanhoLote);
  const resultado: number[] = [];
  const adicionar = (x: number) => {
    if (!resultado.some((v) => Math.abs(v - x) < 1e-6)) resultado.push(x);
  };

  for (let i = 0; i < vertices.length; i++) {
    const s = vertices[i]!;
    const p = P(s);
    if (Math.abs(p) < EPS) {
      adicionar(s); // zero exatamente sobre o vértice
      continue;
    }
    if (i < vertices.length - 1) {
      const s2 = vertices[i + 1]!;
      const p2 = P(s2);
      // Troca estrita de sinal → há um cruzamento dentro do segmento.
      if (p * p2 < 0) {
        adicionar(s + ((s2 - s) * (0 - p)) / (p2 - p));
      }
    }
  }

  // Cauda além do maior strike: segmento linear com inclinação no infinito.
  const ultimo = vertices[vertices.length - 1]!;
  const inclinacao = inclinacaoNoInfinito(legs, tamanhoLote);
  if (Math.abs(inclinacao) > EPS) {
    const candidato = ultimo - P(ultimo) / inclinacao;
    if (candidato > ultimo + EPS) adicionar(candidato);
  }

  return resultado.sort((a, b) => a - b);
}

/**
 * Resumo completo de risco/retorno (risco antes do ganho — §2). Conveniência
 * que agrega `riscoMaximo`, `ganhoMaximo` e `breakevens`.
 */
export function resumirEstrutura(
  legs: Leg[],
  tamanhoLote: number = TAMANHO_LOTE_PADRAO,
): ResumoEstrutura {
  const risco = riscoMaximo(legs, tamanhoLote);
  const ganho = ganhoMaximo(legs, tamanhoLote);
  return {
    riscoMaximo: risco.valor,
    riscoIndefinido: risco.indefinido,
    ganhoMaximo: ganho.valor,
    ganhoIlimitado: ganho.ilimitado,
    breakevens: breakevens(legs, tamanhoLote),
  };
}

/**
 * Faixa de preços sugerida para o gráfico, a partir dos strikes da estrutura
 * (conveniência para a UI; o montador pode sobrescrever). Abre uma margem
 * relativa abaixo do menor e acima do maior strike. Nunca devolve `min < 0`.
 */
export function faixaSugerida(legs: Leg[], margem = 0.3): FaixaPrecos {
  if (legs.length === 0) {
    throw new Error("faixaSugerida: a estrutura não tem pernas.");
  }
  const strikes = legs.map((l) => l.strike);
  const menor = Math.min(...strikes);
  const maior = Math.max(...strikes);
  return {
    min: Math.max(0, menor * (1 - margem)),
    max: maior * (1 + margem),
  };
}

// Estruturas nomeadas do montador (§8.4, §18) — construídas sobre o motor acima.
export * from "./estruturas";

// Motor Black-Scholes: pricing, volatilidade implícita e gregas (§18.1).
export * from "./black-scholes";

// IV representativa diária por ativo-objeto (§6.4) — base do IV Rank.
export * from "./iv-representativa";

// IV Rank / IV Percentil sobre a série de IV (§8.2, §9) — "opção cara vs. barata".
export * from "./iv-rank";
