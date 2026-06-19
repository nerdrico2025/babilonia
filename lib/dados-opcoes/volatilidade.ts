/**
 * dados-opcoes/volatilidade — VOLATILIDADE do ativo (IV atual + IV Rank/Percentil)
 * a partir de `iv_history` (§8.2/§9 do PRD).
 *
 * Devolve o tipo neutro `VolatilidadeAtivo` (`lib/opcoes/tipos.ts`). A IV Rank é
 * CALCULADA por nós (núcleo puro `calcularIvRank`) sobre a série diária já gravada
 * em `iv_history` — nada vem pronto (§6.4). É a fonte da volatilidade da
 * `/api/cadeia` (§4.4).
 *
 * Convenções (documentadas; nada inventado §2.4):
 *  - `ivAtual`: IV representativa MAIS RECENTE de `iv_history`, convertida de
 *    DECIMAL (0.2816) para PERCENTUAL (28.16) — unidade que a UI consome (`fmtIV`),
 *    igual à cadeia.
 *  - IV Rank/Percentil de 1 ANO: `calcularIvRank` com a janela padrão (252). Já
 *    saem em [0,100]. O ESTADO (completo/parcial/insuficiente) vai em
 *    `confiabilidade` (campo opcional novo de `VolatilidadeAtivo`).
 *  - IV Rank/Percentil de 6 MESES: mesma função com janela 126 e piso de 60 pregões
 *    (abaixo disso → `null`). SEM badge próprio — herda o aviso de confiabilidade
 *    do 1 ano (decisão do passo 4.3).
 *  - `ewmaAtual`: `null` por ora (HV/EWMA é feature futura, não exibida hoje).
 *  - `ivRankPorContratoDisponivel`: `false` (IV Rank só existe no ativo, §6.4 #3).
 *  - `asOf`: o pregão MAIS RECENTE de `iv_history` do ativo — a data de referência
 *    do Rank, que a UI CARIMBA (o último pregão válido varia por ativo).
 *
 * Server-only (lê o banco). A matemática mora no núcleo puro `calcularIvRank`.
 */

import { asc, eq } from "drizzle-orm";

import { calcularIvRank, type PontoIv } from "@/lib/options-math";
import { getDb } from "@/db";
import { ivHistory } from "@/db/schema";
import type { VolatilidadeAtivo } from "@/lib/opcoes/tipos";

import type { Db } from "./comum";

/** Janela do IV Rank de 6 MESES (em pregões) e seu piso de confiabilidade. */
const LOOKBACK_6M = 126;
const DIAS_MINIMOS_6M = 60;

/** Resultado: a volatilidade neutra + a data-base (as-of) do Rank, para carimbar. */
export interface ResultadoVolatilidadeCotahist {
  volatilidade: VolatilidadeAtivo;
  /**
   * Pregão de referência do Rank (mais recente em `iv_history` do ativo). `null`
   * quando o ativo ainda não tem IV diária (degradação coerente).
   */
  asOf: Date | null;
}

/** `VolatilidadeAtivo` vazia/degradada (ativo sem IV em `iv_history`). */
function volatilidadeVazia(ativo: string): VolatilidadeAtivo {
  return {
    ativo: ativo.toUpperCase(),
    ivAtual: null,
    ivRank1a: null,
    ivPercentil1a: null,
    ivRank6m: null,
    ivPercentil6m: null,
    ewmaAtual: null,
    ivRankPorContratoDisponivel: false,
  };
}

/**
 * MONTA a `VolatilidadeAtivo` a partir da série de IV diária (decimal) do ativo.
 * FUNÇÃO PURA (sem banco/rede): calcula Rank/Percentil de 1a e 6m e a
 * confiabilidade. Exportada para teste direto. Série vazia → degradação coerente.
 *
 * @param serie Série de IV diária (uma entrada por pregão), IV em DECIMAL. Não
 *   precisa estar ordenada — usa-se o ÚLTIMO pregão como alvo.
 */
export function montarVolatilidade(
  ativo: string,
  serie: readonly PontoIv[],
): ResultadoVolatilidadeCotahist {
  if (serie.length === 0) {
    return { asOf: null, volatilidade: volatilidadeVazia(ativo) };
  }

  const ordenada = [...serie].sort(
    (a, b) => a.tradeDate.getTime() - b.tradeDate.getTime(),
  );
  const alvo = ordenada[ordenada.length - 1]!;
  const ivAlvo = alvo.iv; // decimal

  // 1 ano (janela padrão 252) — define o estado de confiabilidade exposto.
  const r1a = calcularIvRank(ordenada, ivAlvo);
  // 6 meses (janela 126, piso 60). Estado próprio NÃO é exposto (herda o de 1a).
  const r6m = calcularIvRank(ordenada, ivAlvo, {
    lookback: LOOKBACK_6M,
    diasCompletos: LOOKBACK_6M,
    diasMinimos: DIAS_MINIMOS_6M,
  });

  return {
    asOf: alvo.tradeDate,
    volatilidade: {
      ativo: ativo.toUpperCase(),
      ivAtual: ivAlvo * 100, // decimal → percentual
      ivRank1a: r1a.ivRank,
      ivPercentil1a: r1a.ivPercentil,
      ivRank6m: r6m.ivRank,
      ivPercentil6m: r6m.ivPercentil,
      ewmaAtual: null,
      ivRankPorContratoDisponivel: false,
      confiabilidade: { estado: r1a.estado, diasJanela: r1a.diasNaJanela },
    },
  };
}

/**
 * Volatilidade do ativo (IV atual + IV Rank/Percentil 1a/6m) a partir de
 * `iv_history`. Degrada coerente (sem IV diária → tudo `null`, `asOf: null`),
 * nunca quebra a tela (§2.6).
 */
export async function getVolatilidadeCotahist(
  ativo: string,
  opcoes: { db?: Db } = {},
): Promise<ResultadoVolatilidadeCotahist> {
  const db = opcoes.db ?? getDb();
  const simbolo = ativo.toUpperCase();

  const linhas = await db
    .select({ tradeDate: ivHistory.tradeDate, iv: ivHistory.iv })
    .from(ivHistory)
    .where(eq(ivHistory.ativo, simbolo))
    .orderBy(asc(ivHistory.tradeDate));

  const serie: PontoIv[] = linhas.map((l) => ({
    tradeDate: l.tradeDate,
    iv: Number(l.iv),
  }));

  return montarVolatilidade(simbolo, serie);
}
