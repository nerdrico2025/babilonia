import { describe, it, expect, afterEach } from "vitest";

import {
  getFundamentos,
  BolsaiIndisponivelError,
  type CacheStore,
  type RegistroCache,
} from "@/lib/integrations/bolsai";

/**
 * Testes da integração bolsai. As respostas são MOCKADAS (fetch injetado) e o
 * cache é um store em memória — nada toca a rede nem o Postgres. Os fixtures são
 * os JSONs REAIS coletados da bolsai durante a migração de fundamentos, não
 * formato inventado. Cobrem: parse/mapeamento sem transformar percentuais, null
 * propagado, campos extras aceitos, e cache-hit / cache-expirado / erro→fallback.
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
const erro500 = (): RespFake => ({ ok: false, status: 500, body: { error: "Server Error" } });
const cota429 = (): RespFake => ({ ok: false, status: 429, body: { error: "Too Many Requests" } });

// Fixture REAL (PETR4) — payload completo da bolsai, com os ~30 campos extras.
const CORPO_PETR4 = {
  cvm_code: "9512",
  ticker: "PETR4",
  reference_date: "2026-03-31",
  close_price: 38.85,
  shares_outstanding: 12888732761,
  market_cap: 500727267764.85,
  pl: 4.65,
  pvp: 1.12,
  ev_ebitda: 3.81,
  ev_ebit: 4.24,
  p_ebitda: 2.32,
  p_ebit: 2.57,
  p_sr: 1.01,
  lpa: 8.35,
  vpa: 34.54,
  gross_margin: 47.36,
  net_margin: 21.69,
  ebitda_margin: 43.41,
  ebit_margin: 39.07,
  roe: 24.17,
  roa: 8.67,
  roic: 16.7,
  ebit_over_assets: 15.62,
  asset_turnover: 0.4,
  p_assets: 0.4,
  current_ratio: 0.74,
  debt_equity: 0.83,
  net_debt_equity: 0.73,
  net_debt_ebitda: 1.5,
  net_debt_ebit: 1.67,
  cagr_revenue_5y: 12.83,
  cagr_earnings_5y: 77.68,
  net_income: 107583000,
  equity: 445189000,
  net_revenue: 498091000,
  total_debt: 371691000,
  ebitda: 216231000,
  ebit: 194617000,
  net_debt: 324091000,
  cash: 47600000,
  total_assets: 1246068000,
  current_assets: 140533000,
  current_liabilities: 189166000,
  corporate_name: "PETRÓLEO BRASILEIRO  S.A.  - PETROBRAS",
};

const T0 = new Date("2026-06-19T12:00:00Z");
const horas = (n: number) => new Date(T0.getTime() + n * 3_600_000);

afterEach(() => {
  delete process.env.BOLSAI_API_KEY;
});

// ── Parse + mapeamento (sem transformar valores) ──────────────────────────────

describe("getFundamentos — parse, mapeamento e gravação no cache", () => {
  it("mapeia os 14 campos para o domínio sem transformar percentuais", async () => {
    process.env.BOLSAI_API_KEY = "k_teste";
    const { store, mapa } = storeMemoria();
    const f = fakeFetch(() => ok(CORPO_PETR4));

    const r = await getFundamentos("petr4", { store, fetchImpl: f.fetchImpl, agora: T0 });

    expect(r.origem).toBe("rede");
    expect(r.dado).toEqual({
      ticker: "PETR4",
      precoLucro: 4.65,
      evEbitda: 3.81,
      precoValorPatrimonial: 1.12,
      // percentuais em PONTOS, sem dividir/multiplicar por 100
      margemLiquida: 21.69,
      roe: 24.17,
      roic: 16.7,
      roa: 8.67,
      lpa: 8.35,
      vpa: 34.54,
      marketCap: 500727267764.85,
      lucroLiquido: 107583000,
      ebitda: 216231000,
      dataReferencia: "2026-03-31",
      nomeEmpresa: "PETRÓLEO BRASILEIRO  S.A.  - PETROBRAS",
    });
    expect(f.chamadas).toBe(1);
    expect(mapa.has("bolsai:fundamentos:PETR4")).toBe(true); // chave normalizada
  });

  it("envia X-API-Key no header e bate no endpoint de fundamentals", async () => {
    process.env.BOLSAI_API_KEY = "k_secreta";
    const { store } = storeMemoria();
    const f = fakeFetch(() => ok(CORPO_PETR4));

    await getFundamentos("PETR4", { store, fetchImpl: f.fetchImpl, agora: T0 });

    const headers = f.ultimoInit?.headers as Record<string, string>;
    expect(headers["X-API-Key"]).toBe("k_secreta");
    expect(f.ultimaUrl).toContain("/fundamentals/PETR4");
    expect(f.ultimaUrl).not.toContain("k_secreta"); // chave não vaza na URL
  });

  it("aceita payload com os ~30 campos extras sem erro (schema não-strict)", async () => {
    process.env.BOLSAI_API_KEY = "k_teste";
    const { store } = storeMemoria();
    // CORPO_PETR4 já carrega close_price, gross_margin, debt_equity, etc.
    const f = fakeFetch(() => ok(CORPO_PETR4));

    const r = await getFundamentos("PETR4", { store, fetchImpl: f.fetchImpl, agora: T0 });

    expect(r.dado.precoLucro).toBe(4.65);
    // campos extras não vazam para o domínio
    expect(Object.keys(r.dado)).not.toContain("close_price");
    expect(Object.keys(r.dado)).not.toContain("gross_margin");
  });

  it("aceita valores negativos e fora da faixa comum (P/L negativo, margem > 100)", async () => {
    process.env.BOLSAI_API_KEY = "k_teste";
    const { store } = storeMemoria();
    // ITSA4 real: net_margin 203.91; CSNA3 real: pl negativo.
    const f = fakeFetch(() =>
      ok({ ...CORPO_PETR4, ticker: "ITSA4", pl: -3.44, net_margin: 203.91, roe: -272.42 }),
    );

    const r = await getFundamentos("ITSA4", { store, fetchImpl: f.fetchImpl, agora: T0 });

    expect(r.dado.precoLucro).toBe(-3.44);
    expect(r.dado.margemLiquida).toBe(203.91);
    expect(r.dado.roe).toBe(-272.42);
  });

  it("propaga null do payload como null no tipo, sem quebrar", async () => {
    process.env.BOLSAI_API_KEY = "k_teste";
    const { store } = storeMemoria();
    const f = fakeFetch(() =>
      ok({ ...CORPO_PETR4, ev_ebitda: null, roic: null, corporate_name: null }),
    );

    const r = await getFundamentos("PETR4", { store, fetchImpl: f.fetchImpl, agora: T0 });

    expect(r.dado.evEbitda).toBeNull();
    expect(r.dado.roic).toBeNull();
    expect(r.dado.nomeEmpresa).toBeNull();
    // os demais continuam preenchidos
    expect(r.dado.precoLucro).toBe(4.65);
  });
});

// ── Cache: hit vs. expirado ───────────────────────────────────────────────────

describe("getFundamentos — cache-hit vs. cache-expirado", () => {
  it("dentro do TTL devolve do cache e NÃO rebusca", async () => {
    process.env.BOLSAI_API_KEY = "k_teste";
    const { store } = storeMemoria();
    const f = fakeFetch(() => ok(CORPO_PETR4));

    await getFundamentos("PETR4", { store, fetchImpl: f.fetchImpl, agora: T0 }); // popula
    const r = await getFundamentos("PETR4", { store, fetchImpl: f.fetchImpl, agora: horas(1) });

    expect(r.origem).toBe("cache");
    expect(r.dado.precoLucro).toBe(4.65);
    expect(f.chamadas).toBe(1);
  });

  it("após o TTL (24h) rebusca na rede", async () => {
    process.env.BOLSAI_API_KEY = "k_teste";
    const { store } = storeMemoria();
    const f = fakeFetch(() => ok(CORPO_PETR4));

    await getFundamentos("PETR4", { store, fetchImpl: f.fetchImpl, agora: T0 });
    const r = await getFundamentos("PETR4", { store, fetchImpl: f.fetchImpl, agora: horas(25) });

    expect(r.origem).toBe("rede");
    expect(f.chamadas).toBe(2);
  });
});

// ── Erro → fallback graceful (§6.3) ──────────────────────────────────────────

describe("getFundamentos — erro→fallback (§6.3)", () => {
  it("falha de rede com cache vencido: serve o cache com aviso e flag de forçar", async () => {
    process.env.BOLSAI_API_KEY = "k_teste";
    const { store } = storeMemoria();
    let modo: "ok" | "erro" = "ok";
    const f = fakeFetch(() => (modo === "ok" ? ok(CORPO_PETR4) : erro500()));

    await getFundamentos("PETR4", { store, fetchImpl: f.fetchImpl, agora: T0 }); // popula
    modo = "erro";
    const r = await getFundamentos("PETR4", { store, fetchImpl: f.fetchImpl, agora: horas(25) });

    expect(r.origem).toBe("cache_fallback");
    expect(r.desatualizado).toBe(true);
    expect(r.podeForcarAtualizacao).toBe(true);
    expect(r.aviso).toContain("não foi possível atualizar");
    expect(r.dado.precoLucro).toBe(4.65); // dado antigo ainda servido — tela não cai
  });

  it("cota 429 também cai no fallback do cache", async () => {
    process.env.BOLSAI_API_KEY = "k_teste";
    const { store } = storeMemoria();
    let modo: "ok" | "cota" = "ok";
    const f = fakeFetch(() => (modo === "ok" ? ok(CORPO_PETR4) : cota429()));

    await getFundamentos("PETR4", { store, fetchImpl: f.fetchImpl, agora: T0 });
    modo = "cota";
    const r = await getFundamentos("PETR4", { store, fetchImpl: f.fetchImpl, agora: horas(25) });

    expect(r.origem).toBe("cache_fallback");
    expect(r.desatualizado).toBe(true);
  });

  it("falha SEM cache lança BolsaiIndisponivelError (Route Handler trata)", async () => {
    process.env.BOLSAI_API_KEY = "k_teste";
    const { store } = storeMemoria();
    const f = fakeFetch(() => erro500());

    await expect(
      getFundamentos("PETR4", { store, fetchImpl: f.fetchImpl, agora: T0 }),
    ).rejects.toBeInstanceOf(BolsaiIndisponivelError);
  });

  it("resposta inválida (reference_date fora do formato) sem cache vira erro tipado", async () => {
    process.env.BOLSAI_API_KEY = "k_teste";
    const { store } = storeMemoria();
    const f = fakeFetch(() => ok({ ...CORPO_PETR4, reference_date: "31/03/2026" }));

    await expect(
      getFundamentos("PETR4", { store, fetchImpl: f.fetchImpl, agora: T0 }),
    ).rejects.toBeInstanceOf(BolsaiIndisponivelError);
  });

  it("chave de API ausente no servidor: sem cache, vira erro tipado", async () => {
    // sem BOLSAI_API_KEY no env
    const { store } = storeMemoria();
    const f = fakeFetch(() => ok(CORPO_PETR4));

    await expect(
      getFundamentos("PETR4", { store, fetchImpl: f.fetchImpl, agora: T0 }),
    ).rejects.toBeInstanceOf(BolsaiIndisponivelError);
  });
});
