/**
 * DIAGNÓSTICO (somente leitura) da IV representativa — não grava nada.
 *
 * Duas funções:
 *  1) DECOMPÕE a causa dos gaps. Para cada dia que vira gap, classifica pelo
 *     PRIMEIRO filtro que reprova a MELHOR série ATM do vencimento ESCOLHIDO
 *     (mesma seleção de `calcularIvRepresentativa`: janela de tenor [14,50] →
 *     gate de liquidez → seletor por proximidade de ~30d), em categorias
 *     mutuamente exclusivas:
 *       (a) nenhum vencimento da janela tem série ATM no piso de liquidez;
 *       (b) escolhido tem série líquida, mas SEM cotação de dois lados (bid/ask=0);
 *       (c) passou, dois lados, mas spread relativo > limite;
 *       (d) passou os filtros de oferta, mas o solver de IV devolveu null.
 *     Buckets fora do funil: `sem-venc` (nada na janela [14,50]), `cadeia-vazia`,
 *     `sem-spot`/`sem-selic`.
 *
 *  2) RECOMPÕE e RELATA, com a lógica de seleção ATUAL (sem gravar):
 *       (a) tabela ativo / dias_com_iv / iv_min / iv_max / iv_media;
 *       (b) PETR4 — 5 maiores e 5 menores IV (checar que 150%/3% sumiram);
 *       (c) t_anos por ativo (min/média/max) — estabilidade do prazo usado;
 *       (d) ativos abaixo de ~200 dias válidos (candidatos a histórico insuficiente).
 *
 * Uso:
 *   tsx scripts/diagnostico-iv-gaps.ts                 # toda a watchlist
 *   tsx scripts/diagnostico-iv-gaps.ts PETR4 VALE3     # ativos específicos
 *   tsx scripts/diagnostico-iv-gaps.ts --detalhe PETR4 # dump do landscape de venc
 */

import { and, eq } from "drizzle-orm";

import {
  calcularIvRepresentativa,
  DIAS_ALVO_VENCIMENTO,
  DIAS_MINIMOS_VENCIMENTO,
  DIAS_MAXIMOS_VENCIMENTO,
  NEG_MINIMO,
  VOLUME_MINIMO,
  SPREAD_RELATIVO_MAXIMO,
  type OpcaoDoDia,
} from "@/lib/options-math";
import {
  buscarSerieMetaSelic,
  criarResolvedorSelic,
} from "@/lib/integrations/bcb-sgs";
import { getDb } from "@/db";
import { acaoCotahist, opcaoCotahist, watchlist } from "@/db/schema";

try {
  process.loadEnvFile(".env.local");
} catch {
  /* usa env do ambiente */
}

const MS_POR_DIA = 86_400_000;
/** Limiar p/ "histórico insuficiente" no IV Rank (PASSO 3d). */
const DIAS_MIN_IV_RANK = 200;

function chaveDia(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function diasCorridos(de: Date, ate: Date): number {
  return (ate.getTime() - de.getTime()) / MS_POR_DIA;
}

/** Mesma ordenação de `iv-representativa.ts` (mais ATM → mais líquida → call → símbolo). */
function ordenarPorAtm(spot: number) {
  return (a: OpcaoDoDia, b: OpcaoDoDia) => {
    const da = Math.abs(a.strike - spot);
    const db = Math.abs(b.strike - spot);
    if (Math.abs(da - db) > 1e-9) return da - db;
    if (a.numeroNegocios !== b.numeroNegocios) return b.numeroNegocios - a.numeroNegocios;
    if (Math.abs(a.volumeFinanceiro - b.volumeFinanceiro) > 1e-9) {
      return b.volumeFinanceiro - a.volumeFinanceiro;
    }
    if (a.tipo !== b.tipo) return a.tipo === "call" ? -1 : 1;
    return a.optionSymbol < b.optionSymbol ? -1 : 1;
  };
}

/**
 * Replica a SELEÇÃO DE VENCIMENTO do módulo: janela [14,50] → gate de liquidez →
 * ordena os que passam por proximidade de ~30d (desempate: maior liquidez).
 * Devolve a lista de vencimentos que passam no gate, em ordem de prioridade, com
 * suas candidatas líquidas já ordenadas por ATM.
 */
function vencimentosPrioridade(
  cadeia: readonly OpcaoDoDia[],
  tradeDate: Date,
  spot: number,
): { venc: number; candidatas: OpcaoDoDia[]; liquidez: number }[] {
  const naJanela = [
    ...new Set(
      cadeia
        .filter((o) => {
          const d = diasCorridos(tradeDate, o.vencimento);
          return d >= DIAS_MINIMOS_VENCIMENTO && d <= DIAS_MAXIMOS_VENCIMENTO;
        })
        .map((o) => o.vencimento.getTime()),
    ),
  ];
  const passam: { venc: number; candidatas: OpcaoDoDia[]; liquidez: number }[] = [];
  for (const venc of naJanela) {
    const candidatas = cadeia
      .filter((o) => o.vencimento.getTime() === venc)
      .filter((o) => o.numeroNegocios >= NEG_MINIMO && o.volumeFinanceiro >= VOLUME_MINIMO)
      .sort(ordenarPorAtm(spot));
    if (candidatas.length === 0) continue;
    const liquidez = candidatas.reduce((m, o) => Math.max(m, o.numeroNegocios), 0);
    passam.push({ venc, candidatas, liquidez });
  }
  passam.sort((a, b) => {
    const da = Math.abs(diasCorridos(tradeDate, new Date(a.venc)) - DIAS_ALVO_VENCIMENTO);
    const db = Math.abs(diasCorridos(tradeDate, new Date(b.venc)) - DIAS_ALVO_VENCIMENTO);
    if (Math.abs(da - db) > 1e-9) return da - db;
    if (a.liquidez !== b.liquidez) return b.liquidez - a.liquidez;
    return a.venc - b.venc;
  });
  return passam;
}

type Categoria = "a-liquidez" | "b-um-lado" | "c-spread" | "d-solver";

/** Classifica um gap pela melhor série ATM do vencimento de maior prioridade. */
function classificarGap(
  spot: number,
  cadeia: readonly OpcaoDoDia[],
  r: number,
  tradeDate: Date,
): Categoria {
  const prioridade = vencimentosPrioridade(cadeia, tradeDate, spot);
  if (prioridade.length === 0) return "a-liquidez";
  const melhor = prioridade[0]!.candidatas[0]!;
  if (!(melhor.bid > 0) || !(melhor.ask > 0)) return "b-um-lado";
  const mid = (melhor.bid + melhor.ask) / 2;
  if ((melhor.ask - melhor.bid) / mid > SPREAD_RELATIVO_MAXIMO) return "c-spread";
  return "d-solver"; // dois lados + spread ok num gap ⇒ o que falhou foi o solver
}

interface DiagAtivo {
  ativo: string;
  pregoesComOpcoes: number;
  validos: number;
  catA: number;
  catB: number;
  catC: number;
  catD: number;
  semVencimento: number;
  cadeiaVazia: number;
  semSpotOuSelic: number;
  // recompute
  ivs: {
    dia: string;
    iv: number;
    opcao: string;
    diasVenc: number;
    tipo: string;
    strike: number;
    spot: number;
    bid: number;
    ask: number;
    premio: number;
    neg: number;
  }[];
  tAnos: number[];
}

function fmtPct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

async function main(): Promise<void> {
  const flags = process.argv.slice(2).filter((a) => a.startsWith("--"));
  const detalhe = flags.includes("--detalhe");
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));

  const db = getDb();

  const ativos =
    args.length > 0
      ? args
      : (await db.select({ symbol: watchlist.symbol }).from(watchlist)).map((w) => w.symbol);
  if (ativos.length === 0) {
    console.error("Watchlist vazia e nenhum ativo passado.");
    process.exit(1);
  }

  // Janela p/ Selic, igual ao orquestrador.
  const acoes = await db.select({ tradeDate: acaoCotahist.tradeDate }).from(acaoCotahist);
  if (acoes.length === 0) {
    console.error("acao_cotahist vazia.");
    process.exit(1);
  }
  let min = acoes[0]!.tradeDate;
  let max = acoes[0]!.tradeDate;
  for (const a of acoes) {
    if (a.tradeDate < min) min = a.tradeDate;
    if (a.tradeDate > max) max = a.tradeDate;
  }
  const inicioSelic = new Date(min);
  inicioSelic.setUTCFullYear(inicioSelic.getUTCFullYear() - 1);
  const serieSelic = await buscarSerieMetaSelic(inicioSelic, max);
  const resolverSelic = criarResolvedorSelic(serieSelic);

  console.error(
    `Seleção: janela [${DIAS_MINIMOS_VENCIMENTO},${DIAS_MAXIMOS_VENCIMENTO}]d, alvo ${DIAS_ALVO_VENCIMENTO}d, ` +
      `gate neg≥${NEG_MINIMO} & vol≥${VOLUME_MINIMO}, MID 2 lados + spread≤${SPREAD_RELATIVO_MAXIMO}\n`,
  );

  const diags: DiagAtivo[] = [];

  for (const ativo of ativos) {
    const d: DiagAtivo = {
      ativo,
      pregoesComOpcoes: 0,
      validos: 0,
      catA: 0,
      catB: 0,
      catC: 0,
      catD: 0,
      semVencimento: 0,
      cadeiaVazia: 0,
      semSpotOuSelic: 0,
      ivs: [],
      tAnos: [],
    };

    const spots = await db
      .select({ tradeDate: acaoCotahist.tradeDate, fechamento: acaoCotahist.precoFechamento })
      .from(acaoCotahist)
      .where(eq(acaoCotahist.ticker, ativo));
    const spotPorDia = new Map<string, number>();
    for (const s of spots) spotPorDia.set(chaveDia(s.tradeDate), Number(s.fechamento));

    const opcoes = await db
      .select({
        optionSymbol: opcaoCotahist.optionSymbol,
        kind: opcaoCotahist.kind,
        strike: opcaoCotahist.strike,
        bid: opcaoCotahist.bid,
        ask: opcaoCotahist.ask,
        vencimento: opcaoCotahist.expiresAt,
        tradeDate: opcaoCotahist.tradeDate,
        volumeFinanceiro: opcaoCotahist.volumeFinanceiro,
        numeroNegocios: opcaoCotahist.numeroNegocios,
      })
      .from(opcaoCotahist)
      .where(and(eq(opcaoCotahist.underlying, ativo), eq(opcaoCotahist.fatorCotacao, 1)));

    const cadeiaPorDia = new Map<string, OpcaoDoDia[]>();
    for (const o of opcoes) {
      const dia = chaveDia(o.tradeDate);
      const lista = cadeiaPorDia.get(dia) ?? [];
      lista.push({
        optionSymbol: o.optionSymbol,
        tipo: o.kind,
        strike: Number(o.strike),
        bid: Number(o.bid),
        ask: Number(o.ask),
        vencimento: o.vencimento,
        volumeFinanceiro: Number(o.volumeFinanceiro),
        numeroNegocios: o.numeroNegocios,
      });
      cadeiaPorDia.set(dia, lista);
    }

    let dumpRestante = detalhe ? 5 : 0;

    for (const [dia, cadeia] of cadeiaPorDia) {
      d.pregoesComOpcoes++;
      const tradeDate = new Date(`${dia}T00:00:00.000Z`);
      const spot = spotPorDia.get(dia);
      if (spot === undefined) {
        d.semSpotOuSelic++;
        continue;
      }
      const r = resolverSelic(tradeDate);
      if (r === null) {
        d.semSpotOuSelic++;
        continue;
      }

      const res = calcularIvRepresentativa({ spot, cadeia, r, tradeDate });
      if (res.iv !== null) {
        d.validos++;
        d.tAnos.push(res.tAnos);
        const serie = cadeia.find((o) => o.optionSymbol === res.opcaoUsada);
        d.ivs.push({
          dia,
          iv: res.iv,
          opcao: res.opcaoUsada,
          diasVenc: Math.round(diasCorridos(tradeDate, res.vencimentoUsado)),
          tipo: res.tipoUsado,
          strike: serie?.strike ?? 0,
          spot: res.spotUsado,
          bid: serie?.bid ?? 0,
          ask: serie?.ask ?? 0,
          premio: res.premioUsado,
          neg: serie?.numeroNegocios ?? 0,
        });
        continue;
      }

      if (res.motivo === "cadeia-vazia") {
        d.cadeiaVazia++;
        continue;
      }
      if (res.motivo === "sem-vencimento-valido") {
        d.semVencimento++;
        continue;
      }
      const cat = classificarGap(spot, cadeia, r, tradeDate);
      if (cat === "a-liquidez") {
        d.catA++;
        if (dumpRestante > 0) {
          dumpRestante--;
          const porVenc = new Map<number, number>();
          for (const o of cadeia) {
            const dd = diasCorridos(tradeDate, o.vencimento);
            if (dd < DIAS_MINIMOS_VENCIMENTO || dd > DIAS_MAXIMOS_VENCIMENTO) continue;
            const t = o.vencimento.getTime();
            porVenc.set(t, Math.max(porVenc.get(t) ?? 0, o.numeroNegocios));
          }
          const linha = [...porVenc.entries()]
            .sort((x, y) => x[0] - y[0])
            .map(([t, mn]) => `${Math.round(diasCorridos(tradeDate, new Date(t)))}d:maxNeg${mn}`)
            .join("  ");
          console.error(`    [${ativo} ${dia}] janela: ${linha || "(nada em [14,50])"}`);
        }
      } else if (cat === "b-um-lado") d.catB++;
      else if (cat === "c-spread") d.catC++;
      else d.catD++;
    }

    diags.push(d);
  }

  // ── Decomposição dos gaps ──────────────────────────────────────────────────
  console.error("\nDECOMPOSIÇÃO DOS GAPS (lógica de seleção ATUAL)\n");
  const cab =
    "ativo".padEnd(7) +
    "pregões".padStart(9) +
    "válidos".padStart(9) +
    "gaps".padStart(7) +
    " | " +
    "(a)liq".padStart(7) +
    "(b)1lado".padStart(9) +
    "(c)sprd".padStart(8) +
    "(d)solv".padStart(8) +
    " | " +
    "s/venc".padStart(7) +
    "s/spot".padStart(7);
  console.error(cab);
  console.error("-".repeat(cab.length));
  for (const d of diags) {
    const gaps =
      d.catA + d.catB + d.catC + d.catD + d.semVencimento + d.cadeiaVazia + d.semSpotOuSelic;
    console.error(
      d.ativo.padEnd(7) +
        String(d.pregoesComOpcoes).padStart(9) +
        String(d.validos).padStart(9) +
        String(gaps).padStart(7) +
        " | " +
        String(d.catA).padStart(7) +
        String(d.catB).padStart(9) +
        String(d.catC).padStart(8) +
        String(d.catD).padStart(8) +
        " | " +
        String(d.semVencimento).padStart(7) +
        String(d.semSpotOuSelic).padStart(7),
    );
  }

  // ── (a) Tabela de IV por ativo ─────────────────────────────────────────────
  console.error("\n(a) IV representativa por ativo (recomputada, NÃO gravada)\n");
  const ca =
    "ativo".padEnd(7) + "dias_com_iv".padStart(12) + "iv_min".padStart(9) + "iv_max".padStart(9) + "iv_media".padStart(10);
  console.error(ca);
  console.error("-".repeat(ca.length));
  for (const d of diags) {
    if (d.ivs.length === 0) {
      console.error(d.ativo.padEnd(7) + "0".padStart(12) + "—".padStart(9) + "—".padStart(9) + "—".padStart(10));
      continue;
    }
    const vals = d.ivs.map((x) => x.iv);
    const ivMin = Math.min(...vals);
    const ivMax = Math.max(...vals);
    const ivMed = vals.reduce((a, b) => a + b, 0) / vals.length;
    console.error(
      d.ativo.padEnd(7) +
        String(d.ivs.length).padStart(12) +
        fmtPct(ivMin).padStart(9) +
        fmtPct(ivMax).padStart(9) +
        fmtPct(ivMed).padStart(10),
    );
  }

  // ── (b) PETR4 — extremos de IV ─────────────────────────────────────────────
  const petr = diags.find((d) => d.ativo === "PETR4");
  if (petr && petr.ivs.length > 0) {
    const ord = [...petr.ivs].sort((a, b) => a.iv - b.iv);
    console.error("\n(b) PETR4 — 5 MENORES IV:");
    for (const x of ord.slice(0, 5)) {
      console.error(`    ${x.dia}  IV=${fmtPct(x.iv)}  ${x.opcao}  (${x.diasVenc}d)`);
    }
    console.error("(b) PETR4 — 5 MAIORES IV:");
    for (const x of ord.slice(-5).reverse()) {
      console.error(`    ${x.dia}  IV=${fmtPct(x.iv)}  ${x.opcao}  (${x.diasVenc}d)`);
    }
  }

  // ── (c) t_anos por ativo ───────────────────────────────────────────────────
  console.error("\n(c) t_anos usado por ativo (min / média / max) — estabilidade do prazo\n");
  const cc = "ativo".padEnd(7) + "t_min".padStart(9) + "t_med".padStart(9) + "t_max".padStart(9) + "dias_med".padStart(10);
  console.error(cc);
  console.error("-".repeat(cc.length));
  for (const d of diags) {
    if (d.tAnos.length === 0) {
      console.error(d.ativo.padEnd(7) + "—".padStart(9) + "—".padStart(9) + "—".padStart(9) + "—".padStart(10));
      continue;
    }
    const tMin = Math.min(...d.tAnos);
    const tMax = Math.max(...d.tAnos);
    const tMed = d.tAnos.reduce((a, b) => a + b, 0) / d.tAnos.length;
    console.error(
      d.ativo.padEnd(7) +
        tMin.toFixed(4).padStart(9) +
        tMed.toFixed(4).padStart(9) +
        tMax.toFixed(4).padStart(9) +
        (tMed * 365).toFixed(1).padStart(10),
    );
  }

  // ── Auditoria dos MAIORES IV por ativo (checar artefato vs. spike real) ─────
  console.error("\nAUDITORIA — 3 maiores IV por ativo (moneyness + spread do MID escolhido):");
  for (const d of diags) {
    if (d.ivs.length === 0) continue;
    const top = [...d.ivs].sort((a, b) => b.iv - a.iv).slice(0, 3);
    const linhas = top.map((x) => {
      const mny = ((x.strike / x.spot - 1) * 100).toFixed(1);
      const spreadRel = x.premio > 0 ? (((x.ask - x.bid) / x.premio) * 100).toFixed(0) : "—";
      return `${x.dia} IV=${fmtPct(x.iv)} ${x.opcao}(${x.tipo} K${x.strike}/S${x.spot.toFixed(2)}=${mny}% ${x.diasVenc}d neg${x.neg} bid${x.bid}/ask${x.ask} sprd${spreadRel}%)`;
    });
    console.error(`  ${d.ativo}: ${linhas.join("  |  ")}`);
  }

  // ── Resíduo de outliers (qualidade) — independe da seleção de venc ──────────
  console.error("\nRESÍDUO DE OUTLIERS (IV alta por MID largo / strike fora do dinheiro):");
  let totGt150 = 0;
  let totGt120 = 0;
  for (const d of diags) {
    const gt150 = d.ivs.filter((x) => x.iv > 1.5).length;
    const gt120 = d.ivs.filter((x) => x.iv > 1.2).length;
    const longe = d.ivs.filter((x) => Math.abs(x.strike / x.spot - 1) > 0.1).length;
    totGt150 += gt150;
    totGt120 += gt120;
    if (gt120 > 0 || longe > 0) {
      console.error(
        `  ${d.ativo}: IV>150%: ${gt150}; IV>120%: ${gt120}; séries com |moneyness|>10%: ${longe}/${d.ivs.length}`,
      );
    }
  }
  console.error(`  TOTAL nos 12: IV>150% = ${totGt150} dia(s); IV>120% = ${totGt120} dia(s).`);

  // ── (d) Histórico insuficiente p/ IV Rank ──────────────────────────────────
  const abaixo = diags.filter((d) => d.validos < DIAS_MIN_IV_RANK);
  console.error(`\n(d) Ativos com < ${DIAS_MIN_IV_RANK} dias válidos (candidatos a "histórico insuficiente" no IV Rank):`);
  if (abaixo.length === 0) {
    console.error("    nenhum — todos com histórico suficiente.");
  } else {
    for (const d of abaixo) console.error(`    ${d.ativo}: ${d.validos} dias`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\nFalha no diagnóstico:", err instanceof Error ? err.message : err);
    if (err && typeof err === "object") {
      const cause = (err as { cause?: unknown }).cause;
      if (cause) console.error("Causa:", cause);
    }
    process.exit(1);
  });
