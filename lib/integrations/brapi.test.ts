import { describe, it, expect, afterEach } from "vitest";

import {
  getCotacao,
  getFundamentos,
  getCalendarioProventos,
  getCalendarioResultados,
  BrapiIndisponivelError,
  type CacheStore,
  type RegistroCache,
} from "@/lib/integrations/brapi";

/**
 * Testes da integração brapi. As respostas são MOCKADAS (fetch injetado) e o
 * cache é um store em memória — nada toca a rede nem o Postgres. Cobrem o
 * caminho cache-hit, cache-expirado e erro→fallback (§6.3), além do parse
 * (Zod) de cotação/fundamentos/proventos.
 */

// ── Infra de teste ───────────────────────────────────────────────────────────

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
  let ultimoInit: RequestInit | undefined;
  const fn = (async (url: string | URL, init?: RequestInit) => {
    chamadas++;
    ultimaUrl = String(url);
    ultimoInit = init;
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
    get ultimoInit() {
      return ultimoInit;
    },
  };
}

const ok = (body: unknown): RespFake => ({ ok: true, status: 200, body });
const erro500 = (): RespFake => ({ ok: false, status: 500, body: { error: true, message: "Server Error", code: "500" } });
const cota429 = (): RespFake => ({ ok: false, status: 429, body: { error: true, message: "Too Many Requests", code: "429" } });

const CORPO_COTACAO = {
  results: [
    {
      symbol: "PETR4",
      regularMarketPrice: 36.65,
      regularMarketChange: -0.35,
      regularMarketChangePercent: -0.95,
      regularMarketVolume: 27_681_100,
      regularMarketTime: "2026-02-08T16:24:54.000Z",
      currency: "BRL",
    },
  ],
  requestedAt: "2026-02-08T16:25:28.170Z",
  took: 3,
};

const T0 = new Date("2026-06-15T12:00:00Z");
const min = (n: number) => new Date(T0.getTime() + n * 60_000);

afterEach(() => {
  delete process.env.BRAPI_TOKEN;
});

// ── Cotação + cache ──────────────────────────────────────────────────────────

describe("getCotacao — rede, parse e gravação no cache", () => {
  it("busca na rede, valida (Zod) e grava no cache", async () => {
    const { store, mapa } = storeMemoria();
    const f = fakeFetch(() => ok(CORPO_COTACAO));

    const r = await getCotacao("petr4", { store, fetchImpl: f.fetchImpl, agora: T0 });

    expect(r.origem).toBe("rede");
    expect(r.desatualizado).toBe(false);
    expect(r.dado).toMatchObject({
      ticker: "PETR4",
      preco: 36.65,
      variacao: -0.35,
      variacaoPercent: -0.95,
      volume: 27_681_100,
      moeda: "BRL",
    });
    expect(f.chamadas).toBe(1);
    expect(mapa.has("brapi:quote:PETR4")).toBe(true); // chave normalizada (uppercase)
  });
});

describe("getCotacao — caminho cache-hit", () => {
  it("dentro do TTL devolve do cache e NÃO chama a rede de novo", async () => {
    const { store } = storeMemoria();
    const f = fakeFetch(() => ok(CORPO_COTACAO));

    await getCotacao("PETR4", { store, fetchImpl: f.fetchImpl, agora: T0 }); // popula
    const r = await getCotacao("PETR4", { store, fetchImpl: f.fetchImpl, agora: min(2) });

    expect(r.origem).toBe("cache");
    expect(r.dado.preco).toBe(36.65);
    expect(f.chamadas).toBe(1); // não buscou de novo
  });
});

describe("getCotacao — caminho cache-expirado", () => {
  it("após o TTL (5 min) busca de novo na rede", async () => {
    const { store } = storeMemoria();
    const f = fakeFetch(() => ok(CORPO_COTACAO));

    await getCotacao("PETR4", { store, fetchImpl: f.fetchImpl, agora: T0 }); // expira em 12:05
    const r = await getCotacao("PETR4", { store, fetchImpl: f.fetchImpl, agora: min(6) });

    expect(r.origem).toBe("rede");
    expect(f.chamadas).toBe(2);
  });
});

describe("getCotacao — caminho erro→fallback (§6.3)", () => {
  it("falha de rede com cache vencido: devolve o cache com aviso e flag de forçar", async () => {
    const { store } = storeMemoria();
    let modo: "ok" | "erro" = "ok";
    const f = fakeFetch(() => (modo === "ok" ? ok(CORPO_COTACAO) : erro500()));

    await getCotacao("PETR4", { store, fetchImpl: f.fetchImpl, agora: T0 }); // popula
    modo = "erro";
    const r = await getCotacao("PETR4", { store, fetchImpl: f.fetchImpl, agora: min(6) });

    expect(r.origem).toBe("cache_fallback");
    expect(r.desatualizado).toBe(true);
    expect(r.podeForcarAtualizacao).toBe(true);
    expect(r.aviso).toContain("não foi possível atualizar");
    expect(r.dado.preco).toBe(36.65); // dado antigo ainda é servido — tela não cai
  });

  it("cota 429 também cai no fallback do cache", async () => {
    const { store } = storeMemoria();
    let modo: "ok" | "cota" = "ok";
    const f = fakeFetch(() => (modo === "ok" ? ok(CORPO_COTACAO) : cota429()));

    await getCotacao("PETR4", { store, fetchImpl: f.fetchImpl, agora: T0 });
    modo = "cota";
    const r = await getCotacao("PETR4", { store, fetchImpl: f.fetchImpl, agora: min(6) });

    expect(r.origem).toBe("cache_fallback");
    expect(r.desatualizado).toBe(true);
  });

  it("falha SEM cache lança BrapiIndisponivelError (Route Handler trata)", async () => {
    const { store } = storeMemoria();
    const f = fakeFetch(() => erro500());

    await expect(
      getCotacao("PETR4", { store, fetchImpl: f.fetchImpl, agora: T0 }),
    ).rejects.toBeInstanceOf(BrapiIndisponivelError);
  });
});

describe("getCotacao — forçar atualização", () => {
  it("com forcar=true ignora o cache válido e rebusca", async () => {
    const { store } = storeMemoria();
    let preco = 36.65;
    const f = fakeFetch(() =>
      ok({ results: [{ ...CORPO_COTACAO.results[0], regularMarketPrice: preco }] }),
    );

    await getCotacao("PETR4", { store, fetchImpl: f.fetchImpl, agora: T0 }); // cacheia 36,65
    preco = 40.0;
    const r = await getCotacao("PETR4", {
      store,
      fetchImpl: f.fetchImpl,
      agora: min(1), // ainda dentro do TTL
      forcar: true,
    });

    expect(r.origem).toBe("rede");
    expect(r.dado.preco).toBe(40.0);
    expect(f.chamadas).toBe(2);
  });
});

describe("getCotacao — chave de API só no servidor", () => {
  it("envia o token no header Authorization e NÃO na query", async () => {
    process.env.BRAPI_TOKEN = "tk_secreto";
    const { store } = storeMemoria();
    const f = fakeFetch(() => ok(CORPO_COTACAO));

    await getCotacao("PETR4", { store, fetchImpl: f.fetchImpl, agora: T0 });

    const headers = f.ultimoInit?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer tk_secreto");
    expect(f.ultimaUrl).not.toContain("token="); // não vaza em logs/URL
  });
});

// ── Fundamentos ──────────────────────────────────────────────────────────────

describe("getFundamentos — parse dos módulos (Startup)", () => {
  const CORPO_FUND = {
    results: [
      {
        symbol: "PETR4",
        priceEarnings: 6.09,
        defaultKeyStatistics: { enterpriseToEbitda: 3.2, priceToBook: 1.1, dividendYield: 0.12 },
        financialData: { grossMargins: 0.5, operatingMargins: 0.3, profitMargins: 0.2 },
        incomeStatementHistoryQuarterly: {
          incomeStatementHistory: [{ endDate: "2026-03-31", netIncome: 1_000 }],
        },
      },
    ],
  };

  it("normaliza P/L, EV/EBITDA, P/VP, margens, DY e lucros por trimestre", async () => {
    const { store } = storeMemoria();
    const f = fakeFetch(() => ok(CORPO_FUND));

    const r = await getFundamentos("PETR4", { store, fetchImpl: f.fetchImpl, agora: T0 });

    expect(r.dado).toMatchObject({
      ticker: "PETR4",
      precoLucro: 6.09,
      evEbitda: 3.2,
      precoValorPatrimonial: 1.1,
      margemBruta: 0.5,
      margemOperacional: 0.3,
      margemLiquida: 0.2,
      dividendYield: 0.12,
    });
    expect(r.dado.lucrosPorTrimestre).toEqual([{ fim: "2026-03-31", lucroLiquido: 1_000 }]);
  });

  it("plano Free (sem os módulos): devolve campos null sem quebrar", async () => {
    const { store } = storeMemoria();
    const f = fakeFetch(() => ok({ results: [{ symbol: "PETR4" }] }));

    const r = await getFundamentos("PETR4", { store, fetchImpl: f.fetchImpl, agora: T0 });

    expect(r.dado.precoLucro).toBeNull();
    expect(r.dado.evEbitda).toBeNull();
    expect(r.dado.lucrosPorTrimestre).toEqual([]);
  });
});

// ── Proventos ────────────────────────────────────────────────────────────────

describe("getCalendarioProventos — parse de dividendsData (Startup)", () => {
  it("mapeia cashDividends para o domínio", async () => {
    const { store } = storeMemoria();
    const f = fakeFetch(() =>
      ok({
        results: [
          {
            symbol: "PETR4",
            dividendsData: {
              cashDividends: [
                {
                  assetIssued: "BRPETRACNPR6",
                  paymentDate: "2026-05-20",
                  rate: 0.95,
                  relatedTo: "1º trimestre 2026",
                  approvedOn: "2026-05-08",
                  isinCode: "BRPETRACNPR6",
                  label: "DIVIDENDO",
                },
              ],
            },
          },
        ],
      }),
    );

    const r = await getCalendarioProventos("PETR4", { store, fetchImpl: f.fetchImpl, agora: T0 });

    expect(r.dado).toHaveLength(1);
    expect(r.dado[0]).toMatchObject({
      ativoEmitido: "BRPETRACNPR6",
      dataPagamento: "2026-05-20",
      valor: 0.95,
      tipo: "DIVIDENDO",
    });
  });

  it("plano Free (sem dividendsData): lista vazia, sem quebrar", async () => {
    const { store } = storeMemoria();
    const f = fakeFetch(() => ok({ results: [{ symbol: "PETR4" }] }));

    const r = await getCalendarioProventos("PETR4", { store, fetchImpl: f.fetchImpl, agora: T0 });
    expect(r.dado).toEqual([]);
  });
});

// ── Resultados (não existe no brapi, §6.4) ───────────────────────────────────

describe("getCalendarioResultados — indisponível por design (§6.4)", () => {
  it("não inventa: devolve indisponível + fonte alternativa", () => {
    const r = getCalendarioResultados("PETR4");
    expect(r.disponivel).toBe(false);
    expect(r.motivo).toContain("§6.4");
    expect(r.fonteAlternativa).toMatch(/manual/i);
  });
});
