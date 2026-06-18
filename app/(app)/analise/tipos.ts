/**
 * Tipos das respostas das rotas de API consumidas pela tela de Análise (§8.2).
 * Espelham o que `/api/ativo`, `/api/cadeia` e `/api/calendario` devolvem. Os
 * tipos de domínio vêm das integrações via `import type` (apagado em runtime —
 * não puxa código server-only para o cliente).
 */

import type {
  BrapiCotacao,
  BrapiFundamentos,
  BrapiProvento,
} from "@/lib/integrations/brapi";
import type { CadeiaOpcoes, VolatilidadeAtivo } from "@/lib/opcoes/tipos";

/** Metadado de frescor (§6.3), espelhando `Frescor` do Route Handler. */
export interface Frescor {
  origem: "rede" | "cache" | "cache_fallback";
  geradoEm: string;
  desatualizado: boolean;
  podeForcarAtualizacao: boolean;
  aviso?: string;
}

/** GET /api/ativo/{ticker}. */
export interface RespostaAtivo {
  ticker: string;
  cotacao: BrapiCotacao;
  fundamentos: BrapiFundamentos | null;
  frescor: { cotacao: Frescor; fundamentos: Frescor | null };
}

/** GET /api/cadeia/{ativo} (aqui só usamos IV/volatilidade). */
export interface RespostaCadeia {
  ativo: string;
  cadeia: CadeiaOpcoes;
  volatilidade: VolatilidadeAtivo | null;
  frescor: { cadeia: Frescor; volatilidade: Frescor | null };
}

/** GET /api/calendario/{ticker}. */
export interface RespostaCalendario {
  ticker: string;
  proventos: BrapiProvento[];
  resultados: { disponivel: false; motivo: string; fonteAlternativa: string };
  frescor: { proventos: Frescor };
}
