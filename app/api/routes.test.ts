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

// /api/ativo agora consome o preço EOD (acao_cotahist) + fundamentos (bolsai via
// repositório de frescor) — não mais o brapi. /api/calendario foi desligado (5.6)
// e não chama mais nenhuma integração. Nenhuma rota usa brapi nesta suíte.
vi.mock("@/lib/dados-opcoes/comum", () => ({ buscarCotacaoEodAtivo: vi.fn() }));
vi.mock("@/lib/fundamentos/repositorio", () => ({ obterFundamentos: vi.fn() }));

// Camada de dados própria (COTAHIST) que as rotas /api/cadeia e /api/gregas consomem.
vi.mock("@/lib/dados-opcoes/cadeia", () => ({ getCadeiaCotahist: vi.fn() }));
vi.mock("@/lib/dados-opcoes/volatilidade", () => ({ getVolatilidadeCotahist: vi.fn() }));
vi.mock("@/lib/dados-opcoes/gregas", () => ({ getGregasCotahist: vi.fn() }));

import { auth } from "@/auth";
import * as dadosComum from "@/lib/dados-opcoes/comum";
import * as repoFund from "@/lib/fundamentos/repositorio";
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

describe("GET /api/ativo/{ticker} — preço EOD (COTAHIST) + fundamentos (bolsai)", () => {
  // Data-base do fechamento (EOD) que a rota carimba no frescor do preço.
  const PREGAO = new Date("2026-06-18T00:00:00.000Z");

  /** Cotação EOD padrão (acao_cotahist) mockada. */
  function precoEod(over: Record<string, unknown> = {}) {
    return {
      ticker: "PETR4",
      preco: 38.85,
      variacao: 0.4,
      variacaoPercent: 1.04,
      volume: 1_234_567,
      dataPregao: PREGAO,
      ...over,
    };
  }

  it("devolve preço EOD, fundamentos e frescor de cada bloco (duas datas)", async () => {
    vi.mocked(dadosComum.buscarCotacaoEodAtivo).mockResolvedValue(precoEod() as never);
    vi.mocked(repoFund.obterFundamentos).mockResolvedValue(
      resultado({ ticker: "PETR4", precoLucro: 4.65, roe: 24.17 }, { origem: "cache" }) as never,
    );

    const resp = await getAtivo(
      new Request("http://localhost/api/ativo/petr4"),
      ctx({ ticker: "petr4" }),
    );
    expect(resp.status).toBe(200);
    const body = await resp.json();

    expect(body.ticker).toBe("PETR4"); // normalizado (uppercase)
    expect(body.preco.preco).toBe(38.85);
    expect(body.preco.variacaoPercent).toBe(1.04);
    expect(body.fundamentos.precoLucro).toBe(4.65);
    expect(body.fundamentos.roe).toBe(24.17);
    // Frescor por fonte (§6.3): preço = data-base EOD; fundamentos = tabela (5.4).
    expect(body.frescor.preco.geradoEm).toBe(PREGAO.toISOString());
    expect(body.frescor.preco.desatualizado).toBe(false);
    expect(body.frescor.fundamentos.origem).toBe("cache");
    expect(body.frescor.fundamentos.geradoEm).toBe(GERADO_EM.toISOString());
    // Não força atualização por padrão.
    expect(repoFund.obterFundamentos).toHaveBeenCalledWith("PETR4", { forcarAtualizacao: false });
  });

  it("propaga ?forcar=true como forcarAtualizacao para os fundamentos", async () => {
    vi.mocked(dadosComum.buscarCotacaoEodAtivo).mockResolvedValue(precoEod() as never);
    vi.mocked(repoFund.obterFundamentos).mockResolvedValue(resultado({ ticker: "PETR4" }) as never);

    await getAtivo(
      new Request("http://localhost/api/ativo/PETR4?forcar=true"),
      ctx({ ticker: "PETR4" }),
    );
    expect(repoFund.obterFundamentos).toHaveBeenCalledWith("PETR4", { forcarAtualizacao: true });
  });

  it("variação null (só 1 pregão) é repassada sem quebrar", async () => {
    vi.mocked(dadosComum.buscarCotacaoEodAtivo).mockResolvedValue(
      precoEod({ variacao: null, variacaoPercent: null }) as never,
    );
    vi.mocked(repoFund.obterFundamentos).mockResolvedValue(resultado({ ticker: "PETR4" }) as never);

    const resp = await getAtivo(
      new Request("http://localhost/api/ativo/PETR4"),
      ctx({ ticker: "PETR4" }),
    );
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.preco.variacao).toBeNull();
    expect(body.preco.variacaoPercent).toBeNull();
  });

  it("fundamentos indisponíveis degradam para null sem derrubar a rota", async () => {
    vi.mocked(dadosComum.buscarCotacaoEodAtivo).mockResolvedValue(precoEod() as never);
    vi.mocked(repoFund.obterFundamentos).mockRejectedValue(
      new IntegracaoIndisponivelError("fundamentos:PETR4", new Error("x")),
    );

    const resp = await getAtivo(
      new Request("http://localhost/api/ativo/PETR4"),
      ctx({ ticker: "PETR4" }),
    );
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.preco.preco).toBe(38.85); // preço (essencial) segue
    expect(body.fundamentos).toBeNull();
    expect(body.frescor.fundamentos).toBeNull();
  });

  it("ativo sem fechamento ingerido (preço null) → 503", async () => {
    vi.mocked(dadosComum.buscarCotacaoEodAtivo).mockResolvedValue(null as never);

    const resp = await getAtivo(
      new Request("http://localhost/api/ativo/PETR4"),
      ctx({ ticker: "PETR4" }),
    );
    expect(resp.status).toBe(503);
    const body = await resp.json();
    expect(body.erro).toMatch(/sem dados de fechamento/i);
    // Sem preço essencial, nem tenta os fundamentos.
    expect(repoFund.obterFundamentos).not.toHaveBeenCalled();
  });

  it("ticker inválido → 400 (Zod), sem tocar nas fontes", async () => {
    const resp = await getAtivo(
      new Request("http://localhost/api/ativo/!!!"),
      ctx({ ticker: "!!!" }),
    );
    expect(resp.status).toBe(400);
    expect(dadosComum.buscarCotacaoEodAtivo).not.toHaveBeenCalled();
  });

  it("sem sessão → 401, sem tocar nas fontes", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);

    const resp = await getAtivo(
      new Request("http://localhost/api/ativo/PETR4"),
      ctx({ ticker: "PETR4" }),
    );
    expect(resp.status).toBe(401);
    expect(dadosComum.buscarCotacaoEodAtivo).not.toHaveBeenCalled();
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

describe("GET /api/calendario/{ticker} — busca automática DESLIGADA (5.6)", () => {
  it("devolve proventos e resultados como indisponíveis tipados (sem rede)", async () => {
    const resp = await getCalendario(
      new Request("http://localhost/api/calendario/petr4"),
      ctx({ ticker: "petr4" }),
    );
    expect(resp.status).toBe(200);
    const body = await resp.json();

    expect(body.ticker).toBe("PETR4"); // normalizado (uppercase)
    // Mesmo formato { disponivel:false, motivo, fonteAlternativa } para AMBOS.
    expect(body.proventos.disponivel).toBe(false);
    expect(body.proventos.motivo).toMatch(/não é obtido automaticamente/i);
    expect(body.proventos.fonteAlternativa).toMatch(/corretora|manual/i);
    expect(body.resultados.disponivel).toBe(false);
    expect(body.resultados.fonteAlternativa).toMatch(/manual/i);
    // Sem frescor: não há dado automático com data de origem.
    expect(body.frescor).toBeUndefined();
  });

  it("ticker inválido → 400 (Zod)", async () => {
    const resp = await getCalendario(
      new Request("http://localhost/api/calendario/123"),
      ctx({ ticker: "123" }),
    );
    expect(resp.status).toBe(400);
  });

  it("sem sessão → 401", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    const resp = await getCalendario(
      new Request("http://localhost/api/calendario/PETR4"),
      ctx({ ticker: "PETR4" }),
    );
    expect(resp.status).toBe(401);
  });
});
