/**
 * selecao-cadeia — ponte da CADEIA (tela 5, §8.3) para o MONTADOR (tela 6).
 *
 * Quando o usuário seleciona séries na cadeia e clica "montar estrutura", as
 * séries escolhidas viajam até o montador por aqui. Como ainda não há estado
 * global, usamos o `sessionStorage` (some ao fechar a aba) — simples e suficiente
 * no MVP (§2.6). É o CONTRATO consumido pelo montador (ver `prefill.ts`).
 *
 * Os NÚMEROS (strike, prêmio de referência) vêm da cadeia (COTAHIST); aqui só os
 * transportamos — nada é inventado (§2.4).
 */

import type { TipoOpcao } from "@/lib/options-math";

import type { EstruturaId } from "./catalogo";

/** Uma série de opção escolhida na cadeia, pronta para virar perna. */
export interface SerieSelecionada {
  /** Ticker exato da opção (ex.: "PETRK221"). */
  symbol: string;
  tipo: TipoOpcao;
  /** Strike em BRL, por ação. */
  strike: number;
  /** Vencimento (data ISO, como veio da cadeia). */
  vencimento: string;
  /** Prêmio de referência (mid bid/ask), em BRL por ação; `null` se faltar. */
  premioRef: number | null;
  bid: number | null;
  ask: number | null;
}

/** Conjunto de séries trazidas da cadeia para o montador. */
export interface SelecaoCadeia {
  /** Ativo-objeto (ex.: "PETR4"). */
  ativo: string;
  series: SerieSelecionada[];
  /**
   * Estrutura JÁ identificada (preenchida pela TRIAGEM do screening, §15): quando
   * presente, o montador a seleciona sozinho e pré-preenche tudo — o usuário não
   * redigita nada. Vindo da cadeia (seleção manual de séries), fica `undefined` e
   * o usuário escolhe a estrutura normalmente.
   */
  estruturaSugerida?: EstruturaId;
}

const CHAVE = "babilonia:selecao-cadeia";

/** Salva a seleção para o montador consumir. */
export function salvarSelecaoCadeia(selecao: SelecaoCadeia): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(CHAVE, JSON.stringify(selecao));
}

/** Lê a seleção atual (ou `null` se não houver / estiver corrompida). */
export function lerSelecaoCadeia(): SelecaoCadeia | null {
  if (typeof window === "undefined") return null;
  const bruto = window.sessionStorage.getItem(CHAVE);
  if (!bruto) return null;
  try {
    return JSON.parse(bruto) as SelecaoCadeia;
  } catch {
    window.sessionStorage.removeItem(CHAVE);
    return null;
  }
}

/** Limpa a seleção (após consumir no montador, por exemplo). */
export function limparSelecaoCadeia(): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(CHAVE);
}
