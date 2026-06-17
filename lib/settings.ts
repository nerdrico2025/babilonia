/**
 * settings — preferências do usuário e validações da tela de Configurações
 * (tela 3, §7, §14). Módulo PURO (só Zod), importável de qualquer lugar.
 *
 * O capital total mora numa coluna própria (`settings.total_capital`); aqui ficam
 * só as PREFERÊNCIAS DE EXIBIÇÃO (jsonb `display_preferences`) e a validação do
 * ticker da watchlist. Mantemos o formato extensível: novas preferências entram
 * sem migração de schema.
 */

import { z } from "zod";

/** Temas de exibição suportados (claro/escuro — o app usa a classe `.dark`). */
export const TEMAS = ["claro", "escuro"] as const;
export type Tema = (typeof TEMAS)[number];

/**
 * Preferências de exibição persistidas em `settings.display_preferences`.
 * `catch`/`default` garantem que dado antigo ou ausente nunca quebre a leitura.
 */
export const preferenciasSchema = z.object({
  tema: z.enum(TEMAS).catch("claro").default("claro"),
});

export type Preferencias = z.infer<typeof preferenciasSchema>;

/** Preferências padrão (usadas quando não há nada salvo). */
export const PREFERENCIAS_PADRAO: Preferencias = { tema: "claro" };

/**
 * Lê preferências de um valor cru (jsonb do banco), tolerando formato antigo ou
 * inválido — nunca lança (§2.6). Campos desconhecidos são ignorados.
 */
export function lerPreferencias(bruto: unknown): Preferencias {
  const r = preferenciasSchema.safeParse(bruto ?? {});
  return r.success ? r.data : PREFERENCIAS_PADRAO;
}

/**
 * Ticker de ATIVO-OBJETO da B3 (ex.: PETR4, VALE3, TAEE11, BOVA11): 4 letras +
 * 1–2 dígitos. Normaliza para maiúsculas. Mesmo critério das rotas de API.
 */
export const tickerAtivoSchema = z
  .string()
  .trim()
  .transform((s) => s.toUpperCase())
  .pipe(z.string().regex(/^[A-Z]{4}\d{1,2}$/, "ticker da B3 inválido (ex.: PETR4)"));

/** Capital total: número ≥ 0 em BRL (base das regras de risco do §10). */
export const capitalSchema = z
  .number({ error: "informe um valor numérico" })
  .finite("valor inválido")
  .min(0, "o capital não pode ser negativo");
