/**
 * Orquestrador da IV REPRESENTATIVA diária → tabela `iv_history` (§6.4).
 *
 * Operação BATCH (manual/agendada), NÃO request-por-tela (§5.1). Carrega do
 * Postgres o spot (acao_cotahist) e a cadeia (opcao_cotahist) por dia, busca a
 * Selic histórica (BCB-SGS), chama a função PURA `calcularIvRepresentativa`
 * (lib/options-math) e faz upsert em `iv_history`. Toda a matemática mora no
 * núcleo puro/testado; aqui é só I/O + montagem.
 *
 * Uso:
 *   npx tsx scripts/calcular-iv.ts                # todos os ativos da watchlist
 *   npx tsx scripts/calcular-iv.ts PETR4 VALE3    # só esses ativos
 *   npx tsx scripts/calcular-iv.ts --dry PETR4    # calcula e RELATA, sem gravar
 *
 * NÃO calcula IV Rank/Percentil — só a IV diária. O Rank vem depois, lendo
 * `iv_history`.
 *
 * ⚠️ FATCOT: o Black-Scholes opera por AÇÃO. Séries com `fatorCotacao ≠ 1` (raras
 * em opções de ação; o prêmio sai cotado por FATCOT ações) são PULADAS aqui para
 * não contaminar a IV — tratá-las corretamente fica para quando aparecerem.
 */

import { and, eq, sql } from "drizzle-orm";

import {
  calcularIvRepresentativa,
  type OpcaoDoDia,
  type MotivoGapIv,
} from "@/lib/options-math";
import {
  buscarSerieMetaSelic,
  criarResolvedorSelic,
} from "@/lib/integrations/bcb-sgs";
import { getDb } from "@/db";
import { acaoCotahist, opcaoCotahist, ivHistory, watchlist } from "@/db/schema";
import type { NewIvHistory } from "@/db/schema";

// Carrega DATABASE_URL de .env.local (nativo do Node 22), como nos outros scripts.
try {
  process.loadEnvFile(".env.local");
} catch {
  // .env.local ausente — usa as variáveis já presentes no ambiente.
}

const TAMANHO_LOTE = 500;

/** Chave de dia (YYYY-MM-DD em UTC) para casar spot ↔ cadeia do mesmo pregão. */
function chaveDia(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Relatório por ativo: quantos dias geraram IV e os gaps por motivo. */
interface RelatorioAtivo {
  ativo: string;
  pregoesComOpcoes: number;
  ivCalculadas: number;
  gaps: Map<MotivoGapIv | "sem-spot", number>;
}

function registrarGap(rel: RelatorioAtivo, motivo: MotivoGapIv | "sem-spot") {
  rel.gaps.set(motivo, (rel.gaps.get(motivo) ?? 0) + 1);
}

/** Converte uma linha de `iv_history` calculada nos campos de upsert (numéricos → string). */
function paraUpsert(
  ativo: string,
  tradeDate: Date,
  res: {
    iv: number;
    vencimentoUsado: Date;
    opcaoUsada: string;
    tipoUsado: "call" | "put";
    spotUsado: number;
    rUsado: number;
    tAnos: number;
  },
): NewIvHistory {
  return {
    ativo,
    tradeDate,
    iv: res.iv.toFixed(6),
    vencimentoUsado: res.vencimentoUsado,
    opcaoUsada: res.opcaoUsada,
    tipoUsado: res.tipoUsado,
    spotUsado: res.spotUsado.toFixed(2),
    rUsado: res.rUsado.toFixed(6),
    tAnos: res.tAnos.toFixed(6),
  };
}

async function upsertLote(
  db: ReturnType<typeof getDb>,
  linhas: NewIvHistory[],
): Promise<void> {
  if (linhas.length === 0) return;
  await db
    .insert(ivHistory)
    .values(linhas)
    .onConflictDoUpdate({
      target: [ivHistory.ativo, ivHistory.tradeDate],
      set: {
        iv: sql`excluded.iv`,
        vencimentoUsado: sql`excluded.vencimento_usado`,
        opcaoUsada: sql`excluded.opcao_usada`,
        tipoUsado: sql`excluded.tipo_usado`,
        spotUsado: sql`excluded.spot_usado`,
        rUsado: sql`excluded.r_usado`,
        tAnos: sql`excluded.t_anos`,
        updatedAt: new Date(),
      },
    });
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dry = args.includes("--dry");
  const ativosArg = args.filter((a) => a !== "--dry");

  const db = getDb();

  // 1) Ativos: os do argumento, ou toda a watchlist.
  const ativos =
    ativosArg.length > 0
      ? ativosArg
      : (await db.select({ symbol: watchlist.symbol }).from(watchlist)).map(
          (w) => w.symbol,
        );
  if (ativos.length === 0) {
    console.error("Nenhum ativo (watchlist vazia e nenhum passado por argumento).");
    process.exit(1);
  }
  console.error(`Ativos: ${ativos.join(", ")}${dry ? "  [DRY-RUN]" : ""}`);

  // 2) Janela de pregões (de acao_cotahist) → série da Selic. Busca a partir de
  //    bem antes do 1º pregão p/ garantir uma vigência de Selic prévia (resolver
  //    passo-a-passo precisa de uma data ≤ pregão).
  const range = await db
    .select({
      min: sql<string | null>`min(${acaoCotahist.tradeDate})`,
      max: sql<string | null>`max(${acaoCotahist.tradeDate})`,
    })
    .from(acaoCotahist);
  const minData = range[0]?.min ? new Date(range[0].min) : null;
  const maxData = range[0]?.max ? new Date(range[0].max) : null;
  if (!minData || !maxData) {
    console.error("acao_cotahist vazia — sem spot, nada a calcular.");
    process.exit(1);
  }
  const inicioSelic = new Date(minData);
  inicioSelic.setUTCFullYear(inicioSelic.getUTCFullYear() - 1);

  console.error(
    `Buscando Selic (432) de ${chaveDia(inicioSelic)} a ${chaveDia(maxData)} …`,
  );
  const serieSelic = await buscarSerieMetaSelic(inicioSelic, maxData);
  const resolverSelic = criarResolvedorSelic(serieSelic);
  console.error(`Série Selic: ${serieSelic.length} vigência(s).`);

  // 3) Por ativo: carrega spot e cadeia, agrupa por dia, calcula e (talvez) grava.
  let lote: NewIvHistory[] = [];
  const descarregar = async () => {
    if (dry || lote.length === 0) return;
    await upsertLote(db, lote);
    lote = [];
  };

  const relatorios: RelatorioAtivo[] = [];

  for (const ativo of ativos) {
    const rel: RelatorioAtivo = {
      ativo,
      pregoesComOpcoes: 0,
      ivCalculadas: 0,
      gaps: new Map(),
    };

    // Spot do ativo por dia.
    const spots = await db
      .select({
        tradeDate: acaoCotahist.tradeDate,
        fechamento: acaoCotahist.precoFechamento,
      })
      .from(acaoCotahist)
      .where(eq(acaoCotahist.ticker, ativo));
    const spotPorDia = new Map<string, number>();
    for (const s of spots) spotPorDia.set(chaveDia(s.tradeDate), Number(s.fechamento));

    // Cadeia do ativo (só FATCOT=1) agrupada por dia.
    const opcoes = await db
      .select({
        optionSymbol: opcaoCotahist.optionSymbol,
        kind: opcaoCotahist.kind,
        strike: opcaoCotahist.strike,
        premio: opcaoCotahist.precoFechamento,
        vencimento: opcaoCotahist.expiresAt,
        tradeDate: opcaoCotahist.tradeDate,
        volumeFinanceiro: opcaoCotahist.volumeFinanceiro,
        numeroNegocios: opcaoCotahist.numeroNegocios,
      })
      .from(opcaoCotahist)
      .where(
        and(eq(opcaoCotahist.underlying, ativo), eq(opcaoCotahist.fatorCotacao, 1)),
      );

    const cadeiaPorDia = new Map<string, OpcaoDoDia[]>();
    for (const o of opcoes) {
      const dia = chaveDia(o.tradeDate);
      const lista = cadeiaPorDia.get(dia) ?? [];
      lista.push({
        optionSymbol: o.optionSymbol,
        tipo: o.kind,
        strike: Number(o.strike),
        premio: Number(o.premio),
        vencimento: o.vencimento,
        volumeFinanceiro: Number(o.volumeFinanceiro),
        numeroNegocios: o.numeroNegocios,
      });
      cadeiaPorDia.set(dia, lista);
    }

    // Um cálculo por dia que tem cadeia.
    for (const [dia, cadeia] of cadeiaPorDia) {
      rel.pregoesComOpcoes++;
      const tradeDate = new Date(`${dia}T00:00:00.000Z`);

      const spot = spotPorDia.get(dia);
      if (spot === undefined) {
        registrarGap(rel, "sem-spot");
        continue;
      }
      const r = resolverSelic(tradeDate);
      if (r === null) {
        // Sem Selic vigente para o dia — não inventa taxa. (Não deveria ocorrer
        // dado o início recuado da busca; conta como gap de spot/dados.)
        registrarGap(rel, "sem-spot");
        continue;
      }

      const res = calcularIvRepresentativa({ spot, cadeia, r, tradeDate });
      if (res.iv === null) {
        registrarGap(rel, res.motivo);
        continue;
      }
      rel.ivCalculadas++;
      lote.push(paraUpsert(ativo, tradeDate, res));
      if (lote.length >= TAMANHO_LOTE) await descarregar();
    }

    relatorios.push(rel);
  }

  await descarregar();

  // 4) Relatório final.
  console.error(`\nIV representativa ${dry ? "(DRY-RUN, nada gravado)" : "gravada"}:`);
  for (const rel of relatorios) {
    const gaps = [...rel.gaps.entries()]
      .map(([m, n]) => `${m}=${n}`)
      .join(", ");
    console.error(
      `  ${rel.ativo}: ${rel.ivCalculadas} IV / ${rel.pregoesComOpcoes} pregões com opções` +
        (gaps ? `  (gaps: ${gaps})` : ""),
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\nFalha no cálculo de IV:", err instanceof Error ? err.message : err);
    if (err && typeof err === "object") {
      const cause = (err as { cause?: unknown }).cause;
      if (cause) console.error("Causa:", cause);
    }
    process.exit(1);
  });
