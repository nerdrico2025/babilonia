import { describe, it, expect } from "vitest";

import {
  obterFundamentos,
  FUNDAMENTOS_TTL_HORAS,
  type FundamentosRepo,
  type LinhaFundamentos,
} from "@/lib/fundamentos/repositorio";
import type { Fundamentos } from "@/lib/fundamentos/tipos";
import {
  BolsaiIndisponivelError,
  type ResultadoIntegracao,
} from "@/lib/integrations/bolsai";

/**
 * Testes do frescor sobre a tabela `fundamentos` (5.4). O repositório é um store
 * em MEMÓRIA e a busca na bolsai é INJETADA — nada toca Postgres nem rede. O
 * fixture é o domínio mapeado do JSON real do PETR4 coletado da bolsai.
 */

// ── Infra de teste ───────────────────────────────────────────────────────────

/** Repositório em memória (espelha o upsert por ticker = substitui a linha). */
function repoMemoria(inicial?: Record<string, LinhaFundamentos>) {
  const mapa = new Map<string, LinhaFundamentos>(
    Object.entries(inicial ?? {}).map(([k, v]) => [k.toUpperCase(), v]),
  );
  const repo: FundamentosRepo = {
    async ler(ticker) {
      return mapa.get(ticker.toUpperCase()) ?? null;
    },
    async gravar(dado, atualizadoEm) {
      // Substitui a entrada inteira (sem merge) — espelha o onConflictDoUpdate.
      mapa.set(dado.ticker.toUpperCase(), { dado, atualizadoEm });
    },
  };
  return { repo, mapa };
}

/** `getFundamentos` falso que conta chamadas e devolve/lança o que pedirmos. */
function fakeBolsai(handler: () => ResultadoIntegracao<Fundamentos>) {
  let chamadas = 0;
  const fn = async (_ticker: string) => {
    chamadas++;
    return handler();
  };
  return {
    buscarBolsai: fn,
    get chamadas() {
      return chamadas;
    },
  };
}

const FUND_PETR4: Fundamentos = {
  ticker: "PETR4",
  precoLucro: 4.65,
  evEbitda: 3.81,
  precoValorPatrimonial: 1.12,
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
};

/** Embrulha um Fundamentos como retorno "de rede" do client bolsai. */
const comoRede = (d: Fundamentos): ResultadoIntegracao<Fundamentos> => ({
  dado: d,
  origem: "rede",
  geradoEm: new Date(),
  desatualizado: false,
  podeForcarAtualizacao: false,
});

const T0 = new Date("2026-06-19T12:00:00Z");
const horas = (n: number) => new Date(T0.getTime() + n * 3_600_000);

// ── 1. Linha inexistente ──────────────────────────────────────────────────────

describe("obterFundamentos — linha inexistente", () => {
  it("busca na bolsai, faz upsert e devolve o dado fresco", async () => {
    const { repo, mapa } = repoMemoria();
    const b = fakeBolsai(() => comoRede(FUND_PETR4));

    const r = await obterFundamentos("petr4", {
      repo,
      buscarBolsai: b.buscarBolsai,
      agora: T0,
    });

    expect(b.chamadas).toBe(1);
    expect(r.origem).toBe("rede");
    expect(r.dado).toEqual(FUND_PETR4);
    expect(r.geradoEm).toEqual(T0);
    // gravou no banco com atualizado_em = agora
    expect(mapa.get("PETR4")).toEqual({ dado: FUND_PETR4, atualizadoEm: T0 });
  });
});

// ── 2. Linha dentro do TTL ─────────────────────────────────────────────────────

describe("obterFundamentos — linha fresca (dentro do TTL)", () => {
  it("devolve do banco e NÃO chama a bolsai", async () => {
    const { repo } = repoMemoria({
      PETR4: { dado: FUND_PETR4, atualizadoEm: horas(-1) }, // 1h atrás < 24h
    });
    const b = fakeBolsai(() => comoRede(FUND_PETR4));

    const r = await obterFundamentos("PETR4", {
      repo,
      buscarBolsai: b.buscarBolsai,
      agora: T0,
    });

    expect(b.chamadas).toBe(0);
    expect(r.origem).toBe("cache");
    expect(r.desatualizado).toBe(false);
    expect(r.geradoEm).toEqual(horas(-1));
    expect(r.dado).toEqual(FUND_PETR4);
  });
});

// ── 3. Linha expirada ──────────────────────────────────────────────────────────

describe("obterFundamentos — linha expirada", () => {
  it("rebusca na bolsai e faz upsert substituindo a linha antiga", async () => {
    const antigo: Fundamentos = { ...FUND_PETR4, precoLucro: 99, nomeEmpresa: "ANTIGO" };
    const { repo, mapa } = repoMemoria({
      PETR4: { dado: antigo, atualizadoEm: horas(-(FUNDAMENTOS_TTL_HORAS + 1)) }, // 25h atrás
    });
    const b = fakeBolsai(() => comoRede(FUND_PETR4));

    const r = await obterFundamentos("PETR4", {
      repo,
      buscarBolsai: b.buscarBolsai,
      agora: T0,
    });

    expect(b.chamadas).toBe(1);
    expect(r.origem).toBe("rede");
    expect(r.dado).toEqual(FUND_PETR4);
    expect(mapa.get("PETR4")!.atualizadoEm).toEqual(T0);
  });
});

// ── 4. forcarAtualizacao ───────────────────────────────────────────────────────

describe("obterFundamentos — forcarAtualizacao", () => {
  it("dentro do TTL, com forcar=true, ainda chama a bolsai e regrava", async () => {
    const { repo, mapa } = repoMemoria({
      PETR4: { dado: FUND_PETR4, atualizadoEm: horas(-1) }, // fresca
    });
    const novo: Fundamentos = { ...FUND_PETR4, precoLucro: 5.01 };
    const b = fakeBolsai(() => comoRede(novo));

    const r = await obterFundamentos("PETR4", {
      repo,
      buscarBolsai: b.buscarBolsai,
      agora: T0,
      forcarAtualizacao: true,
    });

    expect(b.chamadas).toBe(1);
    expect(r.origem).toBe("rede");
    expect(r.dado.precoLucro).toBe(5.01);
    expect(mapa.get("PETR4")).toEqual({ dado: novo, atualizadoEm: T0 });
  });
});

// ── 5. Falha na bolsai + linha antiga ──────────────────────────────────────────

describe("obterFundamentos — falha na bolsai com linha antiga", () => {
  it("devolve a linha antiga com frescor degradado, sem lançar", async () => {
    const { repo, mapa } = repoMemoria({
      PETR4: { dado: FUND_PETR4, atualizadoEm: horas(-(FUNDAMENTOS_TTL_HORAS + 5)) },
    });
    const b = fakeBolsai(() => {
      throw new BolsaiIndisponivelError("fundamentos:PETR4", new Error("rede caiu"));
    });

    const r = await obterFundamentos("PETR4", {
      repo,
      buscarBolsai: b.buscarBolsai,
      agora: T0,
    });

    expect(b.chamadas).toBe(1);
    expect(r.origem).toBe("cache_fallback");
    expect(r.desatualizado).toBe(true);
    expect(r.podeForcarAtualizacao).toBe(true);
    expect(r.aviso).toContain("não foi possível atualizar");
    expect(r.dado).toEqual(FUND_PETR4);
    // não regravou (a linha antiga continua intacta)
    expect(mapa.get("PETR4")!.atualizadoEm).toEqual(horas(-(FUNDAMENTOS_TTL_HORAS + 5)));
  });
});

// ── 6. Falha na bolsai + nenhuma linha ─────────────────────────────────────────

describe("obterFundamentos — falha na bolsai sem linha no banco", () => {
  it("lança BolsaiIndisponivelError (erro tipado)", async () => {
    const { repo } = repoMemoria();
    const b = fakeBolsai(() => {
      throw new BolsaiIndisponivelError("fundamentos:PETR4", new Error("rede caiu"));
    });

    await expect(
      obterFundamentos("PETR4", { repo, buscarBolsai: b.buscarBolsai, agora: T0 }),
    ).rejects.toBeInstanceOf(BolsaiIndisponivelError);
  });
});

// ── 7. Upsert substitui a linha inteira ────────────────────────────────────────

describe("obterFundamentos — upsert substitui a linha inteira", () => {
  it("nenhum campo antigo sobrevive: campos que viraram null no novo dado ficam null", async () => {
    // Linha antiga com vários campos preenchidos.
    const antigo: Fundamentos = { ...FUND_PETR4, roe: 24.17, roic: 16.7, nomeEmpresa: "VELHO SA" };
    const { repo, mapa } = repoMemoria({
      PETR4: { dado: antigo, atualizadoEm: horas(-30) }, // expirada
    });
    // Novo dado com esses mesmos campos agora null.
    const novo: Fundamentos = { ...FUND_PETR4, roe: null, roic: null, nomeEmpresa: null };
    const b = fakeBolsai(() => comoRede(novo));

    const r = await obterFundamentos("PETR4", {
      repo,
      buscarBolsai: b.buscarBolsai,
      agora: T0,
    });

    // O resultado e a linha gravada são EXATAMENTE o novo dado — sem mistura.
    expect(r.dado.roe).toBeNull();
    expect(r.dado.roic).toBeNull();
    expect(r.dado.nomeEmpresa).toBeNull();
    expect(mapa.get("PETR4")!.dado).toEqual(novo);
    expect(mapa.get("PETR4")!.dado.nomeEmpresa).not.toBe("VELHO SA");
  });
});
