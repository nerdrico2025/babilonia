/**
 * Cliente Drizzle (Postgres serverless / Neon) — §4 do PRD.
 *
 * O cliente é criado sob demanda para não exigir DATABASE_URL em build time.
 * STUB de conexão — as queries de negócio chegam na Fase 1.
 */
import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import * as schema from "./schema";

export function getDb() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL não configurada (ver .env.example)");
  }
  return drizzle(neon(url), { schema });
}
