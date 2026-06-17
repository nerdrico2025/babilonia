/**
 * reconstruir — reconstrói um RASCUNHO a partir de uma posição já registrada,
 * para o fluxo "revisão de operação existente" (§12): reabrir uma operação do
 * book/histórico e gerar um TICKET DE AJUSTE.
 *
 * Módulo PURO (options-math + risk-rules, sem DOM). Os números (risco, ganho,
 * breakevens, curva) são RECALCULADOS pelo núcleo a partir das pernas — uma só
 * fonte da verdade (§5.1). Os tickers das opções viajam em `simbolos` para o
 * ticket pré-preencher os campos de execução.
 */

import {
  curvaPayoff,
  faixaSugerida,
  type Leg,
  type ResultadoEstrutura,
} from "@/lib/options-math";
import { avaliarRisco } from "@/lib/risk-rules";

import type { FamiliaEstrutura } from "./catalogo";
import type { RascunhoOperacao } from "./rascunho";

/** Nome amigável da família da estrutura (§8.4), para exibir e reconstruir. */
export const NOME_FAMILIA: Record<string, string> = {
  trava_alta: "Trava de alta",
  trava_baixa: "Trava de baixa",
  borboleta: "Borboleta",
  condor: "Condor",
  straddle: "Straddle",
  strangle: "Strangle",
  venda_coberta: "Venda coberta",
};

/** Perna persistida (forma mínima necessária à reconstrução). */
export interface PernaPosicao {
  optionSymbol: string;
  kind: "call" | "put";
  side: "compra" | "venda";
  strike: number;
  quantity: number;
  premium: number;
}

/** Posição persistida reconstruível em rascunho. */
export interface PosicaoReconstruivel {
  underlying: string;
  /** Família (enum `structureType`). */
  structure: string;
  /** Vencimento em ISO. */
  expiresAtISO: string;
  maxRisk: number;
  maxGain: number | null;
  riskDefined: boolean;
  breakevens: number[];
  pernas: PernaPosicao[];
}

/**
 * Reconstrói o `ResultadoEstrutura` (números do núcleo) e o `RascunhoOperacao`
 * de uma posição, recomputando a curva de payoff e as avaliações de risco (§10).
 */
export function reconstruirRascunho(
  p: PosicaoReconstruivel,
  capitalTotal: number,
): RascunhoOperacao {
  const legs: Leg[] = p.pernas.map((x) => ({
    tipo: x.kind,
    lado: x.side,
    strike: x.strike,
    premio: x.premium,
    quantidade: x.quantity,
  }));

  const resultado: ResultadoEstrutura = {
    nome: NOME_FAMILIA[p.structure] ?? p.structure,
    // Risco indefinido não tem perda máxima finita → Infinity (rótulo cobre o caso).
    risco_maximo: p.riskDefined ? p.maxRisk : Infinity,
    rotulo_risco: p.riskDefined ? "DEFINIDO" : "INDEFINIDO",
    ganho_maximo: p.maxGain == null ? "ilimitado" : p.maxGain,
    breakevens: p.breakevens,
    curva: curvaPayoff(legs, faixaSugerida(legs)),
    legs,
    avisos: [],
  };

  const vencimento = new Date(p.expiresAtISO);
  const margemRequerida = p.riskDefined ? undefined : p.maxRisk;
  const avaliacoes = avaliarRisco(
    { estrutura: resultado, ativoObjeto: p.underlying, vencimento, margemRequerida },
    capitalTotal,
    [],
    {},
  );

  return {
    familia: p.structure as FamiliaEstrutura,
    estrutura: resultado,
    ativoObjeto: p.underlying,
    vencimentoISO: p.expiresAtISO,
    capitalTotal,
    margemRequerida,
    avaliacoes,
    simbolos: p.pernas.map((x) => x.optionSymbol),
  };
}
