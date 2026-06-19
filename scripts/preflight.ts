/**
 * PREFLIGHT de deploy/smoke (docs/aceite-mvp.md) — go/no-go para QUALQUER
 * `DATABASE_URL` carregado no ambiente (local OU produção).
 *
 * Objetivo: evitar o cenário "prod apontando para banco vazio". Verifica, contra o
 * banco do ambiente atual:
 *  1. todas as env vars OBRIGATÓRIAS presentes (espelha `lib/env.ts`, pós-migração);
 *  2. banco acessível;
 *  3. tabelas com dado: watchlist = 12, opcao_cotahist > 0, acao_cotahist > 0,
 *     iv_history > 0 (imprime as contagens);
 *  4. ALERTA (não falha) se < 8 dos 12 ativos têm histórico em iv_history.
 *
 * Saída: relatório + "PREFLIGHT OK" (exit 0) ou "PREFLIGHT FALHOU: <motivos>"
 * (exit 1). NÃO deploya nada — é só leitura.
 *
 * Uso: `./node_modules/.bin/tsx scripts/preflight.ts`
 *   - carrega `.env.local` por padrão. Para checar PROD, exporte a `DATABASE_URL`
 *     de produção antes de rodar (ex.: `DATABASE_URL=... tsx scripts/preflight.ts`),
 *     ou rode `vercel env pull` e aponte o ambiente.
 */
import { count, countDistinct } from "drizzle-orm";

import { getDb } from "@/db";
import {
  acaoCotahist,
  ivHistory,
  opcaoCotahist,
  watchlist,
} from "@/db/schema";

// Variáveis carregadas em process.env já presentes ganham deste arquivo; o
// .env.local serve para a rodada LOCAL (em prod, exporta-se a DATABASE_URL antes).
try {
  process.loadEnvFile(".env.local");
} catch {
  // .env.local ausente — usa só o que já está no ambiente (caso de prod/CI).
}

/** Env vars OBRIGATÓRIAS — espelha o schema de `lib/env.ts` (sem OPLAB_ACCESS_TOKEN). */
const ENV_OBRIGATORIAS = [
  "DATABASE_URL",
  "AUTH_SECRET",
  "AUTH_USERNAME",
  "AUTH_PASSWORD",
  "BRAPI_TOKEN",
] as const;

/** Watchlist esperada do MVP (§6.4 / seed-watchlist). */
const WATCHLIST_ESPERADA = 12;
/** Piso de ativos com histórico de IV para não emitir o alerta de cobertura. */
const COBERTURA_IV_MINIMA = 8;

const ok = (s: string) => `  ✅ ${s}`;
const fail = (s: string) => `  ❌ ${s}`;
const warn = (s: string) => `  ⚠️  ${s}`;

async function main() {
  const motivos: string[] = [];
  console.log("══════════════════════════════════════════════════════════════");
  console.log(" PREFLIGHT — deploy/smoke (env + dados)");
  console.log("══════════════════════════════════════════════════════════════");

  // 1) Env vars obrigatórias.
  console.log("\n[1] Variáveis de ambiente obrigatórias");
  for (const nome of ENV_OBRIGATORIAS) {
    const presente = Boolean(process.env[nome]);
    console.log(presente ? ok(nome) : fail(`${nome} — FALTANDO`));
    if (!presente) motivos.push(`env ${nome} faltando`);
  }

  // Sem DATABASE_URL não dá para checar o banco — para por aqui.
  if (!process.env.DATABASE_URL) {
    console.log(fail("DATABASE_URL ausente — não é possível checar o banco."));
    return encerrar(["env DATABASE_URL faltando (banco não verificado)", ...motivos]);
  }

  // Identifica o host do banco (sem vazar credenciais) para conferir o destino.
  let host = "(desconhecido)";
  try {
    host = new URL(process.env.DATABASE_URL).host;
  } catch {
    /* URL malformada — o erro real aparece na conexão abaixo. */
  }
  console.log(`\n[2] Banco de dados  (host: ${host})`);

  // 2) Conexão + 3) contagens.
  let counts: {
    watchlist: number;
    opcoes: number;
    acoes: number;
    iv: number;
    ativosComIv: number;
  };
  try {
    const db = getDb();
    const [w, o, a, iv, cob] = await Promise.all([
      db.select({ c: count() }).from(watchlist),
      db.select({ c: count() }).from(opcaoCotahist),
      db.select({ c: count() }).from(acaoCotahist),
      db.select({ c: count() }).from(ivHistory),
      db.select({ c: countDistinct(ivHistory.ativo) }).from(ivHistory),
    ]);
    counts = {
      watchlist: Number(w[0]!.c),
      opcoes: Number(o[0]!.c),
      acoes: Number(a[0]!.c),
      iv: Number(iv[0]!.c),
      ativosComIv: Number(cob[0]!.c),
    };
    console.log(ok("conexão estabelecida"));
  } catch (e) {
    console.log(fail(`falha ao conectar/consultar: ${(e as Error).message}`));
    return encerrar(["banco inacessível", ...motivos]);
  }

  console.log("\n[3] Tabelas com dado");
  // watchlist deve ter exatamente os 12 ativos do MVP.
  const wOk = counts.watchlist === WATCHLIST_ESPERADA;
  console.log(
    (wOk ? ok : fail)(`watchlist = ${counts.watchlist} (esperado ${WATCHLIST_ESPERADA})`),
  );
  if (!wOk) motivos.push(`watchlist tem ${counts.watchlist}, esperado ${WATCHLIST_ESPERADA}`);

  for (const [rotulo, valor, chave] of [
    ["opcao_cotahist", counts.opcoes, "opcao_cotahist vazia"],
    ["acao_cotahist", counts.acoes, "acao_cotahist vazia"],
    ["iv_history", counts.iv, "iv_history vazia"],
  ] as const) {
    const temDado = valor > 0;
    console.log((temDado ? ok : fail)(`${rotulo} = ${valor}`));
    if (!temDado) motivos.push(chave);
  }

  // 4) Alerta de cobertura (não derruba o preflight).
  console.log("\n[4] Cobertura de IV (alerta, não bloqueia)");
  console.log(`  ativos com histórico em iv_history: ${counts.ativosComIv} de ${WATCHLIST_ESPERADA}`);
  if (counts.ativosComIv < COBERTURA_IV_MINIMA) {
    console.log(
      warn(
        `cobertura baixa: < ${COBERTURA_IV_MINIMA} ativos com histórico. ` +
          "IV Rank/Percentil ficará indisponível para vários ativos — considere rodar o backfill.",
      ),
    );
  } else {
    console.log(ok("cobertura de IV adequada"));
  }

  return encerrar(motivos);
}

/** Imprime o veredito e encerra com o código de saída apropriado. */
function encerrar(motivos: string[]): void {
  console.log("\n──────────────────────────────────────────────────────────────");
  if (motivos.length === 0) {
    console.log("PREFLIGHT OK");
    process.exit(0);
  }
  console.log(`PREFLIGHT FALHOU: ${motivos.join("; ")}`);
  process.exit(1);
}

main().catch((e) => {
  console.error("\nPREFLIGHT FALHOU: erro inesperado —", e);
  process.exit(1);
});
