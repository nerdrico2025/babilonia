/**
 * Seed mínimo da Fase 0 — garante uma linha em `settings` com um capital total
 * de exemplo (base das regras de risco do §10). Idempotente: não duplica.
 *
 * Uso: `npm run db:seed` (carrega DATABASE_URL de .env.local).
 */
import { getDb } from "./index";
import { settings } from "./schema";

// Carrega DATABASE_URL de .env.local (nativo do Node 22). `getDb()` é lazy, então
// basta o env estar carregado antes de `main()` conectar.
try {
  process.loadEnvFile(".env.local");
} catch {
  // .env.local ausente — usa as variáveis já presentes no ambiente.
}

async function main() {
  const db = getDb();

  const existing = await db.select({ id: settings.id }).from(settings).limit(1);
  if (existing.length > 0) {
    console.log("settings já existe — seed ignorado (idempotente).");
    return;
  }

  await db.insert(settings).values({
    // Capital total de exemplo: R$ 50.000,00 (numeric guardado como string).
    totalCapital: "50000.00",
    displayPreferences: {},
  });
  console.log("Seed concluído: settings criado com capital total R$ 50.000,00.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Falha no seed:", err);
    process.exit(1);
  });
