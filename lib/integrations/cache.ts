/**
 * cache — núcleo de cache REUTILIZÁVEL das integrações (§6.3 do PRD).
 *
 * Get-or-fetch com TTL e degradação graciosa, compartilhado por `brapi.ts` e
 * `oplab.ts`. O armazenamento é abstraído atrás de `CacheStore` (default:
 * tabela `api_cache` via Drizzle, §7) para ser testável sem Postgres.
 *
 * Resiliência (§6.3, §13): falha/cota degrada para o cache (mesmo vencido) com
 * aviso + flag de "forçar atualização". Erro só sobe quando NÃO há cache.
 */

import { eq } from "drizzle-orm";

import { getDb } from "@/db";
import { apiCache } from "@/db/schema";

/** Erro: a fonte falhou E não havia cache para degradar — sem dado a exibir. */
export class IntegracaoIndisponivelError extends Error {
  constructor(
    public readonly chave: string,
    public readonly causa: unknown,
  ) {
    super(`integração indisponível e sem cache para "${chave}"`);
    this.name = "IntegracaoIndisponivelError";
  }
}

/** Resultado padrão de uma busca com cache (§6.3). */
export interface ResultadoIntegracao<T> {
  dado: T;
  /** `rede` = recém-buscado; `cache` = hit válido; `cache_fallback` = vencido após falha. */
  origem: "rede" | "cache" | "cache_fallback";
  /** Quando o dado foi obtido da rede (para exibir "dado de HH:MM"). */
  geradoEm: Date;
  /** `true` quando se está mostrando dado vencido por falha/cota. */
  desatualizado: boolean;
  /** Front deve oferecer "forçar atualização". */
  podeForcarAtualizacao: boolean;
  /** Aviso pronto para a UI (presente no fallback). */
  aviso?: string;
}

/** Registro lido do cache. */
export interface RegistroCache {
  payload: unknown;
  /** `createdAt` — quando o dado foi gravado (= obtido da rede). */
  geradoEm: Date;
  /** `expiresAt` — instante de expiração (TTL). */
  expiraEm: Date;
}

/** Armazenamento de cache (get-or-fetch). Injetável nos testes. */
export interface CacheStore {
  ler(chave: string): Promise<RegistroCache | null>;
  gravar(chave: string, payload: unknown, expiraEm: Date): Promise<void>;
}

/** Opções comuns das buscas (injeções para teste + controle de cache). */
export interface OpcoesBusca {
  /** Ignora o cache válido e força ida à rede (ainda degrada em falha). */
  forcar?: boolean;
  /** Store de cache (default: `api_cache` via Drizzle). Injetável em teste. */
  store?: CacheStore;
  /** "Agora" para o cálculo de TTL (default: data atual). */
  agora?: Date;
  /** Implementação de `fetch` (default: `globalThis.fetch`). Mock em teste. */
  fetchImpl?: typeof fetch;
}

/** Store padrão: tabela `api_cache` via Drizzle (§7). */
export function criarCacheStoreDrizzle(): CacheStore {
  return {
    async ler(chave) {
      const db = getDb();
      const linhas = await db
        .select()
        .from(apiCache)
        .where(eq(apiCache.key, chave))
        .limit(1);
      const linha = linhas[0];
      if (!linha) return null;
      return {
        payload: linha.payload,
        geradoEm: linha.createdAt,
        expiraEm: linha.expiresAt,
      };
    },
    async gravar(chave, payload, expiraEm) {
      const db = getDb();
      await db
        .insert(apiCache)
        .values({ key: chave, payload, expiresAt: expiraEm })
        .onConflictDoUpdate({
          target: apiCache.key,
          set: { payload, expiresAt: expiraEm, createdAt: new Date() },
        });
    },
  };
}

let _storePadrao: CacheStore | null = null;
/** Store padrão memoizado (só toca no banco quando ler/gravar é chamado). */
export function storePadrao(): CacheStore {
  if (!_storePadrao) _storePadrao = criarCacheStoreDrizzle();
  return _storePadrao;
}

/** Formata "HH:MM" no fuso de São Paulo para o aviso de dado em cache. */
function horaMinuto(d: Date): string {
  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  }).format(d);
}

/**
 * Núcleo de cache: get-or-fetch com TTL e degradação graciosa.
 *
 * - cache válido (e sem `forcar`) → devolve do cache;
 * - sem cache ou vencido → busca na rede, grava e devolve;
 * - falha/cota na rede → devolve o cache (mesmo vencido) com aviso + flag de
 *   forçar atualização; só lança erro se NÃO houver nada em cache (§6.3).
 */
export async function cacheGetOrFetch<T>(args: {
  chave: string;
  ttlSegundos: number;
  buscar: () => Promise<T>;
  store: CacheStore;
  agora: Date;
  forcar: boolean;
}): Promise<ResultadoIntegracao<T>> {
  const { chave, ttlSegundos, buscar, store, agora, forcar } = args;

  const registro = await store.ler(chave);
  const valido =
    registro !== null && registro.expiraEm.getTime() > agora.getTime();

  // 1) Cache hit válido.
  if (!forcar && valido) {
    return {
      dado: registro!.payload as T,
      origem: "cache",
      geradoEm: registro!.geradoEm,
      desatualizado: false,
      podeForcarAtualizacao: false,
    };
  }

  // 2) Buscar na rede (sem cache, vencido, ou forçado).
  try {
    const dado = await buscar();
    const expiraEm = new Date(agora.getTime() + ttlSegundos * 1000);
    await store.gravar(chave, dado, expiraEm);
    return {
      dado,
      origem: "rede",
      geradoEm: agora,
      desatualizado: false,
      podeForcarAtualizacao: false,
    };
  } catch (causa) {
    // 3) Falha/cota → degrada para o cache vencido, se houver.
    if (registro !== null) {
      return {
        dado: registro.payload as T,
        origem: "cache_fallback",
        geradoEm: registro.geradoEm,
        desatualizado: true,
        podeForcarAtualizacao: true,
        aviso: `Mostrando dado de ${horaMinuto(registro.geradoEm)} — não foi possível atualizar agora.`,
      };
    }
    // Sem nada em cache: não há o que exibir. O Route Handler trata (§6.3).
    throw new IntegracaoIndisponivelError(chave, causa);
  }
}
