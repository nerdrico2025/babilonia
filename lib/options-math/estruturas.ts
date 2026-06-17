/**
 * estruturas — ESTRUTURAS NOMEADAS do montador (§8.4 e §18 do PRD).
 *
 * Cada função monta a lista de pernas da estrutura e delega o cálculo ao MOTOR
 * GENÉRICO (`./index`), que já é puro, testado e validado contra o §18. Assim os
 * números (risco, ganho, breakevens) saem de uma única fonte da verdade.
 *
 * O resultado segue a ordem de importância do §8.4 (risco SEMPRE antes do ganho,
 * §2): risco_maximo + rotulo_risco → ganho_maximo → breakevens → curva.
 *
 * Convenções (iguais ao motor): strike/prêmio por AÇÃO em BRL; quantidade em
 * CONTRATOS; valores financeiros = por ação × quantidade × tamanho do lote
 * (default 100 na B3 — parametrizável via `tamanhoLote`).
 *
 * Escopo: SÓ opções. A venda coberta trata APENAS a perna de opção; o ativo à
 * vista está fora do escopo (§3.2) e é gerido pelo usuário por fora.
 */

import {
  type Leg,
  type PontoPayoff,
  type FaixaPrecos,
  TAMANHO_LOTE_PADRAO,
  riscoMaximo,
  ganhoMaximo,
  breakevens,
  curvaPayoff,
  faixaSugerida,
} from "./index";

/** Rótulo de risco exigido pelo §2 (risco DEFINIDO vs INDEFINIDO). */
export type RotuloRisco = "DEFINIDO" | "INDEFINIDO";

/**
 * Resultado padronizado de uma estrutura nomeada. Campos na ORDEM de
 * importância do §8.4 — risco antes do ganho (§2).
 */
export interface ResultadoEstrutura {
  /** Nome da estrutura (para a UI). */
  nome: string;
  /** 1. Risco máximo em BRL (número positivo; `Infinity` se indefinido). */
  risco_maximo: number;
  /** 1. Rótulo do risco: DEFINIDO ou INDEFINIDO. */
  rotulo_risco: RotuloRisco;
  /** 2. Ganho máximo em BRL, ou a string `"ilimitado"`. */
  ganho_maximo: number | "ilimitado";
  /** 3. Ponto(s) de equilíbrio (preços do ativo), em ordem crescente. */
  breakevens: number[];
  /** 4. Curva de payoff (do motor genérico) — base do gráfico (§8.4 item 4). */
  curva: PontoPayoff[];
  /** Pernas efetivamente montadas (úteis para o ticket §11). */
  legs: Leg[];
  /** Avisos em linguagem de iniciante (liquidez, risco indefinido, cobertura…). */
  avisos: string[];
}

/** Parâmetros comuns a todas as estruturas. */
interface ParamsBase {
  /** Quantidade da estrutura, em contratos (multiplica todas as pernas). Default 1. */
  quantidade?: number;
  /** Tamanho do lote/contrato. Default 100 (B3). */
  tamanhoLote?: number;
  /** Faixa de preços da curva. Default: `faixaSugerida` em torno dos strikes. */
  faixa?: FaixaPrecos;
}

// Aviso padrão para estruturas com perna vendida a descoberto (§10, regra 10%).
const AVISO_RISCO_INDEFINIDO =
  "Risco INDEFINIDO: a perda pode superar o prêmio recebido. Exige margem na " +
  "corretora (regra de ~10% do capital, §10) e atenção redobrada.";

// ── Helpers internos ─────────────────────────────────────────────────────────

/** Garante que os strikes estão em ordem estritamente crescente. */
function exigirCrescente(rotulo: string, ...strikes: number[]): void {
  for (let i = 1; i < strikes.length; i++) {
    if (!(strikes[i]! > strikes[i - 1]!)) {
      throw new Error(`${rotulo}: os strikes devem ser estritamente crescentes.`);
    }
  }
}

/** Monta o resultado padronizado a partir das pernas, usando o motor genérico. */
function montarResultado(
  nome: string,
  legs: Leg[],
  tamanhoLote: number,
  opcoes?: { faixa?: FaixaPrecos; avisos?: string[] },
): ResultadoEstrutura {
  const risco = riscoMaximo(legs, tamanhoLote);
  const ganho = ganhoMaximo(legs, tamanhoLote);
  const faixa = opcoes?.faixa ?? faixaSugerida(legs);
  return {
    nome,
    risco_maximo: risco.valor,
    rotulo_risco: risco.indefinido ? "INDEFINIDO" : "DEFINIDO",
    ganho_maximo: ganho.ilimitado ? "ilimitado" : (ganho.valor as number),
    breakevens: breakevens(legs, tamanhoLote),
    curva: curvaPayoff(legs, faixa, tamanhoLote),
    legs,
    avisos: opcoes?.avisos ?? [],
  };
}

// ── Travas verticais ─────────────────────────────────────────────────────────

/**
 * Trava de ALTA com calls (DÉBITO) — §18: compra call K1, vende call K2, K1<K2.
 * Risco = débito; ganho = (K2−K1) − débito; breakeven = K1 + débito. DEFINIDO.
 */
export function travaAltaCallDebito(
  p: { k1: number; k2: number; premioK1: number; premioK2: number } & ParamsBase,
): ResultadoEstrutura {
  exigirCrescente("Trava de alta (débito)", p.k1, p.k2);
  const q = p.quantidade ?? 1;
  const lote = p.tamanhoLote ?? TAMANHO_LOTE_PADRAO;
  const legs: Leg[] = [
    { tipo: "call", lado: "compra", strike: p.k1, premio: p.premioK1, quantidade: q },
    { tipo: "call", lado: "venda", strike: p.k2, premio: p.premioK2, quantidade: q },
  ];
  return montarResultado("Trava de alta (débito, calls)", legs, lote, { faixa: p.faixa });
}

/**
 * Trava de ALTA de CRÉDITO (bull put spread) — vende put K2, compra put K1, K1<K2.
 * Risco = (K2−K1) − crédito; ganho = crédito; breakeven = K2 − crédito. DEFINIDO.
 */
export function travaAltaPutCredito(
  p: { k1: number; k2: number; premioK1: number; premioK2: number } & ParamsBase,
): ResultadoEstrutura {
  exigirCrescente("Trava de alta (crédito)", p.k1, p.k2);
  const q = p.quantidade ?? 1;
  const lote = p.tamanhoLote ?? TAMANHO_LOTE_PADRAO;
  const legs: Leg[] = [
    { tipo: "put", lado: "venda", strike: p.k2, premio: p.premioK2, quantidade: q },
    { tipo: "put", lado: "compra", strike: p.k1, premio: p.premioK1, quantidade: q },
  ];
  return montarResultado("Trava de alta (crédito, puts)", legs, lote, { faixa: p.faixa });
}

/**
 * Trava de BAIXA com puts (DÉBITO) — §18: compra put K2, vende put K1, K1<K2.
 * Risco = débito; ganho = (K2−K1) − débito; breakeven = K2 − débito. DEFINIDO.
 */
export function travaBaixaPutDebito(
  p: { k1: number; k2: number; premioK1: number; premioK2: number } & ParamsBase,
): ResultadoEstrutura {
  exigirCrescente("Trava de baixa (débito)", p.k1, p.k2);
  const q = p.quantidade ?? 1;
  const lote = p.tamanhoLote ?? TAMANHO_LOTE_PADRAO;
  const legs: Leg[] = [
    { tipo: "put", lado: "compra", strike: p.k2, premio: p.premioK2, quantidade: q },
    { tipo: "put", lado: "venda", strike: p.k1, premio: p.premioK1, quantidade: q },
  ];
  return montarResultado("Trava de baixa (débito, puts)", legs, lote, { faixa: p.faixa });
}

/**
 * Trava de BAIXA de CRÉDITO (bear call spread) — vende call K1, compra call K2, K1<K2.
 * Risco = (K2−K1) − crédito; ganho = crédito; breakeven = K1 + crédito. DEFINIDO.
 */
export function travaBaixaCallCredito(
  p: { k1: number; k2: number; premioK1: number; premioK2: number } & ParamsBase,
): ResultadoEstrutura {
  exigirCrescente("Trava de baixa (crédito)", p.k1, p.k2);
  const q = p.quantidade ?? 1;
  const lote = p.tamanhoLote ?? TAMANHO_LOTE_PADRAO;
  const legs: Leg[] = [
    { tipo: "call", lado: "venda", strike: p.k1, premio: p.premioK1, quantidade: q },
    { tipo: "call", lado: "compra", strike: p.k2, premio: p.premioK2, quantidade: q },
  ];
  return montarResultado("Trava de baixa (crédito, calls)", legs, lote, { faixa: p.faixa });
}

// ── Borboleta e condor ───────────────────────────────────────────────────────

/**
 * BORBOLETA com calls — §18: compra K1, vende 2× K2, compra K3, equidistantes.
 * Risco = débito líquido; ganho = (K2−K1) − débito; breakevens = K1+débito e
 * K3−débito. DEFINIDO.
 */
export function borboletaCalls(
  p: {
    k1: number; k2: number; k3: number;
    premioK1: number; premioK2: number; premioK3: number;
  } & ParamsBase,
): ResultadoEstrutura {
  exigirCrescente("Borboleta", p.k1, p.k2, p.k3);
  if (Math.abs((p.k2 - p.k1) - (p.k3 - p.k2)) > 1e-9) {
    throw new Error("Borboleta: os strikes devem ser equidistantes (K2−K1 = K3−K2).");
  }
  const q = p.quantidade ?? 1;
  const lote = p.tamanhoLote ?? TAMANHO_LOTE_PADRAO;
  const legs: Leg[] = [
    { tipo: "call", lado: "compra", strike: p.k1, premio: p.premioK1, quantidade: q },
    { tipo: "call", lado: "venda", strike: p.k2, premio: p.premioK2, quantidade: 2 * q },
    { tipo: "call", lado: "compra", strike: p.k3, premio: p.premioK3, quantidade: q },
  ];
  return montarResultado("Borboleta (calls)", legs, lote, { faixa: p.faixa });
}

/**
 * CONDOR com calls (long call condor) — §18: quatro strikes K1<K2<K3<K4; compra
 * K1, vende K2, vende K3, compra K4. Platô de ganho entre os strikes internos
 * (K2..K3). Risco = débito líquido; breakevens = K1+débito e K4−débito. DEFINIDO.
 */
export function condorCalls(
  p: {
    k1: number; k2: number; k3: number; k4: number;
    premioK1: number; premioK2: number; premioK3: number; premioK4: number;
  } & ParamsBase,
): ResultadoEstrutura {
  exigirCrescente("Condor", p.k1, p.k2, p.k3, p.k4);
  const q = p.quantidade ?? 1;
  const lote = p.tamanhoLote ?? TAMANHO_LOTE_PADRAO;
  const legs: Leg[] = [
    { tipo: "call", lado: "compra", strike: p.k1, premio: p.premioK1, quantidade: q },
    { tipo: "call", lado: "venda", strike: p.k2, premio: p.premioK2, quantidade: q },
    { tipo: "call", lado: "venda", strike: p.k3, premio: p.premioK3, quantidade: q },
    { tipo: "call", lado: "compra", strike: p.k4, premio: p.premioK4, quantidade: q },
  ];
  return montarResultado("Condor (calls)", legs, lote, { faixa: p.faixa });
}

// ── Straddle e strangle ──────────────────────────────────────────────────────

/**
 * STRADDLE COMPRADO — §18: compra call e put no mesmo strike K. Risco = soma dos
 * prêmios; ganho ilimitado (grande para baixo); breakevens = K ± prêmios. DEFINIDO.
 */
export function straddleComprado(
  p: { k: number; premioCall: number; premioPut: number } & ParamsBase,
): ResultadoEstrutura {
  const q = p.quantidade ?? 1;
  const lote = p.tamanhoLote ?? TAMANHO_LOTE_PADRAO;
  const legs: Leg[] = [
    { tipo: "call", lado: "compra", strike: p.k, premio: p.premioCall, quantidade: q },
    { tipo: "put", lado: "compra", strike: p.k, premio: p.premioPut, quantidade: q },
  ];
  return montarResultado("Straddle comprado", legs, lote, { faixa: p.faixa });
}

/**
 * STRADDLE VENDIDO — §18: vende call e put no mesmo strike K. Recebe os prêmios;
 * ganho = soma dos prêmios; risco INDEFINIDO (pode superar o prêmio).
 */
export function straddleVendido(
  p: { k: number; premioCall: number; premioPut: number } & ParamsBase,
): ResultadoEstrutura {
  const q = p.quantidade ?? 1;
  const lote = p.tamanhoLote ?? TAMANHO_LOTE_PADRAO;
  const legs: Leg[] = [
    { tipo: "call", lado: "venda", strike: p.k, premio: p.premioCall, quantidade: q },
    { tipo: "put", lado: "venda", strike: p.k, premio: p.premioPut, quantidade: q },
  ];
  return montarResultado("Straddle vendido", legs, lote, {
    faixa: p.faixa,
    avisos: [AVISO_RISCO_INDEFINIDO],
  });
}

/**
 * STRANGLE COMPRADO — §18: compra put K1 e call K2, K1<K2. Risco = soma dos
 * prêmios; ganho ilimitado; breakevens = K1−prêmios e K2+prêmios. DEFINIDO.
 */
export function strangleComprado(
  p: { k1: number; k2: number; premioPut: number; premioCall: number } & ParamsBase,
): ResultadoEstrutura {
  exigirCrescente("Strangle", p.k1, p.k2);
  const q = p.quantidade ?? 1;
  const lote = p.tamanhoLote ?? TAMANHO_LOTE_PADRAO;
  const legs: Leg[] = [
    { tipo: "put", lado: "compra", strike: p.k1, premio: p.premioPut, quantidade: q },
    { tipo: "call", lado: "compra", strike: p.k2, premio: p.premioCall, quantidade: q },
  ];
  return montarResultado("Strangle comprado", legs, lote, { faixa: p.faixa });
}

/**
 * STRANGLE VENDIDO — §18: vende put K1 e call K2, K1<K2. Recebe os prêmios;
 * ganho = soma dos prêmios; risco INDEFINIDO.
 */
export function strangleVendido(
  p: { k1: number; k2: number; premioPut: number; premioCall: number } & ParamsBase,
): ResultadoEstrutura {
  exigirCrescente("Strangle", p.k1, p.k2);
  const q = p.quantidade ?? 1;
  const lote = p.tamanhoLote ?? TAMANHO_LOTE_PADRAO;
  const legs: Leg[] = [
    { tipo: "put", lado: "venda", strike: p.k1, premio: p.premioPut, quantidade: q },
    { tipo: "call", lado: "venda", strike: p.k2, premio: p.premioCall, quantidade: q },
  ];
  return montarResultado("Strangle vendido", legs, lote, {
    faixa: p.faixa,
    avisos: [AVISO_RISCO_INDEFINIDO],
  });
}

// ── Venda coberta (só a perna de opção) ──────────────────────────────────────

/**
 * VENDA COBERTA (perna de opção) — §18 / §3.2: vende call K contra um ativo que
 * o usuário detém. O app trata SÓ a perna de opção; o ativo à vista é gerido por
 * fora (fora do escopo, §3.2).
 *
 * Decisão de produto (alinhada ao §18, que NÃO a classifica como INDEFINIDO):
 * como a posição é coberta pelo ativo detido, NÃO há risco de caixa ilimitado na
 * perna → rotulo_risco = DEFINIDO e risco_maximo = 0 (em caixa, na perna). O
 * prêmio recebido define o ganho da perna. O risco real — ser exercido e perder
 * o ativo / abrir mão da alta acima do strike — é comunicado nos `avisos`.
 *
 * A `curva` é a da perna isolada (call vendida): mostra prejuízo acima do strike,
 * que numa venda COBERTA é compensado pelo ativo (gerido por fora).
 */
export function vendaCoberta(
  p: { k: number; premio: number } & ParamsBase,
): ResultadoEstrutura {
  const q = p.quantidade ?? 1;
  const lote = p.tamanhoLote ?? TAMANHO_LOTE_PADRAO;
  const legs: Leg[] = [
    { tipo: "call", lado: "venda", strike: p.k, premio: p.premio, quantidade: q },
  ];
  const faixa = p.faixa ?? faixaSugerida(legs);
  const premioRecebido = p.premio * q * lote;
  return {
    nome: "Venda coberta (perna de call)",
    // Coberta pelo ativo detido → sem risco de caixa ilimitado na perna (§18).
    risco_maximo: 0,
    rotulo_risco: "DEFINIDO",
    // O prêmio recebido define o ganho da perna.
    ganho_maximo: premioRecebido,
    // A perna (call vendida) zera o resultado em K + prêmio.
    breakevens: [p.k + p.premio],
    curva: curvaPayoff(legs, faixa, lote),
    legs,
    avisos: [
      "Venda COBERTA: o risco é ser exercido e perder o ativo no exercício / " +
        "abrir mão da valorização acima do strike.",
      "O app trata só a perna de opção; o ativo à vista que cobre a posição " +
        "fica por fora (§3.2) e deve ser gerido por você.",
    ],
  };
}
