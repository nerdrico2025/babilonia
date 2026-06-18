/**
 * VARREDURA (somente leitura) — trade-off cobertura × resíduo de outliers.
 *
 * Para cada combinação de TRAVA DE MONEYNESS × SPREAD máximo, recomputa a IV de
 * toda a watchlist (sem gravar) e reporta, por ativo: dias válidos e nº de dias
 * com IV > 120%. Serve só para escolher os limites antes de cravá-los no módulo.
 *
 * Uso: tsx scripts/varredura-iv-qualidade.ts
 */

import { and, eq } from "drizzle-orm";

import { calcularIvRepresentativa, type OpcaoDoDia } from "@/lib/options-math";
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

const MONEYNESS_GRID = [0.1, 0.15];
const SPREAD_GRID = [0.5, 0.7];
const OUTLIER = 1.2; // limiar de "resíduo" a contar

function chaveDia(d: Date): string {
  return d.toISOString().slice(0, 10);
}

interface DadosAtivo {
  ativo: string;
  dias: { tradeDate: Date; spot: number; r: number; cadeia: OpcaoDoDia[] }[];
}

async function main(): Promise<void> {
  const db = getDb();
  const ativos = (await db.select({ symbol: watchlist.symbol }).from(watchlist)).map(
    (w) => w.symbol,
  );

  const acoes = await db.select({ tradeDate: acaoCotahist.tradeDate }).from(acaoCotahist);
  let min = acoes[0]!.tradeDate;
  let max = acoes[0]!.tradeDate;
  for (const a of acoes) {
    if (a.tradeDate < min) min = a.tradeDate;
    if (a.tradeDate > max) max = a.tradeDate;
  }
  const inicioSelic = new Date(min);
  inicioSelic.setUTCFullYear(inicioSelic.getUTCFullYear() - 1);
  const resolverSelic = criarResolvedorSelic(await buscarSerieMetaSelic(inicioSelic, max));

  // Carrega TUDO uma vez; as combinações só variam os parâmetros do cálculo.
  const dados: DadosAtivo[] = [];
  for (const ativo of ativos) {
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

    const dias: DadosAtivo["dias"] = [];
    for (const [dia, cadeia] of cadeiaPorDia) {
      const spot = spotPorDia.get(dia);
      if (spot === undefined) continue;
      const tradeDate = new Date(`${dia}T00:00:00.000Z`);
      const r = resolverSelic(tradeDate);
      if (r === null) continue;
      dias.push({ tradeDate, spot, r, cadeia });
    }
    dados.push({ ativo, dias });
  }

  // Linha de base (combinação atual em produção: moneyness ∞, spread 1.0) p/ comparar.
  console.error("BASELINE commitado (sem trava de moneyness, spread 1.0):\n");
  const baseHdr = "ativo".padEnd(7) + "válidos".padStart(9) + "IV>120%".padStart(9);
  console.error(baseHdr);
  console.error("-".repeat(baseHdr.length));
  for (const d of dados) {
    let validos = 0;
    let out = 0;
    for (const dia of d.dias) {
      const res = calcularIvRepresentativa({
        spot: dia.spot,
        cadeia: dia.cadeia,
        r: dia.r,
        tradeDate: dia.tradeDate,
        spreadMaximo: 1.0,
        moneynessMaximo: Number.POSITIVE_INFINITY,
      });
      if (res.iv !== null) {
        validos++;
        if (res.iv > OUTLIER) out++;
      }
    }
    console.error(d.ativo.padEnd(7) + String(validos).padStart(9) + String(out).padStart(9));
  }

  // Varredura.
  for (const mny of MONEYNESS_GRID) {
    for (const sprd of SPREAD_GRID) {
      console.error(
        `\n=== moneyness ≤ ${(mny * 100).toFixed(0)}%  ×  spread ≤ ${sprd} ===\n`,
      );
      const hdr =
        "ativo".padEnd(7) + "válidos".padStart(9) + "Δvs base".padStart(9) + "IV>120%".padStart(9);
      console.error(hdr);
      console.error("-".repeat(hdr.length));
      let totValidos = 0;
      let totOut = 0;
      for (const d of dados) {
        // baseline p/ delta
        let baseV = 0;
        for (const dia of d.dias) {
          const r0 = calcularIvRepresentativa({
            spot: dia.spot, cadeia: dia.cadeia, r: dia.r, tradeDate: dia.tradeDate,
            spreadMaximo: 1.0, moneynessMaximo: Number.POSITIVE_INFINITY,
          });
          if (r0.iv !== null) baseV++;
        }
        let validos = 0;
        let out = 0;
        for (const dia of d.dias) {
          const res = calcularIvRepresentativa({
            spot: dia.spot, cadeia: dia.cadeia, r: dia.r, tradeDate: dia.tradeDate,
            spreadMaximo: sprd, moneynessMaximo: mny,
          });
          if (res.iv !== null) {
            validos++;
            if (res.iv > OUTLIER) out++;
          }
        }
        totValidos += validos;
        totOut += out;
        const delta = validos - baseV;
        console.error(
          d.ativo.padEnd(7) +
            String(validos).padStart(9) +
            (delta === 0 ? "0" : delta > 0 ? `+${delta}` : String(delta)).padStart(9) +
            String(out).padStart(9),
        );
      }
      console.error(`TOTAL  ${String(totValidos).padStart(7)}  (IV>120%: ${totOut})`);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\nFalha na varredura:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
