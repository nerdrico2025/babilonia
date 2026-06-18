/**
 * Seed da WATCHLIST — os ativos-objeto do MVP (§6.4). A ingestão de opções
 * (`scripts/ingestao-cotahist.ts`) só armazena opções cujo ativo-objeto está
 * AQUI; sem watchlist, nenhuma opção é gravada. Ações à vista não dependem disto.
 *
 * IDEMPOTENTE: `ON CONFLICT (symbol) DO NOTHING` — re-rodar não duplica e não
 * apaga o que já existe. Para editar a watchlist, ajuste a lista `SYMBOLS` e
 * rode de novo (só ENTRA o que faltar; remoções são manuais, por segurança).
 *
 * Uso: `npx tsx scripts/seed-watchlist.ts` (carrega DATABASE_URL de .env.local).
 */
import { getDb } from "@/db";
import { watchlist } from "@/db/schema";

// Carrega DATABASE_URL de .env.local (nativo do Node 22), como no db/seed.ts.
// `getDb()` é lazy, então basta o env estar carregado antes de conectar.
try {
  process.loadEnvFile(".env.local");
} catch {
  // .env.local ausente — usa as variáveis já presentes no ambiente.
}

/**
 * Os 12 ativos-objeto do MVP. Edite esta lista para mudar a watchlist; o seed
 * insere só os que faltam (idempotente).
 */
const SYMBOLS = [
  "VALE3",
  "PETR4",
  "ITSA4",
  "CMIG4",
  "GOAU4",
  "ECOR3",
  "CSNA3",
  "CSAN3",
  "HAPV3",
  "MRVE3",
  "MGLU3",
  "USIM5",
] as const;

async function main() {
  const db = getDb();

  // Upsert idempotente: insere a lista inteira e ignora quem já existe (symbol
  // é UNIQUE no schema). Conta quantas linhas foram realmente inseridas.
  const inseridos = await db
    .insert(watchlist)
    .values(SYMBOLS.map((symbol) => ({ symbol })))
    .onConflictDoNothing({ target: watchlist.symbol })
    .returning({ symbol: watchlist.symbol });

  // Estado final da watchlist (independente de já existir ou não).
  const todos = await db
    .select({ symbol: watchlist.symbol })
    .from(watchlist)
    .orderBy(watchlist.symbol);

  console.log(
    `Watchlist semeada: ${inseridos.length} novo(s) de ${SYMBOLS.length} ` +
      `(os demais já existiam — idempotente).`,
  );
  console.log(`Total na watchlist: ${todos.length} ativo(s):`);
  console.log(`  ${todos.map((t) => t.symbol).join(", ")}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Falha no seed da watchlist:", err);
    process.exit(1);
  });
