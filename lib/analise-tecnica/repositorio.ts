/**
 * analise-tecnica/repositorio — ponte `acao_cotahist` → `Candle[]` (Fase 2-T2).
 *
 * Camada de ACESSO A DADOS da análise técnica: lê o histórico EOD do ativo-objeto
 * em `acao_cotahist` (db/schema) e o entrega no contrato puro `Candle` que o motor
 * do T1 (`lib/analise-tecnica`) espera. O motor não sabe nada de banco; este módulo
 * é a única fronteira que conhece os dois lados (§5.1).
 *
 * Server-only (toca no Postgres). Segue a MESMA convenção de injeção do irmão que
 * já lê esta tabela — `lib/dados-opcoes/comum.ts` (`db: Db = getDb()`) — em vez da
 * interface-repo de `lib/fundamentos/repositorio.ts`: aqui é leitura pura, sem o
 * upsert/orquestração de frescor que justifica aquela interface. O `db` injetável
 * deixa o repositório testável sem Postgres.
 *
 * NÃO inventa dado (§2.4): numeric malformado vira ERRO explícito (não NaN
 * silencioso); ticker sem histórico vira `[]`/`null` (quem chama decide o fallback).
 */

import { desc, eq } from "drizzle-orm";

import { getDb } from "@/db";
import { acaoCotahist } from "@/db/schema";
import type { AcaoCotahist } from "@/db/schema";

import type { Candle } from "./tipos";

/** Instância do cliente Drizzle (server-only), injetável p/ teste. */
export type Db = ReturnType<typeof getDb>;

/**
 * Limite default de candles. 252 ≈ 1 ano de pregões: cobre TODOS os indicadores do
 * T1 (incl. MM200 e a janela de 252 de suporte/resistência) com folga. Override
 * para baixo (quem só precisa de MM50) ou para cima (backfill mais longo).
 */
export const LIMITE_PADRAO = 252;

/**
 * Converte uma LINHA de `acao_cotahist` no `Candle` puro do T1.
 *
 * Os campos de preço/quantidade são `numeric` do Postgres → chegam como STRING no
 * `$inferSelect` do Drizzle; convertemos para `number`. Conversão inválida (NaN,
 * Infinity) LANÇA com mensagem identificando ticker, pregão e campo — nunca passa
 * adiante um NaN silencioso (§2.4).
 *
 * `volume` = `quantidadeTitulos` (QUATOT, nº de papéis), o mesmo campo que o Bloco
 * Técnico atual já usa como "volume" (`lib/dados-opcoes/comum.ts`) — consistência.
 * `data` = `tradeDate` em ISO (carimbo lossless do pregão).
 */
export function acaoCotahistParaCandle(linha: AcaoCotahist): Candle {
  const conv = (valor: string, campo: string): number => {
    const n = Number(valor);
    if (!Number.isFinite(n)) {
      throw new Error(
        `acao_cotahist (${linha.ticker} @ ${linha.tradeDate.toISOString()}): ` +
          `campo "${campo}" não é um número válido (${JSON.stringify(valor)}).`,
      );
    }
    return n;
  };

  return {
    data: linha.tradeDate.toISOString(),
    abertura: conv(linha.precoAbertura, "precoAbertura"),
    maxima: conv(linha.precoMaximo, "precoMaximo"),
    minima: conv(linha.precoMinimo, "precoMinimo"),
    fechamento: conv(linha.precoFechamento, "precoFechamento"),
    volume: conv(linha.quantidadeTitulos, "quantidadeTitulos"),
  };
}

/**
 * Histórico de candles do ATIVO-OBJETO em ordem CRONOLÓGICA ASCENDENTE (mais
 * antigo → mais recente), pronto para o motor do T1.
 *
 * Pega os `limite` pregões MAIS RECENTES (consulta DESC + recorte no banco) e
 * inverte para ascendente — assim o recorte mantém os candles relevantes para os
 * indicadores, não os mais velhos. Ticker sem nenhuma linha → `[]` (não lança).
 */
export async function obterCandles(
  ticker: string,
  opts: { limite?: number; db?: Db } = {},
): Promise<Candle[]> {
  const db = opts.db ?? getDb();
  const limite = opts.limite ?? LIMITE_PADRAO;

  const linhas = await db
    .select()
    .from(acaoCotahist)
    .where(eq(acaoCotahist.ticker, ticker.toUpperCase()))
    .orderBy(desc(acaoCotahist.tradeDate))
    .limit(limite);

  // Veio DESC (mais recente primeiro); inverte p/ cronológico ascendente.
  return linhas.reverse().map(acaoCotahistParaCandle);
}

/**
 * Data do candle MAIS RECENTE disponível para o ticker (`null` se não houver
 * histórico). Para a UI carimbar "indicadores calculados até DD/MM" — mesmo
 * espírito do aviso de preço EOD do Bloco Técnico.
 *
 * Função SEPARADA (em vez de campo no retorno de `obterCandles`) por dois motivos:
 *  (1) mantém a assinatura de `obterCandles` alinhada ao T1 (`Candle[]` puro, sem
 *      embrulho); e (2) permite buscar só o carimbo de frescor com um `LIMIT 1`,
 *      sem puxar 252 linhas, quando a tela só precisa da data. Quando você JÁ
 *      carregou os candles, `candles.at(-1)?.data` dá a mesma informação.
 */
export async function obterDataUltimoCandle(
  ticker: string,
  db: Db = getDb(),
): Promise<Date | null> {
  const linhas = await db
    .select({ tradeDate: acaoCotahist.tradeDate })
    .from(acaoCotahist)
    .where(eq(acaoCotahist.ticker, ticker.toUpperCase()))
    .orderBy(desc(acaoCotahist.tradeDate))
    .limit(1);
  return linhas[0]?.tradeDate ?? null;
}
