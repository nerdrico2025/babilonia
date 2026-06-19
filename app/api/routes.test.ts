import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Testes de integração leves dos Route Handlers (§5.1/§13 do PRD).
 *
 * O auth (`@/auth`), o brapi e a camada de dados COTAHIST (`lib/dados-opcoes`) são
 * MOCKADOS — nada toca a rede, o Postgres ou o NextAuth real. Validamos o contrato:
 * guarda de sessão (401), validação de parâmetro (400), uso da camada de cache,
 * o metadado de frescor (§6.3) e a degradação graciosa de dados complementares.
 */

// ── Mocks (hoisted pelo vitest) ──────────────────────────────────────────────

vi.mock("@/auth", () => ({ auth: vi.fn() }));

vi.mock("@/lib/integrations/brapi", () => ({
  getCotacao: vi.fn(),
  getFundamentos: vi.fn(),
  getCalendarioProventos: vi.fn(),
  getCalendarioResultados: vi.fn(),
}));

// Camada de dados própria (COTAHIST) que as rotas /api/cadeia e /api/gregas consomem.
vi.mock("@/lib/dados-opcoes/cadeia", () => ({ getCadeiaCotahist: vi.fn() }));
vi.mock("@/lib/dados-opcoes/volatilidade", () => ({ getVolatilidadeCotahist: vi.fn() }));
vi.mock("@/lib/dados-opcoes/gregas", () => ({ getGregasCotahist: vi.fn() }));

import { auth } from "@/auth";
import * as brapi from "@/lib/integrations/brapi";
import * as dadosCadeia from "@/lib/dados-opcoes/cadeia";
import * as dadosVol from "@/lib/dados-opcoes/volatilidade";
import * as dadosGregas from "@/lib/dados-opcoes/gregas";
// Classe REAL: `erroIntegracao` faz `instanceof` para devolver 503.
import { IntegracaoIndisponivelError } from "@/lib/integrations/cache";

import { GET as getAtivo } from "@/app/api/ativo/[ticker]/route";
import { GET as getCadeia } from "@/app/api/cadeia/[ativo]/route";
import { GET as getGregas } from "@/app/api/gregas/route";
import { GET as getCalendario } from "@/app/api/calendario/[ticker]/route";

// ── Infra de teste ───────────────────────────────────────────────────────────

const GERADO_EM = new Date("2026-06-15T12:00:00.000Z");

/** Monta um `ResultadoIntegracao` (frescor "rede" por padrão). */
function resultado<T>(dado: T, over: Record<string, unknown> = {}) {
  return {
    dado,
    origem: "rede",
    geradoEm: GERADO_EM,
    desatualizado: false,
    podeForcarAtualizacao: false,
    ...over,
  };
}

/** `ctx.params` é uma Promise no Next 16. */
const ctx = <T extends object>(params: T) => ({ params: Promise.resolve(params) });

/** Sessão logada (default em cada teste). */
function logado() {
  vi.mocked(auth).mockResolvedValue({ user: { name: "owner" } } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  logado();
});

// ── /api/ativo/{ticker} ──────────────────────────────────────────────────────

describe("GET /api/ativo/{ticker} — cotação + fundamentos (brapi)", () => {
  it("devolve cotação, fundamentos e frescor de cada bloco", async () => {
    vi.mocked(brapi.getCotacao).mockResolvedValue(
      resultado({ ticker: "PETR4", preco: 36.65 }) as never,
    );
    vi.mocked(brapi.getFundamentos).mockResolvedValue(
      resultado({ ticker: "PETR4", precoLucro: 6.09 }, { origem: "cache" }) as never,
    );

    const resp = await getAtivo(
      new Request("http://localhost/api/ativo/petr4"),
      ctx({ ticker: "petr4" }),
    );
    expect(resp.status).toBe(200);
    const body = await resp.json();

    expect(body.ticker).toBe("PETR4"); // normalizado (uppercase)
    expect(body.cotacao.preco).toBe(36.65);
    expect(body.fundamentos.precoLucro).toBe(6.09);
    // Frescor (§6.3): origem + timestamp ISO da fonte.
    expect(body.frescor.cotacao.origem).toBe("rede");
    expect(body.frescor.cotacao.geradoEm).toBe(GERADO_EM.toISOString());
    expect(body.frescor.fundamentos.origem).toBe("cache");
    // Usou a camada de integração (proxy), não a API externa direto.
    expect(brapi.getCotacao).toHaveBeenCalledWith("PETR4", { forcar: false });
  });

  it("propaga o flag ?forcar=true para a camada de cache", async () => {
    vi.mocked(brapi.getCotacao).mockResolvedValue(resultado({ ticker: "PETR4" }) as never);
    vi.mocked(brapi.getFundamentos).mockResolvedValue(resultado({}) as never);

    await getAtivo(
      new Request("http://localhost/api/ativo/PETR4?forcar=true"),
      ctx({ ticker: "PETR4" }),
    );
    expect(brapi.getCotacao).toHaveBeenCalledWith("PETR4", { forcar: true });
  });

  it("fundamentos indisponíveis degradam para null sem derrubar a rota", async () => {
    vi.mocked(brapi.getCotacao).mockResolvedValue(resultado({ ticker: "PETR4", preco: 1 }) as never);
    vi.mocked(brapi.getFundamentos).mockRejectedValue(
      new IntegracaoIndisponivelError("brapi:fundamentos:PETR4", new Error("x")),
    );

    const resp = await getAtivo(
      new Request("http://localhost/api/ativo/PETR4"),
      ctx({ ticker: "PETR4" }),
    );
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.fundamentos).toBeNull();
    expect(body.frescor.fundamentos).toBeNull();
  });

  it("cotação sem cache (IntegracaoIndisponivelError) → 503", async () => {
    vi.mocked(brapi.getCotacao).mockRejectedValue(
      new IntegracaoIndisponivelError("brapi:quote:PETR4", new Error("falhou")),
    );

    const resp = await getAtivo(
      new Request("http://localhost/api/ativo/PETR4"),
      ctx({ ticker: "PETR4" }),
    );
    expect(resp.status).toBe(503);
    const body = await resp.json();
    expect(body.erro).toContain("indisponível");
  });

  it("ticker inválido → 400 (Zod), sem chamar a integração", async () => {
    const resp = await getAtivo(
      new Request("http://localhost/api/ativo/!!!"),
      ctx({ ticker: "!!!" }),
    );
    expect(resp.status).toBe(400);
    expect(brapi.getCotacao).not.toHaveBeenCalled();
  });

  it("sem sessão → 401, sem chamar a integração", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);

    const resp = await getAtivo(
      new Request("http://localhost/api/ativo/PETR4"),
      ctx({ ticker: "PETR4" }),
    );
    expect(resp.status).toBe(401);
    expect(brapi.getCotacao).not.toHaveBeenCalled();
  });
});

// ── /api/cadeia/{ativo} ──────────────────────────────────────────────────────

describe("GET /api/cadeia/{ativo} — cadeia + IV/IV Rank (COTAHIST)", () => {
  // Data-base (as-of) EOD: pregão de fechamento que a rota carimba no frescor.
  const ASOF = new Date("2026-06-15T00:00:00.000Z");

  it("devolve cadeia, volatilidade e frescor EOD de cada bloco", async () => {
    vi.mocked(dadosCadeia.getCadeiaCotahist).mockResolvedValue({
      cadeia: { ativo: "PETR4", openInterestDisponivel: false } as never,
      asOf: ASOF,
    });
    vi.mocked(dadosVol.getVolatilidadeCotahist).mockResolvedValue({
      volatilidade: { ativo: "PETR4", ivRank1a: 72.5, ivRank6m: null } as never,
      asOf: ASOF,
    });

    const resp = await getCadeia(
      new Request("http://localhost/api/cadeia/petr4"),
      ctx({ ativo: "petr4" }),
    );
    expect(resp.status).toBe(200);
    const body = await resp.json();

    expect(body.ativo).toBe("PETR4"); // normalizado (uppercase)
    expect(body.cadeia.openInterestDisponivel).toBe(false); // §6.4 #1 repassado
    expect(body.volatilidade.ivRank1a).toBe(72.5);
    expect(body.volatilidade.ivRank6m).toBeNull(); // 6m best-effort pode faltar
    // Frescor agora é a DATA-BASE EOD (asOf), não o relógio do cache.
    expect(body.frescor.cadeia.geradoEm).toBe(ASOF.toISOString());
    expect(body.frescor.cadeia.desatualizado).toBe(false);
    expect(body.frescor.volatilidade.geradoEm).toBe(ASOF.toISOString());
    // Consumiu a camada de dados própria (COTAHIST).
    expect(dadosCadeia.getCadeiaCotahist).toHaveBeenCalledWith("PETR4");
  });

  it("volatilidade sem IV diária degrada para null; cadeia segue", async () => {
    vi.mocked(dadosCadeia.getCadeiaCotahist).mockResolvedValue({
      cadeia: { ativo: "PETR4" } as never,
      asOf: ASOF,
    });
    // Sem `iv_history`: o módulo devolve asOf null → a rota zera o bloco.
    vi.mocked(dadosVol.getVolatilidadeCotahist).mockResolvedValue({
      volatilidade: { ativo: "PETR4" } as never,
      asOf: null,
    });

    const resp = await getCadeia(
      new Request("http://localhost/api/cadeia/PETR4"),
      ctx({ ativo: "PETR4" }),
    );
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.volatilidade).toBeNull();
    expect(body.frescor.volatilidade).toBeNull();
    expect(body.frescor.cadeia.geradoEm).toBe(ASOF.toISOString()); // cadeia intacta
  });

  it("ativo sem cadeia ingerida (asOf null) → 503", async () => {
    vi.mocked(dadosCadeia.getCadeiaCotahist).mockResolvedValue({
      cadeia: { ativo: "PETR4" } as never,
      asOf: null,
    });

    const resp = await getCadeia(
      new Request("http://localhost/api/cadeia/PETR4"),
      ctx({ ativo: "PETR4" }),
    );
    expect(resp.status).toBe(503);
    const body = await resp.json();
    expect(body.erro).toMatch(/sem dados/i);
    // Não tenta a volatilidade quando a cadeia essencial falta.
    expect(dadosVol.getVolatilidadeCotahist).not.toHaveBeenCalled();
  });

  it("ativo inválido → 400, sem tocar na camada de dados", async () => {
    const resp = await getCadeia(
      new Request("http://localhost/api/cadeia/123"),
      ctx({ ativo: "123" }),
    );
    expect(resp.status).toBe(400);
    expect(dadosCadeia.getCadeiaCotahist).not.toHaveBeenCalled();
  });
});

// ── /api/gregas ──────────────────────────────────────────────────────────────

describe("GET /api/gregas — gregas por opção via Black-Scholes (COTAHIST)", () => {
  const ASOF = new Date("2026-06-17T00:00:00.000Z");

  /** Pega o 2º argumento (opções) da chamada mais recente ao módulo. */
  function opcoesChamada() {
    return vi.mocked(dadosGregas.getGregasCotahist).mock.calls.at(-1)![1]!;
  }

  it("calcula as gregas a partir de symbol e devolve frescor EOD", async () => {
    vi.mocked(dadosGregas.getGregasCotahist).mockResolvedValue({
      gregas: { symbol: "PETRK221", delta: 0.5, iv: 28.5, margem: null } as never,
      asOf: ASOF,
    });

    const resp = await getGregas(
      new Request("http://localhost/api/gregas?symbol=petrk221&irate=15&vol=28.5"),
    );
    expect(resp.status).toBe(200);
    const body = await resp.json();

    expect(body.symbol).toBe("PETRK221"); // normalizado (uppercase)
    expect(body.gregas.delta).toBe(0.5);
    expect(body.gregas.margem).toBeNull(); // campo não calculável segue null, sem quebrar
    // Frescor agora é a data-base EOD (trade_date da série), não o relógio.
    expect(body.frescor.geradoEm).toBe(ASOF.toISOString());
    expect(body.frescor.desatualizado).toBe(false);
    // Consumiu a camada própria; vol repassado; symbol normalizado.
    expect(dadosGregas.getGregasCotahist).toHaveBeenCalledWith(
      "PETRK221",
      expect.objectContaining({ vol: 28.5 }),
    );
    // irate (% Selic) é convertido para a taxa CONTÍNUA `r` = ln(1 + i/100).
    expect(opcoesChamada().r).toBeCloseTo(Math.log(1 + 15 / 100), 10);
  });

  it("sem irate → auto-SELIC (200, r indefinido); não mais 400", async () => {
    vi.mocked(dadosGregas.getGregasCotahist).mockResolvedValue({
      gregas: { symbol: "PETRK221", delta: 0.3 } as never,
      asOf: ASOF,
    });

    const resp = await getGregas(
      new Request("http://localhost/api/gregas?symbol=PETRK221"),
    );
    expect(resp.status).toBe(200);
    // Sem override: r indefinido → o módulo busca a SELIC do BCB-SGS na data.
    expect(opcoesChamada().r).toBeUndefined();
  });

  it("irate é override e vai como taxa contínua", async () => {
    vi.mocked(dadosGregas.getGregasCotahist).mockResolvedValue({
      gregas: { symbol: "PETRK221" } as never,
      asOf: ASOF,
    });

    await getGregas(new Request("http://localhost/api/gregas?symbol=PETRK221&irate=10"));
    expect(opcoesChamada().r).toBeCloseTo(Math.log(1.1), 10); // ln(1,10) ≈ 0,09531
  });

  it("sem sessão → 401, sem chamar a calculadora", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    const resp = await getGregas(
      new Request("http://localhost/api/gregas?symbol=PETRK221&irate=15"),
    );
    expect(resp.status).toBe(401);
    expect(dadosGregas.getGregasCotahist).not.toHaveBeenCalled();
  });
});

// ── /api/calendario/{ticker} ─────────────────────────────────────────────────

describe("GET /api/calendario/{ticker} — proventos + resultados (brapi)", () => {
  it("devolve proventos com frescor e a indisponibilidade honesta de resultados", async () => {
    vi.mocked(brapi.getCalendarioProventos).mockResolvedValue(
      resultado([{ dataPagamento: "2026-05-20", valor: 0.95 }]) as never,
    );
    vi.mocked(brapi.getCalendarioResultados).mockReturnValue({
      disponivel: false,
      motivo: "O brapi não fornece... (§6.4).",
      fonteAlternativa: "input manual (§8.2).",
    } as never);

    const resp = await getCalendario(
      new Request("http://localhost/api/calendario/petr4"),
      ctx({ ticker: "petr4" }),
    );
    expect(resp.status).toBe(200);
    const body = await resp.json();

    expect(body.ticker).toBe("PETR4");
    expect(body.proventos).toHaveLength(1);
    expect(body.frescor.proventos.origem).toBe("rede");
    // Não inventa calendário de resultados (§6.4 / §2.4).
    expect(body.resultados.disponivel).toBe(false);
    expect(body.resultados.fonteAlternativa).toMatch(/manual/i);
  });

  it("proventos sem cache (IntegracaoIndisponivelError) → 503", async () => {
    vi.mocked(brapi.getCalendarioResultados).mockReturnValue({ disponivel: false } as never);
    vi.mocked(brapi.getCalendarioProventos).mockRejectedValue(
      new IntegracaoIndisponivelError("brapi:proventos:PETR4", new Error("x")),
    );

    const resp = await getCalendario(
      new Request("http://localhost/api/calendario/PETR4"),
      ctx({ ticker: "PETR4" }),
    );
    expect(resp.status).toBe(503);
  });
});
