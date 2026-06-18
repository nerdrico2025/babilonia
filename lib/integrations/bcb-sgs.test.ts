import { describe, it, expect } from "vitest";

import {
  getMetaSelic,
  taxaContinua,
  buscarSerieMetaSelic,
  criarResolvedorSelic,
  TTL_SEGUNDOS,
  SERIE_META_SELIC,
  BcbSgsIndisponivelError,
  type CacheStore,
  type RegistroCache,
  type PontoSelic,
} from "@/lib/integrations/bcb-sgs";

/**
 * Testes da integração BCB SGS (série 432). As respostas são MOCKADAS (fetch
 * injetado) e o cache é um store em memória — nada toca a rede nem o Postgres.
 * Cobrem: parse do formato DD/MM/AAAA + valor string→número, conversão para
 * taxa contínua com valor conhecido, e o caminho cache-hit / cache→fallback.
 */

// ── Infra de teste (mesmo padrão de brapi.test.ts) ───────────────────────────

/** Store de cache em memória (espelha o `createdAt`/`expiresAt` do Drizzle). */
function storeMemoria() {
  const mapa = new Map<string, RegistroCache>();
  const store: CacheStore = {
    async ler(chave) {
      return mapa.get(chave) ?? null;
    },
    async gravar(chave, payload, expiraEm) {
      mapa.set(chave, { payload, geradoEm: new Date(), expiraEm });
    },
  };
  return { store, mapa };
}

interface RespFake {
  ok: boolean;
  status: number;
  body: unknown;
}

/** Cria um `fetch` falso a partir de uma função que devolve a resposta. */
function fakeFetch(handler: () => RespFake) {
  let chamadas = 0;
  let ultimaUrl = "";
  const fn = (async (url: string | URL) => {
    chamadas++;
    ultimaUrl = String(url);
    const { ok, status, body } = handler();
    return { ok, status, json: async () => body } as unknown as Response;
  }) as unknown as typeof fetch;
  return {
    fetchImpl: fn,
    get chamadas() {
      return chamadas;
    },
    get ultimaUrl() {
      return ultimaUrl;
    },
  };
}

const ok = (body: unknown): RespFake => ({ ok: true, status: 200, body });
const erro500 = (): RespFake => ({ ok: false, status: 500, body: null });

// Formato real da série 432: array de { data: "DD/MM/AAAA", valor: string }.
const CORPO_SELIC = [{ data: "18/06/2026", valor: "10.50" }];

const T0 = new Date("2026-06-18T12:00:00Z");
const horas = (n: number) => new Date(T0.getTime() + n * 60 * 60 * 1000);

// ── (b) Conversão para taxa contínua — função pura, sem rede ─────────────────

describe("taxaContinua — Selic anual (% a.a.) → taxa contínua r", () => {
  it("Selic 10% a.a. → r = ln(1,10) ≈ 0,09531", () => {
    expect(taxaContinua(10)).toBeCloseTo(0.0953101798, 9);
  });

  it("Selic 0% → r = 0", () => {
    expect(taxaContinua(0)).toBe(0);
  });

  it("é inversa de e^r (anual efetiva de volta): e^{ln(1,1475)} = 1,1475", () => {
    const r = taxaContinua(14.75);
    expect(Math.exp(r)).toBeCloseTo(1.1475, 10);
  });
});

// ── (a) Parse do formato + (c) caminhos de cache ─────────────────────────────

describe("getMetaSelic — parse, conversão e cache", () => {
  it("(a) parseia DD/MM/AAAA + valor string→número e calcula r contínua", async () => {
    const { store, mapa } = storeMemoria();
    const f = fakeFetch(() => ok(CORPO_SELIC));

    const r = await getMetaSelic({ store, fetchImpl: f.fetchImpl, agora: T0 });

    expect(r.origem).toBe("rede");
    expect(r.dado.data).toBe("18/06/2026");
    expect(r.dado.selicAnual).toBe(10.5); // string "10.50" → número 10.5
    expect(typeof r.dado.selicAnual).toBe("number");
    expect(r.dado.rContinua).toBeCloseTo(Math.log(1.105), 12);

    // Bateu na URL da série 432, endpoint "ultimos/1".
    expect(f.ultimaUrl).toContain(`bcdata.sgs.${SERIE_META_SELIC}/dados/ultimos/1`);
    // Gravou no cache sob a chave normalizada.
    expect(mapa.has(`bcb-sgs:meta-selic:${SERIE_META_SELIC}`)).toBe(true);
  });

  it("(c) cache-hit válido não vai à rede", async () => {
    const { store } = storeMemoria();
    const f = fakeFetch(() => ok(CORPO_SELIC));

    await getMetaSelic({ store, fetchImpl: f.fetchImpl, agora: T0 });
    expect(f.chamadas).toBe(1);

    // Dentro do TTL (12h) → serve do cache, sem nova ida à rede.
    const r2 = await getMetaSelic({
      store,
      fetchImpl: f.fetchImpl,
      agora: horas(1),
    });
    expect(r2.origem).toBe("cache");
    expect(r2.dado.selicAnual).toBe(10.5);
    expect(f.chamadas).toBe(1);
  });

  it("(c) falha na API degrada para o último valor em cache (fallback)", async () => {
    const { store } = storeMemoria();

    // 1ª chamada popula o cache.
    const okFetch = fakeFetch(() => ok(CORPO_SELIC));
    await getMetaSelic({ store, fetchImpl: okFetch.fetchImpl, agora: T0 });

    // Depois do TTL e com a API em erro → cai no cache vencido com aviso.
    const falha = fakeFetch(() => erro500());
    const r = await getMetaSelic({
      store,
      fetchImpl: falha.fetchImpl,
      agora: horas(TTL_SEGUNDOS / 3600 + 1),
    });

    expect(r.origem).toBe("cache_fallback");
    expect(r.desatualizado).toBe(true);
    expect(r.podeForcarAtualizacao).toBe(true);
    expect(r.dado.selicAnual).toBe(10.5);
    expect(r.aviso).toBeTruthy();
  });

  it("(c) sem cache e API em erro → lança BcbSgsIndisponivelError (não inventa número)", async () => {
    const { store } = storeMemoria();
    const falha = fakeFetch(() => erro500());

    await expect(
      getMetaSelic({ store, fetchImpl: falha.fetchImpl, agora: T0 }),
    ).rejects.toBeInstanceOf(BcbSgsIndisponivelError);
  });
});

// ── Série histórica + resolvedor data→taxa (base do backfill de IV) ──────────

describe("buscarSerieMetaSelic — série no intervalo (DD/MM/AAAA → Date)", () => {
  it("parseia, calcula r contínua e ordena por data", async () => {
    const corpo = [
      { data: "19/03/2025", valor: "14.25" },
      { data: "29/01/2025", valor: "13.25" }, // fora de ordem de propósito
    ];
    const f = fakeFetch(() => ok(corpo));
    const serie = await buscarSerieMetaSelic(
      new Date(Date.UTC(2025, 0, 1)),
      new Date(Date.UTC(2025, 5, 30)),
      { fetchImpl: f.fetchImpl },
    );

    expect(serie).toHaveLength(2);
    // Ordenada por data crescente.
    expect(serie[0]!.data.getTime()).toBe(Date.UTC(2025, 0, 29));
    expect(serie[1]!.data.getTime()).toBe(Date.UTC(2025, 2, 19));
    expect(serie[0]!.selicAnual).toBe(13.25);
    expect(serie[1]!.rContinua).toBeCloseTo(Math.log(1.1425), 12);
    // URL com endpoint de intervalo (dataInicial/dataFinal).
    expect(f.ultimaUrl).toContain(`bcdata.sgs.${SERIE_META_SELIC}/dados?`);
    expect(f.ultimaUrl).toContain("dataInicial=01/01/2025");
    expect(f.ultimaUrl).toContain("dataFinal=30/06/2025");
  });
});

describe("criarResolvedorSelic — passo-a-passo data→taxa contínua", () => {
  const serie: PontoSelic[] = [
    { data: new Date(Date.UTC(2025, 0, 29)), selicAnual: 13.25, rContinua: taxaContinua(13.25) },
    { data: new Date(Date.UTC(2025, 2, 19)), selicAnual: 14.25, rContinua: taxaContinua(14.25) },
    { data: new Date(Date.UTC(2025, 4, 7)), selicAnual: 14.75, rContinua: taxaContinua(14.75) },
  ];
  const resolver = criarResolvedorSelic(serie);

  it("vale a última vigência com data ≤ pregão", () => {
    // Entre 19/03 e 07/05 → vale 14,25%.
    expect(resolver(new Date(Date.UTC(2025, 3, 10)))).toBeCloseTo(taxaContinua(14.25), 12);
    // No dia exato da mudança (07/05) → já vale a nova (14,75%).
    expect(resolver(new Date(Date.UTC(2025, 4, 7)))).toBeCloseTo(taxaContinua(14.75), 12);
    // Depois de tudo → última (14,75%).
    expect(resolver(new Date(Date.UTC(2025, 11, 31)))).toBeCloseTo(taxaContinua(14.75), 12);
  });

  it("pregão anterior ao 1º ponto → null (não inventa taxa)", () => {
    expect(resolver(new Date(Date.UTC(2025, 0, 1)))).toBeNull();
  });
});
