import { defineConfig } from "drizzle-kit";

// Carrega DATABASE_URL de .env.local (nativo do Node 22). Silencioso se o
// arquivo não existir — ex.: `db:generate` não precisa de banco.
try {
  process.loadEnvFile(".env.local");
} catch {
  // .env.local ausente — segue com as variáveis já presentes no ambiente.
}

// Configuração do Drizzle Kit (migrations) — §4/§7 do PRD.
export default defineConfig({
  dialect: "postgresql",
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
});
