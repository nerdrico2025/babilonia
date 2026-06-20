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
  const fetchImpl = opcoes.fetchImpl ?? globalThis.fetch;
  const timeoutMs = opcoes.timeoutMs ?? TIMEOUT_PADRAO_MS;
  const url = `${baseUrl().replace(/\/$/, "")}/screening`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let resp: Response;
  try {
    resp = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(montarBody(params)),
      signal: controller.signal,
      // Screening é sempre fresco; não cachear no fetch do servidor.
      cache: "no-store",
    });
  } catch (e) {
    const abortou = e instanceof Error && e.name === "AbortError";
    throw new QuantServiceIndisponivelError(
      abortou
        ? "O serviço de triagem não respondeu a tempo (pode estar iniciando)."
        : "Não foi possível falar com o serviço de triagem.",
      e,
    );
  } finally {
    clearTimeout(timer);
  }

  if (!resp.ok) {
    throw new QuantServiceIndisponivelError(
      `O serviço de triagem respondeu ${resp.status}.`,
    );
  }

  const json: unknown = await resp.json().catch(() => null);
  // Parse estrito: se o contrato divergir, falha alto (ZodError) — não inventamos.
  return respostaSchema.parse(json);
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
