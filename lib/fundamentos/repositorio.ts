/**
 * repositorio — frescor dos FUNDAMENTOS sobre o Postgres (server-only).
 *
 * A partir do 5.4 a tabela `fundamentos` (db/schema, 5.3) é a ÚNICA fonte de
 * frescor deste fluxo: o critério "preciso rebuscar?" passa a ser o
 * `atualizado_em` da LINHA, não mais o TTL do `api_cache`. (O `api_cache` segue
 * vivo para outras integrações — não é tocado aqui.)
 *
 * Por que um módulo separado de `bolsai.ts`: o client bolsai é a fronteira de
 * INTEGRAÇÃO (HTTP + Zod + cache genérico contra rajadas de request); este módulo
 * é a camada de PERSISTÊNCIA/frescor do dado de negócio. Separar evita que o
 * client passe a depender de `db/schema` e mantém cada fronteira focada (§5.1).
 *
 * Espelho sem campos manuais (5.3): o upsert SUBSTITUI a linha inteira por
 * ticker — sem merge campo a campo. `getFundamentos` (bolsai, 5.2) continua
 * intacto: a chamada HTTP em si segue protegida pelo cache genérico; só o
 * critério de frescor do dado de negócio migrou para cá.
 */

import { eq } from "drizzle-orm";

import { getDb } from "@/db";
import { fundamentos as tabelaFundamentos } from "@/db/schema";
import type { Fundamentos } from "@/lib/fundamentos/tipos";
import {
  getFundamentos,
  BolsaiIndisponivelError,
} from "@/lib/integrations/bolsai";
import type { ResultadoIntegracao } from "@/lib/integrations/bolsai";

/** Janela de frescor dos fundamentos (mesma do 5.2: 24h). */
export const FUNDAMENTOS_TTL_HORAS = 24;
const TTL_MS = FUNDAMENTOS_TTL_HORAS * 60 * 60 * 1000;

// ── Acesso ao Postgres (injetável p/ teste) ───────────────────────────────────

/** Linha de fundamentos já no domínio + quando NÓS a gravamos. */
export interface LinhaFundamentos {
  dado: Fundamentos;
  atualizadoEm: Date;
}

/** Repositório da tabela `fundamentos` (leitura + upsert por ticker). */
export interface FundamentosRepo {
  ler(ticker: string): Promise<LinhaFundamentos | null>;
  /** Upsert por ticker SUBSTITUINDO a linha inteira (sem merge). */
  gravar(dado: Fundamentos, atualizadoEm: Date): Promise<void>;
}

/** `numeric` (string|null) → number|null, seguindo a convenção de `db/queries`. */
function num(v: string | null): number | null {
  return v == null ? null : Number(v);
}
/** number|null → `numeric` (string|null) para o insert do Drizzle. */
function str(v: number | null): string | null {
  return v == null ? null : String(v);
}

/** Converte a LINHA do banco no tipo de domínio `Fundamentos`. */
function linhaParaDominio(r: typeof tabelaFundamentos.$inferSelect): Fundamentos {
  return {
    ticker: r.ticker,
    precoLucro: num(r.precoLucro),
    evEbitda: num(r.evEbitda),
    precoValorPatrimonial: num(r.precoValorPatrimonial),
    margemLiquida: num(r.margemLiquida),
    roe: num(r.roe),
    roic: num(r.roic),
    roa: num(r.roa),
    lpa: num(r.lpa),
    vpa: num(r.vpa),
    marketCap: num(r.marketCap),
    lucroLiquido: num(r.lucroLiquido),
    ebitda: num(r.ebitda),
    dataReferencia: r.dataReferencia,
    nomeEmpresa: r.nomeEmpresa,
  };
}

/** Repositório padrão: tabela `fundamentos` via Drizzle (§7). */
export function criarRepoDrizzle(): FundamentosRepo {
  return {
    async ler(ticker) {
      const db = getDb();
      const linhas = await db
        .select()
        .from(tabelaFundamentos)
        .where(eq(tabelaFundamentos.ticker, ticker.toUpperCase()))
        .limit(1);
      const linha = linhas[0];
      if (!linha) return null;
      return { dado: linhaParaDominio(linha), atualizadoEm: linha.atualizadoEm };
    },
    async gravar(dado, atualizadoEm) {
      const db = getDb();
      // TODAS as colunas no `set` — o refetch substitui a linha inteira (5.3),
      // nenhum valor antigo "sobrevive" misturado com o novo.
      const valores = {
        ticker: dado.ticker.toUpperCase(),
        precoLucro: str(dado.precoLucro),
        evEbitda: str(dado.evEbitda),
        precoValorPatrimonial: str(dado.precoValorPatrimonial),
        margemLiquida: str(dado.margemLiquida),
        roe: str(dado.roe),
        roic: str(dado.roic),
        roa: str(dado.roa),
        lpa: str(dado.lpa),
        vpa: str(dado.vpa),
        marketCap: str(dado.marketCap),
        lucroLiquido: str(dado.lucroLiquido),
        ebitda: str(dado.ebitda),
        dataReferencia: dado.dataReferencia,
        nomeEmpresa: dado.nomeEmpresa,
        atualizadoEm,
      };
      await db
        .insert(tabelaFundamentos)
        .values(valores)
        .onConflictDoUpdate({ target: tabelaFundamentos.ticker, set: valores });
    },
  };
}

let _repoPadrao: FundamentosRepo | null = null;
function repoPadrao(): FundamentosRepo {
  if (!_repoPadrao) _repoPadrao = criarRepoDrizzle();
  return _repoPadrao;
}

// ── Orquestração do frescor ────────────────────────────────────────────────────

/** Função de busca na bolsai (injetável p/ teste; default = client do 5.2). */
type BuscarBolsai = (ticker: string) => Promise<ResultadoIntegracao<Fundamentos>>;

/** Opções de `obterFundamentos` (injeções p/ teste + controle de atualização). */
export interface OpcoesObterFundamentos {
  /** Ignora o frescor da linha e força ida à bolsai (ainda degrada em falha). */
  forcarAtualizacao?: boolean;
  /** "Agora" para o cálculo de TTL (default: data atual). */
  agora?: Date;
  /** Repositório (default: tabela `fundamentos` via Drizzle). Injetável. */
  repo?: FundamentosRepo;
  /** Busca na bolsai (default: `getFundamentos` do 5.2). Injetável. */
  buscarBolsai?: BuscarBolsai;
}

/** Formata DD/MM no fuso de São Paulo para o aviso de dado desatualizado. */
function diaMes(d: Date): string {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "America/Sao_Paulo",
  }).format(d);
}

/**
 * Fundamentos do ativo-objeto, com frescor baseado na tabela `fundamentos`:
 *
 *  - linha ausente, vencida (`atualizado_em` > TTL) ou `forcarAtualizacao` →
 *    busca na bolsai, faz UPSERT (substitui a linha inteira) e devolve o fresco;
 *  - linha dentro do TTL → devolve do banco SEM chamar a bolsai;
 *  - falha na bolsai COM linha antiga (mesmo vencida) → devolve a antiga com
 *    `origem: "cache_fallback"` + aviso, sem lançar (degradação graciosa, §6.3);
 *  - falha na bolsai SEM linha alguma → lança `BolsaiIndisponivelError` (tipado).
 */
export async function obterFundamentos(
  ticker: string,
  opcoes: OpcoesObterFundamentos = {},
): Promise<ResultadoIntegracao<Fundamentos>> {
  const repo = opcoes.repo ?? repoPadrao();
  const agora = opcoes.agora ?? new Date();
  const forcar = opcoes.forcarAtualizacao ?? false;
  const buscar = opcoes.buscarBolsai ?? ((t: string) => getFundamentos(t));

  const existente = await repo.ler(ticker);
  const dentroTtl =
    existente !== null && agora.getTime() - existente.atualizadoEm.getTime() < TTL_MS;

  // 1) Linha fresca no banco → devolve direto, sem tocar na bolsai.
  if (!forcar && dentroTtl) {
    return {
      dado: existente!.dado,
      origem: "cache",
      geradoEm: existente!.atualizadoEm,
      desatualizado: false,
      podeForcarAtualizacao: false,
    };
  }

  // 2) Ausente / vencida / forçada → busca na bolsai e faz upsert.
  try {
    const r = await buscar(ticker);
    await repo.gravar(r.dado, agora);
    return {
      dado: r.dado,
      origem: "rede",
      geradoEm: agora,
      desatualizado: false,
      podeForcarAtualizacao: false,
    };
  } catch (causa) {
    // 3) Falha → degrada para a linha antiga, se houver.
    if (existente !== null) {
      return {
        dado: existente.dado,
        origem: "cache_fallback",
        geradoEm: existente.atualizadoEm,
        desatualizado: true,
        podeForcarAtualizacao: true,
        aviso: `Mostrando fundamentos de ${diaMes(existente.atualizadoEm)} — não foi possível atualizar agora.`,
      };
    }
    // 4) Sem nada no banco: não há o que exibir. O Route Handler trata (§6.3).
    throw new BolsaiIndisponivelError(`fundamentos:${ticker.toUpperCase()}`, causa);
  }
}
