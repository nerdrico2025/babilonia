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

// Reexporta o núcleo de cache para consumidores/testes (mesmo padrão de bolsai.ts).
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

// ── Série HISTÓRICA da Selic (para o backfill de IV por pregão) ──────────────
//
// O `getMetaSelic` traz só o valor MAIS RECENTE — serve para precificar hoje. O
// backfill de IV histórica (iv_history) precisa do `r` de CADA pregão passado,
// e a Meta Selic muda em reunião do Copom (~8x/ano). Por isso buscamos a SÉRIE
// no intervalo e montamos um resolvedor data→taxa (passo-a-passo: vale a última
// meta com data ≤ pregão). Sem cache aqui: é um job batch, rodado raramente.

/** Um ponto da série da Meta Selic já normalizado (data + % a.a. + contínua). */
export interface PontoSelic {
  /** Data de vigência (UTC, meia-noite). */
  data: Date;
  /** Meta Selic em % a.a. (como a série 432). */
  selicAnual: number;
  /** Taxa contínua equivalente (`ln(1 + selic/100)`) — o `r` do Black-Scholes. */
  rContinua: number;
}

/** `DD/MM/AAAA` (formato do SGS) → `Date` UTC à meia-noite. */
function parseDataSgs(s: string): Date {
  const [dia, mes, ano] = s.split("/").map(Number) as [number, number, number];
  return new Date(Date.UTC(ano, mes - 1, dia));
}

/** `Date` → `DD/MM/AAAA` (parâmetro de consulta do SGS). */
function formatDataSgs(d: Date): string {
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getUTCFullYear()}`;
}

/**
 * Busca a SÉRIE da Meta Selic (432) entre duas datas, ordenada por data. Lança
 * `BcbSgsErroResposta` em erro de status / resposta inválida. Sem cache (job batch).
 */
export async function buscarSerieMetaSelic(
  dataInicial: Date,
  dataFinal: Date,
  opcoes: { fetchImpl?: typeof fetch } = {},
): Promise<PontoSelic[]> {
  const fetchImpl = opcoes.fetchImpl ?? globalThis.fetch;
  const url =
    `${BASE_URL}/bcdata.sgs.${SERIE_META_SELIC}/dados?formato=json` +
    `&dataInicial=${formatDataSgs(dataInicial)}&dataFinal=${formatDataSgs(dataFinal)}`;

  const resp = await fetchImpl(url, { headers: { Accept: "application/json" } });
  if (!resp.ok) throw new BcbSgsErroResposta(resp.status);

  const json: unknown = await resp.json().catch(() => null);
  const serie = respostaSchema.parse(json);

  return serie
    .map((item) => {
      const selicAnual = parsearValor(item.valor);
      return {
        data: parseDataSgs(item.data),
        selicAnual,
        rContinua: taxaContinua(selicAnual),
      };
    })
    .sort((a, b) => a.data.getTime() - b.data.getTime());
}

/**
 * Monta um resolvedor PURO data→taxa contínua a partir da série: para um pregão,
 * devolve a `rContinua` da última vigência com `data ≤ pregão` (a Meta Selic é
 * constante entre reuniões do Copom). Devolve `null` se o pregão é ANTERIOR ao
 * primeiro ponto da série (não inventa taxa — §2.4). Testável sem rede.
 */
export function criarResolvedorSelic(
  serie: readonly PontoSelic[],
): (pregao: Date) => number | null {
  // Cópia ordenada por data crescente (não confia na ordem da entrada).
  const ordenada = [...serie].sort(
    (a, b) => a.data.getTime() - b.data.getTime(),
  );
  return (pregao: Date): number | null => {
    const t = pregao.getTime();
    let escolhido: number | null = null;
    for (const ponto of ordenada) {
      if (ponto.data.getTime() <= t) escolhido = ponto.rContinua;
      else break; // ordenada → o resto é posterior ao pregão
    }
    return escolhido;
  };
}
