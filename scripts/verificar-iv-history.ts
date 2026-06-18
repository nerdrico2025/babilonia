/**
 * VERIFICAÇÃO do iv_history PERSISTIDO (lê o que está gravado, não recalcula).
 *
 *   tsx scripts/verificar-iv-history.ts            # contagem total + agregados por ativo
 *   tsx scripts/verificar-iv-history.ts --limpar   # APAGA todas as linhas (regenerável)
 */

import { sql } from "drizzle-orm";

import { getDb } from "@/db";
import { ivHistory } from "@/db/schema";

try {
  process.loadEnvFile(".env.local");
} catch {
  /* usa env do ambiente */
}

async function main(): Promise<void> {
  const limpar = process.argv.slice(2).includes("--limpar");
  const db = getDb();

  if (limpar) {
    const antes = await db.select({ n: sql<number>`count(*)::int` }).from(ivHistory);
    await db.delete(ivHistory);
    console.error(`iv_history LIMPO: ${antes[0]?.n ?? 0} linha(s) apagada(s).`);
    return;
  }

  const total = await db.select({ n: sql<number>`count(*)::int` }).from(ivHistory);
  console.error(`Total de linhas em iv_history: ${total[0]?.n ?? 0}\n`);

  const linhas = await db
    .select({
      ativo: ivHistory.ativo,
      dias: sql<number>`count(*)::int`,
      ivMin: sql<string>`min(${ivHistory.iv})`,
      ivMax: sql<string>`max(${ivHistory.iv})`,
      ivMed: sql<string>`avg(${ivHistory.iv})`,
    })
    .from(ivHistory)
    .groupBy(ivHistory.ativo)
    .orderBy(sql`count(*) desc`);

  const hdr =
    "ativo".padEnd(7) + "dias_com_iv".padStart(12) + "iv_min".padStart(9) + "iv_max".padStart(9) + "iv_media".padStart(10);
  console.error(hdr);
  console.error("-".repeat(hdr.length));
  for (const l of linhas) {
    const pct = (s: string) => `${(Number(s) * 100).toFixed(1)}%`;
    console.error(
      l.ativo.padEnd(7) +
        String(l.dias).padStart(12) +
        pct(l.ivMin).padStart(9) +
        pct(l.ivMax).padStart(9) +
        pct(l.ivMed).padStart(10),
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\nFalha:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
