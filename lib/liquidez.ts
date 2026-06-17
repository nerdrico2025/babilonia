/**
 * liquidez — classificação de liquidez de uma série de opção (§2.5, §8.3, §9).
 *
 * Módulo PURO e testável. Princípio §2.5: "a ordem precisa ser executável" — por
 * isso séries com pouco volume ou spread largo recebem ALERTA.
 *
 * ⚠️ A OpLab NÃO fornece open interest (§6.4 #1) — nunca inventamos (§2.4). A
 * liquidez no MVP usa os proxies disponíveis: VOLUME (contratos no dia), SPREAD
 * relativo (ask − bid sobre o preço de referência) e presença de MARKET MAKER.
 *
 * Os limites abaixo são heurísticas conscientes do MVP (ajustáveis na Fase 2,
 * §15) — documentadas aqui para ficarem explícitas, não escondidas no código.
 */

import type { OpcaoCadeia } from "@/lib/integrations/oplab";

/** Limites do filtro de liquidez (MVP — ajustáveis). */
export const LIQUIDEZ_LIMITES = {
  /** Volume mínimo (contratos no dia) para considerar a série líquida. */
  volumeMinimo: 100,
  /** Volume mínimo quando há market maker (a execução fica mais garantida). */
  volumeMinimoComMarketMaker: 20,
  /** Spread máximo aceitável como fração do preço de referência (10%). */
  spreadRelativoMaximo: 0.1,
} as const;

/** Nível de liquidez: dentro do aceitável (`ok`) ou para alertar (`baixa`). */
export type NivelLiquidez = "ok" | "baixa";

/** Avaliação de liquidez de UMA série (sem open interest — §6.4). */
export interface AvaliacaoLiquidez {
  nivel: NivelLiquidez;
  /** Spread relativo ao preço de referência (0.05 = 5%); `null` se faltar bid/ask. */
  spreadRelativo: number | null;
  /** Preço de referência (mid bid/ask, ou o lado disponível); `null` se nenhum. */
  precoReferencia: number | null;
  /** Motivos em linguagem de iniciante (positivos e negativos). */
  motivos: string[];
}

/** Trata valores ausentes ou ≤ 0 como "sem preço". */
function precoValido(valor: number | null): number | null {
  return valor != null && valor > 0 ? valor : null;
}

/**
 * Preço de referência da opção: o "meio" entre bid e ask quando ambos existem;
 * senão o lado disponível. Base do prêmio sugerido e do spread relativo.
 */
export function precoReferencia(op: OpcaoCadeia): number | null {
  const bid = precoValido(op.bid);
  const ask = precoValido(op.ask);
  if (bid != null && ask != null) return (bid + ask) / 2;
  return ask ?? bid ?? null;
}

/** Formata uma fração como percentual em pt-BR (0.12 → "12%"). */
function pct(fracao: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(fracao);
}

/**
 * Classifica a liquidez de uma série pelos proxies disponíveis (volume + spread
 * + market maker). NUNCA usa open interest (§6.4). Alerta (`baixa`) quando o
 * volume é baixo OU o spread é largo — sem impedir nada (a decisão é do usuário).
 */
export function avaliarLiquidez(op: OpcaoCadeia): AvaliacaoLiquidez {
  const mid = precoReferencia(op);
  const spreadRelativo =
    op.spread != null && mid != null && mid > 0 ? op.spread / mid : null;
  const temMarketMaker = op.marketMaker === true;
  const volume = op.volume ?? 0;
  const volumeMinimo = temMarketMaker
    ? LIQUIDEZ_LIMITES.volumeMinimoComMarketMaker
    : LIQUIDEZ_LIMITES.volumeMinimo;

  const motivos: string[] = [];
  let nivel: NivelLiquidez = "ok";

  // Sem volume e sem spread não há como atestar liquidez — alerta.
  if (op.volume == null && op.spread == null) {
    return {
      nivel: "baixa",
      spreadRelativo: null,
      precoReferencia: mid,
      motivos: ["Sem dados de volume e de spread para avaliar a liquidez."],
    };
  }

  if (volume < volumeMinimo) {
    nivel = "baixa";
    motivos.push(
      `Volume baixo: ${volume} contrato(s) no dia (mínimo ${volumeMinimo}` +
        `${temMarketMaker ? ", mesmo com market maker" : ""}).`,
    );
  }

  if (spreadRelativo == null) {
    motivos.push("Sem bid e ask para medir o spread (preço de saída incerto).");
  } else if (spreadRelativo > LIQUIDEZ_LIMITES.spreadRelativoMaximo) {
    nivel = "baixa";
    motivos.push(
      `Spread largo: ${pct(spreadRelativo)} do preço — entrar e sair fica caro.`,
    );
  }

  if (nivel === "ok") {
    motivos.push(
      temMarketMaker
        ? "Volume e spread dentro do aceitável, e há market maker."
        : "Volume e spread dentro do aceitável.",
    );
  }

  return { nivel, spreadRelativo, precoReferencia: mid, motivos };
}
