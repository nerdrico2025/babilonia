import { describe, it, expect, afterEach } from "vitest";

import {
  getCadeiaOpcoes,
  getVolatilidadeAtivo,
  getGregas,
  getTaxasJuros,
  getOpenInterest,
  NOTA_LIQUIDEZ,
  TTL_SEGUNDOS_OPLAB,
  IntegracaoIndisponivelError,
} from "@/lib/integrations/oplab";
import type { CacheStore, RegistroCache } from "@/lib/integrations/cache";

/**
 * Testes da integração OpLab. As respostas são MOCKADAS (fetch injetado) e o
 * cache é um store em memória — nada toca a rede nem o Postgres. Cobrem o
 * caminho cache-hit, cache-expirado e erro→fallback (§6.3), o parse (Zod) da
 * cadeia/volatilidade/BS/taxas, e — crucial — a sinalização honesta das lacunas
 * §6.4 (sem open interest, gregas fora da cadeia, IV Rank só no ativo).
 */

// ── Infra de teste (idêntica à de brapi.test.ts) ─────────────────────────────

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
const erro500 = (): RespFake => ({ ok: false, status: 500, body: { message: "Server Error" } });
const cota429 = (): RespFake => ({ ok: false, status: 429, body: { message: "Too Many Requests" } });
const semPlano403 = (): RespFake => ({ ok: false, status: 403, body: { message: "Forbidden" } });

// Cadeia estruturada (doc §3): ativo + series[].strikes[].call/put.
const CORPO_CADEIA = {
  symbol: "PETR4",
  name: "PETROBRAS PN N2",
  close: 27.15,
  iv_current: 54.08,
  ewma_current: 59.57,
  beta_ibov: 1.128,
  series: [
    {
      due_date: "2022-11-18",
      days_to_maturity: 6,
      call: "K",
      put: "W",
      strikes: [
        {
          strike: 5.77,
          call: {
            symbol: "PETRK221",
            close: 21.9,
            bid: 0.01,
            ask: 0.03,
            volume: 100,
            financial_volume: 2190,
            maturity_type: "AMERICAN",
            contract_size: 100,
            category: "CALL",
            strike: 5.77,
            market_maker: true,
          },
          put: {
            symbol: "PETRW221",
            close: 0,
            bid: 0,
            ask: 0.01,
            volume: 0,
            maturity_type: "EUROPEAN",
            category: "PUT",
            strike: 5.77,
          },
        },
      ],
    },
  ],
};

// Volatilidade do ativo (doc §4): é onde mora o IV Rank.
const CORPO_VOLATILIDADE = {
  symbol: "PETR4",
  iv_current: 54.08,
  iv_1y_rank: 72.5,
  iv_1y_percentile: 81.0,
  iv_6m_rank: 65.0,
  iv_6m_percentile: 70.0,
  ewma_current: 59.57,
};

// Calculadora Black-Scholes (doc §5): gregas + IV por opção.
const CORPO_BS = {
  moneyness: "OTM",
  price: 0.0317,
  delta: 0.03,
  gamma: 0.0254,
  vega: 0.0033,
  theta: -0.0096,
  rho: 0.0003,
  volatility: 28.5,
  poe: 2.37,
  spotprice: 24.06,
  strike: 30,
  margin: 3000,
};

// Taxas de juros (doc §7).
const CORPO_TAXAS = [
  { uid: "SELIC", name: "Taxa Selic", value: 14.75, updated_at: "2026-06-15T00:00:00.000Z" },
  { uid: "CETIP", name: "Taxa DI", value: 14.65, updated_at: "2026-06-15T00:00:00.000Z" },
];

const T0 = new Date("2026-06-15T12:00:00Z");
const min = (n: number) => new Date(T0.getTime() + n * 60_000);

afterEach(() => {
  delete process.env.OPLAB_ACCESS_TOKEN;
});

// ── Cadeia: rede, parse e gravação no cache ──────────────────────────────────

describe("getCadeiaOpcoes — rede, parse (Zod) e gravação no cache", () => {
  it("estrutura a grade call/put, calcula spread e grava no cache", async () => {
    const { store, mapa } = storeMemoria();
    const f = fakeFetch(() => ok(CORPO_CADEIA));

    const r = await getCadeiaOpcoes("petr4", { store, fetchImpl: f.fetchImpl, agora: T0 });

    expect(r.origem).toBe("rede");
    expect(r.dado.ativo).toBe("PETR4");
    expect(r.dado.precoAtivo).toBe(27.15);
    expect(r.dado.ivAtual).toBe(54.08);

    const venc = r.dado.vencimentos[0]!;
    expect(venc.vencimento).toBe("2022-11-18");
    expect(venc.diasAteVencimento).toBe(6);

    const linha = venc.strikes[0]!;
    expect(linha.strike).toBe(5.77);
    expect(linha.call?.symbol).toBe("PETRK221");
    expect(linha.call?.tipo).toBe("call");
    expect(linha.call?.spread).toBeCloseTo(0.02); // ask 0.03 − bid 0.01
    expect(linha.call?.marketMaker).toBe(true);
    expect(linha.put?.tipo).toBe("put");

    expect(f.chamadas).toBe(1);
    expect(mapa.has("oplab:cadeia:PETR4")).toBe(true); // chave normalizada (uppercase)
  });

  it("sinaliza as lacunas §6.4 na própria cadeia (NUNCA inventa)", async () => {
    const { store } = storeMemoria();
    const f = fakeFetch(() => ok(CORPO_CADEIA));

    const r = await getCadeiaOpcoes("PETR4", { store, fetchImpl: f.fetchImpl, agora: T0 });

    expect(r.dado.openInterestDisponivel).toBe(false); // §6.4 #1
    expect(r.dado.gregasNaCadeia).toBe(false); // §6.4 #2
    expect(r.dado.notaLiquidez).toBe(NOTA_LIQUIDEZ);
    expect(r.dado.notaLiquidez).toContain("open interest");
  });
});

describe("getCadeiaOpcoes — caminho cache-hit", () => {
  it("dentro do TTL devolve do cache e NÃO chama a rede de novo", async () => {
    const { store } = storeMemoria();
    const f = fakeFetch(() => ok(CORPO_CADEIA));

    await getCadeiaOpcoes("PETR4", { store, fetchImpl: f.fetchImpl, agora: T0 }); // popula
    const r = await getCadeiaOpcoes("PETR4", { store, fetchImpl: f.fetchImpl, agora: min(2) });

    expect(r.origem).toBe("cache");
    expect(r.dado.ativo).toBe("PETR4");
    expect(f.chamadas).toBe(1); // não buscou de novo
  });
});

describe("getCadeiaOpcoes — caminho cache-expirado", () => {
  it("após o TTL (3 min) busca de novo na rede", async () => {
    const { store } = storeMemoria();
    const f = fakeFetch(() => ok(CORPO_CADEIA));

    await getCadeiaOpcoes("PETR4", { store, fetchImpl: f.fetchImpl, agora: T0 }); // expira em 12:03
    const r = await getCadeiaOpcoes("PETR4", { store, fetchImpl: f.fetchImpl, agora: min(4) });

    expect(r.origem).toBe("rede");
    expect(f.chamadas).toBe(2);
    // confirma o TTL declarado (a cadeia é a chamada mais pesada, §6.2).
    expect(TTL_SEGUNDOS_OPLAB.cadeia).toBe(180);
  });
});

describe("getCadeiaOpcoes — caminho erro→fallback (§6.3)", () => {
  it("falha de rede com cache vencido: devolve o cache com aviso e flag de forçar", async () => {
    const { store } = storeMemoria();
    let modo: "ok" | "erro" = "ok";
    const f = fakeFetch(() => (modo === "ok" ? ok(CORPO_CADEIA) : erro500()));

    await getCadeiaOpcoes("PETR4", { store, fetchImpl: f.fetchImpl, agora: T0 }); // popula
    modo = "erro";
    const r = await getCadeiaOpcoes("PETR4", { store, fetchImpl: f.fetchImpl, agora: min(4) });

    expect(r.origem).toBe("cache_fallback");
    expect(r.desatualizado).toBe(true);
    expect(r.podeForcarAtualizacao).toBe(true);
    expect(r.aviso).toContain("não foi possível atualizar");
    expect(r.dado.ativo).toBe("PETR4"); // dado antigo ainda é servido — tela não cai
  });

  it("cota 429 também cai no fallback do cache", async () => {
    const { store } = storeMemoria();
    let modo: "ok" | "cota" = "ok";
    const f = fakeFetch(() => (modo === "ok" ? ok(CORPO_CADEIA) : cota429()));

    await getCadeiaOpcoes("PETR4", { store, fetchImpl: f.fetchImpl, agora: T0 });
    modo = "cota";
    const r = await getCadeiaOpcoes("PETR4", { store, fetchImpl: f.fetchImpl, agora: min(4) });

    expect(r.origem).toBe("cache_fallback");
    expect(r.desatualizado).toBe(true);
  });

  it("plano sem o recurso (403) sem cache: lança IntegracaoIndisponivelError", async () => {
    const { store } = storeMemoria();
    const f = fakeFetch(() => semPlano403());

    await expect(
      getCadeiaOpcoes("PETR4", { store, fetchImpl: f.fetchImpl, agora: T0 }),
    ).rejects.toBeInstanceOf(IntegracaoIndisponivelError);
  });
});

describe("getCadeiaOpcoes — forçar atualização", () => {
  it("com forcar=true ignora o cache válido e rebusca", async () => {
    const { store } = storeMemoria();
    let preco = 27.15;
    const f = fakeFetch(() => ok({ ...CORPO_CADEIA, close: preco }));

    await getCadeiaOpcoes("PETR4", { store, fetchImpl: f.fetchImpl, agora: T0 }); // cacheia 27,15
    preco = 30.0;
    const r = await getCadeiaOpcoes("PETR4", {
      store,
      fetchImpl: f.fetchImpl,
      agora: min(1), // ainda dentro do TTL
      forcar: true,
    });

    expect(r.origem).toBe("rede");
    expect(r.dado.precoAtivo).toBe(30.0);
    expect(f.chamadas).toBe(2);
  });
});

describe("getCadeiaOpcoes — chave de API só no servidor", () => {
  it("envia o token no header Access-Token e NÃO na query", async () => {
    process.env.OPLAB_ACCESS_TOKEN = "tk_secreto";
    const { store } = storeMemoria();
    const f = fakeFetch(() => ok(CORPO_CADEIA));

    await getCadeiaOpcoes("PETR4", { store, fetchImpl: f.fetchImpl, agora: T0 });

    const headers = f.ultimoInit?.headers as Record<string, string>;
    expect(headers["Access-Token"]).toBe("tk_secreto");
    expect(f.ultimaUrl).not.toContain("access_token="); // não vaza em logs/URL
    expect(f.ultimaUrl).not.toContain("tk_secreto");
  });
});

// ── Volatilidade do ativo: IV Rank/percentil (§6.4 #3) ───────────────────────

describe("getVolatilidadeAtivo — IV Rank/percentil vêm prontos (não calculamos)", () => {
  it("normaliza IV, IV Rank e percentil 1a/6m do ATIVO-OBJETO", async () => {
    const { store } = storeMemoria();
    const f = fakeFetch(() => ok(CORPO_VOLATILIDADE));

    const r = await getVolatilidadeAtivo("petr4", { store, fetchImpl: f.fetchImpl, agora: T0 });

    expect(r.origem).toBe("rede");
    expect(r.dado).toMatchObject({
      ativo: "PETR4",
      ivAtual: 54.08,
      ivRank1a: 72.5,
      ivPercentil1a: 81.0,
      ivRank6m: 65.0,
      ivPercentil6m: 70.0,
      ewmaAtual: 59.57,
    });
  });

  it("sinaliza que IV Rank por contrato NÃO existe (§6.4 #3)", async () => {
    const { store } = storeMemoria();
    const f = fakeFetch(() => ok(CORPO_VOLATILIDADE));

    const r = await getVolatilidadeAtivo("PETR4", { store, fetchImpl: f.fetchImpl, agora: T0 });
    expect(r.dado.ivRankPorContratoDisponivel).toBe(false);
  });

  it("dentro do TTL devolve do cache (chave própria, sem colidir com a cadeia)", async () => {
    const { store } = storeMemoria();
    const f = fakeFetch(() => ok(CORPO_VOLATILIDADE));

    await getVolatilidadeAtivo("PETR4", { store, fetchImpl: f.fetchImpl, agora: T0 });
    const r = await getVolatilidadeAtivo("PETR4", { store, fetchImpl: f.fetchImpl, agora: min(5) });

    expect(r.origem).toBe("cache");
    expect(f.chamadas).toBe(1);
  });
});

// ── Gregas via calculadora BS (§6.4 #2) ──────────────────────────────────────

describe("getGregas — calculadora Black-Scholes por opção", () => {
  it("normaliza delta/gama/theta/vega, IV (volatility) e PoE", async () => {
    const { store } = storeMemoria();
    const f = fakeFetch(() => ok(CORPO_BS));

    const r = await getGregas(
      { symbol: "PETRK221", irate: 14.75, vol: 28.5 },
      { store, fetchImpl: f.fetchImpl, agora: T0 },
    );

    expect(r.origem).toBe("rede");
    expect(r.dado).toMatchObject({
      symbol: "PETRK221",
      moneyness: "OTM",
      precoTeorico: 0.0317,
      delta: 0.03,
      gamma: 0.0254,
      vega: 0.0033,
      theta: -0.0096,
      rho: 0.0003,
      iv: 28.5, // campo `volatility` → iv
      probExercicio: 2.37, // campo `poe`
      margem: 3000,
    });
    // SELIC (irate) e símbolo da opção vão na URL da calculadora.
    expect(f.ultimaUrl).toContain("symbol=PETRK221");
    expect(f.ultimaUrl).toContain("irate=14.75");
  });

  it("cacheia por símbolo+irate+vol; mesma chamada não rebusca", async () => {
    const { store } = storeMemoria();
    const f = fakeFetch(() => ok(CORPO_BS));

    await getGregas({ symbol: "PETRK221", irate: 14.75, vol: 28.5 }, { store, fetchImpl: f.fetchImpl, agora: T0 });
    const r = await getGregas(
      { symbol: "PETRK221", irate: 14.75, vol: 28.5 },
      { store, fetchImpl: f.fetchImpl, agora: min(1) },
    );

    expect(r.origem).toBe("cache");
    expect(f.chamadas).toBe(1);
  });

  it("irate diferente é chave de cache diferente → rebusca (não serve gregas erradas)", async () => {
    const { store } = storeMemoria();
    const f = fakeFetch(() => ok(CORPO_BS));

    await getGregas({ symbol: "PETRK221", irate: 14.75, vol: 28.5 }, { store, fetchImpl: f.fetchImpl, agora: T0 });
    const r = await getGregas(
      { symbol: "PETRK221", irate: 10.0, vol: 28.5 },
      { store, fetchImpl: f.fetchImpl, agora: min(1) },
    );

    expect(r.origem).toBe("rede");
    expect(f.chamadas).toBe(2);
  });
});

// ── Taxas de juros (insumo de `irate`) ───────────────────────────────────────

describe("getTaxasJuros — SELIC/CETIP para alimentar o BS", () => {
  it("normaliza a lista de taxas", async () => {
    const { store } = storeMemoria();
    const f = fakeFetch(() => ok(CORPO_TAXAS));

    const r = await getTaxasJuros({ store, fetchImpl: f.fetchImpl, agora: T0 });

    expect(r.dado).toHaveLength(2);
    expect(r.dado[0]).toMatchObject({ uid: "SELIC", nome: "Taxa Selic", valor: 14.75 });
  });

  it("TTL longo (6h): dentro da janela serve do cache", async () => {
    const { store } = storeMemoria();
    const f = fakeFetch(() => ok(CORPO_TAXAS));

    await getTaxasJuros({ store, fetchImpl: f.fetchImpl, agora: T0 });
    const r = await getTaxasJuros({ store, fetchImpl: f.fetchImpl, agora: min(60) });

    expect(r.origem).toBe("cache");
    expect(f.chamadas).toBe(1);
  });
});

// ── Open interest: indisponível por design (§6.4 #1) ─────────────────────────

describe("getOpenInterest — indisponível por design (§6.4 #1)", () => {
  it("não inventa: devolve indisponível + motivo + fonte alternativa", () => {
    const r = getOpenInterest("PETR4");
    expect(r.disponivel).toBe(false);
    expect(r.motivo).toContain("§6.4");
    expect(r.fonteAlternativa).toMatch(/volume \+ spread \+ market maker/i);
  });
});
