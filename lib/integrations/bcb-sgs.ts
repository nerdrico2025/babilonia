/**
 * Integração BCB SGS — taxa livre de risco (Meta Selic, série 432).
 *
 * Contrato confirmado em `docs/apis/bcb-sgs.md` e §6.2/§6.3 do PRD; uso da taxa
 * no pricing em `docs/design/options-math-black-scholes.md`.
 *
 * A API do SGS (Sistema Gerenciador de Séries Temporais do Banco Central) é
 * PÚBLICA — sem chave, sem cota publicada. Usamos a **série 432** (Meta Selic
 * definida pelo Copom), que já vem em **% ao ano** — encaixe direto no
 * Black-Scholes sem precisar anualizar taxa diária (ver justificativa no doc).
 *
 * Regras de arquitetura (§5.1):
 *  - Nenhuma tela chama o SGS direto; tudo passa por aqui + cache (§6.3).
 *  - Falha/cota degrada para o último valor em cache; NUNCA derruba o pricing.
 *
 * Fallback quando NÃO há cache (primeira chamada já falhou): este módulo NÃO
 * inventa um número (§2.4). Ele lança `BcbSgsIndisponivelError` (reexportado do
 * núcleo de cache). A "constante de taxa padrão configurável em `settings`"
 * descrita no doc é responsabilidade do CONSUMIDOR (Route Handler), que pode
 * capturar esse erro e cair na taxa de `settings` — aqui o erro é explícito e
 * sinalizado, nunca silencioso.
 */

import { z } from "zod";

import { cacheGetOrFetch, storePadrao } from "./cache";
import type { OpcoesBusca, ResultadoIntegracao } from "./cache";

// Reexporta o núcleo de cache para consumidores/testes (mesmo padrão de brapi.ts).
export {
  criarCacheStoreDrizzle,
  IntegracaoIndisponivelError as BcbSgsIndisponivelError,
} from "./cache";
export type {
  OpcoesBusca,
  ResultadoIntegracao,
  CacheStore,
  RegistroCache,
} from "./cache";

// ── Configuração da série e TTL ──────────────────────────────────────────────

/**
 * Código da série no SGS. **432 = Meta Selic definida pelo Copom (% a.a.)**.
 * Alternativa documentada (taxa realizada, base 252): trocar para `"1178"` —
 * mesma unidade (% a.a.), encaixe direto, sem mais nenhuma mudança aqui
 * (ver `docs/apis/bcb-sgs.md`). ⚠️ NÃO usar 11/12 (são % ao DIA).
 */
export const SERIE_META_SELIC = "432";

/**
 * TTL de cache, em segundos. A Meta Selic só muda em reunião do Copom (~8x/ano),
 * então um TTL longo basta — usamos 12 horas (o suficiente para pegar a decisão
 * do Copom no dia seguinte sem martelar a API).
 */
export const TTL_SEGUNDOS = 12 * 60 * 60;

const BASE_URL = "https://api.bcb.gov.br/dados/serie";

// ── Erros ────────────────────────────────────────────────────────────────────

/** O SGS respondeu com erro de status HTTP. */
export class BcbSgsErroResposta extends Error {
  constructor(
    public readonly status: number,
    mensagem?: string,
  ) {
    super(`BCB SGS respondeu ${status}${mensagem ? `: ${mensagem}` : ""}`);
    this.name = "BcbSgsErroResposta";
  }
}

// ── Tipo de domínio (normalizado, JSON-safe p/ cache) ────────────────────────

/** Meta Selic vigente, já pronta para o Black-Scholes. */
export interface MetaSelic {
  /** Data de vigência como veio da fonte (`DD/MM/AAAA`). */
  data: string;
  /** Meta Selic em **% ao ano** (ex.: 10.5 = 10,5% a.a.), como na série 432. */
  selicAnual: number;
  /**
   * Taxa contínua equivalente — o `r` que o Black-Scholes espera (§18.1). É a
   * conversão da taxa anual EFETIVA para composição contínua. Ver `taxaContinua`.
   */
  rContinua: number;
}

// ── Conversão de taxa (pura, sem rede — testável isolada) ────────────────────

/**
 * Converte a Meta Selic anual (% a.a.) na **taxa contínua** equivalente, que é a
 * convenção que o `black-scholes.ts` usa para `r` (base 252, `r` contínua).
 *
 * Fórmula: `r = ln(1 + selic_anual / 100)`.
 *
 * Ex.: Selic 10% a.a. → `ln(1,10) ≈ 0,09531`. A taxa anual efetiva 10% e a
 * contínua ~9,531% descrevem o MESMO crescimento ao fim de 1 ano
 * (`e^0,09531 = 1,10`); o BS precisa da forma contínua porque desconta por `e^{-rT}`.
 */
export function taxaContinua(selicAnualPercent: number): number {
  return Math.log(1 + selicAnualPercent / 100);
}

// ── Chamada HTTP + validação (Zod) ───────────────────────────────────────────

/**
 * Resposta do SGS: array de `{ data: "DD/MM/AAAA", valor: "string numérica" }`.
 * `valor` SEMPRE vem como string (ex.: `"14.75"`) → convertemos para número.
 */
const itemSerieSchema = z.object({
  data: z.string().regex(/^\d{2}\/\d{2}\/\d{4}$/, "data deve ser DD/MM/AAAA"),
  valor: z.string(),
});
const respostaSchema = z.array(itemSerieSchema);

/** Converte o `valor` string da API em número; lança se não for numérico. */
function parsearValor(valor: string): number {
  const n = Number(valor);
  if (!Number.isFinite(n)) {
    throw new BcbSgsErroResposta(200, `valor não numérico da série: "${valor}"`);
  }
  return n;
}

/**
 * Busca o valor mais recente da série 432 e devolve já no formato de domínio
 * (com a taxa contínua calculada). Lança `BcbSgsErroResposta` em erro/sem dados.
 */
async function buscarMetaSelic(fetchImpl: typeof fetch): Promise<MetaSelic> {
  const url = `${BASE_URL}/bcdata.sgs.${SERIE_META_SELIC}/dados/ultimos/1?formato=json`;

  const resp = await fetchImpl(url, { headers: { Accept: "application/json" } });
  if (!resp.ok) {
    throw new BcbSgsErroResposta(resp.status);
  }

  const json: unknown = await resp.json().catch(() => null);
  const serie = respostaSchema.parse(json);

  // `ultimos/1` traz um único item; ausência = série sem dados (não inventar).
  const ultimo = serie[0];
  if (!ultimo) {
    throw new BcbSgsErroResposta(200, "série sem dados (resposta vazia)");
  }

  const selicAnual = parsearValor(ultimo.valor);
  return {
    data: ultimo.data,
    selicAnual,
    rContinua: taxaContinua(selicAnual),
  };
}

// ── API pública ──────────────────────────────────────────────────────────────

/**
 * Taxa livre de risco (Meta Selic, série 432) com cache e degradação graciosa.
 *
 * Em falha da API, degrada para o último valor em cache (mesmo vencido) com
 * aviso (§6.3). Sem cache nenhum, lança `BcbSgsIndisponivelError` — o consumidor
 * decide o fallback final (taxa de `settings`); este módulo não inventa número.
 */
export function getMetaSelic(
  opcoes: OpcoesBusca = {},
): Promise<ResultadoIntegracao<MetaSelic>> {
  const fetchImpl = opcoes.fetchImpl ?? globalThis.fetch;
  return cacheGetOrFetch({
    chave: `bcb-sgs:meta-selic:${SERIE_META_SELIC}`,
    ttlSegundos: TTL_SEGUNDOS,
    buscar: () => buscarMetaSelic(fetchImpl),
    store: opcoes.store ?? storePadrao(),
    agora: opcoes.agora ?? new Date(),
    forcar: opcoes.forcar ?? false,
  });
}
