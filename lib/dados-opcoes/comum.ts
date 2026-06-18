/**
 * dados-opcoes/comum — helpers de leitura compartilhados da camada de dados de
 * opções a partir do COTAHIST (§5.1, §6.2/§6.4 do PRD).
 *
 * Estes helpers leem o Postgres (tabelas `opcao_cotahist`, `acao_cotahist`) e o
 * BCB-SGS, e são REUTILIZADOS por:
 *  - `cadeia.ts` (passo 4.2) — monta a `CadeiaOpcoes` neutra para a UI;
 *  - o passo 4.3 (volatilidade + gregas on-demand), que precisa da MESMA data-base
 *    (as-of), do MESMO spot e da SELIC do pregão.
 *
 * São server-only (tocam no banco e/ou em rede). NÃO contêm regra de negócio nem
 * matemática — só I/O + normalização (numeric do Postgres vem como string → número).
 *
 * Toda função aceita um `db` injetável (default `getDb()`) para teste/composição;
 * nenhuma inventa dado (§2.4): falta de dado vira `null`, não um número-chute.
 */

import { and, desc, eq } from "drizzle-orm";

import { getDb } from "@/db";
import { acaoCotahist, opcaoCotahist } from "@/db/schema";
import {
  buscarSerieMetaSelic,
  criarResolvedorSelic,
} from "@/lib/integrations/bcb-sgs";

/** Instância do cliente Drizzle (server-only). */
export type Db = ReturnType<typeof getDb>;

/**
 * Resolve a DATA-BASE (as-of) do ativo: o `trade_date` MAIS RECENTE em
 * `opcao_cotahist` para aquele ativo-objeto. É o pregão de fechamento sobre o qual
 * a cadeia/gregas serão montadas — a rota usa esta data para CARIMBAR o frescor do
 * dado na tela ("fechamento de DD/MM", §6.2).
 *
 * Devolve `null` quando o ativo não tem NENHUMA opção ingerida (fora da watchlist
 * ou ainda sem ingestão) — o chamador degrada para uma cadeia vazia.
 */
export async function resolverDataBase(
  ativo: string,
  db: Db = getDb(),
): Promise<Date | null> {
  const linhas = await db
    .select({ tradeDate: opcaoCotahist.tradeDate })
    .from(opcaoCotahist)
    .where(eq(opcaoCotahist.underlying, ativo.toUpperCase()))
    .orderBy(desc(opcaoCotahist.tradeDate))
    .limit(1);
  return linhas[0]?.tradeDate ?? null;
}

/**
 * Spot (preço de fechamento do ATIVO-OBJETO) em `acao_cotahist` no pregão `data`.
 * É o `preco_fechamento` (PREULT) — o mesmo spot que alimenta o Black-Scholes.
 *
 * Degrada para `null` quando não há linha de ação naquele pregão (ex.: a opção foi
 * ingerida mas o spot do objeto, não) — nunca chuta um preço (§2.4). Sem spot, a
 * cadeia ainda monta (strikes/prêmios), só sem `precoAtivo`/moneyness.
 */
export async function buscarSpot(
  ativo: string,
  data: Date,
  db: Db = getDb(),
): Promise<number | null> {
  const linhas = await db
    .select({ fechamento: acaoCotahist.precoFechamento })
    .from(acaoCotahist)
    .where(
      and(eq(acaoCotahist.ticker, ativo.toUpperCase()), eq(acaoCotahist.tradeDate, data)),
    )
    .limit(1);
  return linhas[0] ? Number(linhas[0].fechamento) : null;
}

/**
 * SELIC CONTÍNUA (o `r` que o Black-Scholes espera — `ln(1 + Selic/100)`, §18.1)
 * vigente no pregão `data`, via BCB-SGS série 432.
 *
 * Busca a série de Selic numa janela de ~1 ano até o pregão e resolve passo-a-passo
 * (a Meta Selic é constante entre reuniões do Copom): vale a última vigência com
 * `data ≤ pregão`. Devolve `null` se a fonte não cobrir o pregão (não inventa taxa
 * — §2.4); o consumidor decide o fallback (ex.: taxa de `settings`).
 *
 * Reusada pelo 4.3 (gregas on-demand). Sem cache aqui: o consumidor (rota) cacheia.
 */
export async function buscarSelicContinuaNaData(
  data: Date,
  opcoes: { fetchImpl?: typeof fetch } = {},
): Promise<number | null> {
  // Janela recuada 1 ano para garantir uma vigência prévia ao pregão (o resolver
  // precisa de ao menos um ponto com data ≤ pregão).
  const inicio = new Date(data);
  inicio.setUTCFullYear(inicio.getUTCFullYear() - 1);
  const serie = await buscarSerieMetaSelic(inicio, data, opcoes);
  return criarResolvedorSelic(serie)(data);
}
