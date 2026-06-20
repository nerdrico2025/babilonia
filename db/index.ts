/**
 * Cliente Drizzle (Postgres serverless / Neon) — §4 do PRD.
 *
 * O cliente é criado sob demanda para não exigir DATABASE_URL em build time.
 *
 * Dois clientes, por capacidade:
 *  - `getDb()` (neon-http): leituras e escritas simples. NÃO suporta transação
 *    interativa (cada query é um round-trip HTTP autocommit).
 *  - `comTransacao()` (neon-serverless/Pool por WebSocket): TRANSAÇÃO interativa
 *    (BEGIN/…/COMMIT com rollback automático em erro), para escritas que precisam
 *    ser atômicas (ex.: rolagem cria a nova position e marca a antiga numa só
 *    transação). Abre um Pool por chamada e o encerra ao final — adequado a ações
 *    pontuais do usuário (encerrar/rolar), não a leituras de alta frequência.
 */
import { drizzle } from "drizzle-orm/neon-http";
import { drizzle as drizzlePool } from "drizzle-orm/neon-serverless";
import { neon, Pool } from "@neondatabase/serverless";
import * as schema from "./schema";

function exigirUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL não configurada (ver .env.example)");
  }
  return url;
}

export function getDb() {
  return drizzle(neon(exigirUrl()), { schema });
}

/** Cliente Drizzle com Pool (WebSocket) — só para `comTransacao`. */
type PoolDb = ReturnType<typeof criarPoolDb>;
function criarPoolDb(pool: Pool) {
  return drizzlePool(pool, { schema });
}
/** Transação interativa do Drizzle (rollback automático ao lançar). */
export type TxNeon = Parameters<Parameters<PoolDb["transaction"]>[0]>[0];

/**
 * Executa `fn` dentro de UMA transação interativa (atômica). Abre um Pool
 * dedicado, roda `db.transaction(fn)` (que faz COMMIT no sucesso e ROLLBACK se
 * `fn` lançar) e encerra o Pool. O `neon-http` de `getDb()` não suporta isto.
 */
export async function comTransacao<T>(
  fn: (tx: TxNeon) => Promise<T>,
): Promise<T> {
  const pool = new Pool({ connectionString: exigirUrl() });
  try {
    return await criarPoolDb(pool).transaction(fn);
  } finally {
    await pool.end();
  }
}
