/**
 * Tipos das respostas das rotas de API consumidas pela tela de Análise (§8.2).
 * Espelham o que `/api/ativo`, `/api/cadeia` e `/api/calendario` devolvem. Os
 * tipos de domínio vêm das integrações via `import type` (apagado em runtime —
 * não puxa código server-only para o cliente).
 */

import type { Fundamentos } from "@/lib/fundamentos/tipos";
import type { CadeiaOpcoes, VolatilidadeAtivo } from "@/lib/opcoes/tipos";

/** Metadado de frescor (§6.3), espelhando `Frescor` do Route Handler. */
export interface Frescor {
  origem: "rede" | "cache" | "cache_fallback";
  geradoEm: string;
  desatualizado: boolean;
  podeForcarAtualizacao: boolean;
  aviso?: string;
}

/**
 * Preço EOD do ativo-objeto (Bloco Técnico) — vem de `acao_cotahist` (COTAHIST),
 * não mais de cotação ao vivo. `variacao`/`variacaoPercent`/`volume` podem ser
 * `null` (ex.: só 1 pregão disponível para derivar a variação). `dataPregao` é o
 * fechamento (ISO) que a tela carimba ("fechamento de DD/MM").
 */
export interface PrecoAtivoEod {
  preco: number;
  variacao: number | null;
  variacaoPercent: number | null;
  volume: number | null;
  dataPregao: string;
}

/** GET /api/ativo/{ticker}. Duas fontes → dois frescores (preço EOD × fundamentos). */
export interface RespostaAtivo {
  ticker: string;
  preco: PrecoAtivoEod;
  fundamentos: Fundamentos | null;
  frescor: { preco: Frescor; fundamentos: Frescor | null };
}

/** GET /api/cadeia/{ativo} (aqui só usamos IV/volatilidade). */
export interface RespostaCadeia {
  ativo: string;
  cadeia: CadeiaOpcoes;
  volatilidade: VolatilidadeAtivo | null;
  frescor: { cadeia: Frescor; volatilidade: Frescor | null };
}

/**
 * Sinalização honesta de evento NÃO obtido automaticamente (§2.4, §6.4) — mesmo
 * formato de `ResultadosIndisponivel`. Proventos e resultados são MANUAIS: a tela
 * mostra `motivo` + `fonteAlternativa`, nunca uma lista vazia silenciosa.
 */
export interface EventosIndisponivel {
  disponivel: false;
  motivo: string;
  fonteAlternativa: string;
}

/**
 * GET /api/calendario/{ticker}. A busca automática foi DESLIGADA (5.6): proventos
 * e resultados vêm como indisponíveis tipados (sem rede, sem frescor).
 */
export interface RespostaCalendario {
  ticker: string;
  proventos: EventosIndisponivel;
  resultados: EventosIndisponivel;
}
