/**
 * rascunho — ponte entre o MONTADOR (tela 6) e o TICKET (tela 7, §11).
 *
 * O montador não envia ordens nem grava no banco: ele monta a estrutura e a
 * "passa adiante" para a tela de ticket. Como ainda não há estado global, usamos
 * o `sessionStorage` do navegador como entrega temporária (some ao fechar a aba)
 * — simples e suficiente para o MVP (§2.6, "começar leve").
 *
 * É o CONTRATO consumido pela tela de ticket: salve aqui, navegue para `/ticket`,
 * e a tela lê o rascunho. Quando a integração com a cadeia (Prompt 13) e a
 * persistência chegarem, este módulo é o único ponto a evoluir.
 */

import type { EstruturaId, FamiliaEstrutura } from "./catalogo";
import type { ResultadoEstrutura } from "@/lib/options-math";
import type { AvaliacaoRisco } from "@/lib/risk-rules";

/** Chave única no sessionStorage. */
const CHAVE = "babilonia:rascunho-operacao";

/**
 * O rascunho de operação levado ao ticket. Tudo serializável (datas como ISO):
 * a estrutura (números do `options-math`), o contexto (ativo, vencimento,
 * capital) e as avaliações de risco do §10.
 */
export interface RascunhoOperacao {
  /**
   * Variante exata escolhida no montador. Opcional: ao "revisar" uma posição já
   * registrada (dashboard), só conhecemos a FAMÍLIA persistida, não a variante.
   */
  estruturaId?: EstruturaId;
  familia: FamiliaEstrutura;
  /** Resultado da estrutura — números 100% vindos do `options-math`. */
  estrutura: ResultadoEstrutura;
  /** Ativo-objeto (ex.: "PETR4"). */
  ativoObjeto: string;
  /** Vencimento da operação, em ISO (string) para serializar. */
  vencimentoISO: string;
  /** Capital total considerado (BRL) — base das regras de risco. */
  capitalTotal: number;
  /** Margem requerida pela corretora (BRL), quando risco indefinido. */
  margemRequerida?: number;
  /** Avaliações de risco do §10 (semáforo + texto). */
  avaliacoes: AvaliacaoRisco[];
  /**
   * Tickers EXATOS das opções, alinhados a `estrutura.legs` (mesma ordem).
   * Opcional: o montador não os conhece (o usuário digita no ticket), mas o
   * dashboard, ao "revisar" uma posição já registrada, pode pré-preenchê-los.
   */
  simbolos?: (string | null)[];
  /**
   * Quando presente, esta operação é uma ROLAGEM da position de id indicado: ao
   * confirmar no ticket, chama-se `rolarPosition` (cria a nova + marca a antiga
   * "rolada") em vez de `persistirTicket`. O ticket exibe o aviso de rolagem.
   */
  rolagemDePositionId?: number;
}

/** Salva o rascunho para a tela de ticket consumir. */
export function salvarRascunho(rascunho: RascunhoOperacao): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(CHAVE, JSON.stringify(rascunho));
}

/** Lê o rascunho atual (ou `null` se não houver / estiver corrompido). */
export function lerRascunho(): RascunhoOperacao | null {
  if (typeof window === "undefined") return null;
  const bruto = window.sessionStorage.getItem(CHAVE);
  if (!bruto) return null;
  try {
    return JSON.parse(bruto) as RascunhoOperacao;
  } catch {
    // Dado corrompido: não inventamos nada (§2.4) — descarta e devolve vazio.
    window.sessionStorage.removeItem(CHAVE);
    return null;
  }
}

/** Limpa o rascunho (após gerar o ticket, por exemplo). */
export function limparRascunho(): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(CHAVE);
}
