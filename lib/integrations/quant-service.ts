/**
 * Integração com o MICROSERVIÇO DE QUANT (FastAPI, `services/quant/`) — §4.1/§15.
 *
 * O screening de cadeia inteira (varrer todas as séries e ranquear estruturas por
 * risco/retorno) roda no microserviço Python; aqui é a camada de integração que o
 * Next.js usa para falá-lo por HTTP. Segue as regras do §5.1/§13:
 *  - Nenhuma tela chama o microserviço direto: tudo passa por aqui, e a tela fala
 *    só com a Route Handler `app/api/screening` (que usa este módulo). Server-only.
 *  - A URL do serviço vem de `QUANT_SERVICE_URL` (env, server-only) — nunca embutida
 *    no cliente. Não é segredo, mas é config de servidor.
 *  - Degradação graciosa (§6.3): timeout + erro tipado `QuantServiceIndisponivelError`
 *    quando o serviço não responde (Railway free pode hibernar). A rota traduz isso
 *    para um aviso "ferramenta de triagem indisponível", sem quebrar o resto do app.
 *
 * NÃO recalculamos nada aqui: os números (risco/ganho/breakeven/razão) vêm 100% do
 * microserviço, que por sua vez usa as MESMAS fórmulas do §18 (ver
 * `services/quant/app/quant/options_math.py`). O schema Zod abaixo espelha o
 * contrato real do serviço (`services/quant/app/schemas.py`).
 */

import { z } from "zod";

// ── Erro tipado de indisponibilidade ─────────────────────────────────────────

/** O microserviço não respondeu a tempo / caiu / está hibernando (§6.3). */
export class QuantServiceIndisponivelError extends Error {
  constructor(
    mensagem: string,
    public readonly causa?: unknown,
  ) {
    super(mensagem);
    this.name = "QuantServiceIndisponivelError";
  }
}

// ── Tipos de domínio (entrada) ───────────────────────────────────────────────

/** Famílias de estrutura que o screening sabe ranquear (espelha `TipoEstrutura`). */
export const TIPOS_ESTRUTURA = [
  "trava_alta",
  "trava_baixa",
  "borboleta",
  "condor",
  "straddle",
  "strangle",
] as const;
export type TipoEstrutura = (typeof TIPOS_ESTRUTURA)[number];

/** Parâmetros do screening (camelCase idiomático; mapeados p/ snake_case no body). */
export interface ScreeningParams {
  /** Ativos-objeto. Vazio/ausente = watchlist inteira (default do serviço). */
  tickers?: string[];
  /** Estruturas a considerar. Ausente = todas. */
  tipos?: TipoEstrutura[];
  /** Quantas estruturas devolver (default do serviço: 10). */
  topN?: number;
  /** Capital total (BRL) para o filtro de risco (§10). */
  capitalTotal?: number;
  /** Risco máx. aceitável como fração (0.05 = 5%). */
  riscoMaxPct?: number;
  /** Faixa de vencimento (dias corridos a partir do pregão-base). */
  vencimentoMinDias?: number;
  vencimentoMaxDias?: number;
  maxVencimentos?: number;
  maxStrikesPorLado?: number;
  tamanhoLote?: number;
}

// ── Schema Zod da RESPOSTA (espelha services/quant/app/schemas.py) ───────────

const pernaSchema = z.object({
  option_symbol: z.string(),
  tipo: z.enum(["call", "put"]),
  lado: z.enum(["compra", "venda"]),
  strike: z.number(),
  premio: z.number(),
  bid: z.number().nullable(),
  ask: z.number().nullable(),
  quantidade: z.number().int(),
});

const estruturaSchema = z.object({
  ativo: z.string(),
  tipo_estrutura: z.enum(TIPOS_ESTRUTURA),
  nome: z.string(),
  vencimento: z.string(), // ISO datetime (serializado pelo FastAPI)
  data_referencia: z.string().nullable(),
  // Risco SEMPRE antes do ganho (§2): risco máximo e rótulo em primeiro.
  risco_maximo: z.number(),
  rotulo_risco: z.enum(["DEFINIDO", "INDEFINIDO"]),
  // Ganho pode ser número (BRL) ou a string "ilimitado".
  ganho_maximo: z.union([z.number(), z.literal("ilimitado")]),
  breakevens: z.array(z.number()),
  razao_ganho_risco: z.number().nullable(),
  risco_pct_capital: z.number().nullable(),
  pernas: z.array(pernaSchema),
  avisos: z.array(z.string()),
});

const frescorSchema = z.object({
  ativo: z.string(),
  data_referencia: z.string().nullable(),
  opcoes_na_cadeia: z.number().int(),
});

const respostaSchema = z.object({
  aviso: z.string(), // TRIAGEM, não recomendação (§2)
  gerado_em: z.string(),
  frescor: z.array(frescorSchema),
  ranking: z.array(estruturaSchema),
});

/** Tipos de domínio derivados do schema (consumidos pela rota e, via `type`, pela UI). */
export type PernaScreening = z.infer<typeof pernaSchema>;
export type EstruturaScreening = z.infer<typeof estruturaSchema>;
export type FrescorScreening = z.infer<typeof frescorSchema>;
export type RespostaScreening = z.infer<typeof respostaSchema>;

// ── Configuração ──────────────────────────────────────────────────────────────

/** URL base do microserviço (server-only). Default p/ dev local (`uvicorn` na 8000). */
function baseUrl(): string {
  return process.env.QUANT_SERVICE_URL ?? "http://localhost:8000";
}

/**
 * Timeout (ms) da chamada. GENEROSO de propósito: no Railway free o serviço
 * HIBERNA e o primeiro request "acorda" o container (cold start de vários
 * segundos). Curto demais falharia sempre na primeira chamada — a UI, por sua vez,
 * mostra um loading que avisa que o serviço pode estar "acordando".
 */
export const TIMEOUT_PADRAO_MS = 25_000;

// ── Chamada HTTP ──────────────────────────────────────────────────────────────

/**
 * POST genérico ao microserviço, COMPARTILHADO por `/screening` e `/backtest`.
 * Cuida do timeout (cold start do Railway), do `AbortController` e da tradução de
 * falha de REDE/timeout para `QuantServiceIndisponivelError` (degradação graciosa,
 * §6.3). Devolve a `Response` crua: cada chamador decide o que fazer com o status
 * (o screening trata qualquer não-2xx como indisponível; o backtest separa 4xx de
 * negócio). NÃO valida schema aqui — isso é do chamador (Zod).
 */
async function postQuant(
  rota: string,
  body: unknown,
  opcoes: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<Response> {
  const fetchImpl = opcoes.fetchImpl ?? globalThis.fetch;
  const timeoutMs = opcoes.timeoutMs ?? TIMEOUT_PADRAO_MS;
  const url = `${baseUrl().replace(/\/$/, "")}${rota}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
      // Dado de quant é sempre fresco; não cachear no fetch do servidor.
      cache: "no-store",
    });
  } catch (e) {
    const abortou = e instanceof Error && e.name === "AbortError";
    throw new QuantServiceIndisponivelError(
      abortou
        ? "O serviço de quant não respondeu a tempo (pode estar iniciando)."
        : "Não foi possível falar com o serviço de quant.",
      e,
    );
  } finally {
    clearTimeout(timer);
  }
}

/** Monta o corpo snake_case esperado pelo FastAPI, omitindo campos ausentes. */
function montarBody(p: ScreeningParams): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (p.tickers && p.tickers.length > 0) body.tickers = p.tickers;
  if (p.tipos && p.tipos.length > 0) body.tipos = p.tipos;
  if (p.topN != null) body.top_n = p.topN;
  if (p.capitalTotal != null) body.capital_total = p.capitalTotal;
  if (p.riscoMaxPct != null) body.risco_max_pct = p.riscoMaxPct;
  if (p.vencimentoMinDias != null) body.vencimento_min_dias = p.vencimentoMinDias;
  if (p.vencimentoMaxDias != null) body.vencimento_max_dias = p.vencimentoMaxDias;
  if (p.maxVencimentos != null) body.max_vencimentos = p.maxVencimentos;
  if (p.maxStrikesPorLado != null) body.max_strikes_por_lado = p.maxStrikesPorLado;
  if (p.tamanhoLote != null) body.tamanho_lote = p.tamanhoLote;
  return body;
}

/**
 * Chama `POST /screening` do microserviço e valida a resposta com Zod.
 *
 * Lança `QuantServiceIndisponivelError` em timeout / rede / status de erro
 * (degradação graciosa). Erro de schema (contrato divergente) propaga como
 * `ZodError` — a rota o trata como "resposta inesperada" (502), separando "serviço
 * fora" de "serviço respondeu errado".
 */
export async function screenarCadeia(
  params: ScreeningParams,
  opcoes: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<RespostaScreening> {
  const resp = await postQuant("/screening", montarBody(params), opcoes);
  if (!resp.ok) {
    throw new QuantServiceIndisponivelError(
      `O serviço de triagem respondeu ${resp.status}.`,
    );
  }
  const json: unknown = await resp.json().catch(() => null);
  // Parse estrito: se o contrato divergir, falha alto (ZodError) — não inventamos.
  return respostaSchema.parse(json);
}

// ── Backtest (§15 Fase 3) — simulação histórica de uma estrutura ─────────────

/**
 * 4xx de NEGÓCIO do `/backtest` (≠ indisponibilidade): o serviço respondeu, mas a
 * simulação não pôde rodar com dado real — 422 = dados insuficientes (ex.: a data
 * de entrada não tem fechamento; `faltam` lista o que faltou), 400 = estrutura
 * inválida (datas trocadas, vencimentos mistos). A UI mostra a mensagem para o
 * usuário corrigir; NÃO é "serviço fora" (§2.4 — nunca rodar com dado inventado).
 */
export class BacktestEntradaError extends Error {
  constructor(
    public readonly status: number,
    mensagem: string,
    public readonly faltam?: string[],
  ) {
    super(mensagem);
    this.name = "BacktestEntradaError";
  }
}

/** Uma perna da estrutura a simular. tipo/strike são resolvidos pela base (§2.4). */
export interface PernaBacktestParam {
  /** Ticker EXATO da opção (ex.: "PETRE450") — vem da cadeia, não é inventado. */
  optionSymbol: string;
  lado: LadoBacktest;
  /** Quantidade em contratos (lotes). */
  quantidade: number;
}
export type LadoBacktest = "compra" | "venda";

/** Parâmetros do backtest (camelCase; mapeados p/ snake_case no body). */
export interface BacktestParams {
  pernas: PernaBacktestParam[];
  /** Data de entrada (yyyy-mm-dd). */
  dataEntrada: string;
  /** Data de saída (yyyy-mm-dd). Ausente = levar ao vencimento (default do serviço). */
  dataSaida?: string;
  tamanhoLote?: number;
}

// Schema Zod da RESPOSTA do backtest (espelha services/quant/app/schemas.py).
const pontoSerieSchema = z.object({
  data: z.string(), // ISO datetime (serializado pelo FastAPI)
  valor_posicao: z.number(),
  pl_acumulado: z.number(),
  sem_negociacao: z.boolean(),
  fonte: z.enum(["mercado", "vencimento"]),
  // None = pregão comum; "ajuste_provento" = data-ex de evento corporativo.
  evento: z.literal("ajuste_provento").nullable(),
});

const ajusteProventoSchema = z.object({
  data_ex: z.string(),
  valor_ajuste_por_acao: z.number(),
  pernas_afetadas: z.array(z.string()),
  explicacao: z.string(),
});

const resumoBacktestSchema = z.object({
  // Risco SEMPRE antes do ganho (§2).
  risco_maximo: z.number(),
  rotulo_risco: z.enum(["DEFINIDO", "INDEFINIDO"]),
  ganho_maximo: z.union([z.number(), z.literal("ilimitado")]),
  pl_final: z.number(),
  pl_final_pct_risco: z.number().nullable(),
  dias_ate_vencimento: z.number().int(),
  liquidado_no_vencimento: z.boolean(),
  avisos: z.array(z.string()),
  // Vazio quando não houve evento corporativo na janela.
  ajustes_provento: z.array(ajusteProventoSchema),
});

const backtestRespostaSchema = z.object({
  aviso: z.string(), // SIMULAÇÃO HISTÓRICA — passado não garante futuro (§2)
  ativo: z.string(),
  data_entrada: z.string(),
  data_saida: z.string(),
  vencimento: z.string(),
  serie: z.array(pontoSerieSchema),
  resumo: resumoBacktestSchema,
});

export type PontoSerieBacktest = z.infer<typeof pontoSerieSchema>;
export type AjusteProvento = z.infer<typeof ajusteProventoSchema>;
export type ResumoBacktest = z.infer<typeof resumoBacktestSchema>;
export type RespostaBacktest = z.infer<typeof backtestRespostaSchema>;

/** Monta o corpo snake_case do `/backtest`. As pernas viram option_symbol/lado/qtd. */
function montarBodyBacktest(p: BacktestParams): Record<string, unknown> {
  const body: Record<string, unknown> = {
    pernas: p.pernas.map((perna) => ({
      option_symbol: perna.optionSymbol,
      lado: perna.lado,
      quantidade: perna.quantidade,
    })),
    data_entrada: p.dataEntrada,
  };
  if (p.dataSaida) body.data_saida = p.dataSaida;
  if (p.tamanhoLote != null) body.tamanho_lote = p.tamanhoLote;
  return body;
}

/**
 * Chama `POST /backtest` do microserviço e valida a resposta com Zod.
 *
 * Três famílias de erro, propositalmente distintas:
 *  - rede/timeout/5xx → `QuantServiceIndisponivelError` (serviço fora/hibernando);
 *  - 422/400          → `BacktestEntradaError` (dado insuficiente/estrutura inválida —
 *    é o usuário que corrige, não o serviço que caiu);
 *  - contrato divergente → `ZodError` (a rota traduz para 502).
 *
 * NÃO recalcula nada: série e resumo (risco/ganho/pl_final/ajustes) vêm 100% do
 * serviço (mesmas fórmulas do §18).
 */
export async function backtestEstrutura(
  params: BacktestParams,
  opcoes: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<RespostaBacktest> {
  const resp = await postQuant("/backtest", montarBodyBacktest(params), opcoes);

  if (resp.status === 422 || resp.status === 400) {
    const corpo = (await resp.json().catch(() => null)) as
      | { detail?: { erro?: string; faltam?: string[] } }
      | null;
    const detalhe = corpo?.detail ?? {};
    throw new BacktestEntradaError(
      resp.status,
      detalhe.erro ??
        "Não foi possível rodar a simulação com os dados informados.",
      detalhe.faltam,
    );
  }
  if (!resp.ok) {
    throw new QuantServiceIndisponivelError(
      `O serviço de quant respondeu ${resp.status}.`,
    );
  }

  const json: unknown = await resp.json().catch(() => null);
  return backtestRespostaSchema.parse(json);
}

/** Pinga o `/health` do microserviço (o Next.js confere antes de oferecer a triagem). */
export async function quantServiceDisponivel(
  opcoes: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<boolean> {
  const fetchImpl = opcoes.fetchImpl ?? globalThis.fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opcoes.timeoutMs ?? 5_000);
  try {
    const resp = await fetchImpl(`${baseUrl().replace(/\/$/, "")}/health`, {
      signal: controller.signal,
      cache: "no-store",
    });
    return resp.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
