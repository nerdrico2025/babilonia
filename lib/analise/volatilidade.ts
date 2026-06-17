/**
 * analise/volatilidade — leitura de VOLATILIDADE do ativo (§8.2, bloco 3, §9).
 *
 * Módulo PURO e testável. A regra do §9: IV Rank ALTO → tende a favorecer
 * estruturas VENDIDAS; IV Rank BAIXO → tende a favorecer COMPRADAS. Sempre como
 * LEITURA, nunca como ordem (§2.3), e com o alerta de "atenção a resultados
 * próximos" — exatamente o exemplo do enunciado.
 */

/** Limiares de IV Rank (escala 0–100, como a OpLab entrega). */
export const IV_RANK_ALTO = 70;
export const IV_RANK_BAIXO = 30;

/** Viés que a volatilidade tende a favorecer (não é recomendação). */
export type ViesVolatilidade = "vendidas" | "compradas" | "neutro";

export interface VolatilidadeEntrada {
  /** IV atual do ativo (%), ou null. */
  ivAtual: number | null;
  /** IV Rank (0–100), ou null. */
  ivRank: number | null;
  /** IV percentil (0–100), ou null. */
  ivPercentil: number | null;
}

export interface AnaliseVolatilidade {
  vies: ViesVolatilidade | null;
  leitura: string[];
}

function num(v: number): string {
  return v.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
}

/**
 * Leitura de volatilidade (§9). `eventoProximo` (resultado/provento à vista)
 * reforça o alerta padrão. NUNCA recomenda — usa "tende a favorecer".
 */
export function lerVolatilidade(
  e: VolatilidadeEntrada,
  opcoes: { eventoProximo?: boolean } = {},
): AnaliseVolatilidade {
  const leitura: string[] = [];

  if (e.ivAtual != null) {
    leitura.push(`IV atual do ativo em ${num(e.ivAtual)}%.`);
  }

  if (e.ivRank == null) {
    leitura.push(
      "Sem IV Rank disponível — não dá para situar a volatilidade frente ao histórico. Cole o valor se tiver.",
    );
    return { vies: null, leitura };
  }

  const rank = e.ivRank;
  let vies: ViesVolatilidade;
  if (rank >= IV_RANK_ALTO) {
    vies = "vendidas";
    leitura.push(
      `IV Rank em ${num(rank)}% — a volatilidade está ALTA frente ao último ano. Isso tende a favorecer estruturas VENDIDAS (vender prêmio caro), mas atenção a resultados próximos: um evento pode disparar o movimento.`,
    );
  } else if (rank <= IV_RANK_BAIXO) {
    vies = "compradas";
    leitura.push(
      `IV Rank em ${num(rank)}% — a volatilidade está BAIXA frente ao último ano. Isso tende a favorecer estruturas COMPRADAS (prêmio barato), mas movimentos podem demorar a aparecer.`,
    );
  } else {
    vies = "neutro";
    leitura.push(
      `IV Rank em ${num(rank)}% — a volatilidade está em região intermediária; não há viés claro entre comprar ou vender prêmio.`,
    );
  }

  if (e.ivPercentil != null) {
    leitura.push(`IV percentil em ${num(e.ivPercentil)}% (quanto do último ano ficou abaixo da IV de hoje).`);
  }
  if (opcoes.eventoProximo) {
    leitura.push("Há evento próximo (resultado/provento) — a IV pode estar inflada por isso; reavalie depois do evento.");
  }

  return { vies, leitura };
}

/** Leitura de skew a partir da IV de uma put OTM e de uma call OTM. */
export interface AnaliseSkew {
  /** IV(put) − IV(call), em pontos de %. */
  diferenca: number;
  leitura: string;
}

/**
 * Lê o skew put/call comparando a IV de uma put OTM com a de uma call OTM
 * (valores colados/da cadeia). Put mais cara = mercado paga mais por proteção.
 */
export function lerSkew(ivPut: number, ivCall: number): AnaliseSkew {
  const diferenca = ivPut - ivCall;
  let leitura: string;
  if (diferenca > 1) {
    leitura =
      "As puts estão com IV maior que as calls (skew de baixa): o mercado paga mais caro por proteção contra quedas.";
  } else if (diferenca < -1) {
    leitura =
      "As calls estão com IV maior que as puts (skew de alta): a demanda por exposição à alta está mais cara.";
  } else {
    leitura = "IV de puts e calls parecida — skew aproximadamente simétrico.";
  }
  return { diferenca, leitura };
}
