/**
 * format — formatadores de EXIBIÇÃO em pt-BR (§2: linguagem clara para leigos).
 *
 * Módulo PURO, só para a UI. Usa `Intl.NumberFormat` (locale pt-BR) para mostrar
 * dinheiro e preços de forma amigável. NÃO confundir com o formatador do TICKET
 * (`lib/ticket`), que é determinístico e tem regras próprias de §11 — aqui é só
 * para telas (montador, resumos).
 *
 * Regra de ouro do app: os NÚMEROS vêm sempre de `lib/options-math`; estas
 * funções apenas os VESTEM para leitura — nunca calculam nada.
 */

const FORMATADOR_BRL = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const FORMATADOR_PRECO = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Formata um valor em BRL (ex.: 1234.5 → "R$ 1.234,50"). */
export function formatBRL(valor: number): string {
  return FORMATADOR_BRL.format(valor);
}

/** Formata um preço de ativo/strike em BRL (ex.: 28.7 → "R$ 28,70"). */
export function formatPreco(valor: number): string {
  return FORMATADOR_PRECO.format(valor);
}

/** Formata uma fração como percentual em pt-BR (0.075 → "7,5%"). */
export function formatPct(fracao: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "percent",
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  }).format(fracao);
}
