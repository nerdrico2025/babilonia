/**
 * Testes da orquestração analisarTecnico / montarAnaliseTecnica (T3).
 *
 * Estratégia: NÃO reimplementar os cálculos — comparar a saída da orquestração com
 * os indicadores do T1 chamados DIRETAMENTE nos mesmos dados (teste de
 * consistência). Casos de borda (histórico insuf./ausente) e cruzamentos
 * crafted (direção exata) completam a cobertura. A busca de candles é INJETADA,
 * sem Postgres.
 */

import { describe, expect, it } from "vitest";

import { cruzamentoRecente, mediaMovelSimples } from "./medias-moveis";
import { macd } from "./macd";
import { rsi } from "./rsi";
import {
  niveisSuporteResistencia,
  suporteResistenciaProximos,
} from "./suporte-resistencia";
import {
  analisarTecnico,
  montarAnaliseTecnica,
  MINIMO_CANDLES,
} from "./analise-completa";
import type { Candle } from "./tipos";

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** Candle a partir de um fechamento; OHLC derivados de forma determinística. */
function candleDe(fechamento: number, i: number): Candle {
  const data = new Date(Date.UTC(2025, 0, 1) + i * 86_400_000)
    .toISOString()
    .slice(0, 10);
  return {
    data,
    abertura: fechamento - 0.2,
    maxima: fechamento + 0.5,
    minima: fechamento - 0.5,
    fechamento,
    volume: 1000 + i,
  };
}

/** Série determinística e ondulada (gera médias, RSI, MACD e pivots variados). */
function closesOndulados(n: number): number[] {
  return Array.from({ length: n }, (_, i) => 50 + Math.sin(i / 4) * 6 + i * 0.05);
}

function candlesDe(closes: number[]): Candle[] {
  return closes.map(candleDe);
}

const ultimo = (s: (number | null)[]) => s[s.length - 1] ?? null;

// ── Consistência com o motor T1 ───────────────────────────────────────────────

describe("montarAnaliseTecnica — consistência com o T1", () => {
  const closes = closesOndulados(260);
  const candles = candlesDe(closes);
  const a = montarAnaliseTecnica("petr4", candles)!;

  it("preenche metadados (ticker maiúsculo, frescor, pontos, preço atual)", () => {
    expect(a.ticker).toBe("PETR4");
    expect(a.pontos).toBe(260);
    expect(a.precoAtual).toBe(closes[259]);
    expect(a.dataReferencia).toBe(candles[259]!.data);
  });

  it("médias móveis batem com mediaMovelSimples chamado direto", () => {
    expect(a.medias.mm9).toBe(ultimo(mediaMovelSimples(closes, 9)));
    expect(a.medias.mm21).toBe(ultimo(mediaMovelSimples(closes, 21)));
    expect(a.medias.mm50).toBe(ultimo(mediaMovelSimples(closes, 50)));
    expect(a.medias.mm200).toBe(ultimo(mediaMovelSimples(closes, 200)));
    expect(a.medias.cruzamento9x21).toBe(
      cruzamentoRecente(mediaMovelSimples(closes, 9), mediaMovelSimples(closes, 21)),
    );
    expect(a.medias.cruzamento50x200).toBe(
      cruzamentoRecente(mediaMovelSimples(closes, 50), mediaMovelSimples(closes, 200)),
    );
  });

  it("RSI14 bate com rsi() direto", () => {
    expect(a.rsi14).toBe(ultimo(rsi(closes, 14)));
  });

  it("MACD (linha/sinal/histograma/cruzamento) bate com macd() direto", () => {
    const m = macd(closes);
    expect(a.macd.linha).toBe(ultimo(m.linha));
    expect(a.macd.sinal).toBe(ultimo(m.sinal));
    expect(a.macd.histograma).toBe(ultimo(m.histograma));
    expect(a.macd.cruzamento).toBe(cruzamentoRecente(m.linha, m.sinal));
  });

  it("suporte/resistência batem com niveis + proximos diretos", () => {
    const niveis = niveisSuporteResistencia(candles);
    expect(a.suporteResistencia).toEqual(
      suporteResistenciaProximos(niveis, closes[259]!),
    );
  });
});

// ── Cruzamentos crafted (direção exata) ───────────────────────────────────────

describe("montarAnaliseTecnica — cruzamentos refletidos corretamente", () => {
  it("MM9 cruzando PARA CIMA da MM21 no último candle → 'cima'", () => {
    // 21 fechamentos iguais (MM9 = MM21) e um salto p/ cima no último: a MM9
    // (mais rápida) ultrapassa a MM21 exatamente no fim.
    const closes = [...new Array(21).fill(20), 26];
    const a = montarAnaliseTecnica("X", candlesDe(closes))!;
    expect(a.medias.cruzamento9x21).toBe("cima");
  });

  it("MM9 cruzando PARA BAIXO da MM21 no último candle → 'baixo'", () => {
    const closes = [...new Array(21).fill(20), 14];
    const a = montarAnaliseTecnica("X", candlesDe(closes))!;
    expect(a.medias.cruzamento9x21).toBe("baixo");
  });

  it("MACD: o cruzamento exposto é o mesmo que cruzamentoRecente(linha, sinal)", () => {
    // Série que cai e depois sobe forte no fim → força inversão de momentum.
    const closes = [
      ...Array.from({ length: 30 }, (_, i) => 100 - i),
      ...Array.from({ length: 12 }, (_, i) => 70 + i * 4),
    ];
    const a = montarAnaliseTecnica("X", candlesDe(closes))!;
    const m = macd(closes);
    expect(a.macd.cruzamento).toBe(cruzamentoRecente(m.linha, m.sinal));
  });
});

// ── Bordas (histórico insuficiente / ausente) ─────────────────────────────────

describe("montarAnaliseTecnica — bordas", () => {
  it(`menos de ${MINIMO_CANDLES} candles → null (histórico insuficiente)`, () => {
    expect(montarAnaliseTecnica("X", candlesDe(closesOndulados(MINIMO_CANDLES - 1)))).toBeNull();
  });

  it("array vazio → null", () => {
    expect(montarAnaliseTecnica("X", [])).toBeNull();
  });

  it(`exatamente ${MINIMO_CANDLES} candles → não-null; MM9/RSI14 valem, MM200/MACD ainda null`, () => {
    const a = montarAnaliseTecnica("X", candlesDe(closesOndulados(MINIMO_CANDLES)))!;
    expect(a).not.toBeNull();
    expect(a.medias.mm9).not.toBeNull();
    expect(a.rsi14).not.toBeNull();
    expect(a.medias.mm200).toBeNull();
    expect(a.macd.linha).toBeNull(); // MACD precisa de 26 candles
  });
});

// ── analisarTecnico (assíncrono, busca injetada) ──────────────────────────────

describe("analisarTecnico (busca injetada)", () => {
  it("histórico completo → AnaliseTecnica preenchida", async () => {
    const candles = candlesDe(closesOndulados(260));
    const a = await analisarTecnico("PETR4", { buscarCandles: async () => candles });
    expect(a).not.toBeNull();
    expect(a!.pontos).toBe(260);
    expect(a!.medias.mm200).not.toBeNull();
  });

  it("histórico insuficiente → null", async () => {
    const candles = candlesDe(closesOndulados(5));
    const a = await analisarTecnico("NOVA3", { buscarCandles: async () => candles });
    expect(a).toBeNull();
  });

  it("sem nenhum candle → null", async () => {
    const a = await analisarTecnico("ZZZZ99", { buscarCandles: async () => [] });
    expect(a).toBeNull();
  });

  it("repassa o limite 252 para a busca", async () => {
    let limiteVisto: number | undefined;
    await analisarTecnico("PETR4", {
      buscarCandles: async (_t, opts) => {
        limiteVisto = opts?.limite;
        return candlesDe(closesOndulados(260));
      },
    });
    expect(limiteVisto).toBe(252);
  });
});
