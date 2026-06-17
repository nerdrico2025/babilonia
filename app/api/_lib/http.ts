/**
 * Helpers compartilhados dos Route Handlers (§5.1 do PRD).
 *
 * As rotas em `app/api/` são o ÚNICO ponto que fala com as integrações
 * (brapi/OpLab) — nenhuma tela chama as APIs externas direto. Este módulo
 * concentra o que toda rota repete: guarda de sessão (§13), metadado de
 * "frescor" do dado (§6.3) e tradução de erros para JSON.
 *
 * A pasta `_lib` começa com `_`: o App Router a trata como privada (não vira
 * rota), então é seguro guardar utilitários aqui.
 */
import { z } from "zod";

import { auth } from "@/auth";
import {
  IntegracaoIndisponivelError,
  type ResultadoIntegracao,
} from "@/lib/integrations/cache";

/**
 * Ticker do ATIVO-OBJETO da B3 (ex.: PETR4, VALE3, TAEE11, BOVA11): 4 letras +
 * 1–2 dígitos. Normaliza para maiúsculas antes de validar. Rejeita lixo de
 * entrada antes de gastar uma chamada de integração.
 */
export const tickerSchema = z
  .string()
  .trim()
  .transform((s) => s.toUpperCase())
  .pipe(z.string().regex(/^[A-Z]{4}\d{1,2}$/, "ticker da B3 inválido (ex.: PETR4)"));

/**
 * Metadado de frescor exposto na resposta (§6.3): de onde veio o dado e se
 * está atualizado. A UI usa isso para mostrar "dado de HH:MM" e o botão de
 * forçar atualização. `geradoEm` vai como ISO string (JSON-safe).
 */
export interface Frescor {
  /** `rede` = recém-buscado; `cache` = hit válido; `cache_fallback` = vencido após falha. */
  origem: ResultadoIntegracao<unknown>["origem"];
  /** Quando o dado foi obtido da fonte (ISO 8601). */
  geradoEm: string;
  /** `true` quando se está servindo dado vencido por falha/cota da fonte. */
  desatualizado: boolean;
  /** A UI deve oferecer "forçar atualização". */
  podeForcarAtualizacao: boolean;
  /** Aviso pronto para a tela (presente no fallback). */
  aviso?: string;
}

/** Extrai o metadado de frescor de um `ResultadoIntegracao` (§6.3). */
export function frescorDe(r: ResultadoIntegracao<unknown>): Frescor {
  return {
    origem: r.origem,
    geradoEm: r.geradoEm.toISOString(),
    desatualizado: r.desatualizado,
    podeForcarAtualizacao: r.podeForcarAtualizacao,
    ...(r.aviso ? { aviso: r.aviso } : {}),
  };
}

/**
 * Guarda de sessão (§13). O `proxy.ts` já barra o acesso não autenticado, mas
 * checamos de novo aqui (defesa em profundidade) e devolvemos **401 JSON** —
 * uma rota de API não deve redirecionar para a tela de login.
 *
 * Retorna `null` quando há sessão (siga em frente) ou uma `Response` 401 para
 * a rota devolver imediatamente.
 */
export async function exigirSessao(): Promise<Response | null> {
  const session = await auth();
  if (!session?.user) {
    return Response.json(
      { erro: "não autenticado", mensagem: "Faça login para acessar esta rota." },
      { status: 401 },
    );
  }
  return null;
}

/**
 * Traduz uma falha de integração para resposta JSON. `IntegracaoIndisponivelError`
 * (fonte caiu E não havia cache, §6.3) vira **503**; o resto vira **502**. Nunca
 * vaza stack/segredos para o cliente.
 */
export function erroIntegracao(e: unknown): Response {
  if (e instanceof IntegracaoIndisponivelError) {
    return Response.json(
      {
        erro: "integração indisponível",
        mensagem:
          "Não foi possível obter o dado agora e não há versão em cache. Tente de novo em instantes.",
      },
      { status: 503 },
    );
  }
  return Response.json(
    {
      erro: "falha ao consultar a fonte de dados",
      mensagem: "Ocorreu um erro inesperado ao consultar a integração.",
    },
    { status: 502 },
  );
}

/** Resposta padrão de parâmetro inválido (Zod) — 400 com a lista de problemas. */
export function erroParametro(mensagem: string, detalhes?: unknown): Response {
  return Response.json(
    { erro: "parâmetro inválido", mensagem, detalhes },
    { status: 400 },
  );
}

/**
 * Lê o flag `?forcar=true` da query (§6.3): ignora o cache válido e rebusca na
 * fonte. Qualquer outro valor (ou ausência) = `false`.
 */
export function lerForcar(url: string): boolean {
  return new URL(url).searchParams.get("forcar") === "true";
}
