/**
 * Orquestrador do IV RANK / IV PERCENTIL (§8.2, §9) — lê `iv_history` e chama o
 * núcleo PURO `calcularIvRank` (lib/options-math). NÃO recalcula IV nem toca em
 * cadeia: só consome a série diária já gravada.
 *
 * O Rank é DERIVÁVEL on-the-fly da `iv_history` — por isso NÃO há tabela nova
 * (decisão trancada). Este script é o ponto de leitura; a UI fará a mesma consulta
 * via uma query equivalente quando chegar a vez dela.
 *
 * Uso:
 *   npx tsx scripts/iv-rank.ts                # tabela do ÚLTIMO pregão, todos os ativos
 *   npx tsx scripts/iv-rank.ts PETR4 VALE3    # só esses ativos
 *
 * Para cada ativo: carrega toda a série de IV (ordenada por pregão), usa o ÚLTIMO
 * pregão como alvo e calcula Rank/Percentil/estado sobre a janela de 252.
 */

import { asc, inArray } from "drizzle-orm";

import { calcularIvRank, type PontoIv } from "@/lib/options-math";
import { getDb } from "@/db";
import { ivHistory } from "@/db/schema";

// Carrega DATABASE_URL de .env.local (nativo do Node 22), como nos outros scripts.
try {
  process.loadEnvFile(".env.local");
} catch {
  // .env.local ausente — usa as variáveis já presentes no ambiente.
}

/** Formata uma fração [0..100] como "NN.N" ou "—" quando null. */
function fmtPct(x: number | null): string {
  return x === null ? "—" : x.toFixed(1);
}

/** Formata IV decimal como percentual a.a. ("35.2%"). */
function fmtIv(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

async function main(): Promise<void> {
  const filtro = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const db = getDb();

  // Carrega a série de IV (ativo, pregão, iv) em ordem cronológica. Filtra por
  // ativos da linha de comando, se houver.
  const linhas = await db
    .select({
      ativo: ivHistory.ativo,
      tradeDate: ivHistory.tradeDate,
      iv: ivHistory.iv,
    })
    .from(ivHistory)
    .where(filtro.length > 0 ? inArray(ivHistory.ativo, filtro) : undefined)
    .orderBy(asc(ivHistory.ativo), asc(ivHistory.tradeDate));

  // Agrupa por ativo, preservando a ordem cronológica.
  const porAtivo = new Map<string, PontoIv[]>();
  for (const l of linhas) {
    const serie = porAtivo.get(l.ativo) ?? [];
    serie.push({ tradeDate: l.tradeDate, iv: Number(l.iv) });
    porAtivo.set(l.ativo, serie);
  }

  if (porAtivo.size === 0) {
    console.error("Nenhuma linha em iv_history para os filtros informados.");
    return;
  }

  // Monta as linhas do relatório (alvo = último pregão da série de cada ativo).
  interface LinhaRel {
    ativo: string;
    pregaoAlvo: string;
    ivHoje: number;
    ivRank: number | null;
    ivPercentil: number | null;
    dias: number;
    estado: string;
  }

  const rel: LinhaRel[] = [];
  for (const [ativo, serie] of porAtivo) {
    const alvo = serie[serie.length - 1];
    if (alvo === undefined) continue;
    const r = calcularIvRank(serie, alvo.iv);
    rel.push({
      ativo,
      pregaoAlvo: alvo.tradeDate.toISOString().slice(0, 10),
      ivHoje: alvo.iv,
      ivRank: r.ivRank,
      ivPercentil: r.ivPercentil,
      dias: r.diasNaJanela,
      estado: r.estado,
    });
  }

  // Ordena por estado (completo → parcial → insuficiente) e, dentro, por Rank desc.
  const ordemEstado: Record<string, number> = {
    completo: 0,
    parcial: 1,
    insuficiente: 2,
  };
  rel.sort((a, b) => {
    const oe = (ordemEstado[a.estado] ?? 9) - (ordemEstado[b.estado] ?? 9);
    if (oe !== 0) return oe;
    return (b.ivRank ?? -1) - (a.ivRank ?? -1);
  });

  // Imprime a tabela.
  const cab =
    "ativo".padEnd(7) +
    "pregão".padEnd(12) +
    "IV hoje".padStart(9) +
    "IV Rank".padStart(9) +
    "IV %ile".padStart(9) +
    "dias".padStart(6) +
    "  estado";
  console.error(cab);
  console.error("-".repeat(cab.length + 6));
  for (const r of rel) {
    console.error(
      r.ativo.padEnd(7) +
        r.pregaoAlvo.padEnd(12) +
        fmtIv(r.ivHoje).padStart(9) +
        fmtPct(r.ivRank).padStart(9) +
        fmtPct(r.ivPercentil).padStart(9) +
        String(r.dias).padStart(6) +
        "  " +
        r.estado,
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
